import test from 'node:test';
import assert from 'node:assert/strict';
import { FairQueue, TimeoutError, withTimeout, type JobMeta } from '../src/queue.js';

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const options = { parallel: 1, perPerson: 2, perChat: 5, maxTotal: 10, timeoutMs: 5_000 };
const job = (id: string, chat: string, person: string): JobMeta => ({ id, chat, person });

test('reveza entre conversas: um grupo cheio não faz o privado esperar todos', async () => {
  const queue = new FairQueue(options);
  const order: string[] = [];
  const run = (name: string) => async () => { await wait(5); order.push(name); };
  queue.add(job('g1', 'grupo', 'ana'), run('g1'));
  queue.add(job('g2', 'grupo', 'bia'), run('g2'));
  queue.add(job('g3', 'grupo', 'caio'), run('g3'));
  queue.add(job('p1', 'privado', 'duda'), run('p1'));
  await queue.idle();
  // g1 começa na hora; depois a vez passa ao privado antes do resto do grupo.
  assert.deepEqual(order, ['g1', 'p1', 'g2', 'g3']);
});

test('roda vários ao mesmo tempo, mas nunca dois da mesma pessoa', async () => {
  const queue = new FairQueue({ ...options, parallel: 2 });
  let active = 0, maxActive = 0;
  const anaRunning: boolean[] = [];
  let ana = 0;
  const run = (person: string) => async () => {
    active++; maxActive = Math.max(maxActive, active);
    if (person === 'ana') { ana++; anaRunning.push(ana > 1); }
    await wait(20);
    if (person === 'ana') ana--;
    active--;
  };
  queue.add(job('a1', 'c1', 'ana'), run('ana'));
  queue.add(job('a2', 'c1', 'ana'), run('ana'));
  queue.add(job('b1', 'c2', 'bia'), run('bia'));
  assert.equal(queue.runningCount, 2); // ana (a1) e bia; a2 espera a1 terminar
  await queue.idle();
  assert.equal(maxActive, 2);
  assert.ok(anaRunning.every(twice => !twice), 'dois pedidos da ana rodaram juntos');
});

test('limites: por pessoa, por conversa, total e pedido repetido', async () => {
  const queue = new FairQueue({ ...options, perPerson: 2, perChat: 3, maxTotal: 4 });
  const slow = () => wait(30);
  assert.equal(queue.add(job('1', 'grupo', 'ana'), slow).status, 'started');
  assert.deepEqual(queue.add(job('2', 'grupo', 'ana'), slow), { status: 'waiting', ahead: 0 });
  assert.deepEqual(queue.add(job('3', 'grupo', 'ana'), slow), { status: 'refused', reason: 'pessoa' });
  assert.deepEqual(queue.add(job('2', 'outro', 'zeca'), slow), { status: 'refused', reason: 'repetido' });
  assert.equal(queue.add(job('4', 'grupo', 'bia'), slow).status, 'waiting');
  assert.deepEqual(queue.add(job('5', 'grupo', 'caio'), slow), { status: 'refused', reason: 'conversa' });
  assert.equal(queue.add(job('6', 'privado', 'duda'), slow).status, 'waiting');
  assert.deepEqual(queue.add(job('7', 'privado2', 'eva'), slow), { status: 'refused', reason: 'cheia' });
  assert.equal(queue.size, 4);
  await queue.idle();
  assert.equal(queue.size, 0);
  assert.equal(queue.add(job('3', 'grupo', 'ana'), slow).status, 'started'); // depois de esvaziar, pode de novo
  await queue.idle();
});

test('erro ou demora num pedido não trava os seguintes', async () => {
  const errors: unknown[] = [];
  const queue = new FairQueue({ ...options, timeoutMs: 50, onError: error => errors.push(error) });
  let ran = false;
  queue.add(job('1', 'a', 'ana'), async () => { throw new Error('falhou'); });
  queue.add(job('2', 'b', 'bia'), () => wait(500));
  queue.add(job('3', 'c', 'caio'), async () => { ran = true; });
  await queue.idle();
  assert.equal(ran, true);
  assert.equal(errors.length, 2);
  assert.ok(errors[1] instanceof TimeoutError);
  await assert.rejects(withTimeout(wait(100), 10), TimeoutError);
});

test('idle resolve na hora com a fila vazia', async () => {
  await new FairQueue(options).idle();
});
