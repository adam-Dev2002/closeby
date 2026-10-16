const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
function load(file, dependencies, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, setTimeout, clearTimeout, ...globals, require: name => { if (name in dependencies) return dependencies[name]; throw Error('Unexpected dependency: ' + name); } });
  return module.exports;
}
const BASE = Date.now() - 1000000;
function harness() {
  const storage = new Map(), delivered = [], attempts = [], published = [], native = { running: false, starts: 0, stops: 0, queries: 0, failDelivery: false, queryFailure: false, queryWait: null };
  let now = BASE;
  class Clock extends Date { static now() { return now; } }
  const pure = load('src/lib/placePresence.ts', {}, { Date: Clock });
  const appState = { currentState: 'background' };
  const auth = { currentUser: { uid: 'owner' }, authStateReady: async () => {} };
  const fix = latitude => ({ latitude, longitude: 121.02, timestamp: now, accuracy: 5, speed: 0, heading: null });
  let member = { id: 'family', ownerId: 'family', name: 'Sam', sharing: true, batteryLevel: .5, location: fix(14.552) };
  const notifications = { AndroidImportance: { HIGH: 4 }, setNotificationHandler() {}, setNotificationChannelAsync: async () => {}, requestPermissionsAsync: async () => ({ granted: true }),
    scheduleNotificationAsync: async request => { attempts.push(request); if (native.failDelivery) throw Error('Temporary notification error'); delivered.push(request); return request.identifier; } };
  const api = load('src/services/arrivalMonitoring.ts', {
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => storage.set(key, value), removeItem: async key => storage.delete(key), multiSet: async values => values.forEach(([key, value]) => storage.set(key, value)) } },
    'react-native': { AppState: appState, Platform: { OS: 'android' } }, 'expo-modules-core': { requireOptionalNativeModule: () => ({}) },
    'expo-constants': { __esModule: true, default: { executionEnvironment: 'bare' } },
    'expo-location': { Accuracy: { Balanced: 3, High: 4 }, hasStartedLocationUpdatesAsync: async () => native.running, stopLocationUpdatesAsync: async () => { native.running = false; native.stops++; },
      getForegroundPermissionsAsync: async () => ({ granted: true }), getBackgroundPermissionsAsync: async () => ({ granted: true }),
      requestForegroundPermissionsAsync: async () => { throw Error('Existing GPS grant must be reused'); }, requestBackgroundPermissionsAsync: async () => { throw Error('Existing background grant must be reused'); }, startLocationUpdatesAsync: async () => { native.running = true; native.starts++; } },
    'expo-task-manager': { isTaskDefined: () => false, defineTask() {} },
    'expo-battery': { isAvailableAsync: async () => true, getBatteryLevelAsync: async () => .92 },
    'firebase/firestore': { collection: (_db, ...path) => path, getDocsFromServer: async () => { native.queries++; if (native.queryWait) await native.queryWait; if (native.queryFailure) throw Error('Offline'); return { docs: [{ id: member.id, data: () => member }] }; } },
    '../lib/firebase': { firebaseAuth: auth, requireFirestore: () => ({}) }, '../lib/placePresence': pure,
    './circles': { publishDevice: async (...args) => published.push(args) }, 'expo-notifications': notifications,
    './notificationRuntime': { notificationApi: async () => notifications },
  }, { Date: Clock });
  const zone = { id: 'home', name: 'Home', coordinate: { latitude: 14.55, longitude: 121.02 }, radius: 100, color: '#1186FF', enabled: true };
  const own = { id: 'owner', ownerId: 'owner', name: 'My phone', sharing: false, batteryLevel: .5, location: null, photoURL: null, platform: 'android', lastSeen: 0 };
  const config = { scope: 'owner', enabled: true, alerts: true, generation: 'consent-1', zones: [zone], ownDevice: own, spaceId: 'space', sharing: false };
  return { api, storage, delivered, attempts, published, native, auth, appState, config,
    at(seconds, memberLatitude = 14.552, sharing = true) { now = BASE + seconds * 1000; member = { ...member, sharing, location: fix(memberLatitude) }; },
    async process(latitude = 14.552) { const value = fix(latitude); await api.processArrivalLocations([{ timestamp: value.timestamp, coords: value }]); } };
}

test('family arrivals notify in the background once, using the observed arrival time and existing sharing', async () => {
  const h = harness(); await h.api.configureArrivalMonitor(h.config);
  h.at(0); await h.process(); h.at(60, 14.55); await h.process(); h.at(120, 14.55); await h.process();
  assert.equal(h.delivered.length, 1); assert.equal(h.delivered[0].content.title, 'Sam arrived at Home');
  assert.match(h.delivered[0].identifier, new RegExp(String(BASE + 60000)));
  assert.equal(h.published.length, 0, 'receiving alerts does not turn on the recipient location sharing');
  h.at(180, 14.55); await h.process(); assert.equal(h.delivered.length, 1);
});
test('foreground and paused sharing cannot create duplicate phone notifications', async () => {
  const h = harness(); await h.api.configureArrivalMonitor(h.config);
  h.appState.currentState = 'active'; await h.process(); assert.equal(h.native.queries, 0);
  h.appState.currentState = 'background'; h.at(0); await h.process(); h.at(60, 14.55, false); await h.process(); h.at(120, 14.55, false); await h.process();
  assert.equal(h.delivered.length, 0);
});
test('stopping monitoring while a family query is in flight revokes notification consent', async () => {
  const h = harness(); await h.api.configureArrivalMonitor(h.config);
  h.at(0); await h.process(); h.at(60, 14.55); await h.process();
  let release; h.native.queryWait = new Promise(resolve => release = resolve);
  h.at(120, 14.55); const pending = h.process();
  for (let i = 0; i < 100 && h.native.queries < 3; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.native.queries, 3, 'the family refresh must be in flight before stopping');
  await h.api.stopArrivalMonitor(); release(); await pending;
  assert.equal(await h.api.arrivalMonitorConfig(), null); assert.equal(h.delivered.length, 0);
});
test('temporary notification failures are retried with the same identifier', async () => {
  const h = harness(); await h.api.configureArrivalMonitor(h.config);
  h.at(0); await h.process(); h.at(60, 14.55); await h.process();
  h.native.failDelivery = true; h.at(120, 14.55); await assert.rejects(() => h.process(), /Temporary/);
  assert.equal(h.attempts.length, 1);
  h.native.failDelivery = false; h.at(180, 14.55); await h.process();
  assert.equal(h.delivered.length, 1); assert.equal(h.attempts[0].identifier, h.attempts[1].identifier);
  h.at(240, 14.55); await h.process(); assert.equal(h.delivered.length, 1);
});
test('a failed family refresh keeps own-place notifications functional without inventing a family arrival', async () => {
  const h = harness(); await h.api.configureArrivalMonitor(h.config); h.native.queryFailure = true;
  h.at(0); await h.process(); h.at(60); await h.process(14.55); h.at(120); await h.process(14.55);
  assert.equal(h.delivered.length, 1); assert.equal(h.delivered[0].content.title, 'You arrived at Home');
  assert(h.storage.get(h.api.arrivalErrorKey('owner')).includes('Family updates'));
});
test('account changes shut down the previous user’s background monitoring', async () => {
  const h = harness(); await h.api.configureArrivalMonitor(h.config); h.auth.currentUser.uid = 'another-user';
  await h.process(); assert.equal(await h.api.arrivalMonitorConfig(), null); assert.equal(h.native.queries, 0); assert.equal(h.delivered.length, 0);
});
test('native monitoring starts only after explicit configuration and persists no raw own location', async () => {
  const h = harness(); assert.equal(h.native.starts, 0);
  await h.api.startArrivalMonitor(h.config); assert.equal(h.native.starts, 1);
  assert.equal((await h.api.arrivalMonitorConfig()).ownDevice.location, null);
  await h.api.stopArrivalMonitor(); assert.equal(h.native.running, false);
  await assert.rejects(() => h.api.startArrivalMonitor({ ...h.config, zones: [] }), /Save a safe place/);
});
