const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');
const ts = require('../../node_modules/typescript');
const testRequire = createRequire(path.resolve('.verification/firebase/package.json'));
const { initializeTestEnvironment, assertFails } = testRequire('@firebase/rules-unit-testing');
const firestore = testRequire('firebase/firestore');
const { doc, getDoc, setDoc, getDocs, collection, serverTimestamp, Timestamp, writeBatch, setLogLevel } = firestore;
assert(process.env.FIRESTORE_EMULATOR_HOST, 'Use the isolated demo-closeby Firestore emulator');
setLogLevel('silent');
let environment;
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const factory = vm.runInThisContext(`(function(module, exports, require) {\n${source}\n})`, { filename: file });
  factory(module, module.exports, name => { assert(Object.hasOwn(dependencies, name), name); return dependencies[name]; });
  return module.exports;
}
const invitations = load('src/lib/invitations.ts');
const identity = load('src/lib/profileIdentity.ts');
const database = uid => environment.authenticatedContext(uid).firestore();
function service(uid) {
  return load('src/services/circles.ts', {
    'expo-crypto': { getRandomBytesAsync: async count => new Uint8Array(randomBytes(count)) },
    'firebase/firestore': firestore, '../lib/firebase': { firebaseAuth: { currentUser: { uid, displayName: uid } }, requireFirestore: () => database(uid) },
    '../lib/profileIdentity': identity, '../lib/invitations': invitations, './activityHistory': { stopHistoryUploads() {} },
  });
}
async function create() {
  await service('owner').createCircle('Local invitation test');
  const profile = await getDoc(doc(database('owner'), 'users/owner'));
  const spaceId = profile.data().circleId;
  const record = await getDoc(doc(database('owner'), 'circles', spaceId));
  return { spaceId, code: record.data().inviteCode };
}
before(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  environment = await initializeTestEnvironment({ projectId: 'demo-closeby', firestore: { host, port: Number(port), rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await environment.clearFirestore(); });
after(async () => { await environment?.cleanup(); });

test('actual services create short invitations and join from a full shared link without enabling location', async () => {
  const { code, spaceId } = await create(); assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);
  await assertFails(getDoc(doc(database('member'), 'circles', spaceId)));
  await service('member').joinCircle(invitations.invitationLink(code));
  assert.equal((await getDoc(doc(database('member'), 'users/member'))).data().circleId, spaceId);
  assert.equal((await getDoc(doc(database('member'), 'circles', spaceId))).data().name, 'Local invitation test');
  assert.equal((await getDocs(collection(database('member'), 'circles', spaceId, 'devices'))).size, 0);
});

test('renewal invalidates the previous short code and preserves members', async () => {
  const { code, spaceId } = await create();
  await service('member').joinCircle(invitations.formatInvitationCode(code).toLowerCase());
  await service('owner').renewInvitation(spaceId);
  const renewed = (await getDoc(doc(database('owner'), 'circles', spaceId))).data().inviteCode;
  assert.notEqual(renewed, code); assert.match(renewed, /^[A-HJ-NP-Z2-9]{12}$/);
  await assert.rejects(service('outsider').joinCircle(code), /does not exist/);
  assert((await getDoc(doc(database('member'), 'circles', spaceId, 'members/member'))).exists());
  await service('outsider').joinCircle(renewed);
});

test('legacy invitation links still join, and existing membership cannot be silently switched', async () => {
  const code = 'A'.repeat(32), db = database('owner'), batch = writeBatch(db);
  batch.set(doc(db, 'circles/legacy'), { ownerId: 'owner', name: 'Legacy', inviteCode: code, createdAt: serverTimestamp() });
  batch.set(doc(db, 'circles/legacy/members/owner'), { uid: 'owner', inviteCode: code, joinedAt: serverTimestamp() });
  batch.set(doc(db, 'users/owner'), { circleId: 'legacy' });
  batch.set(doc(db, 'invitations', code), { circleId: 'legacy', ownerId: 'owner', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 3600000) });
  await batch.commit();
  await service('member').joinCircle(invitations.invitationLink(code));
  await assert.rejects(service('member').joinCircle(code), /Leave your current circle/);
});

test('short codes cannot bypass expiry, owner-only renewal, or invitation listing restrictions', async () => {
  const { code, spaceId } = await create();
  await assertFails(getDocs(collection(database('outsider'), 'invitations')));
  await assert.rejects(service('outsider').renewInvitation(spaceId));
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'invitations', code), { circleId: spaceId, ownerId: 'owner', createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() - 1000) }));
  await assert.rejects(service('member').joinCircle(code), /expired/);
  for (const invalid of ['123456', 'ABCD2345WXIO', 'A'.repeat(11), 'A'.repeat(13)]) {
    await assertFails(setDoc(doc(database('owner'), 'invitations', invalid), { circleId: spaceId, ownerId: 'owner', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 3600000) }));
  }
});
