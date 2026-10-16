const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
function load(file, dependencies = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, URL, setTimeout, clearTimeout, require: name => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw Error(name); }, ...globals });
  return module.exports;
}
const api = load('src/lib/activity.ts');
const BASE = Date.now() - 600000;
const fix = (seconds, latitude = 14.55, accuracy = 5) => ({ latitude, longitude: 121.02, accuracy, speed: 0, heading: null, timestamp: BASE + seconds * 1000 });
const sample = (seconds, latitude = 14.55, sessionId = 'first', place = null) => ({ id: `p${seconds}`, sessionId, fix: fix(seconds, latitude), place, distanceMeters: 0 });

test('daily activity has a confirmed stop, observed arrival/departure, and movement', () => {
  const result = api.activityTimeline([sample(0, 14.55, 'first', 'Home'), sample(60, 14.55001, 'first', 'Home'), sample(120, 14.55, 'first', 'Home'), sample(180, 14.552), sample(240, 14.553)]);
  const stop = result.entries.find(item => item.kind === 'stop');
  assert.equal(stop.place, 'Home'); assert.equal(stop.startedAt, BASE); assert.equal(stop.endedAt, BASE + 120000); assert.equal(stop.departed, true);
  assert(result.distanceMeters > 300 && result.distanceMeters < 400);
  assert.equal(result.observedMs, 240000); assert.equal(result.stoppedMs, 120000);
});
test('a stop at the end does not invent a departure or double-count movement', () => {
  const result = api.activityTimeline([sample(0), sample(60), sample(120)]);
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].departed, false); assert.equal(result.distanceMeters, 0);
});
test('session changes and GPS gaps do not draw routes or distance between segments', () => {
  const result = api.activityTimeline([sample(0), sample(30, 14.551), sample(60, 14.6, 'second'), sample(90, 14.601, 'second'), sample(400, 14.7, 'second')]);
  assert.equal(result.routes.length, 3); assert.equal(result.entries.filter(item => item.kind === 'gap').length, 2);
  assert(result.distanceMeters < 250); assert.equal(result.observedMs, 60000);
});
test('GPS jitter, impossible jumps, duplicate timestamps, and uncertain samples do not inflate travel', () => {
  const result = api.activityTimeline([sample(0), sample(30, 14.55001), sample(30, 14.55002), sample(60, 35), { ...sample(90), fix: fix(90, 14.55, 200) }]);
  assert.equal(result.distanceMeters, 0); assert.equal(result.routes.length, 2); assert.equal(result.routes.flat().length, 3);
});
test('date ranges use local calendar boundaries and expose 30 dates', () => {
  const key = api.dateKey(); const range = api.dayRange(key);
  assert.equal(api.dateKey(range.start), key); assert.notEqual(api.dateKey(range.end), key);
  assert.equal(api.recentDays().length, 30);
});
test('a saved zone is named only when GPS uncertainty is completely inside it', () => {
  const point = fix(0);
  assert.equal(api.placeAt(point, [{ name: 'Home', coordinate: point, radius: 100, enabled: true }]), 'Home');
  assert.equal(api.placeAt({ ...point, accuracy: 80 }, [{ name: 'Home', coordinate: point, radius: 50, enabled: true }]), null);
});

test('automatic capture survives headless reload, suppresses duplicates, and respects a persisted stop', async () => {
  const storage = new Map();
  const asyncStorage = { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); }, removeItem: async key => storage.delete(key),
    multiSet: async entries => entries.forEach(([key, value]) => storage.set(key, value)), multiRemove: async keys => keys.forEach(key => storage.delete(key)) };
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const dependencies = { '@react-native-async-storage/async-storage': asyncStorage, '../lib/uuid': { randomUuid: () => 'session' }, '../lib/activity': api,
    '../lib/firebase': { firebaseAuth: null }, './activityHistory': { publishActivity: async () => { throw Error('Private history must not upload'); } } };
  function engine() { return load('src/services/activityCapture.ts', dependencies, { Date: Clock }); }
  const recorder = engine(), config = { scope: 'local-device', enabled: true, enabledAt: now - 1, sessionId: 'session', background: true, zones: [], shared: null, device: null, liveSharing: false, liveSpaceId: null };
  await recorder.configureCapture(config);
  const first = { ...fix(0), timestamp: now };
  await recorder.captureFix(first); await recorder.captureFix(first);
  assert.equal((await recorder.readActivityDay(config.scope, api.dateKey(now))).samples.length, 1);
  now += 60000;
  const headless = engine();
  await headless.captureFix({ ...first, timestamp: now });
  assert.equal((await headless.readActivityDay(config.scope, api.dateKey(now))).samples.length, 2);
  await headless.configureCapture(null);
  now += 60000; await headless.captureFix({ ...first, timestamp: now });
  assert.equal((await headless.readActivityDay(config.scope, api.dateKey(now))).samples.length, 2);
  await headless.configureCapture({ ...config, scope: 'bob', sessionId: 'bob-session', enabledAt: now - 1 });
  await headless.captureFix({ ...first, timestamp: now }, true, { scope: 'local-device', sessionId: 'session' });
  assert.equal((await headless.readActivityDay('bob', api.dateKey(now))).samples.length, 0, 'A previous account callback cannot write into the new account history');
});

module.exports = { load, api, fix, sample };
