/** Mede o tempo de cada etapa da conversão: `npm run bench -- video.mp4 [--inteiro]` */
import { readFile } from 'node:fs/promises';
import { createAnimatedSticker } from '../src/convert.js';

const file = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!file) { console.error('Uso: npm run bench -- video.mp4 [--inteiro]'); process.exit(1); }
const input = await readFile(file);
for (let round = 1; round <= 2; round++) {
  const steps: string[] = [];
  const t0 = performance.now();
  const result = await createAnimatedSticker(input, {
    withAudio: true, fit: process.argv.includes('--inteiro') ? 'inteiro' : 'cortar',
    onStep: (step, ms) => steps.push(`${step} ${ms.toFixed(0)} ms`),
  });
  console.log(`rodada ${round}: ${(performance.now() - t0).toFixed(0)} ms no total — figurinha ${(result.sticker.length / 1024).toFixed(0)} KB, ` +
    `áudio ${result.audio ? `${(result.audio.length / 1024).toFixed(0)} KB${result.audioSilent ? ' (silencioso)' : ''}` : 'nenhum'}`);
  console.log(`  ${steps.join(' | ')}`);
}
