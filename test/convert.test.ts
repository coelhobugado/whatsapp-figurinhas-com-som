import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAnimatedSticker, createStaticSticker, MAX_ANIMATED_BYTES, MAX_STATIC_BYTES } from '../src/convert.js';
import { ConversionError, probe, runFull, withTempDir } from '../src/ffmpeg.js';
import { syntheticImage, syntheticVideo } from './helpers.js';

test('vídeo com áudio vira WebP animado 512×512 dentro do limite', async () => {
  const result = await createAnimatedSticker(await syntheticVideo(3));
  assert.equal(result.animated, true);
  assert.equal(result.hasAudio, true);
  assert.equal(result.trimmed, false);
  assert.ok(result.sticker.length <= MAX_ANIMATED_BYTES);
  assert.ok(Math.abs(result.durationMs - 3000) < 200, `duração ${result.durationMs}`);
});

/** Retângulo e presença de alfa do primeiro quadro (ANMF) de um WebP animado. */
function firstFrame(webp: Buffer) {
  let offset = 12;
  while (offset < webp.length) {
    const type = webp.toString('ascii', offset, offset + 4), size = webp.readUInt32LE(offset + 4), body = offset + 8;
    if (type === 'ANMF') return {
      x: webp.readUIntLE(body, 3) * 2, y: webp.readUIntLE(body + 3, 3) * 2,
      w: webp.readUIntLE(body + 6, 3) + 1, h: webp.readUIntLE(body + 9, 3) + 1,
      alpha: webp.subarray(body + 16, body + size).includes(Buffer.from('ALPH')),
    };
    offset = body + size + (size % 2);
  }
  throw new Error('sem quadros');
}

test('vídeo vertical: "cortar" preenche o quadrado todo, opaco, sem bordas', async () => {
  const result = await createAnimatedSticker(await syntheticVideo(2, false, 180, 320));
  assert.deepEqual(firstFrame(result.sticker), { x: 0, y: 0, w: 512, h: 512, alpha: false });
});

test('vídeo vertical: "inteiro" deixa as laterais fora do primeiro quadro (transparentes)', async () => {
  const result = await createAnimatedSticker(await syntheticVideo(2, false, 180, 320), { fit: 'inteiro' });
  const frame = firstFrame(result.sticker);
  assert.ok(frame.alpha || frame.w < 512, `quadro ${JSON.stringify(frame)}`);
  assert.ok(frame.h === 512);
});

test('vídeo longo é cortado em 10 s', async () => {
  const result = await createAnimatedSticker(await syntheticVideo(13, false, 160));
  assert.equal(result.trimmed, true);
  assert.equal(result.hasAudio, false);
  assert.ok(result.durationMs <= 10_050 && result.durationMs > 9_500, `duração ${result.durationMs}`);
});

test('com withAudio, o áudio sai junto: Ogg/Opus mono com a duração da figurinha', async () => {
  const result = await createAnimatedSticker(await syntheticVideo(4), { withAudio: true });
  assert.ok(result.audio, String(result.audioError));
  assert.equal(result.audioSilent, false);
  assert.equal(result.audio.toString('ascii', 0, 4), 'OggS');
  await withTempDir(async dir => {
    const path = join(dir, 'a.ogg');
    await writeFile(path, result.audio!);
    const out = JSON.parse((await runFull('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels:format=duration', '-of', 'json', path])).stdout);
    assert.equal(out.streams[0].codec_name, 'opus');
    assert.equal(out.streams[0].channels, 1);
    assert.ok(Math.abs(Number(out.format.duration) * 1000 - result.durationMs) < 150);
  });
});

test('sem withAudio não extrai áudio; vídeo sem faixa de áudio é avisado', async () => {
  const plain = await createAnimatedSticker(await syntheticVideo(2));
  assert.equal(plain.hasAudio, true);
  assert.equal(plain.audio, undefined);
  const mute = await createAnimatedSticker(await syntheticVideo(2, false), { withAudio: true });
  assert.equal(mute.hasAudio, false);
  assert.equal(mute.audio, undefined);
});

test('faixa de áudio em silêncio é marcada como muda', async () => {
  const result = await createAnimatedSticker(await syntheticVideo(2, 'mudo'), { withAudio: true });
  assert.equal(result.hasAudio, true);
  assert.equal(result.audioSilent, true);
});

test('vídeo pesado (mais longo que 3 s, muito movimento) cabe em 500 KB e usa a estimativa', async () => {
  const steps: string[] = [];
  const video = await withTempDir(async dir => {
    const out = join(dir, 'pesado.mp4');
    const { ffmpeg } = await import('../src/ffmpeg.js');
    await ffmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=6,noise=alls=30:allf=t+u',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '4M', '-pix_fmt', 'yuv420p', out]);
    const { readFile } = await import('node:fs/promises');
    return readFile(out);
  });
  const result = await createAnimatedSticker(video, { onStep: step => steps.push(step) });
  assert.ok(result.sticker.length <= MAX_ANIMATED_BYTES);
  assert.ok(steps.includes('estimar'), steps.join(','));
  assert.equal(steps.filter(s => s.startsWith('codificar')).length >= 1, true);
});

test('arquivo que não é vídeo vira erro amigável', async () => {
  await assert.rejects(createAnimatedSticker(Buffer.from('isto não é um vídeo'.repeat(50))), ConversionError);
  await assert.rejects(createAnimatedSticker(Buffer.alloc(0)), /vazio/);
});

test('foto vira figurinha estática 512×512 até 100 KB', async () => {
  const result = await createStaticSticker(await syntheticImage());
  assert.equal(result.animated, false);
  assert.ok(result.sticker.length <= MAX_STATIC_BYTES);
  await withTempDir(async dir => {
    const path = join(dir, 's.webp');
    await writeFile(path, result.sticker);
    const info = await probe(path);
    assert.equal(info.width, 512);
    assert.equal(info.height, 512);
  });
});

test('trecho: começa no ponto pedido e respeita a duração', async () => {
  // 20 s de vídeo; tom de 440 Hz só nos primeiros 10 s, silêncio depois.
  const video = await withTempDir(async dir => {
    const out = join(dir, 'tom-depois-silencio.mp4');
    const { ffmpeg } = await import('../src/ffmpeg.js');
    await ffmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=12:duration=20',
      '-f', 'lavfi', '-i', "aevalsrc='if(lt(t,10),sin(2*PI*440*t),0)':s=44100:d=20",
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
    const { readFile } = await import('node:fs/promises');
    return readFile(out);
  });
  const inicio = await createAnimatedSticker(video, { withAudio: true, startSeconds: 2, maxSeconds: 3 });
  assert.equal(inicio.audioSilent, false);
  assert.ok(Math.abs(inicio.durationMs - 3000) < 200, `duração ${inicio.durationMs}`);
  assert.equal(inicio.startSeconds, 2);
  assert.equal(inicio.trimmed, true);

  const fim = await createAnimatedSticker(video, { withAudio: true, startSeconds: 15 });
  assert.equal(fim.audioSilent, true, 'depois dos 10 s o áudio é mudo: o pulo funcionou');
  assert.ok(Math.abs(fim.durationMs - 5000) < 250, `duração ${fim.durationMs} (só sobram 5 s)`);
  assert.equal(fim.trimmed, false);

  await assert.rejects(createAnimatedSticker(video, { startSeconds: 25 }), /tem só 0:20/);
});
