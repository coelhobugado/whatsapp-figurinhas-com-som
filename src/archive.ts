import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type StickerArchiveFolder = 'com-som' | 'outros';

export type StickerArchiveInput = {
  sticker: Buffer;
  audio?: Buffer;
};

export type ArchivedSticker = {
  stickerPath: string;
  audioPath?: string;
};

export async function archiveSticker(
  folder: StickerArchiveFolder,
  result: StickerArchiveInput,
  root = 'saida',
): Promise<ArchivedSticker> {
  const directory = join(root, folder);
  await mkdir(directory, { recursive: true });

  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const stickerPath = join(directory, `${name}.webp`);
  await writeFile(stickerPath, result.sticker);

  if (!result.audio) return { stickerPath };

  const audioPath = join(directory, `${name}.ogg`);
  await writeFile(audioPath, result.audio);
  return { stickerPath, audioPath };
}
