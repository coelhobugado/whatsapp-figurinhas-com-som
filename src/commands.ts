import { normalizeMessageContent, type proto, type WAMessage } from '@whiskeysockets/baileys';
import type { FitMode } from './convert.js';

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
  'A figurinha preenche o quadrado cortando as sobras. Para manter a imagem inteira, use *!som inteiro* ou *!fig inteiro*.',
  'Limites: usa os primeiros 10 segundos, arquivo de até 16 MB. Vídeos mandados como documento também valem.',
].join('\n');

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
