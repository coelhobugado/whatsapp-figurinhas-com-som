import test from 'node:test';
import assert from 'node:assert/strict';
import type { WAMessage } from '@whiskeysockets/baileys';
import { findMedia, messageText, parseCommand, phoneVariants } from '../src/commands.js';

test('ALLOWED_NUMBERS aceita número sem 55 e com ou sem o 9 da frente', () => {
  assert.deepEqual(phoneVariants('85 99999-8888'), ['5585999998888', '85999998888', '558599998888']);
  assert.deepEqual(phoneVariants('5511999998888'), ['5511999998888', '551199998888']);
  assert.deepEqual(phoneVariants('558599998888'), ['558599998888', '5585999998888']);
  assert.deepEqual(phoneVariants('551133334444'), ['551133334444']);
  assert.deepEqual(phoneVariants('14155550100'), ['14155550100']);
  assert.deepEqual(phoneVariants(''), []);
});

test('reconhece comandos e apelidos, ignorando maiúsculas', () => {
  assert.equal(parseCommand('!SOM'), 'som');
  assert.equal(parseCommand('!som engraçado'), 'som');
  assert.equal(parseCommand('!fig'), 'figurinha');
  assert.equal(parseCommand('!ajuda'), 'ajuda');
  assert.equal(parseCommand('som'), undefined);
  assert.equal(parseCommand(''), undefined);
});

test('acha o vídeo na própria mensagem, inclusive em mensagem temporária', () => {
  const message = { key: { id: 'A', remoteJid: 'x@s.whatsapp.net' },
    message: { ephemeralMessage: { message: { videoMessage: { caption: '!som', fileLength: 1000 } } } } } as WAMessage;
  assert.equal(findMedia(message)?.kind, 'video');
  assert.equal(findMedia(message)?.message, message);
});

test('acha o vídeo citado quando o comando é uma resposta', () => {
  const message = { key: { id: 'B', remoteJid: 'grupo@g.us' }, message: { extendedTextMessage: { text: '!som',
    contextInfo: { stanzaId: 'VIDEO', participant: 'y@s.whatsapp.net', quotedMessage: { videoMessage: { gifPlayback: true } } } } } } as WAMessage;
  const media = findMedia(message);
  assert.equal(messageText(message.message!), '!som');
  assert.equal(media?.kind, 'video');
  assert.equal(media?.gif, true);
  assert.equal(media?.message.key.id, 'VIDEO');
  assert.equal(media?.message.key.participant, 'y@s.whatsapp.net');
});

test('texto sem mídia não acha nada', () => {
  assert.equal(findMedia({ key: { id: 'C' }, message: { conversation: '!som' } } as WAMessage), undefined);
});

test('vídeo mandado como documento (com legenda) também vale', () => {
  const message = { key: { id: 'D', remoteJid: 'x@s.whatsapp.net' }, message: { documentWithCaptionMessage: { message: {
    documentMessage: { mimetype: 'video/mp4', caption: '!som', fileLength: 2000 } } } } } as WAMessage;
  const content = findMedia(message);
  assert.equal(content?.kind, 'video');
  assert.equal(parseCommand(messageText(message.message!.documentWithCaptionMessage!.message!)), 'som');
  const pdf = { key: { id: 'E' }, message: { documentMessage: { mimetype: 'application/pdf' } } } as WAMessage;
  assert.equal(findMedia(pdf), undefined);
});

test('trecho: lê início e intervalo em vários formatos', async () => {
  const { parseClip, parseTime, formatTime } = await import('../src/commands.js');
  assert.equal(parseTime('42'), 42);
  assert.equal(parseTime('42s'), 42);
  assert.equal(parseTime('0:42'), 42);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('0:42.5'), 42.5);
  assert.equal(parseTime('0:75'), undefined);
  assert.equal(parseTime('abc'), undefined);
  assert.deepEqual(parseClip('!som 0:42 https://youtu.be/x'), { start: 42 });
  assert.deepEqual(parseClip('!som https://youtu.be/x 1:00-1:06'), { start: 60, seconds: 6 });
  assert.deepEqual(parseClip('!som inteiro 0:10'), { start: 10 });
  assert.equal(parseClip('!som https://youtu.be/x'), undefined);
  assert.equal(parseClip('!som inteiro'), undefined);
  assert.ok('error' in (parseClip('!som 0:50-0:40') as object));
  assert.ok('error' in (parseClip('!som 9:99') as object));
  assert.equal(formatTime(42), '0:42');
  assert.equal(formatTime(3723), '1:02:03');
});

test('avisa quando um número do ALLOWED_NUMBERS foi tratado como brasileiro sem o 55', async () => {
  const { allowedNumberWarnings, assumedBrazilian } = await import('../src/commands.js');
  assert.equal(assumedBrazilian('79991234567'), true, 'russo sem +: parece brasileiro (DDD 79)');
  assert.equal(assumedBrazilian('11 99999-8888'), true);
  assert.equal(assumedBrazilian('5511999998888'), false);
  assert.equal(assumedBrazilian('14155550100'), false);
  const avisos = allowedNumberWarnings(['5511999998888', '79991234567', '4155550100', '14155550100']);
  assert.equal(avisos.length, 2);
  assert.match(avisos[0]!, /79991234567.*\+55 79 991234567.*código do país/);
  assert.match(avisos[1]!, /4155550100.*\+55 41 55550100/);
});
