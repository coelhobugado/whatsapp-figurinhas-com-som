/**
 * Teste local sem WhatsApp: gera a figurinha e o áudio em ./saida
 *   npm run converter -- video.mp4 [--inteiro]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createAnimatedSticker } from './convert.js';
import { checkTools } from './ffmpeg.js';

const file = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!file) { console.error('Uso: npm run converter -- caminho/do/video.mp4 [--inteiro]'); process.exit(1); }
const problems = await checkTools();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

const started = performance.now();
const result = await createAnimatedSticker(await readFile(file), {
  withAudio: true,
  fit: process.argv.includes('--inteiro') ? 'inteiro' : 'cortar',
  meta: { packName: process.env.STICKER_PACK_NAME ?? 'Criada por Dexter' },
});
const name = basename(file, extname(file));
await mkdir('saida', { recursive: true });
await writeFile(join('saida', `${name}.webp`), result.sticker);
console.log(`Figurinha: saida/${name}.webp — ${(result.sticker.length / 1024).toFixed(0)} KB, ${(result.durationMs / 1000).toFixed(2)} s${result.trimmed ? ' (cortada em 10 s)' : ''}`);
if (result.audio) {
  await writeFile(join('saida', `${name}.ogg`), result.audio);
  console.log(`Áudio:     saida/${name}.ogg — ${(result.audio.length / 1024).toFixed(0)} KB${result.audioSilent ? ' (mudo)' : ''}`);
} else console.log(result.hasAudio ? `Áudio falhou: ${result.audioError?.message}` : 'O vídeo não tem áudio.');
console.log(`Pronto em ${((performance.now() - started) / 1000).toFixed(1)} s.`);
