const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const toolsRequire = createRequire(path.resolve('.verification/firebase/package.json'));
const { initializeTestEnvironment, assertSucceeds, assertFails } = toolsRequire('@firebase/rules-unit-testing');
const { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp } = toolsRequire('firebase/firestore');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Use demo-closeby local Firestore only.');
let environment;
const db = uid => uid ? environment.authenticatedContext(uid).firestore() : environment.unauthenticatedContext().firestore();
const id = '12345678-1234-4123-a123-123456789abc';
const settings = () => ({ enabled: true, arrivals: true, speed: true, speedLimitKmh: 80, zones: [], generation: id, updatedAt: serverTimestamp() });
const endpoint = () => ({ token: 'synthetic-fcm-token', platform: 'android', updatedAt: serverTimestamp() });
before(async () => { const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':'); environment = await initializeTestEnvironment({ projectId: 'demo-closeby', firestore: { host, port: +port, rules: fs.readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => { await environment.clearFirestore(); });
after(async () => { await environment?.cleanup(); });
test('push addresses and saved places remain private to their owner', async () => {
  const target = `users/alice/pushDevices/${id}`;
  await assertSucceeds(setDoc(doc(db('alice'), target), endpoint()));
  await assertSucceeds(getDoc(doc(db('alice'), target))); await assertSucceeds(getDocs(collection(db('alice'), 'users/alice/pushDevices')));
  await assertFails(getDoc(doc(db('bob'), target))); await assertFails(getDocs(collection(db('bob'), 'users/alice/pushDevices')));
  await assertFails(setDoc(doc(db('bob'), target), endpoint())); await assertFails(getDoc(doc(db(null), target)));
  const preferences = 'users/alice/notificationSettings/main'; await assertSucceeds(setDoc(doc(db('alice'), preferences), settings()));
  await assertFails(getDoc(doc(db('bob'), preferences))); await assertSucceeds(deleteDoc(doc(db('alice'), target)));
});
test('notification registration rejects malformed tokens, extra fields, unsupported platforms and forged timestamps', async () => {
  const target = doc(db('alice'), `users/alice/pushDevices/${id}`);
  for (const change of [{ token: '' }, { token: 'x'.repeat(4097) }, { platform: 'ios' }, { ownerId: 'bob' }, { updatedAt: 0 }]) await assertFails(setDoc(target, { ...endpoint(), ...change }));
  await assertFails(setDoc(doc(db('alice'), 'users/alice/pushDevices/not-a-device'), endpoint()));
});
test('private settings bound place count and threshold, and disabling erases stored places', async () => {
  const target = doc(db('alice'), 'users/alice/notificationSettings/main');
  const zone = { id: 'home', name: 'Home', coordinate: { latitude: 14.55, longitude: 121.02 }, radius: 100, enabled: true, color: '#1186FF' };
  await assertSucceeds(setDoc(target, { ...settings(), zones: Array.from({ length: 20 }, (_, index) => ({ ...zone, id: String(index) })) }));
  await assertSucceeds(updateDoc(target, { enabled: false, zones: [], updatedAt: serverTimestamp() }));
  for (const change of [{ enabled: 'yes' }, { speedLimitKmh: 9 }, { speedLimitKmh: 80.5 }, { zones: 'not a list' }, { zones: Array(21).fill(zone) }, { extra: true }]) await assertFails(setDoc(target, { ...settings(), ...change }));
});
test('clients cannot forge notification jobs, evaluation state or backend activation', async () => {
  for (const target of ['notificationOutbox/alert', 'users/alice/notificationState/state', 'appStatus/notifications']) await assertFails(setDoc(doc(db('alice'), target), { enabled: true }));
  await assertSucceeds(getDoc(doc(db('alice'), 'appStatus/notifications'))); await assertFails(getDoc(doc(db(null), 'appStatus/notifications')));
  assert.equal((await getDoc(doc(db('alice'), 'appStatus/notifications'))).exists(), false);
});
