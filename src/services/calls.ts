import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, Timestamp, where, type DocumentData, type Unsubscribe } from 'firebase/firestore';
import { firebaseAuth, requireFirestore } from '../lib/firebase';
import { CALL_MAX_MS, RING_TIMEOUT_MS, canAccept, canSignal, defaultIceServers, participant, validCandidate, validDescription, validDeviceAccess, validIceServers, type CallCandidate, type CallMode, type CallSignal, type DeviceAccess, type IceServer, type SpaceCall } from '../lib/calls';

const turnEndpoint = process.env.EXPO_PUBLIC_CALLS_TURN_CREDENTIALS_URL?.trim();
function authenticated(uid: string): void { if (!uid || firebaseAuth?.currentUser?.uid !== uid) throw new Error('Sign in again before making a call.'); }
function milliseconds(value: unknown): number { return value instanceof Timestamp ? value.toMillis() : 0; }
function readCall(id: string, spaceId: string, data: DocumentData): SpaceCall | null {
  if (typeof data.callerId !== 'string' || typeof data.calleeId !== 'string' || data.callerId === data.calleeId
    || !['voice', 'video'].includes(data.mode) || !['ringing', 'accepted', 'declined', 'ended'].includes(data.status)
    || 'access' in data && (!validDeviceAccess(data.access) || data.mode !== (data.access === 'microphone' ? 'voice' : 'video'))) return null;
  return { id, spaceId, callerId: data.callerId, calleeId: data.calleeId, callerName: String(data.callerName || 'Member').slice(0, 100), calleeName: String(data.calleeName || 'Member').slice(0, 100),
    mode: data.mode, ...('access' in data ? { access: data.access as DeviceAccess } : {}), status: data.status, offer: validDescription(data.offer, 'offer') ? data.offer : null, answer: validDescription(data.answer, 'answer') ? data.answer : null,
    createdAt: milliseconds(data.createdAt), updatedAt: milliseconds(data.updatedAt), expiresAt: milliseconds(data.expiresAt) };
}
export async function startCall(spaceId: string, uid: string, callerName: string, calleeId: string, calleeName: string, mode: CallMode, access?: DeviceAccess): Promise<SpaceCall> {
  authenticated(uid);
  if (!spaceId || !calleeId || calleeId === uid || !['voice', 'video'].includes(mode)) throw new Error('Choose another member of your space to call.');
  if (access !== undefined && (!validDeviceAccess(access) || mode !== (access === 'microphone' ? 'voice' : 'video'))) throw new Error('Choose a microphone, front camera or rear camera request.');
  const reference = doc(collection(requireFirestore(), 'circles', spaceId, 'calls'));
  const now = Date.now(), expiresAt = now + RING_TIMEOUT_MS;
  const data = { callerId: uid, calleeId, callerName: callerName.trim().slice(0, 100) || 'Member', calleeName: calleeName.trim().slice(0, 100) || 'Member', mode, ...(access ? { access } : {}), status: 'ringing' as const, offer: null, answer: null };
  // A transaction requires the server: an offline queued request must not ring
  // another phone later after the caller has already cancelled locally.
  await runTransaction(requireFirestore(), async transaction => {
    const member = await transaction.get(doc(requireFirestore(), 'circles', spaceId, 'members', calleeId));
    if (!member.exists()) throw new Error('This member has left your space.');
    transaction.set(reference, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(expiresAt) });
  });
  return { id: reference.id, spaceId, ...data, createdAt: now, updatedAt: now, expiresAt };
}
export function watchIncoming(spaceId: string, uid: string, memberIds: string[], next: (calls: SpaceCall[]) => void, fail: (cause: unknown) => void): Unsubscribe {
  authenticated(uid);
  const ids = [...new Set(memberIds)].filter(id => id !== uid), batches = new Map<number, SpaceCall[]>(), stops: Unsubscribe[] = [];
  let failed = false;
  // Explicit caller membership is needed for Firestore to prove query privacy.
  // Small batches also keep membership lookups within its rules access budget.
  if (!ids.length) next([]);
  try {
    for (let index = 0; index < ids.length; index += 8) {
      const batch = index;
      stops.push(onSnapshot(query(collection(requireFirestore(), 'circles', spaceId, 'calls'), where('calleeId', '==', uid), where('callerId', 'in', ids.slice(index, index + 8)), where('status', '==', 'ringing'), orderBy('createdAt', 'desc'), limit(10)), snapshot => {
        if (failed) return;
        batches.set(batch, snapshot.docs.map(entry => readCall(entry.id, spaceId, entry.data())).filter((call): call is SpaceCall => Boolean(call && call.expiresAt > Date.now())));
        next([...batches.values()].flat().sort((a, b) => b.createdAt - a.createdAt).slice(0, 10));
      }, cause => { failed = true; stops.forEach(stop => stop()); batches.clear(); next([]); fail(cause); }));
    }
  } catch (cause) { stops.forEach(stop => stop()); throw cause; }
  return () => stops.forEach(stop => stop());
}
export function watchCall(call: SpaceCall, uid: string, next: (value: SpaceCall | null) => void, fail: (cause: unknown) => void): Unsubscribe {
  authenticated(uid);
  return onSnapshot(doc(requireFirestore(), 'circles', call.spaceId, 'calls', call.id), snapshot => next(snapshot.exists() ? readCall(snapshot.id, call.spaceId, snapshot.data()) : null), fail);
}
export function watchCandidates(call: SpaceCall, uid: string, next: (value: CallCandidate[]) => void, fail: (cause: unknown) => void): Unsubscribe {
  authenticated(uid);
  return onSnapshot(query(collection(requireFirestore(), 'circles', call.spaceId, 'calls', call.id, 'candidates'), limit(150)), snapshot => {
    next(snapshot.docs.flatMap(entry => {
      const { uid: author, candidate, sdpMid, sdpMLineIndex } = entry.data();
      const value = { candidate, sdpMid, sdpMLineIndex };
      return author !== uid && (author === call.callerId || author === call.calleeId) && validCandidate(value) ? [{ id: entry.id, uid: author, ...value }] : [];
    }));
  }, fail);
}
export async function acceptCall(call: SpaceCall, uid: string): Promise<void> {
  authenticated(uid);
  const ref = doc(requireFirestore(), 'circles', call.spaceId, 'calls', call.id);
  await runTransaction(requireFirestore(), async transaction => {
    const snapshot = await transaction.get(ref), current = snapshot.exists() ? readCall(snapshot.id, call.spaceId, snapshot.data()) : null;
    if (!current || !canAccept(current, uid)) throw new Error('This call has ended or expired.');
    transaction.update(ref, { status: 'accepted', updatedAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + CALL_MAX_MS) });
  });
}
export async function finishCall(call: SpaceCall, uid: string, decline = false): Promise<void> {
  authenticated(uid);
  const ref = doc(requireFirestore(), 'circles', call.spaceId, 'calls', call.id);
  await runTransaction(requireFirestore(), async transaction => {
    const snapshot = await transaction.get(ref), current = snapshot.exists() ? readCall(snapshot.id, call.spaceId, snapshot.data()) : null;
    if (!current || !participant(current, uid) || current.status === 'ended' || current.status === 'declined') return;
    if (decline && (current.calleeId !== uid || current.status !== 'ringing')) throw new Error('Only the receiving member can decline a ringing call.');
    transaction.update(ref, { status: decline ? 'declined' : 'ended', updatedAt: serverTimestamp() });
  });
}
export async function publishSignal(call: SpaceCall, uid: string, signal: CallSignal): Promise<void> {
  authenticated(uid);
  if (!canSignal(call, uid, signal.type)) throw new Error('The call is not ready for this connection update.');
  const db = requireFirestore(), ref = doc(db, 'circles', call.spaceId, 'calls', call.id);
  if (signal.type === 'candidate') {
    if (!validCandidate(signal.candidate)) throw new Error('Invalid call connection information.');
    await addDoc(collection(ref, 'candidates'), { uid, ...signal.candidate, createdAt: serverTimestamp() });
    return;
  }
  if (!validDescription(signal.description, signal.type)) throw new Error('Invalid call session information.');
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref), current = snapshot.exists() ? readCall(snapshot.id, call.spaceId, snapshot.data()) : null;
    if (!current || !canSignal(current, uid, signal.type)) throw new Error('This call has ended or its connection was already configured.');
    transaction.update(ref, { [signal.type]: signal.description, updatedAt: serverTimestamp() });
  });
}
export async function loadCallIce(uid: string): Promise<{ iceServers: IceServer[]; relay: boolean }> {
  if (!turnEndpoint) return { iceServers: defaultIceServers, relay: false };
  let endpoint: URL;
  try { endpoint = new URL(turnEndpoint); } catch { throw new Error('The call relay credentials URL is invalid.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('The call relay credentials endpoint must use HTTPS.');
  authenticated(uid);
  const token = await firebaseAuth!.currentUser!.getIdToken();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(endpoint.toString(), { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!response.ok) throw new Error('The call relay could not provide credentials.');
    const body = await response.json() as { iceServers?: unknown; expiresAt?: number };
    const servers = validIceServers(body.iceServers);
    if (!servers || body.expiresAt !== undefined && (!Number.isFinite(body.expiresAt) || body.expiresAt <= Date.now())) throw new Error('The call relay returned invalid or expired credentials.');
    return { iceServers: servers, relay: servers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/i.test(url))) };
  } finally { clearTimeout(timer); }
}
