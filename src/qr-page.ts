import { createServer, type IncomingMessage, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { MAX_INPUT_BYTES } from './convert.js';

type State = { qr?: string; connected: boolean };
export type LocalWebCommand = 'som' | 'figurinha';
export type LocalWebRequest = {
  command: LocalWebCommand;
  recipient: string;
  fit: 'cortar' | 'inteiro';
  clip?: string;
  source: { type: 'file'; buffer: Buffer; mediaType: string } | { type: 'link'; url: string };
  audio?: { buffer: Buffer; mediaType: string; filename: string };
};
export type LocalWebJob = {
  status: 'queued' | 'processing' | 'done' | 'failed';
  message: string;
  hasWebp: boolean;
  hasOgg: boolean;
};
export type LocalWebHandlers = {
  submit: (request: LocalWebRequest) => { id: string; position: number };
  getJob: (id: string) => LocalWebJob | undefined;
  getFile: (id: string, type: 'webp' | 'ogg') => Promise<Buffer | undefined>;
};

const state: State = { connected: false };
let server: Server | undefined;
let opened = false;
let handlers: LocalWebHandlers | undefined;

const PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Figurinhas com som</title>
<style>
  body{margin:0;background:#f4f4f2;color:#1d1d1b;font:16px/1.5 system-ui,sans-serif}
  main{max-width:760px;margin:32px auto;padding:24px}
  section,form{background:#fff;border-radius:12px;padding:20px;margin:16px 0}
  label{display:block;margin:12px 0 4px;font-weight:600}
  input,select,button{box-sizing:border-box;font:inherit;padding:9px;width:100%}
  button{margin-top:16px;background:#176b3a;color:#fff;border:0;border-radius:6px;cursor:pointer}
  button:disabled{opacity:.5;cursor:not-allowed}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  #qr{margin-top:8px}#qr svg{width:180px;height:180px}
  .muted{color:#555}.error{color:#a20d21}.download a{margin-right:16px}
  @media(max-width:600px){main{margin:8px auto;padding:12px}.grid{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Gerar figurinhas</h1>
<section><strong id="connection">Conferindo conexão com o WhatsApp…</strong>
<div id="qr"></div><p class="muted" id="pairing-help">Para parear, escaneie o QR com o WhatsApp do bot em Configurações › Aparelhos conectados.</p></section>
<form id="job-form">
<label for="recipient">Número de destino (com DDI e DDD)</label>
<input id="recipient" name="recipient" type="tel" placeholder="5511999998888" required>
<div class="grid"><div><label for="command">Tipo de figurinha</label>
<select id="command"><option value="som">!som</option><option value="figurinha">!fig (sem som)</option></select></div>
<div><label for="fit">Enquadramento</label>
<select id="fit"><option value="cortar">Preencher o quadrado</option><option value="inteiro">Manter o quadro inteiro</option></select></div></div>
<label for="file">Vídeo, GIF ou imagem</label><input id="file" type="file" accept="video/*,image/*">
<label for="audio">Áudio separado opcional (MP3, M4A, WAV, OGG; até 16 MB)</label><input id="audio" type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.wma,.aiff">
<p class="muted">O áudio separado substitui o áudio do vídeo. Serão usados os primeiros 10 segundos (ou a duração da figurinha).</p>
<label for="link">Ou link de vídeo</label><input id="link" type="url" placeholder="YouTube, TikTok ou Instagram">
<label for="clip">Trecho opcional (ex.: 0:42-0:47)</label><input id="clip" type="text" placeholder="Até 10 segundos">
<button id="submit" type="submit" disabled>Gerar e enviar</button>
</form>
<section><strong id="result">Pronto para receber um pedido.</strong><div class="download" id="downloads"></div></section>
<script>
const connection=document.getElementById('connection');
const qr=document.getElementById('qr');
const help=document.getElementById('pairing-help');
const form=document.getElementById('job-form');
const submitButton=document.getElementById('submit');
const result=document.getElementById('result');
const downloads=document.getElementById('downloads');
let connected=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function updateConnection(){
  try{
    const response=await fetch('/estado',{cache:'no-store'});
    const data=await response.json();
    connected=data.connected;
    connection.textContent=connected?'WhatsApp conectado':'Aguardando conexão com o WhatsApp';
    submitButton.disabled=!connected;
    help.hidden=connected;
    if(data.svg&& !connected) qr.innerHTML=data.svg;
    else if(connected) qr.textContent='';
  }catch{connection.textContent='Não consegui verificar a conexão';}
  setTimeout(updateConnection,1500);
}
async function pollJob(id){
  while(true){
    await sleep(1200);
    const response=await fetch('/api/jobs/'+encodeURIComponent(id),{cache:'no-store'});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'Não consegui consultar o pedido.');
    result.textContent=data.message;
    if(data.status==='queued'||data.status==='processing') continue;
    if(data.hasWebp){
      const webp=document.createElement('a');webp.href='/api/jobs/'+encodeURIComponent(id)+'/webp';webp.textContent='Baixar WebP';webp.download='figurinha.webp';downloads.append(webp);
    }
    if(data.hasOgg){
      const ogg=document.createElement('a');ogg.href='/api/jobs/'+encodeURIComponent(id)+'/ogg';ogg.textContent='Baixar áudio Ogg';ogg.download='figurinha.ogg';downloads.append(ogg);
    }
    return;
  }
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  downloads.textContent='';
  result.textContent='Enviando pedido…';
  result.className='';
  try{
    const file=document.getElementById('file').files[0];
    const audio=document.getElementById('audio').files[0];
    const link=document.getElementById('link').value.trim();
    if((file?1:0)+(link?1:0)!==1) throw new Error('Escolha um arquivo ou informe um link, não os dois.');
    if(audio&&document.getElementById('command').value!=='som') throw new Error('Áudio separado só pode ser usado com !som.');
    const query=new URLSearchParams({
      command:document.getElementById('command').value,
      recipient:document.getElementById('recipient').value,
      fit:document.getElementById('fit').value
    });
    const clip=document.getElementById('clip').value.trim();
    if(clip) query.set('clip',clip);
    const body=new FormData();
    for(const [key,value] of query) body.set(key,value);
    if(file) body.set('media',file);
    if(audio) body.set('audio',audio);
    if(link) body.set('url',link);
    const response=await fetch('/api/jobs',{method:'POST',body});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'Não consegui iniciar o pedido.');
    result.textContent='Pedido na fila (posição '+data.position+')…';
    await pollJob(data.id);
  }catch(error){result.textContent=error instanceof Error?error.message:String(error);result.className='error';}
});
updateConnection();
</script></main></body></html>`;

export class LocalUiError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch { return false; }
}

function isSameOriginLocal(request: IncomingMessage, port: number): boolean {
  const origin = request.headers.origin;
  if (!origin || !isLocalHost(request.headers.host)) return false;
  try {
    const parsed = new URL(origin);
    const requestUrl = new URL(`http://${request.headers.host}`);
    const bothLoopback = ['localhost', '127.0.0.1'].includes(parsed.hostname)
      && ['localhost', '127.0.0.1'].includes(requestUrl.hostname);
    const validOrigin = !parsed.username && !parsed.password
      && parsed.pathname === '/' && !parsed.search && !parsed.hash;
    const localOrigin = parsed.protocol === 'http:' && validOrigin
      && isLocalHost(parsed.host) && bothLoopback && parsed.port === requestUrl.port;
    const codespace = process.env.CODESPACE_NAME;
    const codespacesEnabled = process.env.ALLOW_CODESPACES_UI === 'true' && !!codespace;
    const codespacesLoopbackOrigin = codespacesEnabled
      && parsed.protocol === 'https:' && validOrigin && bothLoopback && parsed.port === String(port);
    const codespacesOrigin = codespacesEnabled
      && parsed.protocol === 'https:' && validOrigin && !parsed.port
      && parsed.hostname === `${codespace}-${port}.app.github.dev`;
    return localOrigin || codespacesLoopbackOrigin || codespacesOrigin;
  } catch { return false; }
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const part of request) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    if (size > maxBytes) { tooLarge = true; continue; }
    chunks.push(chunk);
  }
  if (tooLarge) throw new LocalUiError(413, `O arquivo ultrapassa ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  return Buffer.concat(chunks, size);
}

type MultipartPart = { buffer: Buffer; mediaType: string; filename?: string };

async function readMultipart(request: IncomingMessage): Promise<Map<string, MultipartPart>> {
  const contentType = request.headers['content-type'] ?? '';
  const boundary = /^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.[1]
    ?? /^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.[2];
  if (!boundary || boundary.length > 70) throw new LocalUiError(400, 'Formato de upload inválido.');
  const body = await readBody(request, MAX_INPUT_BYTES * 2 + 64 * 1024);
  const delimiter = Buffer.from(`--${boundary}`);
  const nextDelimiter = Buffer.from(`\r\n--${boundary}`);
  const parts = new Map<string, MultipartPart>();
  let offset = 0;
  if (!body.subarray(0, delimiter.length).equals(delimiter)) throw new LocalUiError(400, 'Upload multipart inválido.');
  offset = delimiter.length;

  while (offset < body.length) {
    if (body.subarray(offset, offset + 2).equals(Buffer.from('--'))) break;
    if (!body.subarray(offset, offset + 2).equals(Buffer.from('\r\n'))) throw new LocalUiError(400, 'Upload multipart inválido.');
    offset += 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), offset);
    if (headerEnd < 0) throw new LocalUiError(400, 'Cabeçalhos do upload inválidos.');
    const headers = body.toString('latin1', offset, headerEnd);
    const disposition = /^content-disposition:\s*form-data;([^\r\n]*)/im.exec(headers)?.[1];
    const name = disposition && /(?:^|;)\s*name="([^"]+)"/i.exec(disposition)?.[1];
    if (!name || parts.has(name)) throw new LocalUiError(400, 'Campo ausente ou repetido no upload.');
    const filename = disposition ? /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition)?.[1] : undefined;
    const mediaType = /^content-type:\s*([^\r\n;]+)/im.exec(headers)?.[1]?.trim().toLowerCase() || 'text/plain';
    const dataStart = headerEnd + 4;
    const dataEnd = body.indexOf(nextDelimiter, dataStart);
    if (dataEnd < 0) throw new LocalUiError(400, 'Conteúdo do upload incompleto.');
    const buffer = body.subarray(dataStart, dataEnd);
    if ((name === 'media' || name === 'audio') && buffer.length > MAX_INPUT_BYTES)
      throw new LocalUiError(413, 'Cada arquivo pode ter no máximo 16 MB.');
    parts.set(name, { buffer, mediaType, ...(filename !== undefined ? { filename } : {}) });
    offset = dataEnd + 2 + delimiter.length;
  }
  return parts;
}

function isAudioUpload(part: MultipartPart): boolean {
  if (part.mediaType.startsWith('audio/')) return true;
  const extension = part.filename?.toLowerCase().split('.').pop();
  return !!extension && ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac', 'wma', 'aiff', 'aif'].includes(extension);
}

function inferMediaType(part: MultipartPart): string {
  if (part.mediaType !== 'application/octet-stream') return part.mediaType;
  const extension = part.filename?.toLowerCase().split('.').pop();
  const byExtension: Record<string, string> = {
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska',
    webm: 'video/webm', avi: 'video/x-msvideo', gif: 'image/gif',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
    ogg: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', wma: 'audio/x-ms-wma',
    aiff: 'audio/aiff', aif: 'audio/aiff',
  };
  return extension ? byExtension[extension] ?? part.mediaType : part.mediaType;
}

function sendJson(response: import('node:http').ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function parseCommonFields(params: URLSearchParams): Omit<LocalWebRequest, 'source'> {
  const command = params.get('command');
  if (command !== 'som' && command !== 'figurinha') throw new LocalUiError(400, 'Escolha !som ou !fig.');
  const originalRecipient = params.get('recipient')?.trim() ?? '';
  if (!/^\+?[\d\s().-]+$/.test(originalRecipient)) throw new LocalUiError(400, 'Informe um número com DDI e DDD.');
  const recipient = originalRecipient.replace(/\D/g, '');
  if (recipient.length < 8 || recipient.length > 15) throw new LocalUiError(400, 'O número deve ter de 8 a 15 dígitos, incluindo o DDI.');
  const fitValue = params.get('fit') ?? 'cortar';
  if (fitValue !== 'cortar' && fitValue !== 'inteiro') throw new LocalUiError(400, 'Enquadramento inválido.');
  const clip = params.get('clip')?.trim() || undefined;
  if (clip && clip.length > 32) throw new LocalUiError(400, 'O trecho informado é muito longo.');
  return { command, recipient, fit: fitValue, ...(clip ? { clip } : {}) };
}

function createLocalServer(port: number): Server {
  return createServer(async (request, response) => {
    if (!isLocalHost(request.headers.host)) { sendJson(response, 403, { error: 'A interface só aceita acesso local.' }); return; }
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    try {
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(PAGE);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/estado') {
        const svg = state.qr ? await QRCode.toString(state.qr, { type: 'svg', margin: 1, errorCorrectionLevel: 'L' }) : undefined;
        sendJson(response, 200, { connected: state.connected, svg });
        return;
      }
      if (request.method === 'POST' && !isSameOriginLocal(request, port)) {
        console.warn('[interface] POST de origem não autorizada:', {
          host: request.headers.host ?? '(ausente)',
          origin: request.headers.origin ?? '(ausente)',
          expectedCodespace: process.env.CODESPACE_NAME
            ? `${process.env.CODESPACE_NAME}-${port}.app.github.dev`
            : '(CODESPACE_NAME ausente)',
          allowCodespacesUi: process.env.ALLOW_CODESPACES_UI === 'true',
        });
        sendJson(response, 403, { error: 'Origem da solicitação não autorizada.' });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/jobs') {
        if (!state.connected) throw new LocalUiError(503, 'Conecte o bot ao WhatsApp antes de enviar.');
        if (!handlers) throw new LocalUiError(503, 'Interface de geração indisponível.');
        const parts = await readMultipart(request);
        const textField = (name: string) => {
          const part = parts.get(name);
          if (!part) return undefined;
          if (part.filename !== undefined) throw new LocalUiError(400, `O campo ${name} deve ser texto.`);
          return part.buffer.toString('utf8');
        };
        const params = new URLSearchParams();
        for (const key of ['command', 'recipient', 'fit', 'clip'] as const) {
          const value = textField(key);
          if (value !== undefined) params.set(key, value);
        }
        const fields = parseCommonFields(params);
        const media = parts.get('media');
        const audio = parts.get('audio');
        const link = textField('url')?.trim();
        if ((media ? 1 : 0) + (link ? 1 : 0) !== 1)
          throw new LocalUiError(400, 'Envie um vídeo/GIF ou informe um link, não ambos.');
        const mediaType = media ? inferMediaType(media) : undefined;
        const audioType = audio ? inferMediaType(audio) : undefined;
        if (media && !(mediaType!.startsWith('video/') || mediaType!.startsWith('image/')))
          throw new LocalUiError(415, 'Envie uma imagem, GIF ou vídeo compatível.');
        if (audio && !isAudioUpload(audio))
          throw new LocalUiError(415, 'Envie um áudio compatível, como MP3, M4A, WAV, OGG ou FLAC.');
        if (audio && fields.command !== 'som')
          throw new LocalUiError(400, 'Áudio separado só pode ser usado com !som.');
        if (audio && mediaType?.startsWith('image/') && mediaType !== 'image/gif')
          throw new LocalUiError(400, 'Para usar áudio separado, envie um vídeo ou GIF animado.');
        const source = media
          ? { type: 'file' as const, buffer: media.buffer, mediaType: mediaType! }
          : link && /^https?:\/\//i.test(link)
            ? { type: 'link' as const, url: link }
            : undefined;
        if (!source) throw new LocalUiError(400, 'Informe um link HTTP ou HTTPS válido.');
        const job = handlers.submit({
          ...fields,
          source,
          ...(audio ? { audio: { buffer: audio.buffer, mediaType: audioType!, filename: audio.filename ?? '' } } : {}),
        });
        sendJson(response, 202, job);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/jobs/file') {
        if (!state.connected) throw new LocalUiError(503, 'Conecte o bot ao WhatsApp antes de enviar.');
        if (!handlers) throw new LocalUiError(503, 'Interface de geração indisponível.');
        const mediaType = (request.headers['content-type'] ?? '').split(';', 1)[0]!.toLowerCase();
        if (!(mediaType.startsWith('video/') || mediaType.startsWith('image/'))) throw new LocalUiError(415, 'Envie um vídeo, GIF ou imagem compatível.');
        const fields = parseCommonFields(url.searchParams);
        const buffer = await readBody(request, MAX_INPUT_BYTES);
        if (!buffer.length) throw new LocalUiError(400, 'O arquivo está vazio.');
        const job = handlers.submit({ ...fields, source: { type: 'file', buffer, mediaType } });
        sendJson(response, 202, job);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/jobs/link') {
        if (!state.connected) throw new LocalUiError(503, 'Conecte o bot ao WhatsApp antes de enviar.');
        if (!handlers) throw new LocalUiError(503, 'Interface de geração indisponível.');
        const body = await readBody(request, 8 * 1024);
        let value: unknown;
        try { value = JSON.parse(body.toString('utf8')); }
        catch { throw new LocalUiError(400, 'O pedido enviado não contém JSON válido.'); }
        if (!value || typeof value !== 'object') throw new LocalUiError(400, 'Pedido inválido.');
        const data = value as Record<string, unknown>;
        const params = new URLSearchParams();
        for (const key of ['command', 'recipient', 'fit', 'clip'] as const) {
          const field = data[key];
          if (field !== undefined && typeof field !== 'string') throw new LocalUiError(400, 'Campo inválido no pedido.');
          if (typeof field === 'string') params.set(key, field);
        }
        const fields = parseCommonFields(params);
        if (typeof data.url !== 'string' || !/^https?:\/\//i.test(data.url.trim())) throw new LocalUiError(400, 'Informe um link HTTP ou HTTPS.');
        const job = handlers.submit({ ...fields, source: { type: 'link', url: data.url.trim() } });
        sendJson(response, 202, job);
        return;
      }
      const jobMatch = /^\/api\/jobs\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (request.method === 'GET' && jobMatch) {
        const job = handlers?.getJob(jobMatch[1]!);
        if (!job) { sendJson(response, 404, { error: 'Pedido não encontrado ou expirado.' }); return; }
        sendJson(response, 200, job);
        return;
      }
      const fileMatch = /^\/api\/jobs\/([0-9a-f-]{36})\/(webp|ogg)$/.exec(url.pathname);
      if (request.method === 'GET' && fileMatch) {
        const data = await handlers?.getFile(fileMatch[1]!, fileMatch[2] as 'webp' | 'ogg');
        if (!data) { sendJson(response, 404, { error: 'Arquivo não encontrado.' }); return; }
        const isWebp = fileMatch[2] === 'webp';
        response.writeHead(200, {
          'content-type': isWebp ? 'image/webp' : 'audio/ogg',
          'content-disposition': `attachment; filename="figurinha.${isWebp ? 'webp' : 'ogg'}"`,
          'content-length': data.length,
          'cache-control': 'no-store',
        });
        response.end(data);
        return;
      }
      sendJson(response, 404, { error: 'Rota não encontrada.' });
    } catch (error) {
      const status = error instanceof LocalUiError ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : 'Erro inesperado.';
      if (status === 500) console.error('Erro na interface local:', error);
      sendJson(response, status, { error: message });
    }
  });
}

/** Abre a página local no navegador padrão (uma vez só). Usado pelo inicializador de 1 clique. */
function openInBrowser(url: string): void {
  if (opened) return;
  opened = true;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref(); } catch { /* sem navegador: a página continua disponível no localhost */ }
}

export function startQrPage(port: number, options: { open?: boolean; handlers?: LocalWebHandlers } = {}): void {
  handlers = options.handlers;
  if (options.open && !server) setTimeout(() => openInBrowser(`http://localhost:${port}`), 800);
  if (server) return;
  server = createLocalServer(port);
  server.listen(port, '127.0.0.1', () => console.log(`Interface local disponível em http://localhost:${port}`));
  server.on('error', error => console.error('Interface local indisponível:', error.message));
}

export function setQr(qr: string): void { state.qr = qr; state.connected = false; }
export function markConnected(): void { state.connected = true; state.qr = undefined; }
export function markDisconnected(): void { state.connected = false; state.qr = undefined; }

export function stopQrPage(): void {
  if (!server) return;
  const current = server;
  server = undefined;
  current.close(error => { if (error) console.error('Não consegui encerrar a interface local:', error.message); });
}
