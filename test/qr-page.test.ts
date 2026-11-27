import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import test from 'node:test';
import {
  markConnected, markDisconnected, startQrPage, stopQrPage,
  type LocalWebRequest,
} from '../src/qr-page.js';

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('interface local aceita pedido same-origin, entrega estado e recusa origem externa', async t => {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const previousCodespace = process.env.CODESPACE_NAME;
  const previousForwarding = process.env.ALLOW_CODESPACES_UI;
  let submitted: LocalWebRequest | undefined;
  startQrPage(port, {
    handlers: {
      submit: request => {
        submitted = request;
        return { id: '00000000-0000-4000-8000-000000000001', position: 1 };
      },
      getJob: () => undefined,
      getFile: async () => undefined,
    },
  });
  markConnected();
  t.after(() => {
    markDisconnected();
    stopQrPage();
    if (previousCodespace === undefined) delete process.env.CODESPACE_NAME;
    else process.env.CODESPACE_NAME = previousCodespace;
    if (previousForwarding === undefined) delete process.env.ALLOW_CODESPACES_UI;
    else process.env.ALLOW_CODESPACES_UI = previousForwarding;
  });

  let stateResponse: Response | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      stateResponse = await fetch(`${baseUrl}/estado`);
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  assert.ok(stateResponse);
  assert.deepEqual(await stateResponse.json(), { connected: true });

  const rejected = await fetch(`${baseUrl}/api/jobs/link`, {
    method: 'POST',
    headers: { Origin: 'http://example.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'som', recipient: '5511999998888', fit: 'cortar', url: 'https://youtu.be/abcdefghijk' }),
  });
  assert.equal(rejected.status, 403);

  const wrongPort = await fetch(`${baseUrl}/api/jobs/link`, {
    method: 'POST',
    headers: { Origin: `http://localhost:${port + 1}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'som', recipient: '5511999998888', fit: 'cortar', url: 'https://youtu.be/abcdefghijk' }),
  });
  assert.equal(wrongPort.status, 403);

  const accepted = await fetch(`${baseUrl}/api/jobs/link`, {
    method: 'POST',
    headers: { Origin: `http://localhost:${port}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'som', recipient: '5511999998888', fit: 'inteiro', clip: '0:42-0:47', url: 'https://youtu.be/abcdefghijk' }),
  });
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { id: '00000000-0000-4000-8000-000000000001', position: 1 });
  assert.deepEqual(submitted, {
    command: 'som',
    recipient: '5511999998888',
    fit: 'inteiro',
    clip: '0:42-0:47',
    source: { type: 'link', url: 'https://youtu.be/abcdefghijk' },
  });

  process.env.CODESPACE_NAME = 'test-codespace';
  delete process.env.ALLOW_CODESPACES_UI;
  const forwardedOrigin = `https://test-codespace-${port}.app.github.dev`;
  const forwardedRequest = () => fetch(`${baseUrl}/api/jobs/link`, {
    method: 'POST',
    headers: { Origin: forwardedOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'som', recipient: '5511999998888', fit: 'cortar', url: 'https://youtu.be/abcdefghijk' }),
  });
  assert.equal((await forwardedRequest()).status, 403);
  process.env.ALLOW_CODESPACES_UI = 'true';
  assert.equal((await forwardedRequest()).status, 202);

  const uploaded = await fetch(`${baseUrl}/api/jobs/file?command=som&recipient=5511999998888&fit=cortar`, {
    method: 'POST',
    headers: { Origin: `https://localhost:${port}`, 'Content-Type': 'image/png' },
    body: Buffer.from('image bytes'),
  });
  assert.equal(uploaded.status, 202);
  assert.deepEqual(submitted?.source, { type: 'file', buffer: Buffer.from('image bytes'), mediaType: 'image/png' });

  const form = new FormData();
  form.set('command', 'som');
  form.set('recipient', '5511999998888');
  form.set('fit', 'cortar');
  form.set('media', new Blob([Buffer.from('video bytes')], { type: 'video/mp4' }), 'animacao.mp4');
  form.set('audio', new Blob([Buffer.from('audio bytes')], { type: 'application/octet-stream' }), 'trilha.mp3');
  const multipart = await fetch(`${baseUrl}/api/jobs`, {
    method: 'POST',
    headers: { Origin: `https://localhost:${port}` },
    body: form,
  });
  assert.equal(multipart.status, 202, await multipart.clone().text());
  assert.deepEqual(submitted, {
    command: 'som',
    recipient: '5511999998888',
    fit: 'cortar',
    source: { type: 'file', buffer: Buffer.from('video bytes'), mediaType: 'video/mp4' },
    audio: { buffer: Buffer.from('audio bytes'), mediaType: 'audio/mpeg', filename: 'trilha.mp3' },
  });

  const linkForm = new FormData();
  linkForm.set('command', 'som');
  linkForm.set('recipient', '5511999998888');
  linkForm.set('fit', 'cortar');
  linkForm.set('url', 'https://youtu.be/abcdefghijk');
  linkForm.set('audio', new Blob([Buffer.from('audio bytes')], { type: 'audio/mpeg' }), 'trilha.mp3');
  const linkWithAudio = await fetch(`${baseUrl}/api/jobs`, {
    method: 'POST',
    headers: { Origin: `https://localhost:${port}` },
    body: linkForm,
  });
  assert.equal(linkWithAudio.status, 202);
  assert.deepEqual(submitted?.source, { type: 'link', url: 'https://youtu.be/abcdefghijk' });
  assert.equal(submitted?.audio?.filename, 'trilha.mp3');
});
