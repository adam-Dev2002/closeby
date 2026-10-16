export type CallMode = 'voice' | 'video';
export type DeviceAccess = 'microphone' | 'front' | 'back';
export function validDeviceAccess(value: unknown): value is DeviceAccess { return value === 'microphone' || value === 'front' || value === 'back'; }
export function deviceAccessLabel(access: DeviceAccess): string {
  return access === 'microphone' ? 'microphone' : `${access === 'front' ? 'front' : 'rear'} camera and microphone`;
}
export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'ended';
export type CallPhase = 'idle' | 'ringing' | 'connecting' | 'connected';
export type CallDescription = { type: 'offer' | 'answer'; sdp: string };
export type CallCandidate = { id: string; uid: string; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
export type SpaceCall = {
  id: string; spaceId: string; callerId: string; calleeId: string; callerName: string; calleeName: string;
  mode: CallMode; status: CallStatus; offer: CallDescription | null; answer: CallDescription | null;
  access?: DeviceAccess;
  createdAt: number; updatedAt: number; expiresAt: number;
};
export type CallSignal = { type: 'offer' | 'answer'; description: CallDescription }
  | { type: 'candidate'; candidate: Omit<CallCandidate, 'id' | 'uid'> };
export type MediaEvent = CallSignal | { type: 'ready' } | { type: 'state'; state: 'connecting' | 'connected' | 'closed' }
  | { type: 'error'; message: string };
export type IceServer = { urls: string | string[]; username?: string; credential?: string };
export const RING_TIMEOUT_MS = 120000;
export const CALL_MAX_MS = 2 * 60 * 60 * 1000;
export const MAX_SDP_LENGTH = 128000;
export const defaultIceServers: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export function validDescription(value: unknown, type?: 'offer' | 'answer'): value is CallDescription {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (item.type === 'offer' || item.type === 'answer') && (!type || item.type === type)
    && typeof item.sdp === 'string' && item.sdp.length > 0 && item.sdp.length <= MAX_SDP_LENGTH
    && Object.keys(item).every(key => key === 'type' || key === 'sdp');
}
export function validCandidate(value: unknown): value is Omit<CallCandidate, 'id' | 'uid'> {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.candidate === 'string' && item.candidate.length > 0 && item.candidate.length <= 4096
    && (item.sdpMid === null || typeof item.sdpMid === 'string' && item.sdpMid.length <= 256)
    && (item.sdpMLineIndex === null || Number.isInteger(item.sdpMLineIndex) && Number(item.sdpMLineIndex) >= 0 && Number(item.sdpMLineIndex) <= 64)
    && Object.keys(item).every(key => ['candidate', 'sdpMid', 'sdpMLineIndex'].includes(key));
}
export function callExpired(call: SpaceCall, now = Date.now()): boolean { return call.expiresAt <= now; }
export function participant(call: SpaceCall, uid: string): boolean { return call.callerId === uid || call.calleeId === uid; }
export function canAccept(call: SpaceCall, uid: string, now = Date.now()): boolean {
  return call.calleeId === uid && call.status === 'ringing' && !callExpired(call, now);
}
export function canSignal(call: SpaceCall, uid: string, type: CallSignal['type'], now = Date.now()): boolean {
  if (call.status !== 'accepted' || callExpired(call, now) || !participant(call, uid)) return false;
  return type === 'candidate' || (type === 'offer' ? call.callerId === uid && !call.offer : call.calleeId === uid && Boolean(call.offer) && !call.answer);
}
export function parseMediaEvent(raw: unknown, channel: string): MediaEvent | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_SDP_LENGTH + 2048) return null;
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (event.channel !== channel) return null;
  if (event.type === 'ready') return { type: 'ready' };
  if (event.type === 'offer' || event.type === 'answer') return validDescription(event.description, event.type)
    ? { type: event.type, description: event.description } : null;
  if (event.type === 'candidate') return validCandidate(event.candidate) ? { type: 'candidate', candidate: event.candidate } : null;
  if (event.type === 'state' && ['connecting', 'connected', 'closed'].includes(String(event.state))) return { type: 'state', state: event.state as 'connecting' | 'connected' | 'closed' };
  if (event.type === 'error' && typeof event.message === 'string') return { type: 'error', message: event.message.slice(0, 240) };
  return null;
}
export function mediaJson(value: unknown): string { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
export function validIceServers(value: unknown): IceServer[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 6) return null;
  const result: IceServer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const urls = typeof entry.urls === 'string' ? [entry.urls] : entry.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 8 || !urls.every(url => typeof url === 'string' && url.length < 512 && /^(stun|stuns|turn|turns):[^\s@]+$/i.test(url))) return null;
    const relay = urls.some(url => /^turns?:/i.test(url));
    if (relay && (typeof entry.username !== 'string' || !entry.username || entry.username.length > 256 || typeof entry.credential !== 'string' || !entry.credential || entry.credential.length > 1024)) return null;
    result.push({ urls: entry.urls, ...(relay ? { username: entry.username, credential: entry.credential } : {}) });
  }
  return result;
}
