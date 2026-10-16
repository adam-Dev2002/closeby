export const INVITATION_ORIGIN = 'https://closeby-511018.web.app';
export const INVITATION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const shortCode = /^[A-HJ-NP-Z2-9]{12}$/;
const legacyCode = /^[0-9A-F]{32}$/;

export function normalizeInvitationCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100 || /[^a-z0-9\s-]/i.test(value)) return null;
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  return shortCode.test(code) || legacyCode.test(code) ? code : null;
}

export function generateInvitationCode(bytes: Uint8Array): string {
  if (bytes.length !== 12) throw new Error('Invitation codes need twelve random bytes.');
  return Array.from(bytes, byte => INVITATION_ALPHABET[byte & 31]).join('');
}

export function formatInvitationCode(value: string): string {
  const code = normalizeInvitationCode(value);
  return code ? code.match(/.{1,4}/g)!.join('-') : value;
}

export function parseInvitationLink(value: unknown, currentWebOrigin?: string): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password) return null;
    let match: RegExpMatchArray | null = null;
    if (url.protocol === 'closeby:' && url.hostname === 'join' && !url.port) match = url.pathname.match(/^\/([a-z0-9-]+)\/?$/i);
    else if ((url.protocol === 'https:' || url.protocol === 'http:') && (url.origin === INVITATION_ORIGIN || url.origin === currentWebOrigin)) match = url.pathname.match(/^\/j\/([a-z0-9-]+)\/?$/i);
    return match ? normalizeInvitationCode(match[1]) : null;
  } catch { return null; }
}

export function invitationCodeFromInput(value: string): string | null {
  return normalizeInvitationCode(value) ?? parseInvitationLink(value);
}

export function invitationLink(value: string): string {
  const code = normalizeInvitationCode(value);
  if (!code) throw new Error('This invitation code is invalid. Renew the invitation and try again.');
  return `${INVITATION_ORIGIN}/j/${code}`;
}
