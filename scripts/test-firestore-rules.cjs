// Run with the Firestore emulator, never a production project. See
// docs/FIREBASE_SETUP.md for the isolated tooling install and launch commands.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const testRequire = createRequire(path.join(root, '.verification/firebase/package.json'));
const { initializeTestEnvironment, assertSucceeds, assertFails } = testRequire('@firebase/rules-unit-testing');
const { collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, or, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } = testRequire('firebase/firestore');

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run through firebase emulators:exec --only firestore --project demo-closeby.');
const codeA = 'A'.repeat(32);
const codeB = 'B'.repeat(32);
const expiredCode = 'E'.repeat(32);
let environment;
const database = (uid) => uid ? environment.authenticatedContext(uid).firestore() : environment.unauthenticatedContext().firestore();
const device = (uid, overrides = {}) => ({
  id: uid, ownerId: uid, name: 'Test phone', photoURL: null, platform: 'android', batteryLevel: 0.8,
  sharing: true, lastSeen: Date.now(), updatedAt: serverTimestamp(),
  location: { latitude: 14.55, longitude: 121.02, accuracy: 5, speed: null, heading: null, timestamp: Date.now() },
  ...overrides,
});

before(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  environment = await initializeTestEnvironment({
    projectId: 'demo-closeby',
    firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const [id, owner, inviteCode] of [['circleA', 'alice', codeA], ['circleB', 'bob', codeB]]) {
      batch.set(doc(db, 'circles', id), { name: id, ownerId: owner, inviteCode, createdAt: Timestamp.now() });
      batch.set(doc(db, 'circles', id, 'members', owner), { uid: owner, inviteCode, joinedAt: Timestamp.now() });
      batch.set(doc(db, 'users', owner), { circleId: id });
      batch.set(doc(db, 'invitations', inviteCode), { circleId: id, ownerId: owner, createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 86400000) });
      batch.set(doc(db, 'circles', id, 'devices', owner), device(owner));
    }
    batch.set(doc(db, 'invitations', expiredCode), { circleId: 'circleA', ownerId: 'alice', createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await batch.commit();
  });
});

after(async () => { if (environment) await environment.cleanup(); });

test('saved avatar profiles are private to their account and independent of space membership', async () => {
  const charlie = database('charlie'), ref = doc(charlie, 'profiles/charlie');
  await assertSucceeds(setDoc(ref, { avatarId: 'face-8-slate', updatedAt: serverTimestamp() }));
  assert.equal((await assertSucceeds(getDoc(ref))).data().avatarId, 'face-8-slate');
  for (const uid of [null, 'alice', 'bob']) {
    const db = database(uid), otherRef = doc(db, 'profiles/charlie');
    await assertFails(getDoc(otherRef));
    await assertFails(setDoc(otherRef, { avatarId: 'face-1-blue', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(otherRef));
  }
  await assertFails(getDocs(collection(charlie, 'profiles')));
  await assertSucceeds(updateDoc(ref, { avatarId: null, updatedAt: serverTimestamp() }));
  assert.equal((await getDoc(ref)).data().avatarId, null);
  await assertSucceeds(deleteDoc(ref));
});

test('saved avatar profiles reject malformed IDs, unknown fields, and untrusted timestamps', async () => {
  const ref = doc(database('alice'), 'profiles/alice');
  for (const avatarId of ['face-0-blue', 'face-9-blue', 'face-1-red', 'face-1-blue<script>', 1, {}]) {
    await assertFails(setDoc(ref, { avatarId, updatedAt: serverTimestamp() }));
  }
  await assertFails(setDoc(ref, { updatedAt: serverTimestamp() }));
  await assertFails(setDoc(ref, { avatarId: 'face-1-blue' }));
  await assertFails(setDoc(ref, { avatarId: 'face-1-blue', updatedAt: Timestamp.fromMillis(0) }));
  await assertFails(setDoc(ref, { avatarId: 'face-1-blue', updatedAt: serverTimestamp(), location: device('alice').location }));
  await assertSucceeds(setDoc(ref, { avatarId: 'face-1-blue', updatedAt: serverTimestamp() }));
});

test('unauthenticated users cannot read locations, invitations, or write membership', async () => {
  const db = database();
  await assertFails(getDoc(doc(db, 'circles/circleA/devices/alice')));
  await assertFails(getDoc(doc(db, `invitations/${codeA}`)));
  await assertFails(setDoc(doc(db, 'circles/circleA/members/stranger'), { uid: 'stranger', inviteCode: codeA, joinedAt: serverTimestamp() }));
});

test('members can query their circle; other circles and collection enumeration are denied', async () => {
  const alice = database('alice');
  await assertSucceeds(getDocs(collection(alice, 'circles/circleA/devices')));
  await assertFails(getDoc(doc(alice, 'circles/circleB/devices/bob')));
  await assertFails(getDocs(collection(alice, 'circles/circleB/devices')));
  await assertFails(getDocs(collection(alice, 'invitations')));
  await assertFails(getDocs(collection(alice, 'circles')));
  await assertFails(getDoc(doc(alice, 'users/bob')));
});

test('circle creation succeeds atomically with owner membership, invitation and active profile', async () => {
  const db = database('charlie');
  const code = 'C'.repeat(32);
  const batch = writeBatch(db);
  batch.set(doc(db, 'circles/newCircle'), { name: 'Family', ownerId: 'charlie', inviteCode: code, createdAt: serverTimestamp() });
  batch.set(doc(db, `invitations/${code}`), { circleId: 'newCircle', ownerId: 'charlie', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000) });
  batch.set(doc(db, 'circles/newCircle/members/charlie'), { uid: 'charlie', inviteCode: code, joinedAt: serverTimestamp() });
  batch.set(doc(db, 'users/charlie'), { circleId: 'newCircle' });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(db, 'circles/newCircle')));
});

async function attemptJoin(uid, circleId, inviteCode) {
  const db = database(uid);
  const batch = writeBatch(db);
  batch.set(doc(db, `circles/${circleId}/members/${uid}`), { uid, inviteCode, joinedAt: serverTimestamp() });
  batch.set(doc(db, `users/${uid}`), { circleId });
  return batch.commit();
}

test('a valid invitation permits explicit joining and location reads', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  await assertSucceeds(getDoc(doc(database('charlie'), 'circles/circleA/devices/alice')));
});

test('self joining without an invitation, with expired code, or with another circle code is denied', async () => {
  await assertFails(attemptJoin('charlie', 'circleA', 'F'.repeat(32)));
  await assertFails(attemptJoin('charlie', 'circleA', expiredCode));
  await assertFails(attemptJoin('charlie', 'circleB', codeA));
  await assertFails(setDoc(doc(database('charlie'), 'users/charlie'), { circleId: 'circleA' }));
});

test('one account cannot join a second active circle or create another person membership', async () => {
  await assertFails(attemptJoin('alice', 'circleB', codeB));
  await assertFails(setDoc(doc(database('alice'), 'circles/circleA/members/charlie'), { uid: 'charlie', inviteCode: codeA, joinedAt: serverTimestamp() }));
});

test('only a device owner can write their own location and extra hidden coordinate fields are rejected', async () => {
  const alice = database('alice');
  await assertSucceeds(setDoc(doc(alice, 'circles/circleA/devices/alice'), device('alice')));
  await assertFails(setDoc(doc(alice, 'circles/circleA/devices/charlie'), device('charlie')));
  await assertFails(updateDoc(doc(alice, 'circles/circleA/devices/alice'), { ownerId: 'bob', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(alice, 'circles/circleA/devices/alice'), { hiddenLatitude: 14.55, updatedAt: serverTimestamp() }));
});

test('paused sharing must remove coordinates and the authorized reader sees null', async () => {
  const alice = database('alice');
  await assertFails(updateDoc(doc(alice, 'circles/circleA/devices/alice'), { sharing: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(alice, 'circles/circleA/devices/alice'), { sharing: false, location: null, updatedAt: serverTimestamp() }));
  const snapshot = await getDoc(doc(alice, 'circles/circleA/devices/alice'));
  assert.equal(snapshot.data().location, null);
  await assertFails(setDoc(doc(alice, 'circles/circleA/devices/alice'), device('alice', { sharing: false })));
});

test('legacy devices and custom avatars preserve the paused-location privacy boundary', async () => {
  const alice = database('alice'), ref = doc(alice, 'circles/circleA/devices/alice');
  await assertSucceeds(setDoc(ref, device('alice', { sharing: false, location: null })));
  assert.equal(Object.hasOwn((await getDoc(ref)).data(), 'avatarId'), false);
  await assertSucceeds(updateDoc(ref, { avatarId: 'face-4-mint', updatedAt: serverTimestamp() }));
  const paused = (await getDoc(ref)).data();
  assert.equal(paused.avatarId, 'face-4-mint');
  assert.equal(paused.sharing, false);
  assert.equal(paused.location, null);
  await assertFails(updateDoc(ref, { avatarId: 'face-3-coral', location: device('alice').location, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { avatarId: 'face-99-gold', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(database('bob'), 'circles/circleA/devices/alice'), { avatarId: 'face-2-purple', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { avatarId: null, updatedAt: serverTimestamp() }));
  assert.equal((await getDoc(ref)).data().location, null);
});

test('coordinates outside valid geographic bounds are denied', async () => {
  const db = database('alice');
  await assertFails(setDoc(doc(db, 'circles/circleA/devices/alice'), device('alice', { location: { ...device('alice').location, latitude: 999 } })));
});

test('leaving deletes location and membership atomically and revokes future circle reads', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  const charlie = database('charlie');
  await assertSucceeds(setDoc(doc(charlie, 'circles/circleA/devices/charlie'), device('charlie')));
  await assertFails(deleteDoc(doc(charlie, 'circles/circleA/members/charlie')));
  await assertFails(setDoc(doc(charlie, 'users/charlie'), { circleId: null }));
  const batch = writeBatch(charlie);
  batch.delete(doc(charlie, 'circles/circleA/devices/charlie'));
  batch.delete(doc(charlie, 'circles/circleA/members/charlie'));
  batch.set(doc(charlie, 'users/charlie'), { circleId: null });
  await assertSucceeds(batch.commit());
  await assertFails(getDoc(doc(charlie, 'circles/circleA/devices/alice')));
  const remaining = await getDocs(collection(database('alice'), 'circles/circleA/devices'));
  assert.equal(remaining.docs.some((entry) => entry.id === 'charlie'), false);
});

test('only the circle owner can create or revoke invitation codes', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  const code = 'D'.repeat(32);
  const invitation = { circleId: 'circleA', ownerId: 'charlie', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 86400000) };
  await assertFails(setDoc(doc(database('charlie'), `invitations/${code}`), invitation));
  await assertFails(deleteDoc(doc(database('charlie'), `invitations/${codeA}`)));
  await assertSucceeds(deleteDoc(doc(database('alice'), `invitations/${codeA}`)));
  await assertFails(attemptJoin('dave', 'circleA', codeA));
});

test('a realtime location listener receives null after sharing is paused', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  let unsubscribe;
  let timer;
  try {
    const observed = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Paused location did not reach realtime listener')), 10000);
      unsubscribe = onSnapshot(doc(database('charlie'), 'circles/circleA/devices/alice'), (snapshot) => {
        if (snapshot.exists() && snapshot.data().sharing === false && snapshot.data().location === null) resolve();
      }, reject);
    });
    await updateDoc(doc(database('alice'), 'circles/circleA/devices/alice'), { sharing: false, location: null, updatedAt: serverTimestamp() });
    await observed;
  } finally { clearTimeout(timer); unsubscribe?.(); }
});

const message = (uid, overrides = {}) => ({ senderId: uid, senderName: 'Test member', text: 'Arrived safely!', createdAt: serverTimestamp(), ...overrides });

test('joining with a member profile works without uploading a location', async () => {
  const db = database('charlie');
  const batch = writeBatch(db);
  batch.set(doc(db, 'circles/circleA/members/charlie'), { uid: 'charlie', name: 'Charlie', photoURL: null, inviteCode: codeA, joinedAt: serverTimestamp() });
  batch.set(doc(db, 'users/charlie'), { circleId: 'circleA' });
  await assertSucceeds(batch.commit());
  const roster = await assertSucceeds(getDocs(collection(database('alice'), 'circles/circleA/members')));
  assert.equal(roster.docs.find(entry => entry.id === 'charlie').data().name, 'Charlie');
  assert.equal((await getDoc(doc(db, 'circles/circleA/devices/charlie'))).exists(), false);
  await assertFails(updateDoc(doc(db, 'circles/circleA/members/charlie'), { uid: 'alice' }));
});

test('members can update their own avatar and Google photo while membership identity stays immutable', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  const charlie = database('charlie'), ref = doc(charlie, 'circles/circleA/members/charlie');
  const joined = (await getDoc(ref)).data();
  await assertSucceeds(updateDoc(ref, { name: 'Charlie', photoURL: 'https://example.com/google-photo.png', avatarId: 'face-6-gold' }));
  await assertSucceeds(updateDoc(ref, { avatarId: null }));
  const updated = (await getDoc(ref)).data();
  assert.equal(updated.photoURL, 'https://example.com/google-photo.png');
  assert.equal(updated.avatarId, null);
  assert.equal(updated.uid, joined.uid);
  assert.equal(updated.inviteCode, joined.inviteCode);
  assert.equal(updated.joinedAt.toMillis(), joined.joinedAt.toMillis());
  for (const change of [{ uid: 'alice' }, { inviteCode: codeB }, { joinedAt: Timestamp.fromMillis(0) }, { avatarId: 'face-9-blue' }, { location: device('charlie').location }]) {
    await assertFails(updateDoc(ref, change));
  }
  await assertFails(updateDoc(doc(database('alice'), 'circles/circleA/members/charlie'), { avatarId: 'face-2-blue' }));
  await assertFails(updateDoc(doc(database(), 'circles/circleA/members/charlie'), { avatarId: 'face-2-blue' }));
});

test('joining with an avatar is optional and invalid presets cannot create membership', async () => {
  const joinWithAvatar = (uid, avatarId) => {
    const db = database(uid), batch = writeBatch(db);
    batch.set(doc(db, `circles/circleA/members/${uid}`), { uid, name: 'New member', photoURL: null, avatarId, inviteCode: codeA, joinedAt: serverTimestamp() });
    batch.set(doc(db, `users/${uid}`), { circleId: 'circleA' });
    return batch.commit();
  };
  await assertFails(joinWithAvatar('charlie', 'face-2-orange'));
  await assertSucceeds(joinWithAvatar('charlie', 'face-2-purple'));
  await assertSucceeds(attemptJoin('dave', 'circleA', codeA));
  assert.equal(Object.hasOwn((await getDoc(doc(database('alice'), 'circles/circleA/members/dave'))).data(), 'avatarId'), false);
});

test('messages are member-only and reject impersonation, extra data, and invalid content', async () => {
  const ref = doc(database('alice'), 'circles/circleA/messages/hello');
  await assertSucceeds(setDoc(ref, message('alice', { text: 'Hello\nSee you soon!' })));
  await assertSucceeds(getDocs(query(collection(database('alice'), 'circles/circleA/messages'), orderBy('createdAt', 'desc'), limit(100))));
  await assertFails(getDoc(doc(database(), 'circles/circleA/messages/hello')));
  await assertFails(getDocs(collection(database('bob'), 'circles/circleA/messages')));
  await assertFails(setDoc(doc(database('bob'), 'circles/circleA/messages/outside'), message('bob')));
  await assertFails(setDoc(doc(database('alice'), 'circles/circleA/messages/spoof'), message('bob')));
  for (const [id, overrides] of Object.entries({ empty: { text: '' }, whitespace: { text: ' \n\t ' }, long: { text: 'x'.repeat(2001) }, extra: { location: { latitude: 14 } }, clock: { createdAt: Timestamp.fromMillis(1000) } })) {
    await assertFails(setDoc(doc(database('alice'), `circles/circleA/messages/${id}`), message('alice', overrides)));
  }
  await assertFails(updateDoc(ref, { text: 'Edited' }));
  await assertFails(deleteDoc(ref));
});

test('messages reach another member in realtime without requiring location sharing', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  let stop; let timer;
  try {
    const received = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Message did not reach the member')), 10000);
      stop = onSnapshot(collection(database('charlie'), 'circles/circleA/messages'), snapshot => {
        if (snapshot.docs.some(entry => entry.data().text === 'Arrived safely!')) resolve();
      }, reject);
    });
    await assertSucceeds(setDoc(doc(database('alice'), 'circles/circleA/messages/realtime'), message('alice')));
    await received;
  } finally { clearTimeout(timer); stop?.(); }
});

test('leaving a space revokes message reads and writes', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  const db = database('charlie');
  await assertSucceeds(setDoc(doc(db, 'circles/circleA/messages/before'), message('charlie')));
  const batch = writeBatch(db);
  batch.delete(doc(db, 'circles/circleA/devices/charlie'));
  batch.delete(doc(db, 'circles/circleA/members/charlie'));
  batch.set(doc(db, 'users/charlie'), { circleId: null });
  await assertSucceeds(batch.commit());
  await assertFails(getDocs(collection(db, 'circles/circleA/messages')));
  await assertFails(setDoc(doc(db, 'circles/circleA/messages/after'), message('charlie')));
});

test('owner can renew an invitation; the old code is revoked and current members retain access', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  const code = 'D'.repeat(32);
  const db = database('alice');
  const batch = writeBatch(db);
  batch.delete(doc(db, `invitations/${codeA}`));
  batch.set(doc(db, `invitations/${code}`), { circleId: 'circleA', ownerId: 'alice', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000) });
  batch.update(doc(db, 'circles/circleA'), { inviteCode: code });
  await assertSucceeds(batch.commit());
  await assertFails(attemptJoin('dave', 'circleA', codeA));
  await assertSucceeds(attemptJoin('dave', 'circleA', code));
  await assertSucceeds(getDoc(doc(database('charlie'), 'circles/circleA')));
  await assertFails(updateDoc(doc(database('charlie'), 'circles/circleA'), { inviteCode: codeA }));
});

const emergency = (uid, overrides = {}) => ({
  senderId: uid, senderName: 'Test member', audience: 'everyone', ownerId: 'alice',
  location: null, text: 'I need help.', createdAt: serverTimestamp(), ...overrides,
});

function visibleAlerts(db, uid, circleId = 'circleA') {
  return query(collection(db, 'circles', circleId, 'alerts'),
    or(where('audience', '==', 'everyone'), where('senderId', '==', uid), where('ownerId', '==', uid)),
    orderBy('createdAt', 'desc'), limit(100));
}

async function leaveSpace(uid, circleId = 'circleA') {
  const db = database(uid);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'circles', circleId, 'devices', uid));
  batch.delete(doc(db, 'circles', circleId, 'members', uid));
  batch.set(doc(db, 'users', uid), { circleId: null });
  await assertSucceeds(batch.commit());
}

function emergencyService(uid, db = database(uid)) {
  const vm = require('node:vm');
  const ts = require('../node_modules/typescript');
  const source = fs.readFileSync(path.join(root, 'src/services/emergencies.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const load = vm.runInThisContext('(function(require,module,exports){\n' + output + '\n})');
  load((name) => {
      if (name === 'firebase/firestore') return testRequire('firebase/firestore');
      if (name === '../lib/firebase') return { firebaseAuth: { currentUser: { uid, displayName: 'Test member' } }, requireFirestore: () => db };
      throw new Error('Unexpected emergency dependency: ' + name);
  }, module, module.exports);
  return module.exports;
}

test('emergency reads and writes reject unauthenticated and cross-space access', async () => {
  await assertSucceeds(setDoc(doc(database('alice'), 'circles/circleA/alerts/public'), emergency('alice')));
  for (const uid of [null, 'bob']) {
    const db = database(uid);
    await assertFails(getDoc(doc(db, 'circles/circleA/alerts/public')));
    await assertFails(getDocs(visibleAlerts(db, uid || 'stranger')));
    await assertFails(setDoc(doc(db, 'circles/circleA/alerts/outside'), emergency(uid || 'stranger')));
  }
  await assertSucceeds(getDoc(doc(database('alice'), 'circles/circleA/alerts/unused')));
  await assertFails(getDoc(doc(database('bob'), 'circles/circleA/alerts/unused')));
});

test('owner-directed emergencies are private to sender and owner; visible queries enforce privacy', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  await assertSucceeds(attemptJoin('dave', 'circleA', codeA));
  await assertSucceeds(setDoc(doc(database('charlie'), 'circles/circleA/alerts/private'), emergency('charlie', { audience: 'owner', location: device('charlie').location })));
  await assertSucceeds(setDoc(doc(database('charlie'), 'circles/circleA/alerts/public'), emergency('charlie')));
  for (const uid of ['alice', 'charlie']) {
    await assertSucceeds(getDoc(doc(database(uid), 'circles/circleA/alerts/private')));
    const records = await assertSucceeds(getDocs(visibleAlerts(database(uid), uid)));
    assert.deepEqual(records.docs.map(entry => entry.id).sort(), ['private', 'public']);
  }
  await assertFails(getDoc(doc(database('dave'), 'circles/circleA/alerts/private')));
  await assertSucceeds(getDoc(doc(database('dave'), 'circles/circleA/alerts/public')));
  const records = await assertSucceeds(getDocs(visibleAlerts(database('dave'), 'dave')));
  assert.deepEqual(records.docs.map(entry => entry.id), ['public']);
  // Collection-wide queries cannot accidentally expose private sender/owner data.
  await assertFails(getDocs(collection(database('charlie'), 'circles/circleA/alerts')));
  await assertFails(getDocs(collection(database('dave'), 'circles/circleA/alerts')));
  await assertFails(getDocs(query(collection(database('dave'), 'circles/circleA/alerts'), where('audience', '==', 'owner'))));
});

test('emergencies reject sender/owner impersonation, invalid location and malformed content', async () => {
  const db = database('alice');
  const cases = {
    sender: { senderId: 'bob' }, owner: { ownerId: 'bob' }, audience: { audience: 'anyone' },
    empty: { text: '' }, whitespace: { text: ' \n\t ' }, long: { text: 'x'.repeat(501) },
    name: { senderName: '' }, extra: { hiddenLatitude: 14.55 }, clock: { createdAt: Timestamp.fromMillis(1000) },
    latitude: { location: { ...device('alice').location, latitude: 91 } },
    longitude: { location: { ...device('alice').location, longitude: 181 } },
    coordinates: { location: { latitude: 14.55, longitude: 121.02 } },
    hidden: { location: { ...device('alice').location, extra: 14.55 } },
  };
  for (const [id, overrides] of Object.entries(cases)) {
    await assertFails(setDoc(doc(db, 'circles/circleA/alerts', id), emergency('alice', overrides)));
  }
  const valid = doc(db, 'circles/circleA/alerts/valid');
  await assertSucceeds(setDoc(valid, emergency('alice', { text: 'Help\nPlease contact me.', location: device('alice').location })));
  await assertFails(updateDoc(valid, { text: 'Rewritten emergency' }));
  await assertFails(deleteDoc(valid));
});

test('emergencies work with GPS and sharing off and reject delivery to an owner who left', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  const charlie = database('charlie');
  await assertSucceeds(setDoc(doc(charlie, 'circles/circleA/devices/charlie'), device('charlie', { sharing: false, location: null })));
  await assertSucceeds(setDoc(doc(charlie, 'circles/circleA/alerts/nogps'), emergency('charlie', { audience: 'owner' })));
  await leaveSpace('alice');
  await assertFails(setDoc(doc(charlie, 'circles/circleA/alerts/absentowner'), emergency('charlie', { audience: 'owner' })));
  await assertSucceeds(setDoc(doc(charlie, 'circles/circleA/alerts/everyone'), emergency('charlie')));
  const api = emergencyService('charlie', charlie);
  await assert.rejects(api.sendEmergencyAlert('circleA', api.createEmergencyAlertId('circleA'), {
    audience: 'owner', ownerId: 'alice', location: null, text: 'I need help.',
  }), /space owner is no longer/);
});

test('leaving revokes all future emergency reads and sends', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  const db = database('charlie');
  await assertSucceeds(setDoc(doc(db, 'circles/circleA/alerts/before'), emergency('charlie', { audience: 'owner' })));
  await leaveSpace('charlie');
  await assertFails(getDoc(doc(db, 'circles/circleA/alerts/before')));
  await assertFails(getDocs(visibleAlerts(db, 'charlie')));
  await assertFails(setDoc(doc(db, 'circles/circleA/alerts/after'), emergency('charlie')));
});

test('emergency service retries a stable ID without sending twice and rejects altered retries', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  const api = emergencyService('charlie');
  const id = api.createEmergencyAlertId('circleA');
  const input = { audience: 'owner', ownerId: 'alice', location: device('charlie').location, text: 'I need help.' };
  await assertSucceeds(api.sendEmergencyAlert('circleA', id, input));
  await assertSucceeds(api.sendEmergencyAlert('circleA', id, input));
  await assert.rejects(api.sendEmergencyAlert('circleA', id, { ...input, audience: 'everyone' }), /already used/);
  const records = await getDocs(visibleAlerts(database('alice'), 'alice'));
  assert.equal(records.size, 1);
  assert.equal(records.docs[0].id, id);
  assert.equal(records.docs[0].data().createdAt instanceof Timestamp, true);
});

test('emergency realtime listeners deliver privately to owner and everyone without GPS', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  await assertSucceeds(attemptJoin('dave', 'circleA', codeA));
  const sender = emergencyService('charlie');
  const owner = emergencyService('alice');
  const member = emergencyService('dave');
  const privateId = sender.createEmergencyAlertId('circleA');
  const everyoneId = sender.createEmergencyAlertId('circleA');
  let ownerSeen = []; let memberSeen = []; let ownerReady = false; let memberReady = false;
  let stopOwner; let stopMember; let timer; let notify;
  const waitUntil = (check) => new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Emergency listener did not receive expected records')), 10000);
    notify = () => { if (check()) { clearTimeout(timer); resolve(); } };
    notify();
  });
  try {
    stopOwner = owner.watchEmergencyAlerts('circleA', 'alice', alerts => { ownerSeen = alerts; ownerReady = true; notify?.(); }, cause => { throw cause; });
    stopMember = member.watchEmergencyAlerts('circleA', 'dave', alerts => { memberSeen = alerts; memberReady = true; notify?.(); }, cause => { throw cause; });
    await waitUntil(() => ownerReady && memberReady);
    await sender.sendEmergencyAlert('circleA', privateId, { audience: 'owner', ownerId: 'alice', location: null, text: 'Help privately.' });
    await waitUntil(() => ownerSeen.some(alert => alert.id === privateId && !alert.pending));
    assert.equal(memberSeen.some(alert => alert.id === privateId), false);
    await sender.sendEmergencyAlert('circleA', everyoneId, { audience: 'everyone', ownerId: 'alice', location: null, text: 'Help everyone.' });
    await waitUntil(() => ownerSeen.length === 2 && memberSeen.some(alert => alert.id === everyoneId && !alert.pending));
    assert.equal(memberSeen.length, 1);
    assert.equal(memberSeen[0].location, null);
    assert.equal(ownerSeen[0].id, everyoneId);
  } finally { clearTimeout(timer); stopOwner?.(); stopMember?.(); }
});

test('offline emergency sends fail without claiming success or queuing a later emergency', async () => {
  await assertSucceeds(attemptJoin('charlie', 'circleA', codeA));
  // disableNetwork only disables streams in the Node SDK; transactions still
  // make unary requests. An isolated, unbound loopback endpoint proves failure
  // with no route to a cloud project or to the working emulator.
  const offline = await initializeTestEnvironment({
    projectId: 'demo-closeby-offline', firestore: { host: '127.0.0.1', port: 65534 },
  });
  try {
    const api = emergencyService('charlie', offline.authenticatedContext('charlie').firestore());
    const id = api.createEmergencyAlertId('circleA');
    await assert.rejects(api.sendEmergencyAlert('circleA', id, { audience: 'everyone', ownerId: 'alice', location: null, text: 'I need help.' }));
  } finally { await offline.cleanup(); }
  const records = await getDocs(visibleAlerts(database('alice'), 'alice'));
  assert.equal(records.size, 0);
});
