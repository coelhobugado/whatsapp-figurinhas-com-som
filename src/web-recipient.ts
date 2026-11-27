export type WhatsAppRecipient = { jid: string; exists: boolean };
export type RecipientResolution =
  | { status: 'found'; jid: string }
  | { status: 'not-found' }
  | { status: 'unavailable' };

export function resolveWhatsAppRecipient(matches: WhatsAppRecipient[] | undefined): RecipientResolution {
  if (!matches) return { status: 'unavailable' };
  const recipient = matches.find(match => match.exists);
  return recipient ? { status: 'found', jid: recipient.jid } : { status: 'not-found' };
}
