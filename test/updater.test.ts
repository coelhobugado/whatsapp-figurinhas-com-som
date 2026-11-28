import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCommand, parseUpdateAction } from '../src/commands.js';
import { checkForUpdate, githubRepo, installTarball, setEnvValue, VERSION_FILE } from '../src/updater.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=teste@example.com', ...args], { cwd, stdio: 'pipe' }).toString().trim();

async function tempDir(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bot-teste-atualizacao-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function commitFile(repo: string, file: string, content: string, message: string): Promise<void> {
  await writeFile(join(repo, file), content);
  git(repo, 'add', file);
  git(repo, 'commit', '-q', '-m', message);
  git(repo, 'push', '-q');
}

test('comando !atualizar e suas opções', () => {
  assert.equal(parseCommand('!atualizar'), 'atualizar');
  assert.equal(parseCommand('!update off'), 'atualizar');
  assert.equal(parseUpdateAction('!atualizar'), 'agora');
  assert.equal(parseUpdateAction('!atualizar off'), 'desligar');
  assert.equal(parseUpdateAction('!atualizar DESLIGAR'), 'desligar');
  assert.equal(parseUpdateAction('!atualizar on'), 'ligar');
  assert.equal(parseUpdateAction('!atualizar talvez'), undefined);
});

test('setEnvValue troca a linha existente ou acrescenta no fim', () => {
  assert.equal(setEnvValue('A=1\nAUTO_UPDATE=true\nB=2\n', 'AUTO_UPDATE', 'false'), 'A=1\nAUTO_UPDATE=false\nB=2\n');
  assert.equal(setEnvValue('A=1\r\nB=2', 'AUTO_UPDATE', 'false'), 'A=1\r\nB=2\r\nAUTO_UPDATE=false\r\n');
  assert.equal(setEnvValue('', 'AUTO_UPDATE', 'true'), 'AUTO_UPDATE=true\n');
  // Linha comentada não conta: acrescenta uma de verdade.
  assert.equal(setEnvValue('# AUTO_UPDATE=true\n', 'AUTO_UPDATE', 'false'), '# AUTO_UPDATE=true\nAUTO_UPDATE=false\n');
});

test('githubRepo lê o endereço do package.json', () => {
  assert.equal(githubRepo('git+https://github.com/coelhobugado/whatsapp-figurinhas-com-som.git'), 'coelhobugado/whatsapp-figurinhas-com-som');
  assert.equal(githubRepo('https://github.com/dono/repo'), 'dono/repo');
  assert.equal(githubRepo('git@github.com:dono/repo.git'), 'dono/repo');
  assert.equal(githubRepo('https://gitlab.com/dono/repo'), undefined);
  assert.equal(githubRepo(undefined), undefined);
});

test('instalação pelo git: acha a versão nova, atualiza e avisa quando as dependências mudam', async t => {
  const dir = await tempDir(t);
  const remote = join(dir, 'remoto.git'), dev = join(dir, 'dev'), user = join(dir, 'usuario');
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  git(dir, 'clone', '-q', remote, dev);
  git(dev, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  await writeFile(join(dev, 'package-lock.json'), '{"v":1}\n');
  await writeFile(join(dev, 'bot.txt'), 'versão 1\n');
  git(dev, 'add', '.');
  git(dev, 'commit', '-q', '-m', 'primeira');
  git(dev, 'push', '-q', '-u', 'origin', 'main');
  // Sem conversão de fim de linha (o Git do Windows costuma vir com core.autocrlf=true).
  git(dir, 'clone', '-q', '-c', 'core.autocrlf=false', remote, user);
  // Arquivos ignorados (sessão, .env) não atrapalham.
  await writeFile(join(user, '.env'), 'STICKER_PACK_NAME=Meu\n');
  await writeFile(join(user, '.gitignore'), '.env\n');

  assert.equal((await checkForUpdate(user)).status, 'current');

  await commitFile(dev, 'bot.txt', 'versão 2\n', 'segunda');
  let check = await checkForUpdate(user);
  assert.equal(check.status, 'available');
  if (check.status !== 'available') return;
  assert.equal(check.plan.kind, 'git');
  assert.equal(check.plan.changes, 1);
  assert.deepEqual(await check.plan.apply(), { dependencies: false });
  assert.equal(await readFile(join(user, 'bot.txt'), 'utf8'), 'versão 2\n');
  assert.equal(await readFile(join(user, '.env'), 'utf8'), 'STICKER_PACK_NAME=Meu\n');

  await commitFile(dev, 'package-lock.json', '{"v":2}\n', 'dependência nova');
  check = await checkForUpdate(user);
  assert.equal(check.status, 'available');
  if (check.status !== 'available') return;
  assert.deepEqual(await check.plan.apply(), { dependencies: true });
  assert.equal((await checkForUpdate(user)).status, 'current');

  // Quem mexeu num arquivo do bot não tem o trabalho sobrescrito.
  await commitFile(dev, 'bot.txt', 'versão 3\n', 'terceira');
  await writeFile(join(user, 'bot.txt'), 'mudança minha\n');
  const dirty = await checkForUpdate(user);
  assert.equal(dirty.status, 'skipped');
  assert.equal(await readFile(join(user, 'bot.txt'), 'utf8'), 'mudança minha\n');
});

test('instalação pelo ZIP: copia o pacote por cima sem tocar em .env, sessao e node_modules', async t => {
  const dir = await tempDir(t);
  const root = join(dir, 'bot'), pack = join(dir, 'pacote', 'repo-abc123');
  await mkdir(join(root, 'sessao'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, '.env'), 'STICKER_PACK_NAME=Meu\n');
  await writeFile(join(root, 'sessao', 'creds.json'), 'login');
  await writeFile(join(root, 'package.json'), '{"name":"bot"}');
  await writeFile(join(root, 'package-lock.json'), '{"v":1}');
  await writeFile(join(root, 'src', 'bot.ts'), 'antigo');

  await mkdir(join(pack, 'src'), { recursive: true });
  await mkdir(join(pack, 'sessao'), { recursive: true });
  await writeFile(join(pack, 'package.json'), '{"name":"bot"}');
  await writeFile(join(pack, 'package-lock.json'), '{"v":1}');
  await writeFile(join(pack, 'src', 'bot.ts'), 'novo');
  await writeFile(join(pack, 'src', 'novo.ts'), 'arquivo novo');
  await writeFile(join(pack, '.env'), 'NAO=copiar');
  await writeFile(join(pack, 'sessao', 'creds.json'), 'NAO copiar');
  const archive = join(dir, 'pacote.tar.gz');
  const pack_ = () => execFileSync('tar', ['-czf', '../pacote.tar.gz', 'repo-abc123'], { cwd: join(dir, 'pacote') });
  pack_();

  assert.deepEqual(await installTarball(root, archive, 'a'.repeat(40)), { dependencies: false });
  assert.equal(await readFile(join(root, 'src', 'bot.ts'), 'utf8'), 'novo');
  assert.equal(await readFile(join(root, 'src', 'novo.ts'), 'utf8'), 'arquivo novo');
  assert.equal(await readFile(join(root, '.env'), 'utf8'), 'STICKER_PACK_NAME=Meu\n');
  assert.equal(await readFile(join(root, 'sessao', 'creds.json'), 'utf8'), 'login');
  assert.equal((await readFile(join(root, VERSION_FILE), 'utf8')).trim(), 'a'.repeat(40));

  await writeFile(join(pack, 'package-lock.json'), '{"v":2}');
  pack_();
  assert.deepEqual(await installTarball(root, archive, 'b'.repeat(40)), { dependencies: true });
  assert.ok(existsSync(join(root, 'src', 'novo.ts')));
});
