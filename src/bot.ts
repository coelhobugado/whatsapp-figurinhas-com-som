import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import makeWASocket, {
  DisconnectReason, downloadMediaMessage, jidDecode, normalizeMessageContent, useMultiFileAuthState,
  type WAMessage, type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import {
  ADMIN_HELP_TEXT, allowedNumberWarnings, findMedia, findMessageLink, formatTime, HELP_TEXT, messageText,
  parseClip, parseCommand, parseFit, parseUpdateAction, phoneVariants, type Command, type UpdateAction,
} from './commands.js';
import { createAnimatedSticker, createStaticSticker, MAX_INPUT_BYTES, MAX_SECONDS, type StickerResult } from './convert.js';
import { checkTools, ConversionError, ToolError } from './ffmpeg.js';
import { downloadFromLink, LinkError, PLATFORM_NAME, youtubeStart, type FoundLink, type LinkClip } from './link-download.js';
import { JobQueue, TimeoutError } from './queue.js';
import { markConnected, setQr, startQrPage } from './qr-page.js';
import { sendSoundSticker } from './sound-sticker.js';
import {
  checkForUpdate, EXIT_RESTART, EXIT_RESTART_INSTALL, ROOT, saveEnvSetting, UPDATE_INTERVAL_MS, type UpdateCheck,
} from './updater.js';

// ---------------------------------------------------------------- configuração (.env)
const AUTH_DIR = process.env.AUTH_DIR || './sessao';
const QR_PORT = Number(process.env.QR_PORT || 3999);
const numberList = (value: string | undefined) => (value ?? '').split(/[,;\s]+/).filter(n => /\d/.test(n));
/** Números (DDI+DDD+número, só dígitos) que podem usar o bot. Vazio = qualquer pessoa. */
const ALLOWED_LIST = numberList(process.env.ALLOWED_NUMBERS);
const ALLOWED = new Set(ALLOWED_LIST.flatMap(phoneVariants));
/** Quem pode usar os comandos de dono (!atualizar), além do próprio número do bot. */
const ADMIN_LIST = numberList(process.env.ADMIN_NUMBERS);
const ADMIN = new Set(ADMIN_LIST.flatMap(phoneVariants));
/** Atualização automática: ligada, a não ser que AUTO_UPDATE=false (ou "!atualizar off"). */
let autoUpdate = process.env.AUTO_UPDATE !== 'false';
/** Nome mostrado ao tocar na figurinha (metadados EXIF). */
const STICKER_META = { packName: process.env.STICKER_PACK_NAME ?? 'Criada por Dexter', publisher: process.env.STICKER_PUBLISHER ?? '' };
/** DEBUG=true registra a chegada de cada mensagem e o tempo das etapas (sem conteúdo; de números, só os 4 últimos dígitos de quem foi recusado). */
const DEBUG = process.env.DEBUG === 'true';
const MAX_PENDING = Number(process.env.MAX_PENDING || 5);
const MAX_AGE_SECONDS = 5 * 60;

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
let socket: WASocket;
let reconnectAttempt = 0;
let reconnectTimer: NodeJS.Timeout | undefined;
let updateTimer: NodeJS.Timeout | undefined;
let stopping = false;
/** Baixando uma versão nova: pedidos novos esperam o bot reabrir. */
let updating = false;

const log = (...parts: unknown[]) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...parts);
const logError = (...parts: unknown[]) => console.error(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...parts);

const queue = new JobQueue(MAX_PENDING, 3 * 60_000, error => logError('Pedido interrompido:', error));

// ---------------------------------------------------------------- utilidades

const handled = new Set<string>();
function firstTime(message: WAMessage): boolean {
  const id = `${message.key.remoteJid}|${message.key.id}`;
  if (handled.has(id)) return false;
  handled.add(id);
  if (handled.size > 2000) handled.delete(handled.values().next().value!);
  return true;
}

/** Telefone de quem mandou a mensagem, resolvendo o formato @lid quando preciso. */
async function senderPhone(message: WAMessage): Promise<string | undefined> {
  const key = message.key;
  const group = key.remoteJid?.endsWith('@g.us');
  const candidates = group ? [key.participantAlt, key.participant] : [key.remoteJidAlt, key.remoteJid];
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

async function allowed(message: WAMessage): Promise<boolean> {
  if (message.key.fromMe || !ALLOWED.size) return true;
  const phone = await senderPhone(message);
  const ok = !!phone && (ALLOWED.has(phone) || ADMIN.has(phone));
  if (!ok && DEBUG) log(`[recusado] remetente ${phone ? `…${phone.slice(-4)} (${phone.length} dígitos) não está em ALLOWED_NUMBERS` : 'sem número conhecido (só @lid, sem mapa para telefone)'}`);
  return ok;
}

async function reply(message: WAMessage, text: string): Promise<void> {
  await socket.sendMessage(message.key.remoteJid!, { text }, { quoted: message }).catch(error => logError('Não consegui responder:', error));
}

async function react(message: WAMessage, emoji: string): Promise<void> {
  await socket.sendMessage(message.key.remoteJid!, { react: { text: emoji, key: message.key } }).catch(() => {});
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Tenta de novo uma vez (rede instável, upload que caiu). Erros de conversão não são repetidos. */
async function retryOnce<T>(work: () => Promise<T>, label: string): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ConversionError) throw error;
    logError(`${label} falhou, tentando de novo:`, error instanceof Error ? error.message : error);
    await wait(1500);
    return work();
  }
}

class DownloadError extends Error {}

async function download(source: WAMessage): Promise<Buffer> {
  try {
    const buffer = await retryOnce(() => downloadMediaMessage(source, 'buffer',
      { options: { signal: AbortSignal.timeout(60_000) } }, { logger, reuploadRequest: socket.updateMediaMessage }), 'Download');
    if (buffer.length > MAX_INPUT_BYTES) throw new ConversionError('O arquivo passa de 16 MB.');
    return buffer;
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw new DownloadError(error instanceof Error ? error.message : String(error));
  }
}

/** Texto amigável para cada tipo de falha. */
function friendlyError(error: unknown): string {
  if (error instanceof ConversionError) return `Não consegui criar a figurinha: ${error.message}`;
  if (error instanceof LinkError) return error.message;
  if (error instanceof DownloadError) return 'Não consegui baixar o arquivo do WhatsApp (ele pode ter expirado). Reenvie o vídeo e tente de novo.';
  if (error instanceof TimeoutError) return 'Demorou demais para processar. Tente um vídeo mais curto ou mais leve.';
  if (error instanceof ToolError && /não foi encontrado/.test(error.message)) return 'O bot está sem o FFmpeg instalado. Avise quem cuida dele.';
  return 'Algo deu errado ao criar a figurinha. Tente de novo ou com outro arquivo.';
}

// ---------------------------------------------------------------- pedidos

async function sendPlainSticker(message: WAMessage, result: StickerResult): Promise<void> {
  await retryOnce(() => socket.sendMessage(message.key.remoteJid!,
    { sticker: result.sticker, isAnimated: result.animated, width: 512, height: 512 }, { quoted: message }), 'Envio da figurinha');
}

/** Tenta a figurinha com som; devolve um aviso se precisou cair para a versão sem som. */
async function trySoundSticker(message: WAMessage, media: { gif: boolean }, result: StickerResult): Promise<{ sent: boolean; notice?: string }> {
  if (!result.hasAudio) return { sent: false, notice: media.gif ? 'GIF não tem som, então mandei sem som.' : 'Esse vídeo não tem áudio, então mandei sem som.' };
  if (result.audioSilent) return { sent: false, notice: 'O áudio desse vídeo está mudo, então mandei sem som.' };
  if (!result.audio) {
    logError('Falha ao extrair o áudio:', result.audioError);
    return { sent: false, notice: 'Não consegui extrair o áudio desse vídeo, então mandei sem som.' };
  }
  try {
    await retryOnce(() => sendSoundSticker(socket, message.key.remoteJid!,
      { sticker: result.sticker, audio: result.audio!, durationMs: result.durationMs, quoted: message }), 'Envio com som');
    return { sent: true };
  } catch (error) {
    logError('Falha no envio com som:', error);
    return { sent: false, notice: 'O WhatsApp recusou a versão com som, então mandei sem som.' };
  }
}

async function linkDownload(link: FoundLink, maxBytes: number, clip: LinkClip) {
  return downloadFromLink(link, { maxBytes, clip, log: DEBUG ? m => log(`[link] ${m}`) : undefined });
}

/** Aviso sobre o trecho usado ("Usei de 0:42 a 0:52."), quando não foi o vídeo inteiro desde o começo. */
function clipNotice(result: StickerResult, startOffset: number, explicit: boolean): string | undefined {
  const start = startOffset + (result.startSeconds ?? 0);
  const end = start + (result.clipSeconds ?? result.durationMs / 1000);
  if (explicit || start > 0) return `Usei o trecho de ${formatTime(start)} a ${formatTime(end)}.`;
  if (result.trimmed) return 'Usei só os primeiros 10 segundos. Para outro trecho, mande por exemplo *!som 0:42*.';
  return undefined;
}

async function handle(command: Command, text: string, message: WAMessage): Promise<void> {
  if (command === 'ajuda') { await reply(message, (await isAdmin(message)) ? `${HELP_TEXT}\n\n${ADMIN_HELP_TEXT}` : HELP_TEXT); return; }
  const media = findMedia(message);
  const link = media ? undefined : findMessageLink(message);
  if (!media && !link) {
    await reply(message, command === 'som'
      ? 'Mande um vídeo com a legenda *!som*, responda a um vídeo com *!som*, ou mande *!som <link>* do TikTok, Instagram ou YouTube.'
      : 'Mande uma foto, vídeo ou GIF com a legenda *!fig*, responda a um deles com *!fig*, ou mande *!fig <link>*.');
    return;
  }
  if (media && media.fileLength > MAX_INPUT_BYTES) { await reply(message, 'Esse arquivo passa de 16 MB. Corte o vídeo ou mande um menor.'); return; }

  // Trecho: "!som 0:42" / "!som 0:42-0:47"; sem isso, o tempo do link do YouTube (?t=42), se houver.
  const parsedClip = parseClip(text);
  if (parsedClip && 'error' in parsedClip) { await reply(message, parsedClip.error); return; }
  const linkStart = link?.platform === 'youtube' ? youtubeStart(link.url) : undefined;
  const clip = parsedClip ?? (linkStart ? { start: linkStart } : undefined);
  const clipSeconds = Math.min(MAX_SECONDS, clip?.seconds ?? MAX_SECONDS);

  const started = performance.now();
  const steps: string[] = [];
  await react(message, '⏳');
  try {
    const fit = parseFit(text);
    let input: Buffer;
    // Quanto do início já foi pulado na origem (o link baixou só o trecho).
    let startOffset = 0;
    if (media) input = await download(media.message);
    else {
      const t0 = performance.now();
      const video = await linkDownload(link!, MAX_INPUT_BYTES, { start: clip?.start ?? 0, seconds: clipSeconds });
      input = video.buffer;
      if (video.startApplied) startOffset = clip?.start ?? 0;
      steps.push(`link ${PLATFORM_NAME[link!.platform]} ${Math.round(performance.now() - t0)}ms`);
    }
    if (media?.kind === 'image') {
      const result = await createStaticSticker(input, fit, STICKER_META);
      await sendPlainSticker(message, result);
      if (command === 'som') await reply(message, 'Foto não tem som 🙂 Mandei uma figurinha comum.');
      await react(message, '✅');
      log(`!${command} foto ok em ${((performance.now() - started) / 1000).toFixed(1)} s`);
      return;
    }

    const result = await createAnimatedSticker(input, {
      fit, meta: STICKER_META, withAudio: command === 'som',
      startSeconds: (clip?.start ?? 0) - startOffset, maxSeconds: clipSeconds,
      onStep: DEBUG ? (step, ms) => steps.push(`${step} ${Math.round(ms)}ms`) : undefined,
    });
    const notices: string[] = [];
    const clipText = clipNotice(result, startOffset, !!parsedClip);
    if (clipText) notices.push(clipText);

    let withSound = false;
    if (command === 'som') {
      const sound = await trySoundSticker(message, { gif: media?.gif ?? false }, result);
      withSound = sound.sent;
      if (sound.notice) notices.push(sound.notice);
    }
    if (!withSound) await sendPlainSticker(message, result);
    await react(message, withSound ? '🔊' : '✅');
    if (notices.length) await reply(message, notices.join('\n'));
    log(`!${command}${link ? ` (link ${PLATFORM_NAME[link.platform]})` : ''} ${withSound ? 'com som' : 'sem som'} ok em ${((performance.now() - started) / 1000).toFixed(1)} s` +
      ` (${Math.round(result.sticker.length / 1024)} KB)${steps.length ? ` — ${steps.join(', ')}` : ''}`);
  } catch (error) {
    logError(`!${command} falhou em ${((performance.now() - started) / 1000).toFixed(1)} s:`, error);
    await react(message, '❌');
    await reply(message, friendlyError(error));
  }
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
  log(`Versão nova encontrada (${plan.current} → ${plan.latest}). Terminando os pedidos em andamento...`);
  await Promise.race([queue.idle(), wait(4 * 60_000)]);
  try {
    const { dependencies } = await plan.apply();
    log(`Bot atualizado para ${plan.latest}${plan.changes ? ` (${plan.changes} mudança(s))` : ''}.`);
    return { status: 'updated', from: plan.current, to: plan.latest, dependencies };
  } catch (error) {
    updating = false;
    logError('A atualização falhou:', error);
    return { status: 'skipped', reason: 'a atualização falhou no meio (o motivo está no terminal do bot)' };
  }
}

/** Fecha a conexão e reabre o bot com a versão nova. */
async function restartAfterUpdate(dependencies: boolean): Promise<void> {
  stopping = true;
  clearTimeout(reconnectTimer);
  clearTimeout(updateTimer);
  // Solta o teclado para a versão nova (no caminho sem inicializador, ela roda como filha deste processo).
  terminalInput?.close();
  process.stdin.pause();
  await wait(1500); // deixa as últimas respostas saírem
  socket?.end(undefined);
  log('Reabrindo o bot com a versão nova...');
  if (process.env.BOT_LAUNCHER === '1') process.exit(dependencies ? EXIT_RESTART_INSTALL : EXIT_RESTART);
  // Aberto por um "npm start" de antes do inicializador: abre o inicializador aqui mesmo, no mesmo terminal.
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'iniciar-bot.mjs'), ...(dependencies ? ['--instalar'] : [])],
    { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', code => process.exit(code ?? 0));
}

/** Dá para digitar comandos na janela do bot (só quando ela é um terminal de verdade). */
const TERMINAL = !!process.stdin.isTTY;
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
  log('Conferindo se há versão nova do bot...');
  checkedAtStartup = true;
  const update = runUpdate();
  const outcome = await Promise.race([update, wait(30_000).then(() => undefined)]);
  if (!outcome) {
    // Segue conectando; se a resposta chegar depois e houver versão nova, instala e reabre do mesmo jeito.
    log('O GitHub está demorando para responder; sigo com a versão atual por enquanto.');
    void update.then(late => late.status === 'updated' ? restartAfterUpdate(late.dependencies) : undefined);
    return;
  }
  if (outcome.status === 'updated') { await restartAfterUpdate(outcome.dependencies); return new Promise(() => {}); }
  log(outcome.status === 'current' ? `O bot já está na versão mais nova (${outcome.version}).` : `Atualização automática: ${outcome.reason}.`);
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
        log(`Saiu uma versão nova do bot (${check.plan.current} → ${check.plan.latest}). Para instalar, ` +
          `${TERMINAL ? 'digite atualizar aqui e aperte Enter, ou ' : ''}mande !atualizar ao bot.`);
      }
      return;
    }
    const outcome = await runUpdate();
    if (outcome.status === 'updated') await restartAfterUpdate(outcome.dependencies);
    else if (outcome.status === 'skipped') log(`Atualização automática: ${outcome.reason}.`);
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
      error => { logError('Não consegui gravar no .env:', error); return false; });
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

async function handleUpdateCommand(text: string, message: WAMessage): Promise<void> {
  if (!(await isAdmin(message))) { await reply(message, 'Só quem cuida do bot pode usar o *!atualizar*.'); return; }
  const action = parseUpdateAction(text);
  if (!action) { await reply(message, 'Use *!atualizar* para atualizar agora, ou *!atualizar off* / *!atualizar on* para a atualização automática.'); return; }
  if (action !== 'agora') log(`Atualização automática ${action === 'ligar' ? 'ligada' : 'desligada'} pelo WhatsApp (!atualizar).`);
  await updateAction(action, text => reply(message, text), emoji => react(message, emoji));
}

/** Comandos digitados na janela do bot: "atualizar", "atualizar on", "atualizar off" (com ou sem "!"). */
function listenTerminal(): void {
  if (!TERMINAL || terminalInput) return;
  terminalInput = createInterface({ input: process.stdin });
  terminalInput.on('line', line => {
    const text = `!${line.trim().replace(/^!/, '')}`;
    if (text === '!') return;
    const action = parseCommand(text) === 'atualizar' ? parseUpdateAction(text) : undefined;
    if (!action) { log('Aqui na janela dá para digitar: atualizar · atualizar off · atualizar on'); return; }
    updateAction(action, async message => log(message.replace(/\*/g, ''))).catch(error => logError('Falha no atualizar:', error));
  });
}

function logArrival(type: string, message: WAMessage): void {
  const chat = message.key.remoteJid?.split('@')[1] ?? '?';
  const content = normalizeMessageContent(message.message);
  const kinds = content ? Object.keys(content).filter(k => k !== 'messageContextInfo').join(',') : '(sem conteúdo)';
  const age = message.messageTimestamp ? Math.round(Date.now() / 1000 - Number(message.messageTimestamp)) : '?';
  log(`[chegou] upsert=${type} chat=@${chat} deMim=${!!message.key.fromMe} tipo=${kinds}` +
    `${message.messageStubType ? ` stub=${message.messageStubType}` : ''} idade=${age}s comando=${parseCommand(messageText(content)) ?? '-'}`);
}

async function onMessage(message: WAMessage): Promise<void> {
  if (!message.message || message.key.remoteJid === 'status@broadcast') return;
  const sentAt = Number(message.messageTimestamp ?? 0);
  if (sentAt && Date.now() / 1000 - sentAt > MAX_AGE_SECONDS) return; // não processa mensagens antigas ao reconectar
  const text = messageText(normalizeMessageContent(message.message));
  const command = parseCommand(text);
  if (!command || !firstTime(message)) return;
  if (!(await allowed(message))) return;
  if (command === 'atualizar') { await handleUpdateCommand(text, message); return; }
  if (updating) { await reply(message, 'Estou instalando uma versão nova do bot. Mande de novo daqui a um minuto.'); return; }

  const owner = `${message.key.remoteJid}|${message.key.participant ?? ''}|${message.key.fromMe ? 'eu' : ''}`;
  const result = queue.add(owner, () => handle(command, text, message));
  if (result.status === 'full') await reply(message, 'Estou com muitos pedidos agora. Tente de novo em um minuto.');
  else if (result.status === 'duplicate') await reply(message, 'Ainda estou fazendo seu pedido anterior. Espere ele chegar e mande de novo.');
  else if (result.position > 1) await reply(message, `Na fila: você é o ${result.position}º. Já já sai!`);
}

// ---------------------------------------------------------------- conexão

async function connect(): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const current = makeWASocket({ auth: state, logger, markOnlineOnConnect: false, syncFullHistory: false });
  socket = current;
  current.ev.on('creds.update', () => { saveCreds().catch(error => logError('Não consegui salvar a sessão:', error)); });
  current.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      setQr(qr);
      startQrPage(QR_PORT, { open: process.env.ABRIR_QR === 'true' });
      console.log('\nEscaneie o QR no WhatsApp: Configurações › Aparelhos conectados › Conectar um aparelho');
      console.log(`(ou abra http://localhost:${QR_PORT} para ver o QR como imagem)\n`);
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      reconnectAttempt = 0;
      markConnected();
      log(`Bot conectado. Comandos: !som, !fig, !ajuda. ${ALLOWED.size ? `Liberado para ${ALLOWED_LIST.length} número(s).` : 'Liberado para todos.'}`);
      if (!updateTimer) log(autoUpdate
        ? `Atualização automática ligada (confere a cada 6 horas). Para desligar, ${TERMINAL ? 'digite atualizar off aqui e aperte Enter, ou ' : ''}mande !atualizar off ao bot.`
        : `Atualização automática desligada. Para atualizar, ${TERMINAL ? 'digite atualizar aqui e aperte Enter, ou ' : ''}mande !atualizar ao bot.`);
      scheduleUpdates();
      listenTerminal();
    }
    if (connection === 'close' && !stopping && socket === current) {
      const status = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        logError(`O celular desconectou o bot. Apague a pasta "${AUTH_DIR}" e rode de novo para gerar outro QR.`);
        process.exit(1);
      }
      if (status === DisconnectReason.connectionReplaced) {
        logError('Outra cópia do bot abriu esta mesma sessão. Feche a outra antes de rodar esta.');
        process.exit(1);
      }
      if (status === DisconnectReason.forbidden) {
        logError('O WhatsApp recusou a conexão (403). O número pode ter sido bloqueado.');
        process.exit(1);
      }
      const delay = status === DisconnectReason.restartRequired ? 500 : Math.min(60_000, 1000 * 2 ** Math.min(reconnectAttempt++, 6));
      log(`Conexão caiu (código ${status ?? '?'}). Tentando de novo em ${(delay / 1000).toFixed(1)} s.`);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { connect().catch(error => logError('Falha ao reconectar:', error)); }, delay);
    }
  });
  current.ev.on('messages.upsert', ({ messages, type }) => {
    for (const message of messages) {
      if (DEBUG) logArrival(type, message);
      if (type !== 'notify' && type !== 'append') continue;
      onMessage(message).catch(error => logError('Erro ao ler mensagem:', error));
    }
  });
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log(`${signal} recebido: terminando o pedido em andamento antes de sair...`);
  clearTimeout(reconnectTimer);
  await Promise.race([queue.idle(), wait(15_000)]);
  socket?.end(undefined);
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('unhandledRejection', error => logError('Erro não tratado:', error));

const problems = await checkTools();
for (const warning of allowedNumberWarnings(ALLOWED_LIST)) console.warn(`⚠️  ALLOWED_NUMBERS: ${warning}`);
if (problems.length) {
  console.error('O bot não pode começar:\n- ' + problems.join('\n- '));
  console.error('Instale um FFmpeg completo (ex.: https://www.gyan.dev/ffmpeg/builds/ no Windows, "apt install ffmpeg" no Linux, "brew install ffmpeg" no macOS).');
  process.exit(1);
}
await updateAtStartup();
await connect();
