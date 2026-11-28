/**
 * Tratamento de erros: reconhece o tipo de cada falha, dá a ela um código curto (ex.: "REDE") e uma
 * referência única (ex.: "a1b2c3"). O usuário recebe uma resposta curta com os dois; quem cuida do bot
 * acha os detalhes técnicos pelo `!erros` (ou digitando "erros" na janela) e no arquivo `dados/erros.jsonl`.
 *
 * O registro não guarda números de telefone nem conteúdo de mensagens.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ConversionError, ToolError } from './ffmpeg.js';
import { LinkError } from './link-download.js';
import { TimeoutError } from './queue.js';

/** Falha ao baixar a mídia do WhatsApp. */
export class DownloadError extends Error {}
/** Falha ao enviar a figurinha pronta (upload ou mensagem). */
export class SendError extends Error {}

export type ClassifiedError = { code: string; user: string };

const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH',
  'EHOSTUNREACH', 'EPIPE', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT']);
const NETWORK_TEXT = /socket hang up|fetch failed|connection closed|timed out|network|getaddrinfo|tls|ssl/i;

/** Junta o código de sistema do erro e das causas (o fetch do Node esconde o código em `cause`). */
function systemCodes(error: unknown): string[] {
  const codes: string[] = [];
  for (let e = error as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++)
    if (typeof e.code === 'string') codes.push(e.code);
  return codes;
}

/** Texto técnico do erro, incluindo as causas. */
export function technicalText(error: unknown): string {
  const parts: string[] = [];
  for (let e = error as { name?: string; message?: string; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++)
    parts.push(e instanceof Error ? `${e.name !== 'Error' ? e.name : e.constructor.name}: ${e.message}` : String(e));
  return parts.join(' ← ');
}

/** Reconhece o tipo de erro e devolve o código curto e a mensagem para o usuário. */
export function classifyError(error: unknown): ClassifiedError {
  const codes = systemCodes(error);
  const text = technicalText(error);
  if (error instanceof ConversionError) return { code: error.code, user: `Não consegui criar a figurinha: ${error.message}` };
  if (error instanceof LinkError) return { code: error.code, user: error.message };
  if (error instanceof DownloadError) return { code: 'WA-DOWNLOAD', user: 'Não consegui baixar o arquivo do WhatsApp (ele pode ter expirado). Reenvie e tente de novo.' };
  if (error instanceof TimeoutError) return { code: 'DEMOROU', user: 'Demorou demais para processar. Tente um vídeo mais curto ou mais leve.' };
  if (codes.includes('ENOSPC')) return { code: 'DISCO-CHEIO', user: 'O computador do bot está sem espaço livre. Avise quem cuida dele.' };
  if (codes.includes('ENOMEM') || /out of memory|allocation failed/i.test(text))
    return { code: 'MEMORIA', user: 'O computador do bot ficou sem memória. Tente um vídeo menor.' };
  if (error instanceof ToolError) {
    if (/não foi encontrado/.test(error.message)) return { code: 'FFMPEG-FALTA', user: 'O bot está sem o FFmpeg instalado. Avise quem cuida dele.' };
    if (/tempo limite/.test(error.message)) return { code: 'FFMPEG-TEMPO', user: 'A conversão demorou demais. Tente um vídeo mais curto ou mais leve.' };
    return { code: 'FFMPEG', user: 'O conversor falhou com esse arquivo. Tente outro vídeo.' };
  }
  const network = codes.some(code => NETWORK_CODES.has(code)) || NETWORK_TEXT.test(text);
  if (error instanceof SendError)
    return network
      ? { code: 'ENVIO-REDE', user: 'Fiz a figurinha, mas a internet falhou na hora de enviar. Tente de novo.' }
      : { code: 'ENVIO', user: 'Fiz a figurinha, mas o WhatsApp não aceitou o envio. Tente de novo.' };
  if (network) return { code: 'REDE', user: 'A conexão com a internet falhou no meio. Tente de novo em instantes.' };
  return { code: 'INTERNO', user: 'Algo deu errado do meu lado.' };
}

/** Referência curta e única de um erro (6 letras/números). */
export const newErrorRef = () => randomBytes(3).toString('hex');

/** Linha que vai no fim da resposta ao usuário. */
export const errorFooter = (code: string, ref: string) => `_(erro ${code} · ref ${ref})_`;

export type ErrorContext = Record<string, string | number | boolean | undefined>;

export type ErrorRecord = {
  ref: string;
  at: string;
  code: string;
  /** Onde aconteceu: "!som", "!fig", "conexão", "processo"... */
  where: string;
  context?: ErrorContext;
  message: string;
  stack?: string;
};

/**
 * Registro de erros em `dados/erros.jsonl` (uma linha JSON por erro). Guarda os últimos 50 na memória
 * para o `!erros`. Quando o arquivo passa de 1 MB, vira `erros.antigo.jsonl` e começa um novo.
 */
export class ErrorLog {
  private readonly file: string;
  private readonly recent: ErrorRecord[] = [];

  constructor(dir: string, private readonly maxBytes = 1024 * 1024) {
    this.file = join(dir, 'erros.jsonl');
    try {
      mkdirSync(dir, { recursive: true });
      if (existsSync(this.file)) {
        for (const line of readFileSync(this.file, 'utf8').trim().split('\n').slice(-50)) {
          try { this.recent.push(JSON.parse(line) as ErrorRecord); } catch { /* linha quebrada: ignora */ }
        }
      }
    } catch { /* sem acesso à pasta: o registro fica só na memória */ }
  }

  /**
   * Registra o erro (síncrono, para funcionar até no meio de uma queda) e devolve o registro.
   * Nunca lança: um problema ao gravar não pode derrubar o bot.
   */
  record(error: unknown, where: string, context?: ErrorContext, known?: { code: string; ref?: string }): ErrorRecord {
    const entry: ErrorRecord = {
      ref: known?.ref ?? newErrorRef(),
      at: new Date().toISOString(),
      code: known?.code ?? classifyError(error).code,
      where,
      context: context && Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined)),
      message: technicalText(error).slice(0, 2000),
      stack: error instanceof Error ? error.stack?.split('\n').slice(1, 9).map(l => l.trim()).join('\n') : undefined,
    };
    this.recent.push(entry);
    if (this.recent.length > 50) this.recent.shift();
    try {
      if (existsSync(this.file) && statSync(this.file).size > this.maxBytes) renameSync(this.file, this.file.replace(/\.jsonl$/, '.antigo.jsonl'));
      appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
    } catch { /* sem espaço ou sem permissão: fica só na memória */ }
    return entry;
  }

  /** Os últimos `count` erros, do mais novo para o mais antigo. */
  list(count = 10): ErrorRecord[] { return this.recent.slice(-count).reverse(); }

  find(ref: string): ErrorRecord | undefined {
    const wanted = ref.toLowerCase().replace(/^#/, '');
    return [...this.recent].reverse().find(entry => entry.ref === wanted);
  }
}

const shortTime = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Lista curta para o `!erros`. */
export function formatErrorList(entries: ErrorRecord[]): string {
  if (!entries.length) return 'Nenhum erro registrado. 🎉';
  return ['*Últimos erros* (mais novo primeiro):', ...entries.map(e =>
    `${shortTime(e.at)} · *${e.code}* · ref ${e.ref} · ${e.where} — ${e.message.slice(0, 90)}`),
  '', 'Detalhes de um erro: *!erros <ref>*'].join('\n');
}

/** Detalhes de um erro para o `!erros <ref>`. */
export function formatErrorDetail(entry: ErrorRecord): string {
  const context = Object.entries(entry.context ?? {}).map(([k, v]) => `${k}=${v}`).join(', ');
  return [
    `*Erro ${entry.code}* · ref ${entry.ref}`,
    `Quando: ${shortTime(entry.at)} · Onde: ${entry.where}`,
    context && `Contexto: ${context}`,
    `Mensagem: ${entry.message}`,
    entry.stack && `Pilha:\n${entry.stack}`,
  ].filter(Boolean).join('\n');
}
