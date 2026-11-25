import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ffmpeg, withTempDir } from '../src/ffmpeg.js';

/**
 * Gera um MP4 de teste com o FFmpeg (padrão colorido em movimento).
 * `audio`: true = tom de 440 Hz, 'mudo' = faixa de áudio em silêncio, false = sem faixa de áudio.
 */
export async function syntheticVideo(seconds: number, audio: boolean | 'mudo' = true, width = 320, height = Math.round(width * 0.75)): Promise<Buffer> {
  return withTempDir(async dir => {
    const out = join(dir, 'v.mp4');
    const args = ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=24:duration=${seconds}`];
    if (audio) args.push('-f', 'lavfi', '-i', audio === 'mudo'
      ? `anullsrc=r=44100:cl=mono:d=${seconds}` : `sine=frequency=440:duration=${seconds}`, '-c:a', 'aac', '-shortest');
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', out);
    await ffmpeg(args, 60_000);
    return readFile(out);
  });
}

export async function syntheticImage(): Promise<Buffer> {
  return withTempDir(async dir => {
    const out = join(dir, 'i.png');
    await ffmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=800x600', '-frames:v', '1', out]);
    return readFile(out);
  });
}

/** Leitor mínimo de protobuf: devolve os campos de primeiro nível (número → bytes dos campos tipo 2). */
export function protoFields(data: Uint8Array): Map<number, Uint8Array[]> {
  const fields = new Map<number, Uint8Array[]>();
  let pos = 0;
  const varint = () => { let n = 0, f = 1, b: number; do { b = data[pos++]!; n += (b & 127) * f; f *= 128; } while (b & 128); return n; };
  while (pos < data.length) {
    const tag = varint(), field = Math.floor(tag / 8), wire = tag % 8;
    let value: Uint8Array = new Uint8Array();
    if (wire === 0) varint();
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === 2) { const len = varint(); value = data.subarray(pos, pos + len); pos += len; }
    else throw new Error(`wire type ${wire}`);
    fields.set(field, [...(fields.get(field) ?? []), value]);
  }
  return fields;
}
