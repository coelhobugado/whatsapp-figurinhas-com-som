// Inicializador do bot (é o que o "npm start" roda). Abre o bot e o reabre quando precisa:
// - código 75: o bot se atualizou → reabre na hora;
// - código 76: atualizou e as dependências mudaram → roda "npm ci" e reabre;
// - código 0 (Ctrl + C) ou 1 (problema que reabrir não resolve: sessão desconectada, número bloqueado,
//   falta o FFmpeg) → encerra;
// - qualquer outro (o bot caiu: erro inesperado, falta de memória...) → reabre depois de alguns segundos.
//   Se cair 5 vezes em 10 minutos, para de reabrir para o erro ficar visível na tela.
// Feito em JavaScript puro e só com módulos do Node, para funcionar mesmo enquanto o npm ci troca o node_modules.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESTART = 75;
const RESTART_INSTALL = 76;
const FATAL = 1;
/** Código do Windows quando o processo é encerrado com Ctrl + C. */
const WINDOWS_CTRL_C = 3221225786;
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 10 * 60_000;

let current;
let stopping = false;

// Mesmo visual das mensagens do bot (src/terminal.ts): horário + etiqueta colorida.
const COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR;
const LABELS = { versao: ['VERSÃO', '46;30'], erro: ['ERRO', '41;97'] };
function say(kind, text, stream = process.stdout) {
  const [name, colors] = LABELS[kind];
  const time = new Date().toLocaleTimeString('pt-BR');
  const tag = COLOR ? `\x1b[${colors}m ${name.padEnd(7)} \x1b[0m` : `[${name}]`.padEnd(9);
  const [first, ...rest] = text.split('\n');
  stream.write(`${COLOR ? `\x1b[90m${time}\x1b[39m` : time}  ${tag}  ${first}\n`);
  for (const line of rest) stream.write(`${' '.repeat(21)}${line}\n`);
}

function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
    current = child;
    child.on('error', error => { console.error(error.message); resolve(1); });
    child.on('exit', (code, signal) => { current = undefined; resolve(code ?? (signal ? 1 : 0)); });
  });
}

function installDependencies() {
  say('versao', 'Instalando as dependências da versão nova...');
  const args = ['ci', '--no-audit', '--no-fund'];
  // Rodado pelo "npm start": usa o mesmo npm, sem depender do PATH nem do shell.
  const npmCli = process.env.npm_execpath;
  if (npmCli && basename(npmCli).startsWith('npm-cli')) return run(process.execPath, [npmCli, ...args]);
  return process.platform === 'win32' ? run('npm.cmd', args, { shell: true }) : run('npm', args);
}

/** Espera `ms`, mas para na hora se a pessoa apertar Ctrl + C. */
function pause(ms) {
  return new Promise(resolve => {
    const timer = setInterval(() => { if (stopping) { clearInterval(timer); resolve(); } }, 200);
    setTimeout(() => { clearInterval(timer); resolve(); }, ms);
  });
}

// Ctrl + C chega também ao bot, que termina o pedido em andamento e sai; aqui só esperamos e não reabrimos.
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; current?.kill('SIGTERM'); });

const crashes = [];
let install = process.argv.includes('--instalar');
/** Por que o bot está sendo reaberto (o bot mostra um aviso no topo da tela): '' | 'atualizacao' | 'queda'. */
let reopened = install ? 'atualizacao' : '';
for (;;) {
  if (install && (await installDependencies()) !== 0)
    say('erro', 'Não consegui instalar as dependências novas. Se o bot não abrir, confira a internet e rode "npm install".', process.stderr);
  install = false;
  // Sem .env, o bot usa os padrões (sem o aviso ".env not found" do Node).
  const envFile = existsSync(join(ROOT, '.env')) ? ['--env-file=.env'] : [];
  const code = await run(process.execPath, [...envFile, '--import', 'tsx', 'src/bot.ts'],
    { env: { ...process.env, BOT_LAUNCHER: '1', BOT_REOPENED: reopened } });

  if (code === RESTART || code === RESTART_INSTALL) {
    install = code === RESTART_INSTALL;
    reopened = 'atualizacao';
    say('versao', 'Abrindo o bot com a versão nova...');
    continue;
  }
  if (stopping || code === 0 || code === FATAL || code === WINDOWS_CTRL_C) process.exit(code);

  // O bot caiu: reabre, esperando um pouco mais a cada queda seguida.
  const now = Date.now();
  crashes.push(now);
  while (crashes.length && crashes[0] < now - CRASH_WINDOW_MS) crashes.shift();
  if (crashes.length >= MAX_CRASHES) {
    say('erro', `O bot caiu ${crashes.length} vezes em 10 minutos, então parei de reabrir para o erro ficar na tela.\n` +
      'Veja a mensagem acima (e os detalhes em dados/erros.jsonl). Depois de resolver, abra o bot de novo.', process.stderr);
    process.exit(code);
  }
  const seconds = Math.min(30, 2 ** crashes.length);
  say('erro', `O bot fechou com erro (código ${code}). Reabrindo em ${seconds} s...\n` +
    `Queda ${crashes.length} de ${MAX_CRASHES} permitidas em 10 minutos. Os pedidos pela metade serão retomados.`, process.stderr);
  await pause(seconds * 1000);
  if (stopping) process.exit(code);
  reopened = 'queda';
}
