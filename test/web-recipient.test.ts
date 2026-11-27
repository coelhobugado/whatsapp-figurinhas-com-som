import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWhatsAppRecipient } from '../src/web-recipient.js';

test('resolves only a recipient confirmed by WhatsApp', () => {
  assert.deepEqual(resolveWhatsAppRecipient([
    { jid: '5511999998888@s.whatsapp.net', exists: false },
    { jid: '5511888887777@s.whatsapp.net', exists: true },
  ]), { status: 'found', jid: '5511888887777@s.whatsapp.net' });
});

test('distinguishes an unregistered number from an unavailable lookup', () => {
  assert.deepEqual(resolveWhatsAppRecipient([]), { status: 'not-found' });
  assert.deepEqual(resolveWhatsAppRecipient(undefined), { status: 'unavailable' });
});
