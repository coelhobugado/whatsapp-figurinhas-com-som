import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptedStream, proto, type WASocket } from '@whiskeysockets/baileys';
import { createAnimatedSticker } from '../src/convert.js';
import {
  buildSoundStickerWrapper, createStreamingSidecar, installSoundStickerEncoder, sendSoundSticker, SOUND_STICKER_BYTES,
} from '../src/sound-sticker.js';
import { protoFields, syntheticVideo } from './helpers.js';

const one = (fields: Map<number, Uint8Array[]>, n: number) => {
  const value = fields.get(n)?.[0];
  assert.ok(value, `campo ${n} ausente`);
  return value;
};

test('mensagens comuns não mudam depois de instalar o encoder', () => {
  const sample = { conversation: 'oi', stickerMessage: { mimetype: 'image/webp', isAnimated: true } };
  const before = Buffer.from(proto.Message.encode(sample).finish());
  installSoundStickerEncoder();
  assert.deepEqual(Buffer.from(proto.Message.encode(sample).finish()), before);
});

test('mensagem marcada sai como 134 › 1 › 26 › 26, inclusive copiada ou dentro de deviceSentMessage', () => {
  installSoundStickerEncoder();
  const sticker = { mimetype: 'image/webp', isAnimated: true, width: 512, height: 512 };
  const audio = { mimetype: 'audio/ogg; codecs=opus', seconds: 3, streamingSidecar: Buffer.alloc(10, 7) };
  const message = { stickerMessage: sticker, messageContextInfo: {}, [SOUND_STICKER_BYTES]: buildSoundStickerWrapper(sticker, audio) };

  const check = (bytes: Uint8Array) => {
    const top = protoFields(bytes);
    assert.ok(!top.has(26), 'campo 26 não pode ir no primeiro nível');
    const wrapped = protoFields(one(protoFields(one(top, 134)), 1));
    const stickerFields = protoFields(one(wrapped, 26));
    assert.equal(Buffer.from(one(stickerFields, 5)).toString(), 'image/webp');
    const audioFields = protoFields(one(stickerFields, 26));
    assert.equal(Buffer.from(one(audioFields, 2)).toString(), 'audio/ogg; codecs=opus');
    assert.deepEqual(Buffer.from(one(audioFields, 18)), Buffer.alloc(10, 7));
  };
  check(proto.Message.encode(message).finish());
  check(proto.Message.encode({ ...message, conversation: undefined }).finish()); // cópia por spread
  const device = protoFields(proto.Message.encode({ deviceSentMessage: { destinationJid: 'x@s.whatsapp.net', message } }).finish());
  check(one(protoFields(one(device, 31)), 2)); // DeviceSentMessage.message
  // Um cliente que não conhece o campo 134 ainda consegue decodificar a mensagem.
  assert.doesNotThrow(() => proto.Message.decode(proto.Message.encode(message).finish()));
});

test('sidecar: 10 bytes por bloco de 64 KiB e recusa hash errado', async () => {
  for (const size of [5_000, 70_000]) {
    const audio = randomBytes(size);
    const { mediaKey, fileEncSha256 } = await encryptedStream(audio, 'audio');
    const sidecar = await createStreamingSidecar(audio, mediaKey, fileEncSha256);
    assert.equal(sidecar.length, 10 * Math.ceil((size + 16 - (size % 16)) / 65_536));
    await assert.rejects(createStreamingSidecar(audio, mediaKey, Buffer.alloc(32)));
  }
});

test('envio completo com socket falso: dois uploads e uma mensagem sonora citando o vídeo', async () => {
  const video = await syntheticVideo(2);
  const { sticker, durationMs, audio } = await createAnimatedSticker(video, { withAudio: true });
  assert.ok(audio);
  const uploads: string[] = [];
  let relayed: Uint8Array | undefined;
  const socket = {
    user: { id: '5511900000000@s.whatsapp.net' },
    waUploadToServer: async (_path: string, opts: { mediaType: string }) => {
      uploads.push(opts.mediaType);
      return { mediaUrl: 'https://example.invalid/m', directPath: '/m' };
    },
    relayMessage: async (_jid: string, msg: proto.IMessage) => { relayed = proto.Message.encode(msg).finish(); return 'id'; },
  } as unknown as WASocket;
  const quoted = { key: { id: 'ORIGINAL', remoteJid: '5511800000000@s.whatsapp.net' }, message: { videoMessage: {} } };

  await sendSoundSticker(socket, '5511800000000@s.whatsapp.net', { sticker, audio, durationMs, quoted });

  assert.deepEqual(uploads, ['sticker', 'audio']);
  assert.ok(relayed);
  const wrapped = protoFields(one(protoFields(one(protoFields(relayed), 134)), 1));
  const stickerFields = protoFields(one(wrapped, 26));
  const context = protoFields(one(stickerFields, 17));
  assert.equal(Buffer.from(one(context, 1)).toString(), 'ORIGINAL'); // ContextInfo.stanzaId
  const audioFields = protoFields(one(stickerFields, 26));
  assert.ok(audioFields.has(7) && audioFields.has(8) && audioFields.has(18)); // mediaKey, fileEncSha256, sidecar
});
