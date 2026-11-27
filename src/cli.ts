/**
 * Teste local sem WhatsApp: gera a figurinha e o áudio em ./saida
 *   npm run converter -- video.mp4 [--inteiro] [--trecho 0:42] [--trecho 0:42-0:47]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { formatTime, parseClip } from './commands.js';
import { createAnimatedSticker } from './convert.js';
import { checkTools } from './ffmpeg.js';

const args = process.argv.slice(2);
const trechoIndex = args.indexOf('--trecho');
const trecho = trechoIndex >= 0 ? args[trechoIndex + 1] : undefined;
const file = args.find((a, i) => !a.startsWith('--') && i !== trechoIndex + 1);
if (!file) { console.error('Uso: npm run converter -- caminho/do/video.mp4 [--inteiro] [--trecho 0:42 | 0:42-0:47]'); process.exit(1); }
const clip = trecho ? parseClip(`!som ${trecho}`) : undefined;
if (clip && 'error' in clip) { console.error(clip.error.replace(/\*/g, '')); process.exit(1); }
const problems = await checkTools();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

const started = performance.now();
const result = await createAnimatedSticker(await readFile(file), {
  withAudio: true,
  fit: args.includes('--inteiro') ? 'inteiro' : 'cortar',
  meta: { packName: process.env.STICKER_PACK_NAME ?? 'Criada por Dexter' },
  startSeconds: clip?.start, maxSeconds: clip?.seconds,
});
const name = basename(file, extname(file));
await mkdir('saida', { recursive: true });
await writeFile(join('saida', `${name}.webp`), result.sticker);
const start = result.startSeconds ?? 0;
console.log(`Figurinha: saida/${name}.webp — ${(result.sticker.length / 1024).toFixed(0)} KB, ` +
  `trecho ${formatTime(start)}–${formatTime(start + (result.clipSeconds ?? 0))} (${(result.durationMs / 1000).toFixed(2)} s)`);
if (result.audio) {
  await writeFile(join('saida', `${name}.ogg`), result.audio);
  console.log(`Áudio:     saida/${name}.ogg — ${(result.audio.length / 1024).toFixed(0)} KB${result.audioSilent ? ' (mudo)' : ''}`);
} else console.log(result.hasAudio ? `Áudio falhou: ${result.audioError?.message}` : 'O vídeo não tem áudio.');
console.log(`Pronto em ${((performance.now() - started) / 1000).toFixed(1)} s.`);
