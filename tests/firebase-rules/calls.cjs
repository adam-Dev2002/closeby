// Isolated demo-closeby Firestore emulator only; no production operations.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const ts = require('../../node_modules/typescript');
const testRequire = createRequire(path.resolve('.verification/firebase/package.json'));
const { initializeTestEnvironment, assertSucceeds, assertFails } = testRequire('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, limit, query, where, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, writeBatch, setLogLevel } = testRequire('firebase/firestore');
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Use the isolated demo-closeby Firestore emulator.');
setLogLevel('silent');
let environment;
const db = uid => uid ? environment.authenticatedContext(uid).firestore() : environment.unauthenticatedContext().firestore();
const ref = (uid, id = 'call') => doc(db(uid), 'circles/space/calls', id);
const candidateRef = (uid, id = 'ice') => doc(ref(uid), 'candidates', id);
const incoming = (uid, max = 10) => query(collection(db(uid), 'circles/space/calls'), where('calleeId', '==', uid), where('callerId', 'in', ['alice', 'owner']), where('status', '==', 'ringing'), limit(max));
const ringing = (overrides = {}) => ({ callerId: 'alice', calleeId: 'bob', callerName: 'Alice', calleeName: 'Bob', mode: 'video', status: 'ringing', offer: null, answer: null,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 120000), ...overrides });
const acceptance = (overrides = {}) => ({ status: 'accepted', updatedAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 7200000), ...overrides });
const ice = (uid, overrides = {}) => ({ uid, candidate: 'candidate:1 1 UDP 2113937151 192.0.2.1 55000 typ host', sdpMid: '0', sdpMLineIndex: 0, createdAt: serverTimestamp(), ...overrides });
const description = type => ({ type, sdp: 'v=0\r\ns=Closeby\r\n' });
async function create() { await assertSucceeds(setDoc(ref('alice'), ringing())); }
async function accepted() { await create(); await assertSucceeds(updateDoc(ref('bob'), acceptance())); }
async function seed(overrides = {}) {
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'circles/space/calls/call'), ringing({ createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...overrides })));
}
before(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  environment = await initializeTestEnvironment({ projectId: 'demo-closeby', firestore: { host, port: Number(port), rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore(), batch = writeBatch(database);
    batch.set(doc(database, 'circles/space'), { ownerId: 'owner', name: 'Space' });
    for (const uid of ['owner', 'alice', 'bob']) {
      batch.set(doc(database, `circles/space/members/${uid}`), { uid, name: uid, inviteCode: 'A'.repeat(32), joinedAt: Timestamp.now() });
      batch.set(doc(database, `users/${uid}`), { circleId: 'space' });
    }
    batch.set(doc(database, 'circles/other'), { ownerId: 'outsider', name: 'Other' });
    batch.set(doc(database, 'circles/other/members/outsider'), { uid: 'outsider' });
    await batch.commit();
  });
});
after(async () => { await environment?.cleanup(); });

function callService(uid) {
  const database = db(uid);
  function load(file, dependencies) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${source}\n})`)(name => dependencies[name], module, module.exports);
    return module.exports;
  }
  const calls = load('src/lib/calls.ts', {});
  return load('src/services/calls.ts', { 'firebase/firestore': testRequire('firebase/firestore'), '../lib/calls': calls,
    '../lib/firebase': { firebaseAuth: { currentUser: { uid } }, requireFirestore: () => database } });
}

test('actual call services deliver each call and device request to the recipient then accept and signal', async () => {
  const caller = callService('owner'), recipient = callService('bob');
  for (const [mode, access] of [['voice'], ['video'], ['voice', 'microphone'], ['video', 'front'], ['video', 'back']]) {
    let stop, timer;
    try {
      let targetId, notify, received = [];
      const delivered = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Recipient did not receive the request')), 10000);
        notify = () => { if (received.some(value => value.id === targetId)) resolve(); };
        stop = recipient.watchIncoming('space', 'bob', ['owner', 'alice', 'bob'], calls => { received = calls; notify(); }, reject);
      });
      const call = await caller.startCall('space', 'owner', 'Owner', 'bob', 'Bob', mode, access);
      targetId = call.id; notify();
      await delivered;
      await recipient.acceptCall(call, 'bob');
      const accepted = { ...call, status: 'accepted', expiresAt: Date.now() + 7200000 };
      await caller.publishSignal(accepted, 'owner', { type: 'offer', description: description('offer') });
      await recipient.publishSignal({ ...accepted, offer: description('offer') }, 'bob', { type: 'answer', description: description('answer') });
      await recipient.publishSignal(accepted, 'bob', { type: 'candidate', candidate: { candidate: 'candidate:fake', sdpMid: '0', sdpMLineIndex: 0 } });
      await recipient.finishCall(accepted, 'bob');
    } finally { clearTimeout(timer); stop?.(); }
  }
});

test('incoming service supports full membership batches with populated requests', async () => {
  const ids = Array.from({ length: 18 }, (_, index) => `member${index}`);
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore(), batch = writeBatch(database);
    for (const uid of ids) batch.set(doc(database, 'circles/space/members', uid), { uid });
    await batch.commit();
  });
  const caller = callService('owner'), recipient = callService('bob');
  let stop, timer;
  try {
    const call = await caller.startCall('space', 'owner', 'Owner', 'bob', 'Bob', 'video', 'front');
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Batched request not delivered')), 10000);
      stop = recipient.watchIncoming('space', 'bob', ['bob', ...ids, 'owner', 'alice'], calls => { if (calls.some(value => value.id === call.id)) resolve(); }, reject);
    });
  } finally { clearTimeout(timer); stop?.(); }
});

test('calls are private to current participants and bounded incoming queries are authorized', async () => {
  await create();
  await assertSucceeds(getDoc(ref('alice'))); await assertSucceeds(getDoc(ref('bob')));
  const received = await assertSucceeds(getDocs(incoming('bob'))); assert.equal(received.size, 1);
  for (const uid of [null, 'owner', 'outsider', 'stranger']) {
    await assertFails(getDoc(ref(uid)));
    await assertFails(getDocs(query(collection(db(uid), 'circles/space/calls'), where('calleeId', '==', 'bob'), where('status', '==', 'ringing'), limit(10))));
  }
  await assertFails(getDocs(collection(db('bob'), 'circles/space/calls')));
  await assertFails(getDocs(query(collection(db('bob'), 'circles/space/calls'), where('calleeId', '==', 'bob'), where('status', '==', 'ringing'), limit(10))));
  await assertFails(getDocs(incoming('bob', 11)));
  await assertFails(getDoc(doc(db('alice'), 'circles/other/calls/call')));
});

test('only the caller can create a valid ringing call between two current members', async () => {
  for (const uid of [null, 'bob', 'owner', 'outsider']) await assertFails(setDoc(ref(uid), ringing()));
  for (const fields of [{ calleeId: 'alice' }, { calleeId: 'outsider' }, { calleeId: 'missing' }, { mode: 'text' }, { status: 'accepted' }, { offer: description('offer') }, { answer: description('answer') },
    { callerName: '' }, { calleeName: 'x'.repeat(101) }, { extra: true }, { createdAt: Timestamp.fromMillis(0) }, { updatedAt: Timestamp.fromMillis(0) },
    { expiresAt: Timestamp.fromMillis(Date.now() + 10000) }, { expiresAt: Timestamp.fromMillis(Date.now() + 240000) }]) await assertFails(setDoc(ref('alice'), ringing(fields)));
  await assertFails(setDoc(doc(db('alice'), 'circles/other/calls/call'), ringing()));
  const missingOffer = ringing(); delete missingOffer.offer;
  await assertFails(setDoc(ref('alice'), missingOffer));
  await create();
});

test('media signaling is denied before the callee explicitly accepts', async () => {
  await create();
  await assertFails(updateDoc(ref('alice'), { offer: description('offer'), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('bob'), { answer: description('answer'), updatedAt: serverTimestamp() }));
  for (const uid of ['alice', 'bob']) await assertFails(setDoc(candidateRef(uid), ice(uid)));
  await assertFails(updateDoc(ref('bob'), acceptance({ offer: description('offer') })));
  await assertFails(updateDoc(ref('alice'), acceptance()));
  await assertFails(updateDoc(ref('owner'), acceptance()));
  await assertFails(updateDoc(ref('bob'), acceptance({ expiresAt: Timestamp.fromMillis(Date.now() + 60000) })));
  await assertSucceeds(updateDoc(ref('bob'), acceptance()));
  const call = (await getDoc(ref('alice'))).data(); assert.equal(call.status, 'accepted'); assert.equal(call.offer, null); assert.equal(call.answer, null);
});

test('roles, identity, mode and creation time cannot change during any call transition', async () => {
  await create();
  for (const fields of [{ callerId: 'owner' }, { calleeId: 'owner' }, { callerName: 'Pretend' }, { calleeName: 'Pretend' }, { mode: 'voice' }, { createdAt: Timestamp.fromMillis(0) }]) {
    await assertFails(updateDoc(ref('bob'), acceptance(fields)));
    await assertFails(updateDoc(ref('alice'), { ...fields, status: 'ended', updatedAt: serverTimestamp() }));
  }
  await assertSucceeds(updateDoc(ref('bob'), acceptance()));
  await assertFails(updateDoc(ref('alice'), { mode: 'voice', offer: description('offer'), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('bob'), acceptance()));
});

test('SDP is bounded, single-use and restricted to caller offer then callee answer', async () => {
  await accepted();
  await assertFails(updateDoc(ref('bob'), { offer: description('offer'), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('bob'), { answer: description('answer'), updatedAt: serverTimestamp() }));
  for (const offer of [{ type: 'answer', sdp: 'wrong role' }, { type: 'offer', sdp: '' }, { type: 'offer', sdp: 'x'.repeat(128001) }, { type: 'offer', sdp: 'ok', secret: true }]) await assertFails(updateDoc(ref('alice'), { offer, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('alice'), { offer: description('offer'), expiresAt: Timestamp.fromMillis(Date.now() + 7200000), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('alice'), { offer: { type: 'offer', sdp: 'x'.repeat(128000) }, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('alice'), { offer: description('offer'), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('alice'), { answer: description('answer'), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('bob'), { answer: { type: 'answer', sdp: 'x'.repeat(128001) }, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('bob'), { answer: description('answer'), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('bob'), { answer: description('answer'), updatedAt: serverTimestamp() }));
});

test('ICE is bounded, append-only and readable only by the two current participants', async () => {
  await accepted();
  await assertSucceeds(setDoc(candidateRef('alice'), ice('alice')));
  await assertSucceeds(setDoc(candidateRef('bob', 'bob-ice'), ice('bob', { sdpMid: null, sdpMLineIndex: null })));
  await assertSucceeds(setDoc(candidateRef('alice', 'bounded-ice'), ice('alice', { candidate: 'x'.repeat(4096), sdpMid: '0'.repeat(256), sdpMLineIndex: 64 })));
  await assertSucceeds(getDoc(candidateRef('bob')));
  assert.equal((await assertSucceeds(getDocs(query(collection(ref('bob'), 'candidates'), limit(150))))).size, 3);
  for (const uid of [null, 'owner', 'outsider']) {
    await assertFails(getDoc(candidateRef(uid)));
    await assertFails(getDocs(query(collection(ref(uid), 'candidates'), limit(150))));
    await assertFails(setDoc(candidateRef(uid, 'other'), ice(uid)));
  }
  for (const [index, fields] of [{ uid: 'bob' }, { candidate: '' }, { candidate: 'x'.repeat(4097) }, { sdpMid: 'x'.repeat(257) }, { sdpMLineIndex: -1 }, { sdpMLineIndex: 65 }, { sdpMLineIndex: .5 }, { createdAt: Timestamp.fromMillis(0) }, { extra: true }].entries()) await assertFails(setDoc(candidateRef('alice', `invalid-${index}`), ice('alice', fields)));
  await assertFails(updateDoc(candidateRef('alice'), { candidate: 'edited' }));
  await assertFails(deleteDoc(candidateRef('alice')));
  await assertFails(deleteDoc(ref('alice')));
});

test('callee alone may decline ringing; either participant may end; terminal states cannot reopen', async () => {
  await create();
  await assertFails(updateDoc(ref('owner'), { status: 'ended', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('alice'), { status: 'declined', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('bob'), { status: 'declined', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('bob'), acceptance()));
  await assertFails(updateDoc(ref('alice'), { status: 'ended', updatedAt: serverTimestamp() }));
  await seed(); await assertSucceeds(updateDoc(ref('bob'), { status: 'ended', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('bob'), acceptance()));
  await seed(); await assertSucceeds(updateDoc(ref('bob'), acceptance()));
  await assertFails(updateDoc(ref('bob'), { status: 'declined', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('alice'), { status: 'ended', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(candidateRef('bob'), ice('bob')));
  await assertFails(updateDoc(ref('alice'), { offer: description('offer'), updatedAt: serverTimestamp() }));
});

test('expired calls remain privately readable and endable while accept and all signaling stop', async () => {
  await seed({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  await assertSucceeds(getDoc(ref('bob'))); await assertSucceeds(getDocs(incoming('bob')));
  await assertFails(updateDoc(ref('bob'), acceptance()));
  await assertSucceeds(updateDoc(ref('alice'), { status: 'ended', updatedAt: serverTimestamp() }));
  await seed({ status: 'accepted', expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  await assertFails(updateDoc(ref('alice'), { offer: description('offer'), updatedAt: serverTimestamp() }));
  await assertFails(setDoc(candidateRef('bob'), ice('bob')));
  await seed({ status: 'accepted', offer: description('offer'), expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  await assertFails(updateDoc(ref('bob'), { answer: description('answer'), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('bob'), { status: 'ended', updatedAt: serverTimestamp() }));
});

test('either participant leaving immediately revokes call and ICE reads and signaling for both', async () => {
  for (const departing of ['alice', 'bob']) {
    await accepted(); await assertSucceeds(setDoc(candidateRef('alice'), ice('alice')));
    const leaving = db(departing), batch = writeBatch(leaving);
    batch.delete(doc(leaving, `circles/space/members/${departing}`));
    batch.set(doc(leaving, `users/${departing}`), { circleId: null });
    await assertSucceeds(batch.commit());
    await assertFails(getDocs(incoming('bob')));
    for (const uid of ['alice', 'bob']) {
      await assertFails(getDoc(ref(uid))); await assertFails(getDoc(candidateRef(uid)));
      await assertFails(getDocs(query(collection(ref(uid), 'candidates'), limit(150))));
      await assertFails(updateDoc(ref(uid), { status: 'ended', updatedAt: serverTimestamp() }));
      await assertFails(setDoc(candidateRef(uid, 'after-leave'), ice(uid)));
    }
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `circles/space/members/${departing}`), { uid: departing, name: departing, inviteCode: 'A'.repeat(32), joinedAt: Timestamp.now() });
      await deleteDoc(doc(context.firestore(), 'circles/space/calls/call'));
      await deleteDoc(doc(context.firestore(), 'circles/space/calls/call/candidates/ice'));
    });
  }
});

test('only the space owner may authorize requesters; members cannot promote themselves or alter another identity', async () => {
  const member = uid => doc(db(uid), 'circles/space/members/alice');
  for (const uid of ['alice', 'bob', 'outsider']) await assertFails(updateDoc(member(uid), { canRequestMedia: true }));
  await assertSucceeds(updateDoc(member('owner'), { canRequestMedia: true }));
  await assertSucceeds(updateDoc(member('alice'), { name: 'Alice updated' }));
  await assertFails(updateDoc(member('alice'), { canRequestMedia: false }));
  await assertFails(updateDoc(member('owner'), { name: 'Changed by someone else', canRequestMedia: false }));
  await assertFails(updateDoc(member('owner'), { canRequestMedia: 'yes' }));
  await assertSucceeds(updateDoc(member('owner'), { canRequestMedia: false }));
});

test('device requests require an authorized requester and matching microphone or camera mode', async () => {
  await assertFails(setDoc(ref('alice'), ringing({ access: 'front' })));
  await assertSucceeds(updateDoc(doc(db('owner'), 'circles/space/members/alice'), { canRequestMedia: true }));
  for (const access of ['front', 'back', 'microphone']) {
    await assertSucceeds(setDoc(ref('alice', access), ringing({ access, mode: access === 'microphone' ? 'voice' : 'video' })));
  }
  await assertSucceeds(setDoc(ref('owner', 'owner-request'), ringing({ callerId: 'owner', access: 'back' })));
  for (const fields of [{ access: 'hidden' }, { access: null }, { access: 'back', mode: 'voice' }, { access: 'microphone', mode: 'video' }, { access: 'front', status: 'accepted' }]) {
    await assertFails(setDoc(ref('alice', 'invalid'), ringing(fields)));
  }
});

test('approval is required for every device session and cannot be forged by an owner or requester', async () => {
  await assertSucceeds(updateDoc(doc(db('owner'), 'circles/space/members/alice'), { canRequestMedia: true }));
  await assertSucceeds(setDoc(ref('alice'), ringing({ access: 'back' })));
  for (const uid of ['owner', 'alice']) await assertFails(updateDoc(ref(uid), acceptance()));
  await assertFails(updateDoc(ref('alice'), { offer: description('offer'), updatedAt: serverTimestamp() }));
  await assertFails(setDoc(candidateRef('alice'), ice('alice')));
  await assertFails(updateDoc(ref('bob'), acceptance({ access: 'front' })));
  await assertSucceeds(updateDoc(ref('bob'), acceptance()));
  await assertSucceeds(updateDoc(ref('alice'), { offer: description('offer'), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('bob'), { answer: description('answer'), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('bob'), { access: 'front', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('alice'), { access: 'microphone', mode: 'voice', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref('bob'), { status: 'ended', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref('bob'), acceptance()));
  await assertSucceeds(setDoc(ref('alice', 'another'), ringing({ access: 'back' })));
  await assertFails(updateDoc(ref('alice', 'another'), { offer: description('offer'), updatedAt: serverTimestamp() }));
});

test('revoking requester authorization denies pending approvals and new media signaling but permits stopping', async () => {
  const role = doc(db('owner'), 'circles/space/members/alice');
  await assertSucceeds(updateDoc(role, { canRequestMedia: true }));
  await assertSucceeds(setDoc(ref('alice'), ringing({ access: 'front' })));
  await assertSucceeds(updateDoc(role, { canRequestMedia: false }));
  await assertFails(updateDoc(ref('bob'), acceptance()));
  await assertFails(setDoc(ref('alice', 'new'), ringing({ access: 'front' })));
  await assertSucceeds(updateDoc(ref('alice'), { status: 'ended', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(role, { canRequestMedia: true }));
  await assertSucceeds(setDoc(ref('alice', 'live'), ringing({ access: 'microphone', mode: 'voice' })));
  await assertSucceeds(updateDoc(ref('bob', 'live'), acceptance()));
  await assertSucceeds(updateDoc(role, { canRequestMedia: false }));
  await assertFails(updateDoc(ref('alice', 'live'), { offer: description('offer'), updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(ref('bob', 'live'), 'candidates/after-revocation'), ice('bob')));
  await assertSucceeds(updateDoc(ref('bob', 'live'), { status: 'ended', updatedAt: serverTimestamp() }));
});
