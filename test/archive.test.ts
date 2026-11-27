import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { archiveSticker } from '../src/archive.js';
import { withTempDir } from '../src/ffmpeg.js';

test('arquiva WebP e Ogg juntos em saida/com-som', async () => {
  await withTempDir(async dir => {
    const sticker = Buffer.from('webp');
    const audio = Buffer.from('ogg');
    const saved = await archiveSticker('com-som', { sticker, audio }, dir);

    assert.equal(saved.stickerPath.startsWith(join(dir, 'com-som')), true);
    assert.ok(saved.audioPath);
    assert.equal(basename(saved.stickerPath, '.webp'), basename(saved.audioPath!, '.ogg'));
    assert.deepEqual(await readFile(saved.stickerPath), sticker);
    assert.deepEqual(await readFile(saved.audioPath!), audio);
  });
});

test('arquiva somente o WebP em saida/outros quando não há áudio', async () => {
  await withTempDir(async dir => {
    const sticker = Buffer.from('webp');
    const saved = await archiveSticker('outros', { sticker }, dir);

    assert.equal(saved.stickerPath.startsWith(join(dir, 'outros')), true);
    assert.equal(saved.audioPath, undefined);
    assert.deepEqual(await readFile(saved.stickerPath), sticker);
  });
});

test('usa nomes únicos para não sobrescrever resultados', async () => {
  await withTempDir(async dir => {
    const first = await archiveSticker('com-som', { sticker: Buffer.from('1') }, dir);
    const second = await archiveSticker('com-som', { sticker: Buffer.from('2') }, dir);

    assert.notEqual(first.stickerPath, second.stickerPath);
  });
});
