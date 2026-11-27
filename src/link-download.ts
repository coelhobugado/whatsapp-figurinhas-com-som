import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConversionError, ffmpeg, withTempDir } from './ffmpeg.js';

/**
 * Pega o vídeo de um link de TikTok, Instagram ou YouTube para virar figurinha (`!som <link>`, `!fig <link>`).
 *
 * Cada plataforma tem uma lista de "fontes" (bibliotecas JS) tentadas em ordem: esses
 * scrapers quebram de vez em quando, então se uma falhar a próxima assume. Por último,
 * se o `yt-dlp` estiver instalado, ele também entra como reserva.
 */

export type Platform = 'tiktok' | 'instagram' | 'youtube';
export type FoundLink = { url: string; platform: Platform };
/** `startApplied`: o arquivo já começa no início pedido (foi cortado na origem), então a conversão não deve pular de novo. */
export type LinkVideo = { buffer: Buffer; platform: Platform; title?: string; trimmed: boolean; startApplied: boolean };
/** Trecho a buscar quando o vídeo é grande demais para baixar inteiro. */
export type LinkClip = { start: number; seconds: number };

const PATTERNS: [Platform, RegExp][] = [
  ['tiktok', /https?:\/\/(?:[a-z0-9-]+\.)?tiktok\.com\/[^\s]+/i],
  ['instagram', /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:[^\s/]+\/)?(?:reels?|p|tv)\/[^\s]+/i],
  ['youtube', /https?:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[^\s]+/i],
];

export const PLATFORM_NAME: Record<Platform, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube' };

/** Primeiro link de TikTok, Instagram ou YouTube no texto. */
export function findLink(text: string): FoundLink | undefined {
  let best: (FoundLink & { index: number }) | undefined;
  for (const [platform, re] of PATTERNS) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) best = { url: m[0].replace(/[)\].,!?>]+$/, ''), platform, index: m.index };
  }
  return best && { url: best.url, platform: best.platform };
}

export function youtubeId(url: string): string | undefined {
  return /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/.exec(url)?.[1];
}

/** Tempo de início que vem no link do YouTube ("Compartilhar › Começar em"): ?t=42, t=42s, t=1m2s, start=42. */
export function youtubeStart(url: string): number | undefined {
  const value = /[?&#](?:t|start)=([\dhms]+)/i.exec(url)?.[1]?.toLowerCase();
  if (!value) return undefined;
  if (/^\d+s?$/.test(value)) return Number(value.replace('s', ''));
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m || !value) return undefined;
  const seconds = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return seconds || undefined;
}

/** O link foi encontrado, mas nenhuma fonte conseguiu o vídeo. Mensagem pronta para o usuário. */
export class LinkError extends Error {}

class TooBigError extends Error {}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
type Candidate = { url: string; title?: string; headers?: Record<string, string> };
type Source = { name: string; resolve: (link: string) => Promise<Candidate[]> };

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: tempo esgotado`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const nonEmpty = (urls: (string | undefined | null)[]) => urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));

// ---------------------------------------------------------------- fontes por plataforma

const SOURCES: Record<Platform, Source[]> = {
  tiktok: [
    {
      name: 'tiktok-api-dl v1',
      async resolve(link) {
        const { default: tt } = await import('@tobyg74/tiktok-api-dl');
        const r = await tt.Downloader(link, { version: 'v1' });
        if (r.status !== 'success' || !r.result) throw new Error(r.message ?? 'sem resultado');
        if (r.result.type === 'image') throw new LinkError('Esse TikTok é um post de fotos, não um vídeo.');
        return nonEmpty(r.result.video?.playAddr ?? []).map(url => ({ url, title: r.result!.desc, headers: { Referer: 'https://www.tiktok.com/' } }));
      },
    },
    {
      name: 'tiktok-api-dl v2',
      async resolve(link) {
        const { default: tt } = await import('@tobyg74/tiktok-api-dl');
        const r = await tt.Downloader(link, { version: 'v2' });
        if (r.status !== 'success' || !r.result) throw new Error(r.message ?? 'sem resultado');
        return nonEmpty(r.result.video?.playAddr ?? []).map(url => ({ url, title: r.result!.desc }));
      },
    },
  ],
  instagram: [
    {
      name: 'instagram-url-direct',
      async resolve(link) {
        const { instagramGetUrl } = await import('instagram-url-direct');
        const r = await instagramGetUrl(link, { retries: 1, delay: 500 });
        const videos = r.media_details.filter(m => m.type === 'video').map(m => m.url);
        if (!videos.length && r.media_details.length) throw new LinkError('Esse post do Instagram só tem fotos, não um vídeo.');
        return nonEmpty(videos).map(url => ({ url, title: r.post_info?.caption }));
      },
    },
  ],
  youtube: [
    {
      // Cliente ANDROID do YouTube: devolve o MP4 com vídeo+áudio juntos (360p), sem precisar decifrar.
      name: 'youtubei.js',
      async resolve(link) {
        const id = youtubeId(link);
        if (!id) throw new LinkError('Não reconheci esse link do YouTube.');
        const { Innertube, Log } = await import('youtubei.js');
        Log.setLevel(Log.Level.NONE);
        const yt = await Innertube.create({ retrieve_player: false });
        for (const client of ['ANDROID', 'MWEB'] as const) {
          const info = await yt.getBasicInfo(id, { client }).catch(() => undefined);
          const formats = (info?.streaming_data?.formats ?? [])
            .filter(f => f.url && f.has_audio !== false && f.mime_type?.startsWith('video/mp4'));
          if (formats.length) return formats.map(f => ({ url: f.url!, title: info?.basic_info.title }));
        }
        throw new Error('nenhum formato com áudio');
      },
    },
  ],
};

// ---------------------------------------------------------------- download

/** Baixa um arquivo, desistindo se passar de `maxBytes`. */
async function fetchLimited(c: Candidate, maxBytes: number): Promise<Buffer> {
  const res = await fetch(c.url, { headers: { 'User-Agent': UA, ...c.headers }, redirect: 'follow', signal: AbortSignal.timeout(90_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (/text\/html|application\/json/.test(type)) throw new Error(`resposta não é vídeo (${type})`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > maxBytes) { await res.body.cancel(); throw new TooBigError(); }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new TooBigError();
    chunks.push(Buffer.from(chunk));
  }
  if (total < 10_000) throw new Error(`arquivo pequeno demais (${total} bytes)`);
  return Buffer.concat(chunks);
}

/**
 * Pega só o trecho pedido direto do link, sem baixar o vídeo todo (para figurinha).
 * Do começo, copia sem recodificar (rápido). Do meio, recodifica o pedacinho: copiar começaria
 * no quadro-chave anterior, segundos antes do ponto pedido.
 */
async function fetchClip(c: Candidate, clip: LinkClip, maxBytes: number): Promise<Buffer> {
  return withTempDir(async dir => {
    const out = join(dir, 'corte.mp4');
    const headers = Object.entries(c.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    // Só HTTPS: mesmo que uma fonte devolva um endereço estranho (file:, concat:, http: etc.), o FFmpeg não abre.
    await ffmpeg(['-protocol_whitelist', 'https,tls,tcp', '-user_agent', UA, ...(headers ? ['-headers', headers] : []),
      ...(clip.start > 0 ? ['-ss', clip.start.toFixed(3)] : []), '-t', clip.seconds.toFixed(3), '-i', c.url,
      '-map', '0:v:0', '-map', '0:a:0?',
      ...(clip.start > 0 ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-c:a', 'aac', '-b:a', '160k'] : ['-c', 'copy']),
      '-movflags', '+faststart', out], 120_000);
    const buffer = await readFile(out);
    if (buffer.length > maxBytes) throw new TooBigError();
    return buffer;
  });
}

function hasYtDlp(): Promise<boolean> {
  return new Promise(resolve => execFile(process.env.YTDLP_PATH || 'yt-dlp', ['--version'], { timeout: 10_000 }, error => resolve(!error)));
}

/** Reserva final: yt-dlp (se instalado). */
async function viaYtDlp(link: string, maxBytes: number, clip?: LinkClip): Promise<Buffer> {
  return withTempDir(async dir => {
    const args = ['--no-playlist', '--no-warnings', '-q', '--max-filesize', String(maxBytes),
      '-f', 'b[ext=mp4][vcodec!=none][acodec!=none]/b[vcodec!=none][acodec!=none]/b',
      ...(clip ? ['--download-sections', `*${clip.start}-${clip.start + clip.seconds}`, ...(clip.start > 0 ? ['--force-keyframes-at-cuts'] : [])] : []),
      '-o', join(dir, 'video.%(ext)s'), link];
    await new Promise<void>((resolve, reject) => execFile(process.env.YTDLP_PATH || 'yt-dlp', args,
      { timeout: 180_000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 },
      (error, _out, stderr) => error ? reject(new Error(String(stderr || error.message).trim().slice(-300))) : resolve()));
    const file = (await readdir(dir)).find(f => f.startsWith('video.') && !f.endsWith('.part'));
    if (!file) throw new TooBigError();
    return readFile(join(dir, file));
  });
}

export type LinkDownloadOptions = {
  /** Tamanho máximo aceito. */
  maxBytes: number;
  /** Para figurinha: se o vídeo for grande, pega só este trecho em vez de recusar. */
  clip?: LinkClip;
  log?: (message: string) => void;
};

export async function downloadFromLink(link: FoundLink, options: LinkDownloadOptions): Promise<LinkVideo> {
  const { maxBytes, clip, log = () => {} } = options;
  let tooBig = false;
  let userError: LinkError | undefined;

  for (const source of SOURCES[link.platform]) {
    let candidates: Candidate[];
    try {
      candidates = await withTimeout(source.resolve(link.url), 45_000, source.name);
      if (!candidates.length) throw new Error('nenhum vídeo no resultado');
    } catch (error) {
      if (error instanceof LinkError) { userError ??= error; continue; }
      log(`${source.name} falhou: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    for (const candidate of candidates.slice(0, 3)) {
      try {
        return { buffer: await fetchLimited(candidate, maxBytes), platform: link.platform, title: candidate.title, trimmed: false, startApplied: false };
      } catch (error) {
        if (error instanceof TooBigError) {
          tooBig = true;
          if (clip) {
            try {
              return { buffer: await fetchClip(candidate, clip, maxBytes), platform: link.platform, title: candidate.title, trimmed: true, startApplied: true };
            } catch (cutError) { log(`${source.name}: corte falhou: ${cutError instanceof Error ? cutError.message : cutError}`); }
          }
          continue;
        }
        log(`${source.name}: download falhou: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  if (userError) throw userError;
  if (await hasYtDlp()) {
    try {
      return { buffer: await viaYtDlp(link.url, maxBytes, clip), platform: link.platform, trimmed: !!clip, startApplied: !!clip };
    } catch (error) {
      if (error instanceof TooBigError) tooBig = true;
      else log(`yt-dlp falhou: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (tooBig) throw new ConversionError(`O vídeo passa de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  throw new LinkError(`Não consegui baixar esse vídeo do ${PLATFORM_NAME[link.platform]}. ` +
    (link.platform === 'instagram' ? 'Confira se o post é público (conta privada não dá).' : 'Confira se o link está certo e o vídeo é público.'));
}

