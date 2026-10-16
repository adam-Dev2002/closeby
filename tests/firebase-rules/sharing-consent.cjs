const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../node_modules/typescript');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function service({ profile, pause } = {}) {
  const writes = [];
  const firestore = {
    doc: (_db, ...parts) => parts.join('/'),
    getDocFromServer: () => profile || Promise.resolve({ data: () => ({ circleId: 'family' }) }),
    serverTimestamp: () => 'server-time',
    updateDoc: (_ref, value) => { writes.push({ kind: 'pause', value }); return pause || Promise.resolve(); },
    setDoc: (_ref, value) => { writes.push({ kind: 'publish', value }); return Promise.resolve(); },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../src/services/circles.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, setTimeout, clearTimeout,
    require: (name) => {
      if (name === 'firebase/firestore') return firestore;
      if (name === '../lib/firebase') return { firebaseAuth: { currentUser: { uid: 'alice' } }, requireFirestore: () => ({}) };
      if (name === 'expo-crypto') return {};
      if (name === '../lib/invitations') return {};
      if (name === './activityHistory') return { stopHistoryUploads() {} };
      if (name === '../lib/profileIdentity') return { profileIdentity: user => ({ displayName: user?.displayName || null, photoURL: user?.photoURL || null }) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { api: module.exports, writes };
}

const device = {
  id: 'phone', ownerId: 'alice', name: 'My phone', platform: 'android', photoURL: null,
  batteryLevel: 0.9, sharing: true, lastSeen: Date.now(),
  location: { latitude: 14.55, longitude: 121.02, accuracy: 5, speed: null, heading: null, timestamp: Date.now() },
};

test('a slow older stop lookup cannot erase coordinates after explicit sharing resume', async () => {
  const lookup = deferred();
  const { api, writes } = service({ profile: lookup.promise });
  const stopping = api.stopSharing('alice');
  api.beginCircleSession('alice');
  await api.publishDevice('family', 'alice', device, true);
  lookup.resolve({ data: () => ({ circleId: 'family' }) });
  assert.equal(await stopping, false);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].kind, 'publish');
  assert.equal(writes[0].value.location.latitude, 14.55);
});

test('a previously queued pause precedes a newer publish and supersedes the old stop result', async () => {
  const acknowledgement = deferred();
  const { api, writes } = service({ pause: acknowledgement.promise });
  const stopping = api.stopSharing('alice');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(writes[0]?.kind, 'pause');
  api.beginCircleSession('alice');
  await api.publishDevice('family', 'alice', device, true);
  assert.deepEqual(writes.map((write) => write.kind), ['pause', 'publish']);
  acknowledgement.resolve();
  assert.equal(await stopping, false);
});

test('stopping prevents future uploads until explicit sharing resume', async () => {
  const { api, writes } = service();
  assert.equal(await api.stopSharing('alice'), true);
  await api.publishDevice('family', 'alice', device, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value.location, null);
  api.beginCircleSession('alice');
  await api.publishDevice('family', 'alice', device, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].value.sharing, true);
  assert.equal(writes[1].value.ownerId, 'alice');
});
