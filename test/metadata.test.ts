import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimatedSticker, createStaticSticker } from '../src/convert.js';
import { inspectWebp, readStickerMetadata } from '../src/webp.js';
import { syntheticImage, syntheticVideo } from './helpers.js';

const META = { packName: 'Criada por Dexter', publisher: '' };

function checkMetadata(webp: Buffer) {
  const vp8x = webp.indexOf('VP8X', 12, 'ascii');
  assert.equal(vp8x, 12, 'VP8X precisa ser o primeiro bloco');
  assert.ok(webp[20]! & 0x08, 'flag EXIF ligada no VP8X');
  const info = inspectWebp(webp); // RIFF e blocos consistentes
  assert.equal(info.width, 512);
  assert.equal(info.height, 512);
  const meta = readStickerMetadata(webp);
  assert.equal(meta?.['sticker-pack-name'], 'Criada por Dexter');
  assert.equal(meta?.['sticker-pack-publisher'], '');
  assert.equal(typeof meta?.['sticker-pack-id'], 'string');
}

test('figurinha animada leva o nome do pacote no EXIF', async () => {
  const result = await createAnimatedSticker(await syntheticVideo(2, false), { meta: META });
  checkMetadata(result.sticker);
  assert.equal(inspectWebp(result.sticker).animated, true);
});

test('figurinha estática leva o nome do pacote no EXIF', async () => {
  const result = await createStaticSticker(await syntheticImage(), 'cortar', META);
  checkMetadata(result.sticker);
});

test('sem metadados o arquivo não ganha EXIF', async () => {
  const result = await createStaticSticker(await syntheticImage());
  assert.equal(readStickerMetadata(result.sticker), undefined);
});
