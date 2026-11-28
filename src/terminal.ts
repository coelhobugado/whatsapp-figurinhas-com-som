/**
 * Janela do bot (cmd, PowerShell, Terminal do Mac/Linux), minimalista:
 *
 *   FIGURINHAS COM SOM  v9d39d37
 *   ──────────────────────────────────────────
 *   ● online · ouvindo comandos
 *     WhatsApp: !som · !fig · !ajuda    aqui: status · atualizar · erros · sair
 *
 *   16:33  ✓ !som  com som · 7,0 s
 *   16:34  ✗ !som  TRECHO · ref 086009  O vídeo tem só 0:18.
 *
 *   › _
 *
 * A tela é limpa ao abrir (e ao reabrir depois de atualizar). Cada acontecimento ocupa uma linha;
 * detalhes (fila, versões, configuração) só no comando "status". O "›" no fim é onde se digita.
 * Cores só num terminal de verdade (e sem NO_COLOR); redirecionado para arquivo, sai texto puro.
 * Os símbolos (● ✓ ✗ ↑ ↻ ›) aparecem até no cmd antigo do Windows; emoji não.
 */
import { clearLine, cursorTo, type Interface } from 'node:readline';

const TTY = !!process.stdout.isTTY;
const COLOR = TTY && !process.env.NO_COLOR;
const sgr = (open: string, close: string) => (text: string) => COLOR ? `\x1b[${open}m${text}\x1b[${close}m` : text;

export const paint = {
  bold: sgr('1', '22'),
  dim: sgr('2', '22'),
  red: sgr('31', '39'),
  green: sgr('32', '39'),
  yellow: sgr('33', '39'),
  cyan: sgr('36', '39'),
  gray: sgr('90', '39'),
};

/** Largura visível (sem os códigos de cor). */
const visible = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '').length;
const columns = () => Math.max(40, Math.min(process.stdout.columns ?? 100, 110));

// ---------------------------------------------------------------- prompt "›"

let prompt: Interface | undefined;

/** Liga o prompt: daqui em diante as mensagens saem acima dele, sem bagunçar o que está sendo digitado. */
export function attachPrompt(rl: Interface): void {
  prompt = rl;
  rl.setPrompt(`  ${paint.cyan('›')} `);
  rl.prompt();
}

export function detachPrompt(): void {
  if (!prompt) return;
  const rl = prompt;
  prompt = undefined;
  if (TTY) { cursorTo(process.stdout, 0); clearLine(process.stdout, 0); }
  rl.close();
}

/** Linhas de um estado provisório ("○ conectando...") que a próxima mensagem apaga e substitui. */
let transient = 0;

/** Escreve linhas na janela; com o prompt ativo, apaga a linha dele, escreve e redesenha o prompt. */
function print(lines: string[]): void {
  if (transient && TTY) process.stdout.write(`\x1b[${transient}F\x1b[0J`);
  transient = 0;
  if (prompt && TTY) { cursorTo(process.stdout, 0); clearLine(process.stdout, 0); }
  process.stdout.write(lines.map(line => `${line}\n`).join(''));
  if (prompt) prompt.prompt(true);
}

// ---------------------------------------------------------------- linhas

/** Quebra por palavras na largura da janela; as continuações começam em `indent`. */
function wrap(text: string, indent: number): string[] {
  const width = columns() - indent - 1;
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line && visible(line) + 1 + visible(word) > width) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

const clock = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
/** "  16:33  ✓ " = 11 colunas antes do texto. */
const TEXT_COLUMN = 11;

function event(symbol: string, text: string, detail?: string): void {
  const [first = '', ...rest] = wrap(detail ? `${text}  ${paint.gray(detail)}` : text, TEXT_COLUMN);
  print([`  ${paint.gray(clock())}  ${symbol} ${first}`, ...rest.map(line => `${' '.repeat(TEXT_COLUMN)}${line}`)]);
}

export const log = {
  /** Estado bom e importante ("bot iniciado · ouvindo comandos"). */
  online: (text: string, detail?: string) => event(paint.green('●'), text, detail),
  /** Deu certo (figurinha enviada, conectou de novo). */
  ok: (text: string, detail?: string) => event(paint.green('✓'), text, detail),
  /** Pedido que falhou ou erro do bot. */
  fail: (text: string, detail?: string) => event(paint.red('✗'), text, detail),
  /** Algo para prestar atenção (conexão caiu, configuração estranha). */
  warn: (text: string, detail?: string) => event(paint.yellow('!'), text, detail),
  /** Informação. */
  info: (text: string, detail?: string) => event(paint.gray('·'), text, detail),
  /** Atualização do bot. */
  update: (text: string, detail?: string) => event(paint.cyan('↑'), text, detail),
  /** Só com DEBUG=true: linha apagada. */
  debug: (text: string) => event(paint.gray('·'), paint.gray(text)),
  /** Linhas apagadas embaixo do último acontecimento (ex.: a pilha de um erro, com DEBUG). */
  detail: (text: string) => print(text.split('\n').map(line => `${' '.repeat(TEXT_COLUMN)}${paint.gray(line)}`)),
  /** Bloco de texto (status, erros, ajuda), recuado. Aceita o *negrito* do WhatsApp. */
  block: (text: string) => {
    const bold = text.replace(/\*([^*\n]+)\*/g, (_, inner: string) => paint.bold(inner));
    print(['', ...bold.split('\n').flatMap(paragraph => wrap(paragraph, 6).map((line, i) => `${i ? '      ' : '    '}${line}`)), '']);
  },
};

// ---------------------------------------------------------------- tela

/** Limpa a janela (inclusive o que ficou rolado para cima) e mostra o cabeçalho. */
export function header(version: string, note?: string): void {
  if (TTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
  transient = 0;
  const title = `${paint.bold('FIGURINHAS COM SOM')}  ${paint.gray(`v${version}`)}`;
  print(['', `  ${title}`, `  ${paint.gray('─'.repeat(Math.min(46, columns() - 4)))}`]);
  if (note) print([`  ${note}`]);
}

/**
 * Linha de estado: "● online · ouvindo comandos" (verde) ou "○ conectando..." (cinza, provisória:
 * some quando a próxima mensagem aparece).
 */
export function status(online: boolean, text: string, hint?: string): void {
  const block = [`  ${online ? paint.green('●') : paint.gray('○')} ${online ? text : paint.gray(text)}`, ...(hint ? [`    ${paint.gray(hint)}`] : []), ''];
  print(block);
  if (!online) transient = block.length;
}

/** Linhas soltas (ex.: instruções do QR), recuadas, sem horário. */
export function lines(text: string): void {
  print(text.split('\n').map(line => `  ${line}`));
}
