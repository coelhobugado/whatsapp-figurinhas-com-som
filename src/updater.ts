/**
 * Atualização automática do bot.
 *
 * - Instalado com `git clone`: `git fetch` e `git merge --ff-only` no ramo que a pessoa acompanha.
 *   Se ela mudou arquivos do projeto, nada é feito (não sobrescreve o trabalho de ninguém).
 * - Instalado pelo ZIP: pergunta ao GitHub qual é o commit mais novo, baixa o pacote .tar.gz desse
 *   commit e copia por cima. O commit instalado fica anotado em `.versao`.
 *
 * Nos dois casos `.env`, `sessao/`, `saida/` e `node_modules/` nunca são tocados. Quem reabre o bot
 * (e roda `npm ci` quando as dependências mudaram) é o inicializador `scripts/iniciar-bot.mjs`.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;
/** Códigos de saída que pedem ao inicializador para reabrir o bot (76 = rodar `npm ci` antes). */
export const EXIT_RESTART = 75;
export const EXIT_RESTART_INSTALL = 76;
/** Arquivo com o commit instalado, nas instalações feitas pelo ZIP. */
export const VERSION_FILE = '.versao';
const BRANCH = 'main';
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
/** Nunca copiados por cima, mesmo que apareçam no pacote baixado. */
const PROTECTED = new Set(['.env', 'sessao', 'saida', 'node_modules', '.git', VERSION_FILE]);
/** No Windows 10/11 o tar.exe vem junto com o sistema. */
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

export type UpdatePlan = {
  kind: 'git' | 'zip';
  current: string;
  latest: string;
  /** Quantos commits novos (só no git). */
  changes?: number;
  /** Aplica a atualização. `dependencies` = o package-lock.json mudou (precisa de `npm ci`). */
  apply(): Promise<{ dependencies: boolean }>;
};

export type UpdateCheck =
  | { status: 'current'; version: string }
  | { status: 'skipped'; reason: string }
  | { status: 'available'; plan: UpdatePlan };

export class UpdateError extends Error {}

function run(file: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new UpdateError(`${file} ${args[0]}: ${(stderr || error.message).toString().trim()}`));
      else resolve(stdout.toString().trim());
    });
  });
}

const short = (sha: string) => sha.slice(0, 7);

/** Confere se há versão nova, sem mudar nada. A mudança só acontece em `plan.apply()`. */
export async function checkForUpdate(root = ROOT): Promise<UpdateCheck> {
  return existsSync(join(root, '.git')) ? checkGit(root) : checkZip(root);
}

// ---------------------------------------------------------------- git

async function checkGit(root: string): Promise<UpdateCheck> {
  const git = (...args: string[]) => run('git', args, root);
  try { await git('--version'); }
  catch { return { status: 'skipped', reason: 'o bot foi baixado com o git, mas o git não está instalado neste computador' }; }
  const upstream = await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').catch(() => '');
  if (!upstream) return { status: 'skipped', reason: 'o ramo do git em uso não acompanha nenhum ramo do GitHub' };
  await git('fetch', '--quiet');
  const head = await git('rev-parse', 'HEAD');
  const remote = await git('rev-parse', '@{u}');
  const behind = Number(await git('rev-list', '--count', 'HEAD..@{u}'));
  if (!behind) return { status: 'current', version: short(head) };
  if (await git('status', '--porcelain', '--untracked-files=no'))
    return { status: 'skipped', reason: 'há arquivos do bot modificados neste computador (o git não sobrescreve mudanças suas)' };
  const ahead = Number(await git('rev-list', '--count', '@{u}..HEAD'));
  if (ahead) return { status: 'skipped', reason: 'este computador tem commits que não estão no GitHub (atualize com "git pull")' };
  return {
    status: 'available',
    plan: {
      kind: 'git', current: short(head), latest: short(remote), changes: behind,
      async apply() {
        await git('merge', '--ff-only', '--quiet', remote);
        const changed = (await git('diff', '--name-only', head, remote)).split(/\r?\n/);
        return { dependencies: changed.includes('package-lock.json') };
      },
    },
  };
}

// ---------------------------------------------------------------- ZIP (sem git)

/** "git+https://github.com/dono/repo.git" (ou o formato SSH) → "dono/repo". */
export function githubRepo(url: string | undefined): string | undefined {
  const match = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url ?? '');
  return match ? `${match[1]}/${match[2]}` : undefined;
}

async function fetchChecked(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'whatsapp-figurinhas-com-som-updater', Accept: accept },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new UpdateError(`GitHub respondeu ${response.status} para ${new URL(url).pathname}`);
  return response;
}

async function checkZip(root: string): Promise<UpdateCheck> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { repository?: { url?: string } | string };
  const repo = githubRepo(typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url);
  if (!repo) return { status: 'skipped', reason: 'não achei o endereço do projeto no GitHub (package.json › repository)' };
  const latest = (await (await fetchChecked(`https://api.github.com/repos/${repo}/commits/${BRANCH}`, 'application/vnd.github.sha')).text()).trim();
  if (!/^[0-9a-f]{40}$/.test(latest)) throw new UpdateError('O GitHub devolveu uma versão em formato inesperado.');
  const current = (await readFile(join(root, VERSION_FILE), 'utf8').catch(() => '')).trim();
  if (current === latest) return { status: 'current', version: short(latest) };
  return {
    status: 'available',
    plan: {
      kind: 'zip', current: current ? short(current) : 'desconhecida', latest: short(latest),
      async apply() {
        const dir = await mkdtemp(join(tmpdir(), 'bot-atualizacao-'));
        try {
          const response = await fetchChecked(`https://codeload.github.com/${repo}/tar.gz/${latest}`, 'application/gzip');
          const data = Buffer.from(await response.arrayBuffer());
          if (data.length > MAX_DOWNLOAD_BYTES) throw new UpdateError('O pacote da versão nova veio grande demais.');
          const archive = join(dir, 'versao.tar.gz');
          await writeFile(archive, data);
          return await installTarball(root, archive, latest);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    },
  };
}

async function fileHash(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path).catch(() => Buffer.alloc(0))).digest('hex');
}

/**
 * Extrai o pacote .tar.gz do GitHub (uma pasta "repo-<commit>/" com o projeto) e copia por cima de `root`,
 * pulando `.env`, `sessao/`, `saida/`, `node_modules/` e `.git/`. Grava o commit em `.versao`.
 */
export async function installTarball(root: string, archive: string, version: string): Promise<{ dependencies: boolean }> {
  const out = await mkdtemp(join(tmpdir(), 'bot-pacote-'));
  try {
    // Caminho relativo: o tar do GNU (Git Bash, MSYS) entende "C:\..." como um computador remoto.
    await run(TAR, ['-xzf', relative(out, archive)], out);
    const entries = await readdir(out, { withFileTypes: true });
    const top = entries.length === 1 && entries[0]!.isDirectory() ? join(out, entries[0]!.name) : undefined;
    if (!top || !existsSync(join(top, 'package.json'))) throw new UpdateError('O pacote baixado não parece ser o projeto do bot.');
    const before = await fileHash(join(root, 'package-lock.json'));
    await cp(top, root, {
      recursive: true, force: true,
      filter: source => {
        const path = relative(top, source);
        return !path || !PROTECTED.has(path.split(sep)[0]!);
      },
    });
    const after = await fileHash(join(root, 'package-lock.json'));
    await writeFile(join(root, VERSION_FILE), `${version}\n`);
    return { dependencies: before !== after };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- preferência no .env

/** Troca (ou acrescenta) `CHAVE=valor` no conteúdo de um .env, mantendo o resto e as quebras de linha. */
export function setEnvValue(content: string, key: string, value: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const line = new RegExp(`^${key}=.*$`, 'm');
  if (line.test(content)) return content.replace(line, `${key}=${value}`);
  const base = content && !content.endsWith('\n') ? content + newline : content;
  return `${base}${key}=${value}${newline}`;
}

/** Grava a preferência no .env do projeto, para valer também depois de reiniciar. */
export async function saveEnvSetting(key: string, value: string, root = ROOT): Promise<void> {
  const path = join(root, '.env');
  const content = await readFile(path, 'utf8').catch(() => '');
  await writeFile(path, setEnvValue(content, key, value));
}
