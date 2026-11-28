import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnimatedSticker } from '../src/convert.js';
import {
  classifyError, DownloadError, ErrorLog, formatErrorDetail, formatErrorList, SendError,
} from '../src/errors.js';
import { ConversionError, ToolError } from '../src/ffmpeg.js';
import { Pacer, RateLimiter } from '../src/limits.js';
import { LinkError } from '../src/link-download.js';
import { PendingStore, slimMessage, type PendingJob } from '../src/pending.js';
import { TimeoutError } from '../src/queue.js';
import { syntheticVideo } from './helpers.js';

async function tempDir(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bot-teste-resiliencia-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const errno = (code: string) => Object.assign(new Error(code), { code });

test('cada tipo de erro vira um código curto e uma mensagem amigável', () => {
  const cases: [unknown, string][] = [
    [new ConversionError('O arquivo passa de 16 MB.', 'TAMANHO'), 'TAMANHO'],
    [new LinkError('Esse TikTok é um post de fotos.', 'LINK-FOTOS'), 'LINK-FOTOS'],
    [new DownloadError('403'), 'WA-DOWNLOAD'],
    [new TimeoutError('Passou de 180 s.'), 'DEMOROU'],
    [errno('ENOSPC'), 'DISCO-CHEIO'],
    [errno('ENOMEM'), 'MEMORIA'],
    [new ToolError('"ffmpeg" não foi encontrado.'), 'FFMPEG-FALTA'],
    [new ToolError('ffmpeg passou do tempo limite (60 s).'), 'FFMPEG-TEMPO'],
    [new ToolError('ffmpeg falhou: Invalid data'), 'FFMPEG'],
    [new SendError('falhou', { cause: errno('ECONNRESET') }), 'ENVIO-REDE'],
    [new SendError('not-acceptable'), 'ENVIO'],
    [new TypeError('fetch failed', { cause: errno('ENOTFOUND') }), 'REDE'],
    [new Error('Connection Closed'), 'REDE'],
    [new Error('algo estranho'), 'INTERNO'],
    ['nem é um Error', 'INTERNO'],
  ];
  for (const [error, code] of cases) {
    const result = classifyError(error);
    assert.equal(result.code, code, `${String(error)} → ${result.code}`);
    assert.ok(result.user.length > 10 && result.user.length < 140, `mensagem curta para ${code}`);
  }
});

test('registro de erros: grava, lista, acha pela ref e sobrevive a reinício', async t => {
  const dir = await tempDir(t);
  const log = new ErrorLog(dir);
  const first = log.record(new ToolError('ffmpeg falhou: x'), '!som', { comando: '!som', tamanhoKB: 900, vazio: undefined });
  const second = log.record(new Error('outro'), '!fig', undefined, { code: 'SOM-RECUSADO' });
  assert.match(first.ref, /^[0-9a-f]{6}$/);
  assert.equal(first.code, 'FFMPEG');
  assert.equal(second.code, 'SOM-RECUSADO');
  assert.deepEqual(log.list().map(e => e.ref), [second.ref, first.ref]);
  assert.equal(log.find(`#${first.ref.toUpperCase()}`)?.code, 'FFMPEG');
  assert.ok(!('vazio' in (first.context ?? {})));

  const reopened = new ErrorLog(dir);
  assert.equal(reopened.find(first.ref)?.where, '!som');
  assert.match(formatErrorList(reopened.list()), /FFMPEG.*ref/);
  assert.match(formatErrorDetail(first), /tamanhoKB=900/);
  assert.equal(formatErrorList([]), 'Nenhum erro registrado. 🎉');
  // Nada de telefone no arquivo: só o que foi passado no contexto.
  assert.doesNotMatch(await readFile(join(dir, 'erros.jsonl'), 'utf8'), /@s\.whatsapp\.net/);
});

test('registro de erros troca de arquivo quando fica grande', async t => {
  const dir = await tempDir(t);
  const log = new ErrorLog(dir, 300);
  for (let i = 0; i < 5; i++) log.record(new Error(`erro ${i} ${'x'.repeat(100)}`), 'teste');
  assert.ok(existsSync(join(dir, 'erros.antigo.jsonl')));
  assert.equal(log.list(50).length, 5);
});

test('pedidos salvos em disco voltam depois de reiniciar, com a mídia intacta', async t => {
  const dir = await tempDir(t);
  const mediaKey = Buffer.from('0123456789abcdef0123456789abcdef');
  const message = slimMessage({
    key: { remoteJid: '123@g.us', id: 'ABC', participant: '9@lid' },
    message: { videoMessage: { caption: '!som', mediaKey, directPath: '/v/x', fileLength: 1234 } },
    messageTimestamp: 1_800_000_000,
  });
  const job: PendingJob = { id: '123@g.us|ABC', command: 'som', text: '!som', message, sentAt: 1_800_000_000_000, attempts: 1 };
  const store = new PendingStore(dir);
  store.save(job);
  store.save({ ...job, id: 'outro' });
  store.remove('outro');

  const loaded = new PendingStore(dir).load();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]!.id, job.id);
  assert.equal(loaded[0]!.attempts, 1);
  const key = loaded[0]!.message.message?.videoMessage?.mediaKey;
  assert.ok(Buffer.isBuffer(key) && key.equals(mediaKey), 'mediaKey voltou como Buffer');
  assert.equal(loaded[0]!.message.messageTimestamp, 1_800_000_000);

  await writeFile(join(dir, 'pedidos.json'), '{quebrado');
  assert.deepEqual(new PendingStore(dir).load(), []);
});

test('RateLimiter: limite por chave numa janela de tempo', () => {
  const limiter = new RateLimiter(2, 1000);
  assert.equal(limiter.hit('ana', 0), true);
  assert.equal(limiter.hit('ana', 10), true);
  assert.equal(limiter.hit('ana', 20), false);
  assert.equal(limiter.hit('bia', 20), true);
  assert.equal(limiter.hit('ana', 1015), true); // a primeira saiu da janela
});

test('Pacer: rajada até o limite, depois segura e solta na ordem', async () => {
  let now = 0;
  const pacer = new Pacer(600, 2, () => now); // 10 por segundo
  assert.equal(pacer.tryTake(), true);
  assert.equal(pacer.tryTake(), true);
  assert.equal(pacer.tryTake(), false);
  const order: number[] = [];
  const a = pacer.wait().then(() => order.push(1));
  const b = pacer.wait().then(() => order.push(2));
  assert.equal(pacer.queued, 2);
  now += 1000; // o relógio anda: fichas suficientes para os dois
  await Promise.all([a, b]);
  assert.deepEqual(order, [1, 2]);
});

test('vídeo com resolução absurda é recusado antes de decodificar', async () => {
  const video = await syntheticVideo(0.5, false, 4800, 2700);
  await assert.rejects(createAnimatedSticker(video), (error: unknown) =>
    error instanceof ConversionError && error.code === 'RESOLUCAO' && /4800×2700/.test(error.message));
});
