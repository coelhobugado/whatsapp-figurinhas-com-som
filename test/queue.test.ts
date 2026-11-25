import test from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue, TimeoutError, withTimeout } from '../src/queue.js';

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

test('fila roda um por vez, informa a posição e recusa quando lota', async () => {
  const errors: unknown[] = [];
  const queue = new JobQueue(2, 5_000, error => errors.push(error));
  const order: string[] = [];
  const a = queue.add('ana', async () => { await wait(30); order.push('a'); });
  const b = queue.add('bia', async () => { order.push('b'); });
  const c = queue.add('caio', async () => { order.push('c'); });
  assert.deepEqual(a, { status: 'queued', position: 1 });
  assert.deepEqual(b, { status: 'queued', position: 2 });
  assert.deepEqual(c, { status: 'full' });
  await queue.idle();
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(queue.size, 0);
  assert.equal(errors.length, 0);
});

test('a mesma pessoa não enfileira dois pedidos ao mesmo tempo, mas pode depois', async () => {
  const queue = new JobQueue(5);
  assert.equal(queue.add('ana', () => wait(20)).status, 'queued');
  assert.deepEqual(queue.add('ana', () => wait(1)), { status: 'duplicate' });
  await queue.idle();
  assert.equal(queue.add('ana', () => wait(1)).status, 'queued');
  await queue.idle();
});

test('erro ou demora num pedido não trava os seguintes', async () => {
  const errors: unknown[] = [];
  const queue = new JobQueue(5, 50, error => errors.push(error));
  let ran = false;
  queue.add('ana', async () => { throw new Error('falhou'); });
  queue.add('bia', () => wait(500));
  queue.add('caio', async () => { ran = true; });
  await queue.idle();
  assert.equal(ran, true);
  assert.equal(errors.length, 2);
  assert.ok(errors[1] instanceof TimeoutError);
  await assert.rejects(withTimeout(wait(100), 10), TimeoutError);
});
