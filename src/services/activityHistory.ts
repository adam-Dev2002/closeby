import { collection, doc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import { firebaseAuth, requireFirestore } from '../lib/firebase';
import { dayRange, HISTORY_DAYS, MAX_DAY_SAMPLES, validSample } from '../lib/activity';
import type { ActivitySample, HistoryConsent } from '../types';

const stopped = new Set<string>();
export function stopHistoryUploads(uid: string) { stopped.add(uid); }
export function resumeHistoryUploads(uid: string) { stopped.delete(uid); }

export async function setHistoryConsent(spaceId: string, enabled: boolean, expectedUid?: string): Promise<void> {
  const uid = firebaseAuth?.currentUser?.uid;
  if (!uid) throw new Error('Sign in before sharing history.');
  if (expectedUid && uid !== expectedUid) throw new Error('The account changed. Open history settings for the current account.');
  if (!enabled) stopHistoryUploads(uid);
  const db = requireFirestore(), ref = doc(db, 'circles', spaceId, 'historyConsent', uid);
  const generation = doc(collection(db, 'circles', spaceId, 'historyConsent')).id;
  await runTransaction(db, async transaction => {
    const previous = await transaction.get(ref);
    transaction.set(ref, { enabled, generation: enabled ? generation : previous.data()?.generation ?? generation,
      startedAt: enabled ? serverTimestamp() : previous.data()?.startedAt ?? serverTimestamp(), updatedAt: serverTimestamp() });
  });
  if (enabled) resumeHistoryUploads(uid);
}

export function watchHistoryConsents(spaceId: string, next: (consents: Record<string, HistoryConsent>) => void, error: (cause: unknown) => void) {
  return onSnapshot(collection(requireFirestore(), 'circles', spaceId, 'historyConsent'), snapshot => {
    const consents: Record<string, HistoryConsent> = {};
    snapshot.docs.forEach(entry => {
      const data = entry.data();
      if (typeof data.enabled === 'boolean' && typeof data.generation === 'string' && data.startedAt instanceof Timestamp) {
        consents[entry.id] = { enabled: data.enabled, generation: data.generation, startedAt: data.startedAt.toMillis() };
      }
    });
    next(consents);
  }, cause => { next({}); error(cause); });
}

export async function publishActivity(spaceId: string, uid: string, generation: string, sample: ActivitySample): Promise<void> {
  if (stopped.has(uid) || firebaseAuth?.currentUser?.uid !== uid) return;
  if (!validSample(sample)) throw new Error('The activity sample is invalid.');
  const db = requireFirestore(), ref = doc(db, 'circles', spaceId, 'activity', uid, 'samples', sample.id);
  await runTransaction(db, async transaction => {
    const [consent, device, previous] = await Promise.all([
      transaction.get(doc(db, 'circles', spaceId, 'historyConsent', uid)),
      transaction.get(doc(db, 'circles', spaceId, 'devices', uid)), transaction.get(ref),
    ]);
    if (stopped.has(uid) || firebaseAuth?.currentUser?.uid !== uid) return;
    if (!consent.data()?.enabled || consent.data()?.generation !== generation || !device.data()?.sharing) return;
    if (sample.fix.timestamp < consent.data()!.startedAt.toMillis()) return;
    if (previous.exists()) return;
    transaction.set(ref, { ...sample, generation, capturedAt: sample.fix.timestamp,
      expiresAt: Timestamp.fromMillis(sample.fix.timestamp + HISTORY_DAYS * 86400000), createdAt: serverTimestamp() });
  });
}

export function watchActivityDay(spaceId: string, uid: string, day: string, generation: string | null,
  next: (samples: ActivitySample[], capped: boolean) => void, error: (cause: unknown) => void) {
  const { start, end } = dayRange(day);
  const constraints = [where('capturedAt', '>=', Math.max(start, Date.now() - HISTORY_DAYS * 86400000)), where('capturedAt', '<', end)];
  if (generation) constraints.push(where('generation', '==', generation));
  return onSnapshot(query(collection(requireFirestore(), 'circles', spaceId, 'activity', uid, 'samples'),
    ...constraints, orderBy('capturedAt', 'asc'), limit(MAX_DAY_SAMPLES)), snapshot => {
    const samples = snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id })).filter(validSample);
    next(samples, snapshot.size === MAX_DAY_SAMPLES);
  }, cause => { next([], false); error(cause); });
}
