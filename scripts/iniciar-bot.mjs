// Inicializador do bot (é o que o "npm start" roda).
// Abre o bot e, quando ele se atualiza sozinho, abre de novo com a versão nova:
// código de saída 75 = reabrir; 76 = instalar as dependências novas (npm ci) e reabrir.
// Qualquer outro código (Ctrl + C, erro) encerra normalmente.
// Feito em JavaScript puro e só com módulos do Node, para funcionar mesmo enquanto o npm ci troca o node_modules.
import { spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESTART = 75;
const RESTART_INSTALL = 76;

let current;

function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
    current = child;
    child.on('error', error => { console.error(error.message); resolve(1); });
    child.on('exit', (code, signal) => { current = undefined; resolve(code ?? (signal ? 1 : 0)); });
  });
}

function installDependencies() {
  console.log('\nInstalando as dependências da versão nova...');
  const args = ['ci', '--no-audit', '--no-fund'];
  // Rodado pelo "npm start": usa o mesmo npm, sem depender do PATH nem do shell.
  const npmCli = process.env.npm_execpath;
  if (npmCli && basename(npmCli).startsWith('npm-cli')) return run(process.execPath, [npmCli, ...args]);
  return process.platform === 'win32' ? run('npm.cmd', args, { shell: true }) : run('npm', args);
}

// Ctrl + C chega também ao bot, que termina o pedido em andamento e sai; aqui só esperamos.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => { current?.kill('SIGTERM'); });

let install = process.argv.includes('--instalar');
for (;;) {
  if (install && (await installDependencies()) !== 0)
    console.error('Não consegui instalar as dependências novas. Se o bot não abrir, confira a internet e rode "npm install".');
  const code = await run(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'src/bot.ts'],
    { env: { ...process.env, BOT_LAUNCHER: '1' } });
  if (code !== RESTART && code !== RESTART_INSTALL) process.exit(code);
  install = code === RESTART_INSTALL;
  console.log('\nAbrindo o bot com a versão nova...\n');
}
