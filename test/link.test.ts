import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommand } from '../src/commands.js';
import { findLink, youtubeId } from '../src/link-download.js';

test('acha links de TikTok, Instagram e YouTube no meio do texto', () => {
  assert.deepEqual(findLink('!som https://vm.tiktok.com/ZMabc123/'), { url: 'https://vm.tiktok.com/ZMabc123/', platform: 'tiktok' });
  assert.deepEqual(findLink('olha https://www.tiktok.com/@user/video/123?lang=pt.'), { url: 'https://www.tiktok.com/@user/video/123?lang=pt', platform: 'tiktok' });
  assert.equal(findLink('!fig https://www.instagram.com/reel/ABC_def-1/?igsh=x')?.platform, 'instagram');
  assert.equal(findLink('https://instagram.com/p/ABC/')?.platform, 'instagram');
  assert.equal(findLink('https://youtu.be/jNQXAC9IVRw?si=a')?.platform, 'youtube');
  assert.equal(findLink('https://www.youtube.com/shorts/jNQXAC9IVRw')?.platform, 'youtube');
  assert.equal(findLink('https://m.youtube.com/watch?v=jNQXAC9IVRw&t=3')?.platform, 'youtube');
});

test('ignora links de outros sites e perfis', () => {
  assert.equal(findLink('https://example.com/video.mp4'), undefined);
  assert.equal(findLink('https://www.instagram.com/nasa/'), undefined);
  assert.equal(findLink('!som'), undefined);
});

test('pega o primeiro link quando há vários', () => {
  assert.equal(findLink('https://youtu.be/jNQXAC9IVRw e https://vm.tiktok.com/x/')?.platform, 'youtube');
});

test('extrai o id do YouTube', () => {
  assert.equal(youtubeId('https://youtu.be/jNQXAC9IVRw?si=a'), 'jNQXAC9IVRw');
  assert.equal(youtubeId('https://www.youtube.com/watch?feature=x&v=jNQXAC9IVRw'), 'jNQXAC9IVRw');
  assert.equal(youtubeId('https://www.youtube.com/shorts/jNQXAC9IVRw'), 'jNQXAC9IVRw');
});

test('!som e !fig aceitam link; !baixar não existe', () => {
  assert.equal(parseCommand('!som https://youtu.be/x'), 'som');
  assert.equal(parseCommand('!fig https://youtu.be/x'), 'figurinha');
  assert.equal(parseCommand('!baixar https://youtu.be/x'), undefined);
});

test('tempo de início que vem no link do YouTube', async () => {
  const { youtubeStart } = await import('../src/link-download.js');
  assert.equal(youtubeStart('https://youtu.be/jNQXAC9IVRw?t=42'), 42);
  assert.equal(youtubeStart('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=1m5s'), 65);
  assert.equal(youtubeStart('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=90s'), 90);
  assert.equal(youtubeStart('https://www.youtube.com/embed/jNQXAC9IVRw?start=12'), 12);
  assert.equal(youtubeStart('https://youtu.be/jNQXAC9IVRw?si=abc'), undefined);
});
