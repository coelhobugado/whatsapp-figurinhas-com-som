import { normalizeMessageContent, type proto, type WAMessage } from '@whiskeysockets/baileys';
import type { FitMode } from './convert.js';
import { findLink, type FoundLink } from './link-download.js';

export type Command = 'som' | 'figurinha' | 'ajuda';

const ALIASES: Record<string, Command> = {
  '!som': 'som', '!fs': 'som', '!figsom': 'som',
  '!fig': 'figurinha', '!figurinha': 'figurinha', '!f': 'figurinha', '!s': 'figurinha',
  '!ajuda': 'ajuda', '!help': 'ajuda', '!comandos': 'ajuda',
};

export const HELP_TEXT = [
  '*Bot de figurinhas com som* 🔊',
  '',
  '*!som* — envie um vídeo com a legenda !som, ou responda a um vídeo com !som.',
  '*!fig* — figurinha comum (sem som) de foto, vídeo ou GIF.',
  '*!ajuda* — mostra esta mensagem.',
  '',
  'No lugar do vídeo, dá para mandar o link: *!som <link>* ou *!fig <link>* (TikTok, Instagram ou YouTube).',
  '',
  '⏱️ *Escolha o trecho:* *!som 0:42 <link>* começa no 0:42 e usa até 10 s. *!som 0:42-0:47 <link>* usa só esse pedaço. Vale também com vídeo enviado. No YouTube, link com tempo (?t=42) já começa nesse ponto.',
  '',
  'A figurinha preenche o quadrado cortando as sobras. Para manter a imagem inteira, use *!som inteiro* ou *!fig inteiro*.',
  'Limites: até 10 segundos por figurinha, arquivo de até 16 MB. Vídeos mandados como documento também valem.',
].join('\n');

/** Trecho escolhido do vídeo, em segundos. */
export type Clip = { start: number; seconds?: number };

/** "42", "42s", "0:42", "1:02:03", "0:42.5" → segundos. */
export function parseTime(token: string): number | undefined {
  const t = token.trim().toLowerCase();
  if (/^\d+(?:[.,]\d+)?s?$/.test(t)) return Number(t.replace(/s$/, '').replace(',', '.'));
  if (!/^\d{1,2}(?::\d{1,2}){1,2}(?:[.,]\d+)?$/.test(t)) return undefined;
  const parts = t.replace(',', '.').split(':').map(Number);
  if (parts.slice(1).some(p => p >= 60)) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function formatTime(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Lê o trecho pedido depois do comando: "0:42" (início) ou "0:42-0:47" (início e fim).
 * Ignora links e o "inteiro". Devolve uma mensagem de erro se o tempo estiver errado.
 */
export function parseClip(text: string): Clip | { error: string } | undefined {
  const tokens = text.split(/\s+/).slice(1).filter(t => t && !/^https?:\/\//i.test(t) && !/^!?inteiro$/i.test(t));
  const timeLike = tokens.find(t => /^\d[\d:.,s]*(?:-\d[\d:.,s]*)?$/i.test(t));
  if (!timeLike) return undefined;
  const [from, to] = timeLike.split('-');
  const start = parseTime(from!);
  if (start === undefined) return { error: `Não entendi o tempo "${timeLike}". Use assim: *!som 0:42* ou *!som 0:42-0:47*.` };
  if (to === undefined) return { start };
  const end = parseTime(to);
  if (end === undefined || end <= start) return { error: `O fim do trecho precisa vir depois do começo. Ex.: *!som 0:42-0:47*.` };
  return { start, seconds: end - start };
}

/**
 * O número parece brasileiro escrito sem o 55 (DDD + celular com 9, ou DDD + fixo)?
 * É um palpite: um número estrangeiro sem o código do país pode ter o mesmo formato
 * (ex.: Rússia 7 999…, EUA sem o 1). Por isso o bot avisa ao iniciar quando usa esse palpite.
 */
export function assumedBrazilian(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  return (d.length === 11 && d[2] === '9') || (d.length === 10 && /^[1-9]{2}[2-9]/.test(d));
}

/** Avisos para mostrar ao iniciar: números que o bot vai tratar como brasileiros sem o 55. */
export function allowedNumberWarnings(entries: string[]): string[] {
  return entries.filter(assumedBrazilian).map(entry => {
    const d = entry.replace(/\D/g, '');
    return `Considerei ${d} um número brasileiro (+55 ${d.slice(0, 2)} ${d.slice(2)}). ` +
      'Se for de outro país, escreva com o código do país (ex.: 1 para EUA, 7 para Rússia).';
  });
}

/**
 * Formas aceitas de um número do `ALLOWED_NUMBERS`. Brasil: completa o 55 quando falta (DDD + número)
 * e aceita o celular com e sem o 9 da frente, porque o WhatsApp guarda muitos números antigos sem ele.
 */
export function phoneVariants(raw: string): string[] {
  const original = raw.replace(/\D/g, '');
  if (!original) return [];
  const digits = assumedBrazilian(original) ? `55${original}` : original;
  const variants = new Set([digits, original]);
  if (digits.startsWith('55')) {
    const ddd = digits.slice(2, 4), local = digits.slice(4);
    if (local.length === 9 && local.startsWith('9')) variants.add(`55${ddd}${local.slice(1)}`);
    if (local.length === 8 && /^[6-9]/.test(local)) variants.add(`55${ddd}9${local}`);
  }
  return [...variants];
}

/** Texto ou legenda da mensagem, já sem os embrulhos (temporária, visualização única etc.). */
export function messageText(content: proto.IMessage | undefined): string {
  return (content?.conversation ?? content?.extendedTextMessage?.text ?? content?.imageMessage?.caption
    ?? content?.videoMessage?.caption ?? content?.documentMessage?.caption ?? '').trim();
}

export function parseCommand(text: string): Command | undefined {
  const first = text.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  return ALIASES[first];
}

/** `!som inteiro` mantém o quadro todo (com bordas transparentes); o padrão corta para preencher. */
export function parseFit(text: string): FitMode {
  return text.toLowerCase().split(/\s+/).slice(1).some(t => t === 'inteiro' || t === '!inteiro') ? 'inteiro' : 'cortar';
}

export type MediaSource = { kind: 'image' | 'video'; message: WAMessage; fileLength: number; gif: boolean };

function mediaOf(content: proto.IMessage | undefined): Omit<MediaSource, 'message'> | undefined {
  if (content?.videoMessage) return { kind: 'video', fileLength: Number(content.videoMessage.fileLength ?? 0), gif: !!content.videoMessage.gifPlayback };
  if (content?.imageMessage) return { kind: 'image', fileLength: Number(content.imageMessage.fileLength ?? 0), gif: false };
  // Vídeo ou imagem mandados "como documento" (sem compressão do WhatsApp).
  const doc = content?.documentMessage;
  const mime = doc?.mimetype ?? '';
  if (doc && (mime.startsWith('video/') || mime === 'image/gif'))
    return { kind: 'video', fileLength: Number(doc.fileLength ?? 0), gif: mime === 'image/gif' };
  if (doc && mime.startsWith('image/')) return { kind: 'image', fileLength: Number(doc.fileLength ?? 0), gif: false };
  return undefined;
}

/** Mídia da própria mensagem ou, se não houver, da mensagem citada. */
export function findMedia(message: WAMessage): MediaSource | undefined {
  const content = normalizeMessageContent(message.message);
  const own = mediaOf(content);
  if (own) return { ...own, message };
  const context = content?.extendedTextMessage?.contextInfo ?? content?.imageMessage?.contextInfo
    ?? content?.videoMessage?.contextInfo ?? content?.documentMessage?.contextInfo;
  const quotedContent = normalizeMessageContent(context?.quotedMessage);
  const quoted = mediaOf(quotedContent);
  if (!quoted || !context?.stanzaId) return undefined;
  return {
    ...quoted,
    message: {
      key: { remoteJid: message.key.remoteJid, id: context.stanzaId, participant: context.participant ?? undefined },
      message: quotedContent,
    },
  };
}

/** Link de TikTok/Instagram/YouTube no texto da mensagem ou, se não houver, na mensagem citada. */
export function findMessageLink(message: WAMessage): FoundLink | undefined {
  const content = normalizeMessageContent(message.message);
  const own = findLink(messageText(content));
  if (own) return own;
  const context = content?.extendedTextMessage?.contextInfo ?? content?.imageMessage?.contextInfo
    ?? content?.videoMessage?.contextInfo ?? content?.documentMessage?.contextInfo;
  return findLink(messageText(normalizeMessageContent(context?.quotedMessage)));
}
