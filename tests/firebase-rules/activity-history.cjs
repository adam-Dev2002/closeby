const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../node_modules/typescript');
const { createRequire } = require('node:module');
const testRequire = createRequire(path.resolve('.verification/firebase/package.json'));
const { initializeTestEnvironment, assertSucceeds, assertFails } = testRequire('@firebase/rules-unit-testing');
const { collection, doc, getDoc, getDocs, limit, query, where, orderBy, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, writeBatch } = testRequire('firebase/firestore');
let environment;
const db = uid => uid ? environment.authenticatedContext(uid).firestore() : environment.unauthenticatedContext().firestore();
const generation = 'A'.repeat(20);
const samplePath = 'circles/space/activity/alice/samples/point';
function sample(overrides = {}) {
  const timestamp = Date.now();
  return { id: 'point', sessionId: 'session', fix: { latitude: 14.55, longitude: 121.02, accuracy: 5, speed: 0, heading: null, timestamp }, place: 'Home', distanceMeters: 0, generation,
    capturedAt: timestamp, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(timestamp + 30 * 86400000), ...overrides };
}
before(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  environment = await initializeTestEnvironment({ projectId: 'demo-closeby', firestore: { host, port: Number(port), rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.firestore(), batch = writeBatch(database);
    batch.set(doc(database, 'circles/space'), { ownerId: 'alice', name: 'Space' });
    for (const uid of ['alice', 'bob']) { batch.set(doc(database, `users/${uid}`), { circleId: 'space' }); batch.set(doc(database, `circles/space/members/${uid}`), { uid }); }
    batch.set(doc(database, 'circles/other/members/outsider'), { uid: 'outsider' });
    batch.set(doc(database, 'circles/space/historyConsent/alice'), { enabled: true, generation, startedAt: Timestamp.fromMillis(Date.now() - 1000), updatedAt: serverTimestamp() });
    batch.set(doc(database, 'circles/space/devices/alice'), { sharing: true });
    await batch.commit();
  });
});
after(async () => { await environment.cleanup(); });

test('history needs owner consent and current membership for shared readers', async () => {
  await assertSucceeds(setDoc(doc(db('alice'), samplePath), sample()));
  await assertSucceeds(getDoc(doc(db('bob'), samplePath)));
  await assertFails(getDoc(doc(db('outsider'), samplePath)));
  await assertFails(getDoc(doc(db(null), samplePath)));
  await assertFails(setDoc(doc(db('bob'), samplePath), sample()));
});
test('shared day queries prove the consent generation and use a bounded limit', async () => {
  await assertSucceeds(setDoc(doc(db('alice'), samplePath), sample()));
  const ref = collection(db('bob'), 'circles/space/activity/alice/samples');
  const result = await assertSucceeds(getDocs(query(ref, where('generation', '==', generation), where('capturedAt', '>=', Date.now() - 86400000), orderBy('capturedAt'), limit(3000))));
  assert.equal(result.size, 1);
  await assertFails(getDocs(query(ref, limit(3000))));
  await assertFails(getDocs(query(ref, where('generation', '==', generation), limit(3001))));
});
test('turning history sharing off blocks reads and additional uploads while retaining owner access', async () => {
  await assertSucceeds(setDoc(doc(db('alice'), samplePath), sample()));
  await assertSucceeds(updateDoc(doc(db('alice'), 'circles/space/historyConsent/alice'), { enabled: false, updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(db('bob'), samplePath)));
  await assertSucceeds(getDoc(doc(db('alice'), samplePath)));
  await assertFails(setDoc(doc(db('alice'), 'circles/space/activity/alice/samples/next'), sample({ id: 'next' })));
});
test('a new opt-in generation cannot expose the previous shared history', async () => {
  await assertSucceeds(setDoc(doc(db('alice'), samplePath), sample()));
  await assertSucceeds(updateDoc(doc(db('alice'), 'circles/space/historyConsent/alice'), { generation: 'B'.repeat(20), startedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(db('bob'), samplePath)));
});
test('native batches can publish recorded history after consent while expired history is rejected', async () => {
  const old = Date.now() - 300000;
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'circles/space/historyConsent/alice'), { startedAt: Timestamp.fromMillis(Date.now() - 31 * 86400000) }));
  await assertSucceeds(setDoc(doc(db('alice'), samplePath), sample({ capturedAt: old, fix: { ...sample().fix, timestamp: old }, expiresAt: Timestamp.fromMillis(old + 30 * 86400000) })));
  const expired = Date.now() - 31 * 86400000;
  await assertFails(setDoc(doc(db('alice'), 'circles/space/activity/alice/samples/expired'), sample({ id: 'expired', capturedAt: expired, fix: { ...sample().fix, timestamp: expired }, expiresAt: Timestamp.fromMillis(expired + 30 * 86400000) })));
});
test('live sharing paused, pre-consent points, inaccurate fixes, and extra payload fields are rejected', async () => {
  await assertFails(setDoc(doc(db('alice'), samplePath), sample({ hiddenCoordinate: 1 })));
  await assertFails(setDoc(doc(db('alice'), samplePath), sample({ fix: { ...sample().fix, accuracy: 100 } })));
  const old = Date.now() - 10000;
  await assertFails(setDoc(doc(db('alice'), samplePath), sample({ capturedAt: old, fix: { ...sample().fix, timestamp: old }, expiresAt: Timestamp.fromMillis(old + 30 * 86400000) })));
  await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), 'circles/space/devices/alice'), { sharing: false }));
  await assertFails(setDoc(doc(db('alice'), samplePath), sample()));
});
test('a removed viewer or recorder loses shared-history access', async () => {
  await assertSucceeds(setDoc(doc(db('alice'), samplePath), sample()));
  await environment.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), 'circles/space/members/bob')));
  await assertFails(getDoc(doc(db('bob'), samplePath)));
  await environment.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'circles/space/members/bob'), { uid: 'bob' }); await deleteDoc(doc(context.firestore(), 'circles/space/members/alice')); });
  await assertFails(getDoc(doc(db('bob'), samplePath)));
});
test('members cannot enable another person history or edit immutable samples', async () => {
  await assertFails(updateDoc(doc(db('bob'), 'circles/space/historyConsent/alice'), { enabled: true, startedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(db('alice'), samplePath), sample()));
  await assertFails(updateDoc(doc(db('alice'), samplePath), { place: 'Somewhere else' }));
  await assertFails(deleteDoc(doc(db('bob'), samplePath)));
  await assertSucceeds(deleteDoc(doc(db('alice'), samplePath)));
});

test('the real publisher is idempotent and local pause stops further uploads', async () => {
  const module = { exports: {} }, auth = { currentUser: { uid: 'alice' } };
  const activityModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/activity.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: activityModule, exports: activityModule.exports });
  const activity = activityModule.exports;
  const output = ts.transpileModule(fs.readFileSync('src/services/activityHistory.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInThisContext('(function(module,exports,require){' + output + '\n})')(module, module.exports,
    name => name === 'firebase/firestore' ? testRequire(name) : name === '../lib/firebase' ? { firebaseAuth: auth, requireFirestore: () => db('alice') } : activity);
  const publisher = module.exports, record = sample();
  const input = { id: 'point', sessionId: record.sessionId, fix: record.fix, place: record.place, distanceMeters: record.distanceMeters };
  await publisher.publishActivity('space', 'alice', generation, input);
  await publisher.publishActivity('space', 'alice', generation, input);
  assert.equal((await getDocs(query(collection(db('alice'), 'circles/space/activity/alice/samples'), limit(3000)))).size, 1);
  publisher.stopHistoryUploads('alice');
  await publisher.publishActivity('space', 'alice', generation, { ...input, id: 'second' });
  assert.equal((await getDoc(doc(db('alice'), 'circles/space/activity/alice/samples/second'))).exists(), false);
});
