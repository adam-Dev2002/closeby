const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/firebase.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function initialize({ development = true, project = 'demo-closeby', host, failure, configured = true } = {}) {
  const calls = [];
  const app = { name: '[DEFAULT]' };
  const auth = { kind: 'auth' };
  const database = { kind: 'firestore' };
  const track = (name, result) => (...args) => { calls.push({ name, args }); return result; };
  const connect = name => (...args) => {
    calls.push({ name, args });
    if (failure === name) throw new Error(`${name} connection failed`);
  };
  const appSdk = {
    getApps: track('getApps', []), getApp: track('getApp', app), initializeApp: track('initializeApp', app),
  };
  const authSdk = { getAuth: track('getAuth', auth), connectAuthEmulator: connect('connectAuthEmulator') };
  const firestoreSdk = {
    getFirestore: track('getFirestore', database), connectFirestoreEmulator: connect('connectFirestoreEmulator'),
  };
  const env = configured ? {
    EXPO_PUBLIC_FIREBASE_API_KEY: 'test-public-api-key',
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: project,
    EXPO_PUBLIC_FIREBASE_APP_ID: 'test-app-id',
  } : {};
  if (host !== undefined) env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST = host;
  const dependencies = {
    '@react-native-async-storage/async-storage': {},
    'firebase/app': appSdk, 'firebase/auth': authSdk, 'firebase/firestore': firestoreSdk,
    'react-native': { Platform: { OS: 'web' } },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, __DEV__: development, process: { env }, Error,
    require: name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { api: module.exports, calls, app, auth, database };
}

function ready(result) {
  assert.equal(result.api.firebaseApp, result.app);
  assert.equal(result.api.firebaseAuth, result.auth);
  assert.equal(result.api.firestore, result.database);
  assert.equal(result.api.firebaseInitializationError, null);
  assert.equal(result.api.requireFirebaseAuth(), result.auth);
  assert.equal(result.api.requireFirestore(), result.database);
}

function unavailable(result, message) {
  assert.equal(result.api.firebaseApp, null);
  assert.equal(result.api.firebaseAuth, null);
  assert.equal(result.api.firestore, null);
  assert.match(result.api.firebaseInitializationError, message);
  assert.throws(() => result.api.requireFirebaseAuth(), message);
  assert.throws(() => result.api.requireFirestore(), message);
}

test('a configured cloud project initializes normally without emulator configuration', () => {
  const result = initialize({ development: false, project: 'closeby-cloud-project' });
  ready(result);
  assert.equal(result.api.isFirebaseConfigured, true);
  assert.equal(result.calls.some(call => call.name === 'initializeApp'), true);
  assert.equal(result.calls.some(call => call.name.endsWith('Emulator')), false);
});

for (const host of ['127.0.0.1', 'localhost', '10.0.2.2']) {
  test(`a development demo project connects its public handles to local emulators at ${host}`, () => {
    const result = initialize({ host });
    ready(result);
    const authCall = result.calls.find(call => call.name === 'connectAuthEmulator');
    const firestoreCall = result.calls.find(call => call.name === 'connectFirestoreEmulator');
    assert.equal(authCall.args[0], result.api.firebaseAuth);
    assert.equal(authCall.args[1], `http://${host}:9099`);
    assert.equal(firestoreCall.args[0], result.api.firestore);
    assert.equal(firestoreCall.args[1], host);
    assert.equal(firestoreCall.args[2], 8080);
  });
}

for (const [description, options] of [
  ['a production build', { development: false, host: '127.0.0.1' }],
  ['a cloud project', { project: 'closeby-cloud-project', host: '127.0.0.1' }],
  ['a remote host', { host: 'firebase.example.com' }],
]) {
  test(`emulator settings for ${description} fail before any Firebase SDK access`, () => {
    const result = initialize(options);
    assert.equal(result.api.isFirebaseConfigured, true);
    unavailable(result, /development build, a demo- project, and a loopback emulator host/);
    assert.equal(result.calls.length, 0);
  });
}

for (const failure of ['connectAuthEmulator', 'connectFirestoreEmulator']) {
  test(`a partial ${failure} failure exposes no usable app, auth or database handles`, () => {
    const result = initialize({ host: '127.0.0.1', failure });
    unavailable(result, new RegExp(`${failure} connection failed`));
    assert.equal(result.calls.some(call => call.name === 'getAuth'), true);
    assert.equal(result.calls.some(call => call.name === 'getFirestore'), true);
    if (failure === 'connectAuthEmulator') {
      assert.equal(result.calls.some(call => call.name === 'connectFirestoreEmulator'), false);
    }
  });
}

test('an unconfigured app keeps Firebase unavailable without invoking its SDK', () => {
  const result = initialize({ configured: false });
  assert.equal(result.api.isFirebaseConfigured, false);
  assert.equal(result.api.firebaseApp, null);
  assert.equal(result.api.firebaseAuth, null);
  assert.equal(result.api.firestore, null);
  assert.equal(result.api.firebaseInitializationError, null);
  assert.throws(() => result.api.requireFirebaseAuth(), /Connect your Firebase project first/);
  assert.throws(() => result.api.requireFirestore(), /Connect your Firebase project first/);
  assert.equal(result.calls.length, 0);
});
