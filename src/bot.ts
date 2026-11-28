import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import makeWASocket, {
  DisconnectReason, downloadMediaMessage, jidDecode, normalizeMessageContent, useMultiFileAuthState,
  type WAMessage, type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import {
  ADMIN_HELP_TEXT, allowedNumberWarnings, commandArgument, findMedia, findMessageLink, formatTime, HELP_TEXT, messageText,
  parseClip, parseCommand, parseFit, parseUpdateAction, phoneVariants, type UpdateAction,
} from './commands.js';
import { createAnimatedSticker, createStaticSticker, MAX_INPUT_BYTES, MAX_SECONDS, type StickerResult } from './convert.js';
import {
  classifyError, DownloadError, errorFooter, ErrorLog, formatErrorDetail, formatErrorList, SendError, technicalText,
  type ErrorContext,
} from './errors.js';
import { checkTools, ConversionError, ffmpegVersion } from './ffmpeg.js';
import { downloadFromLink, LinkError, PLATFORM_NAME, youtubeStart, type FoundLink, type LinkClip } from './link-download.js';
import { Pacer, RateLimiter } from './limits.js';
import { PendingStore, slimMessage, type PendingJob } from './pending.js';
import { FairQueue, TimeoutError, withTimeout, type AddResult, type RefusalReason } from './queue.js';
import { markConnected, setQr, startQrPage } from './qr-page.js';
import { sendSoundSticker, uploadStickerAudio } from './sound-sticker.js';
import { attachPrompt, detachPrompt, header, lines, log, paint, status } from './terminal.js';
import {
  checkForUpdate, EXIT_CRASH, EXIT_RESTART, EXIT_RESTART_INSTALL, installedVersion, ROOT, saveEnvSetting, UPDATE_INTERVAL_MS,
  type UpdateCheck,
} from './updater.js';

// ---------------------------------------------------------------- configuração (.env)
const AUTH_DIR = process.env.AUTH_DIR || './sessao';
/** Pedidos pendentes e registro de erros. */
const DATA_DIR = process.env.DATA_DIR || './dados';
const QR_PORT = Number(process.env.QR_PORT || 3999);
const numberList = (value: string | undefined) => (value ?? '').split(/[,;\s]+/).filter(n => /\d/.test(n));
/** Números (DDI+DDD+número, só dígitos) que podem usar o bot. Vazio = qualquer pessoa. */
const ALLOWED_LIST = numberList(process.env.ALLOWED_NUMBERS);
const ALLOWED = new Set(ALLOWED_LIST.flatMap(phoneVariants));
/** Quem pode usar os comandos de dono (!atualizar, !erros), além do próprio número do bot. */
const ADMIN_LIST = numberList(process.env.ADMIN_NUMBERS);
const ADMIN = new Set(ADMIN_LIST.flatMap(phoneVariants));
/** Atualização automática: ligada, a não ser que AUTO_UPDATE=false (ou "!atualizar off"). */
let autoUpdate = process.env.AUTO_UPDATE !== 'false';
/** Nome mostrado ao tocar na figurinha (metadados EXIF). */
const STICKER_META = { packName: process.env.STICKER_PACK_NAME ?? 'Criada por Dexter', publisher: process.env.STICKER_PUBLISHER ?? '' };
/** DEBUG=true registra a chegada de cada mensagem e o tempo das etapas (sem conteúdo; de números, só os 4 últimos dígitos de quem foi recusado). */
const DEBUG = process.env.DEBUG === 'true';
const CORES = availableParallelism();
/** Figurinhas feitas ao mesmo tempo. Padrão pelo computador: 1 (até 3 núcleos), 2 (4 a 7), 3 (8 ou mais). */
const MAX_PARALLEL = Math.max(1, Number(process.env.MAX_PARALLEL) || (CORES >= 8 ? 3 : CORES >= 4 ? 2 : 1));
/** Pedidos na fila no total (fazendo + esperando). */
const MAX_PENDING = Math.max(1, Number(process.env.MAX_PENDING) || 20);
/** Ao voltar de uma queda, responde pedidos mandados até tantos minutos atrás. */
const MAX_AGE_MINUTES = Math.max(1, Number(process.env.MAX_MESSAGE_AGE_MINUTES) || 180);
/** Ritmo máximo de mensagens enviadas pelo bot (respostas, reações, figurinhas). */
const MAX_MESSAGES_PER_MINUTE = Math.max(10, Number(process.env.MAX_MESSAGES_PER_MINUTE) || 60);
// Anti-flood (quem cuida do bot não entra nesses limites).
const PER_PERSON_PENDING = 2;       // pedidos de uma pessoa na fila ao mesmo tempo
const PER_CHAT_PENDING = 6;         // pedidos de uma conversa (grupo) na fila ao mesmo tempo
const PERSON_PER_MINUTE = 6;        // comandos por pessoa por minuto
const GROUP_PER_MINUTE = 20;        // comandos por grupo por minuto
const JOB_TIMEOUT_MS = 3 * 60_000;  // tempo máximo de um pedido
/** Respondido com mais atraso que isso (o bot estava fora do ar) ganha um "desculpe a demora". */
const LATE_MS = 2 * 60_000;
const LATE_TEXT = 'Desculpe a demora: eu estava fora do ar quando você mandou.';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
let socket: WASocket;
let reconnectAttempt = 0;
let reconnectTimer: NodeJS.Timeout | undefined;
let updateTimer: NodeJS.Timeout | undefined;
let stopping = false;
/** Baixando uma versão nova: pedidos novos esperam o bot reabrir. */
let updating = false;

/**
 * Falha na janela: uma linha curta (com o motivo apagado ao lado). A pilha só aparece com DEBUG=true;
 * os detalhes completos ficam em dados/erros.jsonl e no "erros <ref>".
 */
function logError(text: string, error?: unknown, reason?: string): void {
  log.fail(text, reason);
  if (DEBUG && error instanceof Error && error.stack) log.detail(error.stack.split('\n').slice(1, 7).map(l => l.trim()).join('\n'));
}
const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
/** Nome do comando como a pessoa digita ("figurinha" → "!fig"). */
const commandName = (command: string) => command === 'figurinha' ? '!fig' : `!${command}`;
/** Contagem desde que o bot abriu, para o "status". */
const stats = { stickers: 0, failures: 0, since: Date.now() };

const errorLog = new ErrorLog(DATA_DIR);
const pending = new PendingStore(DATA_DIR);
const pacer = new Pacer(MAX_MESSAGES_PER_MINUTE, 20);
const personLimiter = new RateLimiter(PERSON_PER_MINUTE, 60_000);
const groupLimiter = new RateLimiter(GROUP_PER_MINUTE, 60_000);
/** Avisos de limite: no máximo um a cada 2 minutos por pessoa/conversa, para o próprio aviso não virar flood. */
const noticeLimiter = new RateLimiter(1, 2 * 60_000);

const queue = new FairQueue({
  parallel: MAX_PARALLEL, perPerson: PER_PERSON_PENDING, perChat: PER_CHAT_PENDING, maxTotal: MAX_PENDING,
  timeoutMs: JOB_TIMEOUT_MS + 60_000,
  onError: (error, job) => {
    const entry = errorLog.record(error, 'fila', { pedido: job.id.slice(-8) });
    logError(`pedido interrompido  ${entry.code} · ref ${entry.ref}`, error, technicalText(error));
  },
});

// ---------------------------------------------------------------- utilidades

const handled = new Set<string>();
const messageId = (message: WAMessage) => `${message.key.remoteJid}|${message.key.id}`;
function firstTime(message: WAMessage): boolean {
  const id = messageId(message);
  if (handled.has(id)) return false;
  handled.add(id);
  if (handled.size > 5000) handled.delete(handled.values().next().value!);
  return true;
}

const isGroup = (jid: string | null | undefined) => !!jid?.endsWith('@g.us');
/** Quem mandou, para os limites por pessoa (a mesma pessoa em grupos diferentes conta junto). */
const personOf = (message: WAMessage) => message.key.fromMe ? 'eu' : (message.key.participant || message.key.remoteJid || '?');

/** Telefone de quem mandou a mensagem, resolvendo o formato @lid quando preciso. */
async function senderPhone(message: WAMessage): Promise<string | undefined> {
  const key = message.key;
  const candidates = isGroup(key.remoteJid) ? [key.participantAlt, key.participant] : [key.remoteJidAlt, key.remoteJid];
  for (const jid of candidates) if (jid?.endsWith('@s.whatsapp.net')) return jidDecode(jid)?.user;
  const lid = candidates.find(jid => jid?.endsWith('@lid'));
  if (lid) {
    const pn = await socket.signalRepository.lidMapping.getPNForLID(lid).catch(() => null);
    if (pn) return jidDecode(pn)?.user;
  }
  return undefined;
}

/** Quem cuida do bot: o próprio número do bot (mensagem "de mim") ou um número do ADMIN_NUMBERS. */
async function isAdmin(message: WAMessage): Promise<boolean> {
  if (message.key.fromMe) return true;
  if (!ADMIN.size) return false;
  const phone = await senderPhone(message);
  return !!phone && ADMIN.has(phone);
}

/** Tira emoji e símbolos que o cmd do Windows não mostra (viram quadradinhos). */
const plainName = (name: string | null | undefined) =>
  (name ?? '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{E0020}-\u{E007F}]/gu, '').replace(/\s+/g, ' ').trim();

/** "5511987654321" → "+55 11 98765-4321". Outros países: "+<dígitos>". */
function formatPhone(digits: string): string {
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const local = digits.slice(4);
    return `+55 ${digits.slice(2, 4)} ${local.slice(0, -4)}-${local.slice(-4)}`;
  }
  return `+${digits}`;
}

const groupNames = new Map<string, string>();
async function groupName(jid: string): Promise<string> {
  const cached = groupNames.get(jid);
  if (cached) return cached;
  const name = plainName(await socket.groupMetadata(jid).then(meta => meta.subject).catch(() => '')) || 'grupo';
  groupNames.set(jid, name);
  return name;
}

/**
 * Quem mandou, para a janela: "+55 11 98765-4321 (Maria)" ou, em grupo, "Amigos · +55 11 91234-5678 (Ana)".
 * Só aparece na janela do bot; o registro de erros (dados/erros.jsonl) não guarda números.
 */
async function who(message: WAMessage): Promise<string> {
  const jid = message.key.remoteJid;
  const name = plainName(message.pushName);
  let person: string;
  if (message.key.fromMe) person = 'número do bot';
  else {
    const phone = await senderPhone(message).catch(() => undefined);
    person = phone ? `${formatPhone(phone)}${name ? ` (${name})` : ''}` : name || 'contato';
  }
  return isGroup(jid) ? `${paint.cyan(await groupName(jid!))} · ${person}` : person;
}

async function allowed(message: WAMessage): Promise<boolean> {
  if (message.key.fromMe || !ALLOWED.size) return true;
  const phone = await senderPhone(message);
  const ok = !!phone && (ALLOWED.has(phone) || ADMIN.has(phone));
  if (!ok && DEBUG) log.debug(`recusado: remetente ${phone ? `…${phone.slice(-4)} (${phone.length} dígitos) não está em ALLOWED_NUMBERS` : 'sem número conhecido (só @lid, sem mapa para telefone)'}`);
  return ok;
}

/** Todo envio passa pelo Pacer: em rajadas, as mensagens saem no ritmo seguro, na ordem. */
async function send(...args: Parameters<WASocket['sendMessage']>) {
  await pacer.wait();
  return socket.sendMessage(...args);
}

async function reply(message: WAMessage, text: string): Promise<void> {
  await send(message.key.remoteJid!, { text }, { quoted: message }).catch(error => log.warn('não consegui responder', technicalText(error)));
}

async function react(message: WAMessage, emoji: string): Promise<void> {
  await send(message.key.remoteJid!, { react: { text: emoji, key: message.key } }).catch(() => {});
}

/** Aviso dispensável (limites): só sai se não foi dado há pouco para `key` e se o ritmo de envio permitir agora. */
async function notice(message: WAMessage, key: string, text: string): Promise<boolean> {
  if (!noticeLimiter.hit(key) || !pacer.tryTake()) return false;
  await socket.sendMessage(message.key.remoteJid!, { text }, { quoted: message }).catch(() => {});
  return true;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Tenta de novo uma vez (rede instável, upload que caiu). Erros de conversão e de link não são repetidos. */
async function retryOnce<T>(work: () => Promise<T>, label: string): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ConversionError || error instanceof LinkError) throw error;
    if (DEBUG) log.debug(`${label} falhou, tentando de novo: ${technicalText(error)}`);
    await wait(1500);
    return work();
  }
}

async function download(source: WAMessage): Promise<Buffer> {
  try {
    const buffer = await retryOnce(() => downloadMediaMessage(source, 'buffer',
      { options: { signal: AbortSignal.timeout(60_000) } }, { logger, reuploadRequest: socket.updateMediaMessage }), 'Download');
    if (buffer.length > MAX_INPUT_BYTES) throw new ConversionError('O arquivo passa de 16 MB.', 'TAMANHO');
    return buffer;
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new DownloadError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

type ReportOptions = {
  context?: ErrorContext;
  /** Código no lugar do reconhecido automaticamente (ex.: SOM-RECUSADO). */
  code?: string;
  /** Quem usou (para a linha da janela: "+55 ... usou !som"). */
  actor?: string;
  /** Só registra, sem linha na janela (quando o resultado já aparece em outra linha). */
  silent?: boolean;
};

/** Registra o erro (janela + dados/erros.jsonl) e devolve o texto curto para o usuário. */
function reportError(error: unknown, where: string, options: ReportOptions = {}) {
  const classified = classifyError(error);
  const code = options.code ?? classified.code;
  const entry = errorLog.record(error, where, options.context, { code });
  if (!options.silent) {
    // Erro "do usuário" (arquivo grande, link privado...) sem pilha; o resto com a pilha (só com DEBUG).
    const userError = error instanceof ConversionError || error instanceof LinkError;
    logError(options.actor ? `${options.actor} usou ${where}` : where, userError ? undefined : error,
      `${code} · ref ${entry.ref} · ${userError ? error.message : technicalText(error)}`);
  }
  return { code, ref: entry.ref, user: classified.user, footer: errorFooter(code, entry.ref) };
}

// ---------------------------------------------------------------- pedidos

async function sendPlainSticker(message: WAMessage, result: StickerResult): Promise<void> {
  try {
    await retryOnce(() => send(message.key.remoteJid!,
      { sticker: result.sticker, isAnimated: result.animated, width: 512, height: 512 }, { quoted: message }), 'Envio da figurinha');
  } catch (error) {
    throw new SendError(technicalText(error), { cause: error });
  }
}

type UploadedAudio = ReturnType<typeof uploadStickerAudio>;

/** Tenta a figurinha com som; devolve um aviso se precisou cair para a versão sem som. */
async function trySoundSticker(message: WAMessage, media: { gif: boolean }, result: StickerResult,
  uploadedAudio: UploadedAudio | undefined, context: ErrorContext): Promise<{ sent: boolean; notice?: string; issue?: string }> {
  if (!result.hasAudio) return { sent: false, notice: media.gif ? 'GIF não tem som, então mandei sem som.' : 'Esse vídeo não tem áudio, então mandei sem som.' };
  if (result.audioSilent) return { sent: false, notice: 'O áudio desse vídeo está mudo, então mandei sem som.' };
  if (!result.audio) {
    const { footer, code, ref } = reportError(result.audioError ?? new Error('áudio vazio'), '!som (extrair áudio)', { context, code: 'AUDIO', silent: true });
    return { sent: false, notice: `Não consegui extrair o áudio desse vídeo, então mandei sem som. ${footer}`, issue: `${code} · ref ${ref}` };
  }
  let attempt = 0;
  try {
    await retryOnce(async () => {
      await pacer.wait();
      // Na 1ª tentativa usa o áudio que já subiu durante a conversão; na 2ª sobe de novo.
      return sendSoundSticker(socket, message.key.remoteJid!, {
        sticker: result.sticker, audio: result.audio!, durationMs: result.durationMs, quoted: message,
        uploadedAudio: attempt++ === 0 ? uploadedAudio : undefined,
      });
    }, 'Envio com som');
    return { sent: true };
  } catch (error) {
    const { footer, code, ref } = reportError(new SendError(technicalText(error), { cause: error }), '!som (envio com som)',
      { context, code: 'SOM-RECUSADO', silent: true });
    return { sent: false, notice: `O WhatsApp recusou a versão com som, então mandei sem som. ${footer}`, issue: `${code} · ref ${ref}` };
  }
}

async function linkDownload(link: FoundLink, maxBytes: number, clip: LinkClip) {
  return downloadFromLink(link, { maxBytes, clip, log: DEBUG ? m => log.debug(`link: ${m}`) : undefined });
}

/** Aviso sobre o trecho usado ("Usei de 0:42 a 0:52."), quando não foi o vídeo inteiro desde o começo. */
function clipNotice(result: StickerResult, startOffset: number, explicit: boolean): string | undefined {
  const start = startOffset + (result.startSeconds ?? 0);
  const end = start + (result.clipSeconds ?? result.durationMs / 1000);
  if (explicit || start > 0) return `Usei o trecho de ${formatTime(start)} a ${formatTime(end)}.`;
  if (result.trimmed) return 'Usei só os primeiros 10 segundos. Para outro trecho, mande por exemplo *!som 0:42*.';
  return undefined;
}

/** O pedido tem o que precisa? Devolve o texto de orientação se não tiver (sem mídia, grande demais, tempo errado). */
function requestProblem(command: 'som' | 'figurinha', text: string, message: WAMessage): string | undefined {
  const media = findMedia(message);
  if (!media && !findMessageLink(message)) {
    return command === 'som'
      ? 'Mande um vídeo com a legenda *!som*, responda a um vídeo com *!som*, ou mande *!som <link>* do TikTok, Instagram ou YouTube.'
      : 'Mande uma foto, vídeo ou GIF com a legenda *!fig*, responda a um deles com *!fig*, ou mande *!fig <link>*.';
  }
  if (media && media.fileLength > MAX_INPUT_BYTES) return 'Esse arquivo passa de 16 MB. Corte o vídeo ou mande um menor.';
  const clip = parseClip(text);
  if (clip && 'error' in clip) return clip.error;
  return undefined;
}

/** Faz uma figurinha (!som ou !fig). Erros viram uma resposta curta com código e referência. */
async function handle(job: PendingJob): Promise<void> {
  const { command, text, message } = job;
  if (command !== 'som' && command !== 'figurinha') return;
  const problem = requestProblem(command, text, message);
  if (problem) { await reply(message, problem); return; }
  const media = findMedia(message);
  const link = media ? undefined : findMessageLink(message);
  const actor = await who(message);
  const name = commandName(command);

  // Trecho: "!som 0:42" / "!som 0:42-0:47"; sem isso, o tempo do link do YouTube (?t=42), se houver.
  const parsedClip = parseClip(text) as Exclude<ReturnType<typeof parseClip>, { error: string }>;
  const linkStart = link?.platform === 'youtube' ? youtubeStart(link.url) : undefined;
  const clip = parsedClip ?? (linkStart ? { start: linkStart } : undefined);
  const clipSeconds = Math.min(MAX_SECONDS, clip?.seconds ?? MAX_SECONDS);

  const started = performance.now();
  const delayMs = Date.now() - job.sentAt;
  const late = delayMs > LATE_MS;
  const steps: string[] = [];
  const context: ErrorContext = {
    comando: `!${command}`,
    origem: media ? (media.gif ? 'gif' : media.kind === 'image' ? 'foto' : 'vídeo') : `link ${link!.platform}`,
    tamanhoKB: media ? Math.round(media.fileLength / 1024) || undefined : undefined,
    conversa: isGroup(message.key.remoteJid) ? 'grupo' : 'privado',
    trecho: clip ? `${clip.start}s${clip.seconds ? `+${clip.seconds}s` : ''}` : undefined,
    tentativa: job.attempts > 1 ? job.attempts : undefined,
    atrasoMin: late ? Math.round(delayMs / 60_000) : undefined,
  };
  // Depois do tempo máximo o pedido já foi respondido com erro: nada mais é enviado para ele.
  let expired = false;
  void react(message, '⏳');

  const work = async () => {
    const fit = parseFit(text);
    let input: Buffer;
    // Quanto do início já foi pulado na origem (o link baixou só o trecho).
    let startOffset = 0;
    const t0 = performance.now();
    if (media) input = await download(media.message);
    else {
      const video = await linkDownload(link!, MAX_INPUT_BYTES, { start: clip?.start ?? 0, seconds: clipSeconds });
      input = video.buffer;
      if (video.startApplied) startOffset = clip?.start ?? 0;
    }
    steps.push(`${media ? 'baixar' : `link ${PLATFORM_NAME[link!.platform]}`} ${Math.round(performance.now() - t0)}ms`);
    const notices: string[] = late ? [LATE_TEXT] : [];

    if (media?.kind === 'image') {
      const result = await createStaticSticker(input, fit, STICKER_META);
      if (expired) return;
      await sendPlainSticker(message, result);
      if (command === 'som') notices.push('Foto não tem som 🙂 Mandei uma figurinha comum.');
      void react(message, '✅');
      if (notices.length) await reply(message, notices.join('\n'));
      stats.stickers++;
      log.ok(`${actor} usou ${name}`, [`foto · ${seconds(performance.now() - started)}`, late ? 'respondido com atraso' : ''].filter(Boolean).join(' · '));
      return;
    }

    // O áudio fica pronto bem antes da imagem: já começa a subir enquanto o vídeo é convertido.
    let uploadedAudio: UploadedAudio | undefined;
    const result = await createAnimatedSticker(input, {
      fit, meta: STICKER_META, withAudio: command === 'som',
      startSeconds: (clip?.start ?? 0) - startOffset, maxSeconds: clipSeconds,
      onStep: DEBUG ? (step, ms) => steps.push(`${step} ${Math.round(ms)}ms`) : undefined,
      onAudio: command === 'som' ? audio => { uploadedAudio = uploadStickerAudio(socket, audio); uploadedAudio.catch(() => {}); } : undefined,
    });
    if (expired) return;
    const clipText = clipNotice(result, startOffset, !!parsedClip);
    if (clipText) notices.push(clipText);

    const t1 = performance.now();
    let withSound = false;
    let soundIssue: string | undefined;
    if (command === 'som') {
      const sound = await trySoundSticker(message, { gif: media?.gif ?? false }, result, uploadedAudio, context);
      withSound = sound.sent;
      soundIssue = sound.issue;
      if (sound.notice) notices.push(sound.notice);
    }
    if (!withSound) await sendPlainSticker(message, result);
    steps.push(`enviar ${Math.round(performance.now() - t1)}ms`);
    void react(message, withSound ? '🔊' : '✅');
    if (notices.length) await reply(message, notices.join('\n'));
    stats.stickers++;
    log.ok(`${actor} usou ${name}`, [
      withSound ? 'com som' : `sem som${soundIssue ? ` (${soundIssue})` : ''}`,
      seconds(performance.now() - started),
      link ? `link ${PLATFORM_NAME[link.platform]}` : '',
      late ? 'respondido com atraso' : '',
    ].filter(Boolean).join(' · '));
    if (DEBUG && steps.length) log.detail(steps.join(' › '));
  };

  try {
    await withTimeout(work(), JOB_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof TimeoutError) expired = true;
    stats.failures++;
    const { user, footer } = reportError(error, name,
      { actor, context: { ...context, segundos: Math.round((performance.now() - started) / 1000) } });
    void react(message, '❌');
    await reply(message, `${late ? `${LATE_TEXT}\n` : ''}${user}\n${footer}`);
  }
}

/** Põe um pedido na fila (e no disco, para sobreviver a quedas). */
function enqueue(job: PendingJob, actor?: string): AddResult {
  const message = job.message;
  const result = queue.add({ id: job.id, chat: message.key.remoteJid!, person: personOf(message) }, async () => {
    job.attempts++;
    pending.save(job);
    try { await handle(job); } finally { pending.remove(job.id); }
  });
  if (result.status === 'refused') {
    void refusalNotice(message, result.reason);
    if (actor && result.reason !== 'repetido') log.warn(`${actor} usou ${commandName(job.command)}`, {
      pessoa: 'já tinha pedidos na fila', conversa: 'muitos pedidos desta conversa na fila', cheia: 'fila cheia',
    }[result.reason]);
    return result;
  }
  pending.save(job);
  if (result.status === 'waiting') void react(message, '🕒');
  return result;
}

async function refusalNotice(message: WAMessage, reason: RefusalReason): Promise<void> {
  const person = personOf(message), chat = message.key.remoteJid!;
  if (reason === 'pessoa') await notice(message, `fila-pessoa|${person}`, 'Você já tem pedidos na fila. Espere eles saírem e mande de novo.');
  else if (reason === 'conversa') await notice(message, `fila-conversa|${chat}`, 'Já tem muitos pedidos desta conversa na fila. Esperem sair alguns e mandem de novo.');
  else if (reason === 'cheia') await notice(message, `fila-cheia|${person}`, 'Estou com muitos pedidos agora. Tente de novo em um minuto.');
}

/** Pedidos que ficaram de antes de uma queda ou atualização (lidos ao abrir, retomados ao conectar). */
let savedJobs: PendingJob[] = [];

function resumePending(): void {
  const jobs = savedJobs;
  savedJobs = [];
  let resumed = 0;
  for (const job of jobs) {
    if (Date.now() - job.sentAt > MAX_AGE_MINUTES * 60_000) { pending.remove(job.id); continue; }
    if (job.attempts >= 2) {
      // Começou duas vezes e o bot caiu nas duas: desiste, para não ficar num ciclo de quedas.
      pending.remove(job.id);
      const { footer } = reportError(new Error('O pedido começou duas vezes e o bot caiu nas duas.'), commandName(job.command),
        { context: { comando: commandName(job.command) }, code: 'TRAVOU' });
      void reply(job.message, `Não consegui fazer esse pedido: ele travou o bot, então desisti dele. Tente com outro arquivo. ${footer}`);
      continue;
    }
    if (enqueue(job).status === 'refused') pending.remove(job.id);
    else resumed++;
  }
  if (resumed) log.info(`retomando ${resumed} pedido(s) que ficaram pela metade`);
}

// ---------------------------------------------------------------- atualização automática

type UpdateOutcome = Exclude<UpdateCheck, { status: 'available' }>
  | { status: 'updated'; from: string; to: string; dependencies: boolean };

/** Confere o GitHub e, se houver versão nova, espera os pedidos em andamento e instala. */
async function runUpdate(): Promise<UpdateOutcome> {
  let check: UpdateCheck;
  try { check = await checkForUpdate(); }
  catch (error) { return { status: 'skipped', reason: `não consegui conferir agora (${error instanceof Error ? error.message : String(error)})` }; }
  if (check.status !== 'available') return check;
  const { plan } = check;
  updating = true;
  log.update(`versão nova ${plan.current} → ${plan.latest}`, 'terminando os pedidos em andamento...');
  await Promise.race([queue.idle(), wait(4 * 60_000)]);
  try {
    const { dependencies } = await plan.apply();
    log.update(`atualizado para ${plan.latest}`, plan.changes ? `${plan.changes} mudança(s)` : undefined);
    return { status: 'updated', from: plan.current, to: plan.latest, dependencies };
  } catch (error) {
    updating = false;
    logError('a atualização falhou', error, technicalText(error));
    return { status: 'skipped', reason: 'a atualização falhou no meio (o motivo está no terminal do bot)' };
  }
}

/** Fecha a conexão e reabre o bot com a versão nova. */
async function restartAfterUpdate(dependencies: boolean): Promise<void> {
  stopping = true;
  clearTimeout(reconnectTimer);
  clearTimeout(updateTimer);
  // Solta o teclado para a versão nova (no caminho sem inicializador, ela roda como filha deste processo).
  detachPrompt();
  process.stdin.pause();
  await wait(1500); // deixa as últimas respostas saírem
  socket?.end(undefined);
  log.update('reabrindo na versão nova...');
  if (process.env.BOT_LAUNCHER === '1') process.exit(dependencies ? EXIT_RESTART_INSTALL : EXIT_RESTART);
  // Aberto por um "npm start" de antes do inicializador: abre o inicializador aqui mesmo, no mesmo terminal.
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'iniciar-bot.mjs'), ...(dependencies ? ['--instalar'] : [])],
    { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', code => process.exit(code ?? 0));
}

/** Dá para digitar comandos na janela do bot (só quando ela é um terminal de verdade). */
const TERMINAL = !!process.stdin.isTTY && !!process.stdout.isTTY;
let terminalInput: Interface | undefined;
/** Última versão nova já avisada no terminal (com a automática desligada), para não repetir o aviso. */
let announcedVersion = '';

/** A automática já conferiu ao abrir (antes de conectar): a próxima conferência fica para daqui a 6 horas. */
let checkedAtStartup = false;

/**
 * Com a automática ligada, confere ao abrir, antes de conectar ao WhatsApp: se houver versão nova, instala e reabre,
 * e o bot já começa nela. Se o GitHub não responder logo, segue com a versão atual.
 */
async function updateAtStartup(): Promise<void> {
  if (!autoUpdate) return;
  checkedAtStartup = true;
  const update = runUpdate();
  const outcome = await Promise.race([update, wait(30_000).then(() => undefined)]);
  if (!outcome) {
    // Segue conectando; se a resposta chegar depois e houver versão nova, instala e reabre do mesmo jeito.
    log.warn('o GitHub não respondeu a tempo', 'sigo na versão atual e confiro de novo depois');
    void update.then(late => late.status === 'updated' ? restartAfterUpdate(late.dependencies) : undefined);
    return;
  }
  if (outcome.status === 'updated') { await restartAfterUpdate(outcome.dependencies); return new Promise(() => {}); }
  if (outcome.status === 'skipped') log.warn('atualização automática pulada', outcome.reason);
}

/**
 * Conferência a cada 6 horas (a primeira 1 minuto depois de conectar, se não conferiu ao abrir). Com a automática
 * ligada, instala; desligada, só avisa no terminal que saiu versão nova.
 */
function scheduleUpdates(): void {
  if (updateTimer) return;
  const tick = async () => {
    if (updating || stopping) return;
    if (!autoUpdate) {
      const check = await checkForUpdate().catch(() => undefined);
      if (check?.status === 'available' && check.plan.latest !== announcedVersion) {
        announcedVersion = check.plan.latest;
        log.update(`saiu a versão ${check.plan.latest}`, `para instalar: ${TERMINAL ? 'digite atualizar' : 'mande !atualizar ao bot'}`);
      }
      return;
    }
    const outcome = await runUpdate();
    if (outcome.status === 'updated') await restartAfterUpdate(outcome.dependencies);
    else if (outcome.status === 'skipped') log.warn('atualização automática pulada', outcome.reason);
  };
  updateTimer = setTimeout(() => {
    void tick();
    updateTimer = setInterval(() => { void tick(); }, UPDATE_INTERVAL_MS);
  }, checkedAtStartup ? UPDATE_INTERVAL_MS : 60_000);
}

/**
 * Executa "atualizar", "atualizar on" ou "atualizar off", vindo do WhatsApp ou do terminal.
 * `say` recebe o texto com *negrito* do WhatsApp; `mark` põe a reação na mensagem, quando há uma.
 */
async function updateAction(action: UpdateAction, say: (text: string) => Promise<void>, mark: (emoji: string) => Promise<void> = async () => {}): Promise<void> {
  if (action !== 'agora') {
    autoUpdate = action === 'ligar';
    const saved = await saveEnvSetting('AUTO_UPDATE', String(autoUpdate)).then(() => true,
      error => { log.warn('não consegui gravar no .env', technicalText(error)); return false; });
    await say((autoUpdate
      ? 'Atualização automática *ligada*. Confiro se há versão nova a cada 6 horas.'
      : 'Atualização automática *desligada*. Para atualizar uma vez, use *!atualizar*. Para ligar de novo, *!atualizar on*.') +
      (saved ? '' : '\n(Não consegui gravar no arquivo .env, então isso vale só até o bot reiniciar.)'));
    return;
  }
  if (updating) { await say('Já estou me atualizando. Volto em instantes.'); return; }
  await mark('⏳');
  const outcome = await runUpdate();
  if (outcome.status === 'updated') {
    await mark('✅');
    await say(`Atualizei o bot (${outcome.from} → ${outcome.to}). Reiniciando, volto em alguns segundos.`);
    await restartAfterUpdate(outcome.dependencies);
    return;
  }
  await mark(outcome.status === 'current' ? '✅' : '❌');
  await say(outcome.status === 'current'
    ? `O bot já está na versão mais nova (${outcome.version}). Atualização automática: *${autoUpdate ? 'ligada' : 'desligada'}*.`
    : `Não atualizei: ${outcome.reason}.`);
}

async function handleUpdateCommand(text: string, message: WAMessage, actor: string): Promise<void> {
  if (!(await isAdmin(message))) {
    log.warn(`${actor} tentou !atualizar`, 'só quem cuida do bot pode');
    await reply(message, 'Só quem cuida do bot pode usar o *!atualizar*.');
    return;
  }
  const action = parseUpdateAction(text);
  log.info(`${actor} usou ${text.trim().split(/\s+/).slice(0, 2).join(' ')}`);
  if (!action) { await reply(message, 'Use *!atualizar* para atualizar agora, ou *!atualizar off* / *!atualizar on* para a atualização automática.'); return; }
  await updateAction(action, text => reply(message, text), emoji => react(message, emoji));
}

const WINDOW_HELP = [
  '*status*             como o bot está: conexão, fila, versão, contagem',
  '*atualizar*          procura e instala a versão nova agora',
  '*atualizar off / on* desliga ou liga a atualização automática',
  '*erros*              últimos erros   ·   *erros <ref>* detalhes de um',
  '*limpar*             limpa a tela',
  '*sair*               desliga o bot (o mesmo que Ctrl + C)',
].join('\n');

const row = (name: string, value: string) => `*${name}*${' '.repeat(Math.max(1, 13 - name.length))}${value}`;

/** Resumo do "status": tudo que não precisa ficar o tempo todo na tela. */
function statusText(): string {
  return [
    row('Conexão', `${online ? 'online' : 'reconectando'} · aberto há ${formatAge(Math.round((Date.now() - stats.since) / 1000))}`),
    row('Feitas', `${stats.stickers} figurinha(s) · ${stats.failures} erro(s) desde que abriu`),
    row('Fila', `${queue.runningCount} fazendo · ${queue.waitingCount} esperando · até ${MAX_PARALLEL} ao mesmo tempo, ${MAX_PENDING} no total`),
    row('Quem usa', `${ALLOWED.size ? `${ALLOWED_LIST.length} número(s) do ALLOWED_NUMBERS` : 'qualquer pessoa'}` +
      `${ADMIN.size ? ` · ${ADMIN_LIST.length} dono(s) no ADMIN_NUMBERS` : ''}`),
    row('Atualização', autoUpdate ? 'automática (ao abrir e a cada 6 h)' : 'desligada (digite atualizar para instalar)'),
    row('Versão', `${VERSION} · Node ${process.versions.node} · FFmpeg ${FFMPEG_VERSION ?? 'não encontrado'}`),
    row('Pendentes', `${pending.size} pedido(s) salvos em ${DATA_DIR}${DEBUG ? ' · log detalhado ligado' : ''}`),
  ].join('\n');
}

function showOnline(text = 'bot iniciado · ouvindo comandos'): void {
  log.online(paint.bold(text));
  log.detail(`WhatsApp: !som · !fig · !ajuda      nesta janela: ${TERMINAL ? 'digite ajuda' : 'Ctrl + C para sair'}`);
}

/** Comandos digitados na janela do bot, no prompt "›" (com ou sem "!"). */
function listenTerminal(): void {
  if (!TERMINAL || terminalInput) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 50 });
  terminalInput = rl;
  // Com o prompt ativo, o Ctrl + C chega por aqui.
  rl.on('SIGINT', () => { void shutdown('SIGINT'); });
  rl.on('line', line => {
    const [name = '', arg] = line.trim().replace(/^!/, '').toLowerCase().split(/\s+/);
    if (!name) rl.prompt();
    else if (name === 'status') log.block(statusText());
    else if (['ajuda', 'help', 'comandos', '?'].includes(name)) log.block(WINDOW_HELP);
    else if (['limpar', 'cls', 'clear'].includes(name)) { header(VERSION); showOnline('online · ouvindo comandos'); }
    else if (['sair', 'exit', 'quit'].includes(name)) void shutdown('sair');
    else if (['erros', 'erro', 'logs'].includes(name)) log.block(errorsText(arg).replace(/!erros/g, 'erros'));
    else if (['atualizar', 'update'].includes(name)) {
      const action = parseUpdateAction(`!atualizar ${arg ?? ''}`);
      if (!action) log.info('use: atualizar · atualizar off · atualizar on');
      else updateAction(action, async message => log.update(message.replace(/\*/g, ''))).catch(error => logError('falha ao atualizar', error, technicalText(error)));
    } else log.info(`não conheço "${name}"`, 'digite ajuda para ver os comandos');
  });
  attachPrompt(rl);
}

const formatAge = (s: number) => s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1).replace('.', ',')} h`;

/** DEBUG: uma linha curta por mensagem recebida (sem conteúdo nem números). Respostas do próprio bot ficam de fora. */
function logArrival(type: string, message: WAMessage): void {
  const content = normalizeMessageContent(message.message);
  const command = parseCommand(messageText(content));
  if (!content || (message.key.fromMe && !command)) return;
  const kinds = Object.keys(content).filter(k => k !== 'messageContextInfo').map(k => k.replace(/Message$/, '')).join(', ');
  const age = message.messageTimestamp ? Math.round(Date.now() / 1000 - Number(message.messageTimestamp)) : undefined;
  log.debug(`chegou ${command ? `!${command}` : 'mensagem'} · ${kinds} · ${isGroup(message.key.remoteJid) ? 'grupo' : 'privado'}` +
    `${message.key.fromMe ? ' · do número do bot' : ''}${age !== undefined ? ` · há ${formatAge(Math.max(0, age))}` : ''}${type === 'append' ? ' · append' : ''}`);
}

async function onMessage(message: WAMessage): Promise<void> {
  if (!message.message || message.key.remoteJid === 'status@broadcast') return;
  const sentAt = Number(message.messageTimestamp ?? 0) * 1000;
  // Ao voltar de uma queda, responde o que chegou nas últimas horas (MAX_MESSAGE_AGE_MINUTES); o resto é velho demais.
  if (sentAt && Date.now() - sentAt > MAX_AGE_MINUTES * 60_000) return;
  const text = messageText(normalizeMessageContent(message.message));
  const command = parseCommand(text);
  if (!command || !firstTime(message)) return;
  if (!(await allowed(message))) return;
  const actor = await who(message);
  const name = commandName(command);
  if (command === 'atualizar') { await handleUpdateCommand(text, message, actor); return; }
  if (command === 'erros') { await handleErrorsCommand(text, message, actor); return; }
  if (updating) {
    if (await notice(message, `atualizando|${personOf(message)}`, 'Estou instalando uma versão nova do bot. Mande de novo daqui a um minuto.'))
      log.info(`${actor} usou ${name}`, 'pedi para mandar de novo depois da atualização');
    return;
  }

  // Anti-flood: limite de comandos por pessoa e por grupo (quem cuida do bot não entra no limite).
  const owner = await isAdmin(message);
  const jid = message.key.remoteJid!;
  if (!owner) {
    const person = personOf(message);
    if (!personLimiter.hit(person)) {
      if (await notice(message, `flood-pessoa|${person}`, 'Calma 🙂 Você mandou muitos pedidos seguidos. Espere um minuto e tente de novo.'))
        log.warn(`${actor} mandou pedidos demais`, 'pedi para esperar um minuto (o resto do minuto é ignorado)');
      return;
    }
    if (isGroup(jid) && !groupLimiter.hit(jid)) {
      if (await notice(message, `flood-grupo|${jid}`, 'Muitos pedidos neste grupo agora. Esperem um minuto e mandem de novo.'))
        log.warn(`${await groupName(jid)} mandou pedidos demais`, 'pedi para esperarem um minuto');
      return;
    }
  }
  if (command === 'ajuda') {
    log.info(`${actor} usou !ajuda`);
    await reply(message, owner ? `${HELP_TEXT}\n\n${ADMIN_HELP_TEXT}` : HELP_TEXT);
    return;
  }
  // Orientação (sem mídia, tempo errado...) sai na hora, sem passar pela fila.
  const problem = requestProblem(command, text, message);
  if (problem) {
    log.info(`${actor} usou ${name}`, /16 MB/.test(problem) ? 'arquivo grande demais' : /tempo|trecho/i.test(problem) ? 'tempo inválido' : 'sem mídia · mandei como usar');
    await reply(message, problem);
    return;
  }
  enqueue({ id: messageId(message), command, text, message: slimMessage(message), sentAt: sentAt || Date.now(), attempts: 0 }, actor);
}

/** Texto do !erros: lista dos últimos, ou os detalhes de um pela referência. */
function errorsText(ref: string | undefined): string {
  if (!ref) return formatErrorList(errorLog.list(10));
  const entry = errorLog.find(ref);
  return entry ? formatErrorDetail(entry) : `Não achei o erro "${ref}". Mande *!erros* para ver os últimos.`;
}

async function handleErrorsCommand(text: string, message: WAMessage, actor: string): Promise<void> {
  if (!(await isAdmin(message))) {
    log.warn(`${actor} tentou !erros`, 'só quem cuida do bot pode');
    await reply(message, 'Só quem cuida do bot pode usar o *!erros*.');
    return;
  }
  log.info(`${actor} usou !erros`);
  await reply(message, errorsText(commandArgument(text)));
}

// ---------------------------------------------------------------- conexão

async function connect(): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const current = makeWASocket({ auth: state, logger, markOnlineOnConnect: false, syncFullHistory: false });
  socket = current;
  current.ev.on('creds.update', () => { saveCreds().catch(error => logError('não consegui salvar a sessão do WhatsApp', error, technicalText(error))); });
  current.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      setQr(qr);
      startQrPage(QR_PORT, { open: process.env.ABRIR_QR === 'true' });
      // Tela limpa a cada QR novo (ele muda a cada ~20 s): só o cabeçalho, a instrução e o QR.
      qrShown = true;
      header(VERSION);
      lines(`${paint.bold('Conecte o WhatsApp do bot')}\n` +
        `No celular: Configurações › Aparelhos conectados › Conectar um aparelho\n` +
        `e escaneie o QR abaixo ${paint.gray(`(ou abra http://localhost:${QR_PORT})`)}\n`);
      qrcode.generate(qr, { small: true }, code => lines(code));
    }
    if (connection === 'open') {
      reconnectAttempt = 0;
      markConnected();
      online = true;
      if (connectedOnce) log.ok('conectado de novo');
      else {
        connectedOnce = true;
        if (qrShown) header(VERSION); // tira o QR da tela
        showOnline();
      }
      scheduleUpdates();
      listenTerminal();
      resumePending();
    }
    if (connection === 'close' && !stopping && socket === current) {
      const status = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      // Problemas que reabrir não resolve: registra e sai com código 1 (o inicializador não reabre).
      const fatal = status === DisconnectReason.loggedOut
        ? { code: 'SESSAO-DESCONECTADA', text: `O celular desconectou o bot. Apague a pasta "${AUTH_DIR}" e rode de novo para gerar outro QR.` }
        : status === DisconnectReason.connectionReplaced
          ? { code: 'SESSAO-DUPLICADA', text: 'Outra cópia do bot abriu esta mesma sessão. Feche a outra antes de rodar esta.' }
          : status === DisconnectReason.forbidden
            ? { code: 'NUMERO-BLOQUEADO', text: 'O WhatsApp recusou a conexão (403). O número pode ter sido bloqueado.' }
            : undefined;
      if (fatal) {
        const entry = errorLog.record(lastDisconnect?.error ?? new Error(fatal.text), 'conexão', { status }, { code: fatal.code });
        detachPrompt();
        logError(fatal.text, undefined, `erro ${fatal.code} · ref ${entry.ref}`);
        process.exit(1);
      }
      const delay = status === DisconnectReason.restartRequired ? 500 : Math.min(60_000, 1000 * 2 ** Math.min(reconnectAttempt++, 6));
      online = false;
      // "restartRequired" é a troca normal de conexão logo depois de escanear o QR: não é queda.
      if (status !== DisconnectReason.restartRequired)
        log.warn(`conexão caiu · tentando de novo em ${seconds(delay)}`,
          reconnectAttempt > 3 ? 'confira a internet; o que chegar nesse tempo será respondido quando voltar' : undefined);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { connect().catch(error => logError('falha ao reconectar', error, technicalText(error))); }, delay);
    }
  });
  current.ev.on('messages.upsert', ({ messages, type }) => {
    for (const message of messages) {
      if (DEBUG) logArrival(type, message);
      if (type !== 'notify' && type !== 'append') continue;
      onMessage(message).catch(error => reportError(error, 'ler mensagem'));
    }
  });
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  detachPrompt();
  log.info(queue.size ? 'desligando · terminando o que está em andamento (até 15 s)...' : 'desligando...');
  clearTimeout(reconnectTimer);
  await Promise.race([queue.idle(), wait(15_000)]);
  socket?.end(undefined);
  log.ok(signal === 'SIGTERM' ? 'bot desligado' : 'bot desligado · até logo!');
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
// Erro solto numa promessa: registra e segue. Exceção não tratada: o estado pode estar quebrado, então registra
// e sai com o código de queda; o inicializador reabre o bot e os pedidos salvos em dados/ são retomados.
process.on('unhandledRejection', error => { reportError(error, 'processo (promessa sem tratamento)'); });
process.on('uncaughtException', error => {
  const entry = errorLog.record(error, 'processo (queda)');
  detachPrompt();
  logError(`o bot caiu  ${entry.code} · ref ${entry.ref}`, error, technicalText(error));
  process.exit(EXIT_CRASH);
});

// ---------------------------------------------------------------- abertura

let connectedOnce = false;
let qrShown = false;
let online = false;
const VERSION = installedVersion();

/** Aviso no topo quando o inicializador reabriu o bot (depois de atualizar ou de uma queda). */
function reopenNote(): string | undefined {
  if (process.env.BOT_REOPENED === 'atualizacao') return paint.cyan('↑ atualizado agora');
  if (process.env.BOT_REOPENED === 'queda') {
    const last = errorLog.list(1)[0];
    return paint.yellow(`↻ reaberto depois de uma queda${last ? ` · digite erros ${last.ref} para ver o motivo` : ''}`);
  }
  return undefined;
}

header(VERSION, reopenNote());
const [problems, FFMPEG_VERSION] = await Promise.all([checkTools(), ffmpegVersion()]);
for (const warning of allowedNumberWarnings(ALLOWED_LIST)) log.warn('ALLOWED_NUMBERS', warning);
if (problems.length) {
  log.fail('o bot não pode começar');
  lines(`${problems.map(p => `  - ${p}`).join('\n')}\n\n  Instale um FFmpeg completo:\n` +
    '  Windows: winget install Gyan.FFmpeg · Linux: sudo apt install ffmpeg · macOS: brew install ffmpeg');
  process.exit(1);
}
status(false, 'conectando...');
savedJobs = pending.load();
for (const job of savedJobs) handled.add(job.id); // se o WhatsApp entregar a mesma mensagem de novo, não faz duas vezes
await updateAtStartup();
await connect();
