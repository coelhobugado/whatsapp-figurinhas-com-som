import { readFile, writeFile } from 'node:fs/promises';

const packageUrl = new URL('../node_modules/@whiskeysockets/baileys/package.json', import.meta.url);
const baileys = JSON.parse(await readFile(packageUrl, 'utf8'));
if (baileys.version !== '7.0.0-rc14') {
  throw new Error(`O ajuste de canais espera Baileys 7.0.0-rc14, mas encontrou ${baileys.version}.`);
}

async function replaceOnce(path, before, after) {
  const url = new URL(`../node_modules/@whiskeysockets/baileys/${path}`, import.meta.url);
  const source = await readFile(url, 'utf8');
  if (source.includes(after)) return;
  const start = source.indexOf(before);
  if (start < 0 || source.indexOf(before, start + before.length) >= 0) {
    throw new Error(`Não encontrei unicamente o trecho esperado em Baileys: ${path}`);
  }
  await writeFile(url, source.replace(before, after));
}

await replaceOnce(
  'lib/Defaults/index.js',
  'export const MEDIA_HKDF_KEY_MAPPING = {',
  `export const NEWSLETTER_MEDIA_PATH_MAP = {
    image: '/newsletter/newsletter-image',
    video: '/newsletter/newsletter-video',
    document: '/newsletter/newsletter-document',
    audio: '/newsletter/newsletter-audio',
    sticker: '/newsletter/newsletter-image',
    'thumbnail-link': '/newsletter/newsletter-thumbnail-link'
};
export const MEDIA_HKDF_KEY_MAPPING = {`
);

await replaceOnce(
  'lib/Utils/messages-media.js',
  "import { DEFAULT_ORIGIN, MEDIA_HKDF_KEY_MAPPING, MEDIA_PATH_MAP } from '../Defaults/index.js';",
  "import { DEFAULT_ORIGIN, MEDIA_HKDF_KEY_MAPPING, MEDIA_PATH_MAP, NEWSLETTER_MEDIA_PATH_MAP } from '../Defaults/index.js';"
);
await replaceOnce(
  'lib/Utils/messages-media.js',
  'return async (filePath, { mediaType, fileEncSha256B64, timeoutMs }) => {',
  'return async (filePath, { mediaType, fileEncSha256B64, timeoutMs, newsletter }) => {'
);
await replaceOnce(
  'lib/Utils/messages-media.js',
  '            const url = `https://${hostname}${MEDIA_PATH_MAP[mediaType]}/${fileEncSha256B64}?auth=${auth}&token=${fileEncSha256B64}`;',
  `            const mediaPathMap = newsletter ? NEWSLETTER_MEDIA_PATH_MAP : MEDIA_PATH_MAP;
            const serverThumb = newsletter ? '&server_thumb_gen=1' : '';
            const url = \`https://\${hostname}\${mediaPathMap[mediaType]}/\${fileEncSha256B64}?auth=\${auth}&token=\${fileEncSha256B64}\${serverThumb}\`;`
);

await replaceOnce(
  'lib/Utils/messages.js',
  `            timeoutMs: options.mediaUploadTimeoutMs
        });
        await fs.unlink(filePath);`,
  `            timeoutMs: options.mediaUploadTimeoutMs,
            newsletter: isNewsletter
        });
        await fs.unlink(filePath);`
);

await replaceOnce(
  'lib/Socket/messages-send.js',
  `                    tag: 'plaintext',
                    attrs: {},
                    content: bytes`,
  `                    tag: 'plaintext',
                    attrs: extraAttrs,
                    content: bytes`
);
