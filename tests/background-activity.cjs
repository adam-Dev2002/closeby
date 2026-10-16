const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

function service({ owner = 'alice', config, available = true, onPermission, environment = 'bare', expoGoConfig = null } = {}) {
  const tasks = new Map(), samples = [], positions = [], starts = [], stops = [];
  let current = config ?? { scope: 'alice', enabled: true, background: true, sessionId: 'session', liveSharing: true,
    shared: { uid: 'alice', spaceId: 'space', generation: 'A'.repeat(20) }, liveSpaceId: 'space', device: { ownerId: 'alice' } };
  let registered = false;
  const dependencies = {
    'expo-constants': { appOwnership: environment === 'storeClient' ? 'expo' : null, executionEnvironment: environment, expoGoConfig }, 'react-native': { Platform: { OS: 'android' } },
    '@react-native-async-storage/async-storage': { setItem: async () => {} },
    'expo-location': { Accuracy: { High: 4 }, getForegroundPermissionsAsync: async () => ({ granted: true }), getBackgroundPermissionsAsync: async () => ({ granted: false }), requestForegroundPermissionsAsync: async () => { throw Error('Existing foreground grant must be reused'); }, requestBackgroundPermissionsAsync: async () => { if (onPermission) current = onPermission(current); return { granted: true }; },
      hasStartedLocationUpdatesAsync: async () => registered, startLocationUpdatesAsync: async (name, options) => { starts.push({ name, options }); registered = true; }, stopLocationUpdatesAsync: async name => { stops.push(name); registered = false; } },
    'expo-task-manager': { isTaskDefined: name => tasks.has(name), defineTask: (name, task) => tasks.set(name, task), isAvailableAsync: async () => available },
    './activityCapture': { captureConfig: async () => current, configureCapture: async value => { current = value; }, captureFix: async value => samples.push(value), activityErrorKey: scope => scope + '/error' },
    '../lib/firebase': { firebaseAuth: { authStateReady: async () => {}, currentUser: owner ? { uid: owner } : null } },
    './circles': { publishDevice: async (space, uid, device) => positions.push({ space, uid, device }) },
    '../lib/activity': { validActivityFix: fix => Boolean(fix && Number.isFinite(fix.latitude)) },
  };
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync('src/services/backgroundTracking.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require: name => dependencies[name] });
  return { api: module.exports, tasks, samples, positions, starts, stops, current: () => current };
}
const location = { timestamp: Date.now(), coords: { latitude: 14.55, longitude: 121.02, accuracy: 5, speed: 0, heading: null } };
test('background task is registered at module scope and records updates without a mounted screen', async () => {
  const model = service();
  assert.equal(model.tasks.size, 1);
  await model.tasks.get(model.api.BACKGROUND_LOCATION_TASK)({ data: { locations: [location] } });
  assert.equal(model.samples.length, 1); assert.equal(model.positions.length, 1);
});
test('background service has a visible notification, indicator, and stops on app termination', async () => {
  const model = service(); await model.api.startBackgroundTracking();
  assert.equal(model.starts[0].options.showsBackgroundLocationIndicator, true);
  assert.equal(model.starts[0].options.foregroundService.killServiceOnDestroy, true);
  assert.match(model.starts[0].options.foregroundService.notificationTitle, /recording/);
});
test('a persisted stop prevents later headless samples and shuts down the location task', async () => {
  const model = service(); await model.api.startBackgroundTracking(); await model.api.stopAllActivity();
  assert.equal(model.current(), null); assert.equal(model.stops.length, 1);
  await model.api.processBackgroundLocations([location]); assert.equal(model.samples.length, 0); assert.equal(model.positions.length, 0);
});
test('an account mismatch stops background capture instead of recording for the previous account', async () => {
  const model = service({ owner: 'bob' }); await model.api.processBackgroundLocations([location]);
  assert.equal(model.current(), null); assert.equal(model.samples.length, 0); assert.equal(model.positions.length, 0);
});
test('an unavailable native task manager rejects background setup', async () => {
  const model = service({ available: false }); await assert.rejects(model.api.startBackgroundTracking(), /native development build/);
  assert.equal(model.starts.length, 0);
});
test('development manifest metadata does not disable native background recording, while Expo Go remains unavailable', async () => {
  const native = service({ expoGoConfig: { debuggerHost: 'localhost:8081' } });
  assert.equal(native.api.backgroundSupported(), true);
  await native.api.startBackgroundTracking(); assert.equal(native.starts.length, 1);
  const expoGo = service({ environment: 'storeClient', expoGoConfig: {} });
  assert.equal(expoGo.api.backgroundSupported(), false);
  await assert.rejects(expoGo.api.startBackgroundTracking(), /native development build/);
  assert.equal(expoGo.starts.length, 0);
});
test('batched history retains older fixes but publishes only the newest fresh live position', async () => {
  const model = service();
  await model.api.processBackgroundLocations([{ ...location, timestamp: Date.now() - 300000 }, { ...location, timestamp: Date.now() }]);
  assert.equal(model.samples.length, 2); assert.equal(model.positions.length, 1);
  assert.equal(model.positions[0].device.location.timestamp, model.samples[1].timestamp);
  const stale = service(); await stale.api.processBackgroundLocations([{ ...location, timestamp: Date.now() - 300000 }]);
  assert.equal(stale.samples.length, 1); assert.equal(stale.positions.length, 0);
});
test('changing accounts during the permission request cancels the original background start', async () => {
  const model = service({ onPermission: config => ({ ...config, scope: 'bob', sessionId: 'bob-session' }) });
  await assert.rejects(model.api.startBackgroundTracking({ scope: 'alice', sessionId: 'session' }), /account or recording session changed/);
  assert.equal(model.starts.length, 0);
});
