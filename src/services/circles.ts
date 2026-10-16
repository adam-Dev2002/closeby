import * as Crypto from 'expo-crypto';
import {
  collection,
  doc,
  getDocFromServer,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { firebaseAuth, requireFirestore } from '../lib/firebase';
import { profileIdentity } from '../lib/profileIdentity';
import { generateInvitationCode, invitationCodeFromInput } from '../lib/invitations';
import type { DeviceProfile, LocationFix, SpaceMember } from '../types';
import { stopHistoryUploads } from './activityHistory';

export type Circle = { id: string; name: string; inviteCode: string; ownerId: string };
const stoppedUsers = new Set<string>();
const sharingGenerations = new Map<string, number>();
const activeCircles = new Map<string, string>();
const lastUploadedFix = new Map<string, number>();

function requireUid(): string {
  const uid = firebaseAuth?.currentUser?.uid;
  if (!uid) throw new Error('Sign in before managing a circle.');
  return uid;
}

function bounded<T>(promise: Promise<T>, message: string, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (cause) => { clearTimeout(timer); reject(cause); });
  });
}

export function beginCircleSession(uid: string): void {
  sharingGenerations.set(uid, (sharingGenerations.get(uid) || 0) + 1);
  stoppedUsers.delete(uid);
}

function stopUploads(uid: string): number {
  const generation = (sharingGenerations.get(uid) || 0) + 1;
  sharingGenerations.set(uid, generation);
  stoppedUsers.add(uid);
  return generation;
}

function memberProfile() {
  const identity = profileIdentity(firebaseAuth?.currentUser);
  return {
    name: identity.displayName?.slice(0, 100) || 'Member',
    photoURL: identity.photoURL && identity.photoURL.length <= 2048 ? identity.photoURL : null,
  };
}

async function invitationCode(): Promise<string> {
  return generateInvitationCode(await Crypto.getRandomBytesAsync(12));
}

export async function createCircle(name: string): Promise<void> {
  const uid = requireUid();
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 60) throw new Error('Choose a circle name between 1 and 60 characters.');
  const db = requireFirestore();
  const circleRef = doc(collection(db, 'circles'));
  const code = await invitationCode();
  await bounded(runTransaction(db, async (transaction) => {
    const userRef = doc(db, 'users', uid);
    const profile = await transaction.get(userRef);
    if (profile.data()?.circleId) throw new Error('Leave your current circle before creating another.');
    transaction.set(circleRef, { name: trimmedName, ownerId: uid, inviteCode: code, createdAt: serverTimestamp() });
    transaction.set(doc(db, 'invitations', code), {
      circleId: circleRef.id,
      ownerId: uid,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    transaction.set(doc(circleRef, 'members', uid), { uid, ...memberProfile(), inviteCode: code, joinedAt: serverTimestamp() });
    transaction.set(userRef, { circleId: circleRef.id });
  }), 'Creating a circle needs a working internet connection. Check your connection and try again.');
  beginCircleSession(uid);
}

export async function joinCircle(input: string): Promise<void> {
  const uid = requireUid();
  const code = invitationCodeFromInput(input);
  if (!code) throw new Error('Paste an invitation link or enter the complete invitation code.');
  const db = requireFirestore();
  await bounded(runTransaction(db, async (transaction) => {
    const userRef = doc(db, 'users', uid);
    const invitationRef = doc(db, 'invitations', code);
    const [profile, invitation] = await Promise.all([transaction.get(userRef), transaction.get(invitationRef)]);
    if (profile.data()?.circleId) throw new Error('Leave your current circle before joining another.');
    if (!invitation.exists()) throw new Error('This invitation does not exist. Ask for a new code.');
    const data = invitation.data();
    if (!(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= Date.now()) {
      throw new Error('This invitation expired. Ask the circle owner for a new invitation.');
    }
    if (typeof data.circleId !== 'string') throw new Error('This invitation is invalid.');
    transaction.set(doc(db, 'circles', data.circleId, 'members', uid), { uid, ...memberProfile(), inviteCode: code, joinedAt: serverTimestamp() });
    transaction.set(userRef, { circleId: data.circleId });
  }), 'Joining a circle needs a working internet connection. Check your connection and try again.');
  beginCircleSession(uid);
}

export async function renewInvitation(circleId: string): Promise<void> {
  const uid = requireUid();
  const db = requireFirestore();
  const code = await invitationCode();
  await bounded(runTransaction(db, async (transaction) => {
    const circleRef = doc(db, 'circles', circleId);
    const circle = await transaction.get(circleRef);
    if (!circle.exists() || circle.data().ownerId !== uid) throw new Error('Only the space owner can renew the invitation.');
    const oldInvitationRef = doc(db, 'invitations', circle.data().inviteCode);
    const oldInvitation = await transaction.get(oldInvitationRef);
    if (oldInvitation.exists()) transaction.delete(oldInvitationRef);
    transaction.set(doc(db, 'invitations', code), {
      circleId, ownerId: uid, createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    transaction.update(circleRef, { inviteCode: code });
  }), 'Renewing your invitation needs an internet connection. Try again when connected.');
}

export async function leaveCircle(): Promise<void> {
  const uid = requireUid();
  stopUploads(uid);
  stopHistoryUploads(uid);
  const db = requireFirestore();
  const profile = await bounded(getDocFromServer(doc(db, 'users', uid)), 'Connect to the internet before leaving your circle.');
  const circleId = profile.data()?.circleId;
  if (typeof circleId !== 'string') return;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'circles', circleId, 'devices', uid));
  batch.delete(doc(db, 'circles', circleId, 'historyConsent', uid));
  batch.delete(doc(db, 'circles', circleId, 'members', uid));
  batch.set(doc(db, 'users', uid), { circleId: null });
  await bounded(batch.commit(), 'Could not confirm leaving the circle. Reconnect and try again.');
  activeCircles.delete(uid);
}

export async function stopSharing(uid = firebaseAuth?.currentUser?.uid): Promise<boolean> {
  if (!uid) return true;
  stopHistoryUploads(uid);
  const generation = stopUploads(uid);
  const db = requireFirestore();
  let circleId: unknown = activeCircles.get(uid);
  if (!circleId) {
    const profile = await bounded(getDocFromServer(doc(db, 'users', uid)), 'Connect to the internet so your shared location can be removed before signing out.');
    circleId = profile.data()?.circleId;
  }
  // A slow profile lookup from an older pause must not clear coordinates after
  // the person has explicitly resumed sharing in this session.
  if (sharingGenerations.get(uid) !== generation || !stoppedUsers.has(uid)) return false;
  if (typeof circleId !== 'string') return true;
  await pauseDevice(circleId, uid);
  return sharingGenerations.get(uid) === generation && stoppedUsers.has(uid);
}

export async function pauseDevice(circleId: string, uid: string): Promise<void> {
  try {
    await bounded(updateDoc(doc(requireFirestore(), 'circles', circleId, 'devices', uid), {
      sharing: false,
      location: null,
      updatedAt: serverTimestamp(),
    }), 'Could not confirm removal of your shared location. Check your internet connection and try again.');
  } catch (cause) {
    if ((cause as { code?: string }).code !== 'not-found') throw cause;
  }
}

export function watchCircle(
  uid: string,
  onCircle: (circle: Circle | null) => void,
  onMembers: (members: DeviceProfile[]) => void,
  onError: (cause: unknown) => void,
  onRoster: (members: SpaceMember[]) => void = () => {},
  onConnected: () => void = () => {},
): Unsubscribe {
  const db = requireFirestore();
  let live = true;
  let generation = 0;
  const ready = new Set<string>();
  let stopCircle: Unsubscribe | undefined;
  let stopDevices: Unsubscribe | undefined;
  let stopMembers: Unsubscribe | undefined;
  let watchingId: string | null | undefined;
  const clear = () => {
    ++generation;
    ready.clear();
    stopCircle?.(); stopDevices?.(); stopMembers?.();
    stopCircle = undefined; stopDevices = undefined; stopMembers = undefined;
    onCircle(null); onMembers([]); onRoster([]);
  };
  const unsubscribe = onSnapshot(doc(db, 'users', uid), (profile) => {
    if (!live) return;
    const circleId = typeof profile.data()?.circleId === 'string' ? profile.data()!.circleId as string : null;
    if (circleId === watchingId) return;
    // Reconnecting to the same space must not briefly remove it from callers.
    if (watchingId !== undefined) clear();
    watchingId = circleId;
    if (!circleId) { clear(); activeCircles.delete(uid); onConnected(); return; }
    const token = generation;
    const current = () => live && generation === token;
    const connected = (part: string) => {
      ready.add(part);
      if (ready.size === 3) onConnected();
    };
    activeCircles.set(uid, circleId);
    stopCircle = onSnapshot(doc(db, 'circles', circleId), (snapshot) => {
      if (!current()) return;
      if (!snapshot.exists()) { clear(); activeCircles.delete(uid); return; }
      const data = snapshot.data();
      onCircle({ id: snapshot.id, name: data.name, inviteCode: data.inviteCode, ownerId: data.ownerId });
      connected('circle');
    }, (cause) => { if (current()) { clear(); activeCircles.delete(uid); onError(cause); } });
    stopDevices = onSnapshot(collection(db, 'circles', circleId, 'devices'), (snapshot) => {
      if (!current()) return;
      onMembers(snapshot.docs.map((entry) => {
        const data = entry.data() as DeviceProfile;
        return { ...data, id: entry.id, location: data.sharing ? data.location : null };
      }));
      connected('devices');
    }, (cause) => { if (current()) { ready.delete('devices'); onMembers([]); onError(cause); } });
    stopMembers = onSnapshot(collection(db, 'circles', circleId, 'members'), (snapshot) => {
      if (!current()) return;
      onRoster(snapshot.docs.map(entry => {
        const data = entry.data();
        return { uid: entry.id, name: typeof data.name === 'string' ? data.name : 'Member', photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
          avatarId: typeof data.avatarId === 'string' ? data.avatarId : null, canRequestMedia: data.canRequestMedia === true };
      }));
      connected('members');
    }, (cause) => { if (current()) { ready.delete('members'); onRoster([]); onError(cause); } });
  }, (cause) => { if (live) { clear(); activeCircles.delete(uid); onError(cause); } });
  return () => { live = false; ++generation; unsubscribe(); stopCircle?.(); stopDevices?.(); stopMembers?.(); activeCircles.delete(uid); };
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cleanLocation(fix: LocationFix | null): LocationFix | null {
  if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude) || !Number.isFinite(fix.timestamp)) return null;
  if (Math.abs(fix.latitude) > 90 || Math.abs(fix.longitude) > 180) return null;
  return {
    latitude: fix.latitude, longitude: fix.longitude, timestamp: fix.timestamp,
    accuracy: finiteOrNull(fix.accuracy), speed: finiteOrNull(fix.speed), heading: finiteOrNull(fix.heading),
  };
}

function cleanAvatarId(value: unknown): string | null {
  return typeof value === 'string' && /^face-[1-8]-(blue|purple|coral|mint|gold|slate)$/.test(value) ? value : null;
}

export async function updateMemberIdentity(circleId: string, uid: string, identity: { name: string; photoURL: string | null; avatarId?: string | null }): Promise<void> {
  if (requireUid() !== uid) throw new Error('Sign in with this account before updating its avatar.');
  await bounded(updateDoc(doc(requireFirestore(), 'circles', circleId, 'members', uid), {
    name: identity.name.trim().slice(0, 100) || 'Member',
    photoURL: typeof identity.photoURL === 'string' && identity.photoURL.length <= 2048 ? identity.photoURL : null,
    avatarId: cleanAvatarId(identity.avatarId),
  }), 'Your avatar is saved. Reconnect to update it for your space.');
}

// A role only permits sending requests. It never grants device consent.
export async function setMediaRequester(circleId: string, memberId: string, enabled: boolean): Promise<void> {
  const uid = requireUid(), db = requireFirestore();
  await bounded(runTransaction(db, async transaction => {
    const circle = await transaction.get(doc(db, 'circles', circleId));
    const memberRef = doc(db, 'circles', circleId, 'members', memberId);
    const member = await transaction.get(memberRef);
    if (!circle.exists() || circle.data().ownerId !== uid) throw new Error('Only the space owner can authorize device access requests.');
    if (!member.exists()) throw new Error('This person is no longer in your space.');
    transaction.update(memberRef, { canRequestMedia: enabled });
  }), 'Connect to the internet to change request permissions.');
}

export function publishDevice(circleId: string, uid: string, device: DeviceProfile, sharing: boolean): Promise<void> {
  if (stoppedUsers.has(uid) && sharing) return Promise.resolve();
  if (sharing && device.location && device.location.timestamp < (lastUploadedFix.get(uid) ?? 0)) return Promise.resolve();
  if (sharing && device.location) lastUploadedFix.set(uid, device.location.timestamp);
  const profile: DeviceProfile = {
    id: uid, ownerId: uid,
    name: device.name.trim().slice(0, 100) || 'My device',
    photoURL: typeof device.photoURL === 'string' && device.photoURL.length <= 2048 ? device.photoURL : null,
    avatarId: cleanAvatarId(device.avatarId),
    platform: device.platform.slice(0, 30),
    batteryLevel: device.batteryLevel !== null && device.batteryLevel >= 0 && device.batteryLevel <= 1 ? finiteOrNull(device.batteryLevel) : null,
    location: sharing ? cleanLocation(device.location) : null,
    sharing,
    lastSeen: Date.now(),
  };
  return bounded(setDoc(doc(requireFirestore(), 'circles', circleId, 'devices', uid), {
    ...profile, updatedAt: serverTimestamp(),
  }), sharing
    ? 'Location sync is waiting for a connection.'
    : 'Sharing is paused on this device. Reconnect to confirm removal of the last shared location.');
}
