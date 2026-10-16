import {
  collection, doc, limit, onSnapshot, or, orderBy, query, runTransaction,
  serverTimestamp, where,
} from 'firebase/firestore';
import { firebaseAuth, requireFirestore } from '../lib/firebase';
import type { EmergencyAudience, LocationFix, SpaceEmergencyAlert } from '../types';

export const MAX_EMERGENCY_TEXT_LENGTH = 500;

export type EmergencyAlertInput = {
  audience: EmergencyAudience;
  ownerId: string;
  text: string;
  location: LocationFix | null;
};

// Keep this ID when retrying the same send. A transaction recognizes an already
// committed alert, so a dropped response cannot create a second emergency.
export function createEmergencyAlertId(spaceId: string): string {
  return doc(collection(requireFirestore(), 'circles', spaceId, 'alerts')).id;
}

function cleanLocation(fix: LocationFix | null): LocationFix | null {
  if (!fix) return null;
  if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90
    || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180
    || !Number.isFinite(fix.timestamp) || fix.timestamp < 0) {
    throw new Error('The current location is invalid. Send the alert without a location.');
  }
  const nullable = (value: number | null) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    latitude: fix.latitude, longitude: fix.longitude, timestamp: fix.timestamp,
    accuracy: nullable(fix.accuracy), speed: nullable(fix.speed), heading: nullable(fix.heading),
  };
}

function sameLocation(left: LocationFix | null, right: LocationFix | null): boolean {
  if (left === null || right === null) return left === right;
  return (['latitude', 'longitude', 'accuracy', 'speed', 'heading', 'timestamp'] as const)
    .every(field => left[field] === right[field]);
}

// Transactions require a server connection; completion means Firebase accepted
// the alert. It does not mean another member has opened or read it.
export async function sendEmergencyAlert(spaceId: string, alertId: string, input: EmergencyAlertInput): Promise<void> {
  const user = firebaseAuth?.currentUser;
  if (!user) throw new Error('Sign in to send an emergency alert.');
  if (!/^[A-Za-z0-9]{20}$/.test(alertId)) throw new Error('Create a new emergency alert before sending.');
  if (input.audience !== 'owner' && input.audience !== 'everyone') throw new Error('Choose the space owner or everyone.');
  const text = input.text.trim();
  if (!text || text.length > MAX_EMERGENCY_TEXT_LENGTH) {
    throw new Error(`Enter an emergency message between 1 and ${MAX_EMERGENCY_TEXT_LENGTH} characters.`);
  }
  const location = cleanLocation(input.location);
  const db = requireFirestore();
  const alertRef = doc(db, 'circles', spaceId, 'alerts', alertId);
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(alertRef);
    if (existing.exists()) {
      const data = existing.data();
      if (data.senderId !== user.uid || data.audience !== input.audience
        || data.ownerId !== input.ownerId || data.text !== text || !sameLocation(data.location, location)) {
        throw new Error('This alert ID was already used. Start a new alert.');
      }
      return;
    }
    const circle = await transaction.get(doc(db, 'circles', spaceId));
    if (!circle.exists()) throw new Error('This space is no longer available.');
    if (circle.data().ownerId !== input.ownerId) throw new Error('The space owner changed. Reopen the alert and try again.');
    if (input.audience === 'owner') {
      const owner = await transaction.get(doc(db, 'circles', spaceId, 'members', input.ownerId));
      if (!owner.exists()) throw new Error('The space owner is no longer in this space. Send to everyone instead.');
    }
    transaction.set(alertRef, {
      senderId: user.uid, senderName: user.displayName?.trim().slice(0, 100) || 'Member',
      audience: input.audience, ownerId: input.ownerId, location, text, createdAt: serverTimestamp(),
    });
  });
}

export function watchEmergencyAlerts(
  spaceId: string,
  uid: string,
  onAlerts: (alerts: SpaceEmergencyAlert[]) => void,
  onError: (cause: unknown) => void,
) {
  // Each OR branch proves permission independently. The checked-in composite
  // indexes provide the latest 100 visible records without fetching history.
  const latest = query(collection(requireFirestore(), 'circles', spaceId, 'alerts'),
    or(where('audience', '==', 'everyone'), where('senderId', '==', uid), where('ownerId', '==', uid)),
    orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(latest, { includeMetadataChanges: true }, snapshot => {
    onAlerts(snapshot.docs.map(entry => {
      const data = entry.data({ serverTimestamps: 'estimate' });
      return {
        id: entry.id, senderId: data.senderId, senderName: data.senderName,
        audience: data.audience, ownerId: data.ownerId, location: data.location,
        text: data.text, createdAt: data.createdAt?.toMillis() ?? null, pending: entry.metadata.hasPendingWrites,
      };
    }));
  }, onError);
}
