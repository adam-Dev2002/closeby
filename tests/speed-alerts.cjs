const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

function load(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...globals,
  });
  return module.exports;
}

const api = load('src/lib/speedAlerts.ts');
const BASE = 1_900_000_000_000;
const settings = { enabled: true, limitKmh: 80, scope: 'alice', ownDeviceId: 'alice', ownTracking: true };
function device(kmh, elapsed = 0, overrides = {}) {
  const { fix = {}, ...profile } = overrides;
  return {
    id: 'alice', ownerId: 'alice', name: 'Alice’s Phone', photoURL: null, platform: 'android',
    batteryLevel: 0.5, sharing: false, lastSeen: BASE + elapsed,
    location: { latitude: 14.55, longitude: 121.02, accuracy: 5, speed: kmh / 3.6, heading: null, timestamp: BASE + elapsed, ...fix },
    ...profile,
  };
}
function reading(evaluator, kmh, elapsed, options = settings, overrides = {}, now = BASE + elapsed) {
  return evaluator.evaluate(device(kmh, elapsed, overrides), options, now);
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('GPS metres per second become km/h; zero remains a measured speed', () => {
  assert.equal(api.speedKmh(device(36).location, BASE), 36);
  assert.equal(api.speedKmh(device(0).location, BASE), 0);
});

test('missing, negative, non-finite, stale and future speeds stay unknown', () => {
  assert.equal(api.speedKmh(null, BASE), null);
  for (const speed of [null, undefined, -1, NaN, Infinity]) {
    assert.equal(api.speedKmh(device(0, 0, { fix: { speed } }).location, BASE), null);
  }
  assert.equal(api.speedKmh(device(50, -45_001).location, BASE), null);
  assert.equal(api.speedKmh(device(50, 5_001).location, BASE), null);
  assert.equal(api.speedKmh(device(50, -45_000).location, BASE), 50);
});

test('only a sustained exceedance across distinct fixes raises an alert', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  assert.equal(reading(evaluator, 90, 0), null);
  assert.equal(reading(evaluator, 90, 1_000), null);
  const event = reading(evaluator, 91, 3_000);
  assert.equal(event.deviceId, 'alice');
  assert.equal(event.name, 'Alice’s Phone');
  assert.ok(Math.abs(event.speedKmh - 91) < 1e-9);
  assert.equal(event.limitKmh, 80);
  assert.equal(event.timestamp, BASE + 3_000);
  assert.equal(reading(evaluator, 100, 10_000), null);
});

test('the exact limit and a single spike do not warn', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  assert.equal(reading(evaluator, 80, 0), null);
  assert.equal(reading(evaluator, 80, 3_000), null);
  assert.equal(reading(evaluator, 120, 6_000), null);
  assert.equal(reading(evaluator, 75, 9_000), null);
  assert.equal(reading(evaluator, 100, 12_000), null);
  assert.ok(reading(evaluator, 100, 15_000));
});

test('duplicate and out-of-order listener snapshots cannot confirm an exceedance', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  assert.equal(reading(evaluator, 90, 0), null);
  assert.equal(reading(evaluator, 90, 0, settings, {}, BASE + 4_000), null);
  assert.equal(reading(evaluator, 90, -1_000, settings, {}, BASE + 4_000), null);
  assert.ok(reading(evaluator, 90, 4_000));
});

test('poor or unknown accuracy interrupts confirmation without fabricating speed', () => {
  for (const accuracy of [null, 51, -1, NaN, Infinity]) {
    const evaluator = api.createSpeedAlertEvaluator();
    assert.equal(reading(evaluator, 90, 0), null);
    assert.equal(reading(evaluator, 90, 3_000, settings, { fix: { accuracy } }), null);
    assert.equal(reading(evaluator, 90, 6_000), null);
    assert.ok(reading(evaluator, 90, 9_000));
  }
  const evaluator = api.createSpeedAlertEvaluator();
  assert.equal(reading(evaluator, 90, 0, settings, { fix: { accuracy: 50 } }), null);
  assert.ok(reading(evaluator, 90, 3_000, settings, { fix: { accuracy: 50 } }));
});

test('stale, future and missing speed fixes cannot confirm an alert', () => {
  for (const fix of [{ speed: null }, { speed: -1 }, { speed: NaN }, { timestamp: BASE - 50_000 }, { timestamp: BASE + 10_000 }]) {
    const evaluator = api.createSpeedAlertEvaluator();
    assert.equal(reading(evaluator, 90, 0, settings, { fix }, BASE), null);
    assert.equal(reading(evaluator, 90, 3_000), null);
    assert.ok(reading(evaluator, 90, 6_000));
  }
});

test('a confirmation gap greater than 30 seconds starts a new candidate', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  assert.equal(reading(evaluator, 90, 0), null);
  assert.equal(reading(evaluator, 90, 30_001), null);
  assert.ok(reading(evaluator, 90, 33_001));
});

test('own-device alerts work without sharing, and stop when own GPS is paused', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  assert.equal(reading(evaluator, 90, 0), null);
  assert.equal(reading(evaluator, 90, 3_000, { ...settings, ownTracking: false }), null);
  assert.equal(reading(evaluator, 90, 6_000), null);
  assert.ok(reading(evaluator, 90, 9_000));
});

test('remote members must actively share fresh measured speed', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  const remote = { id: 'bob', ownerId: 'bob', sharing: false };
  assert.equal(reading(evaluator, 90, 0, settings, remote), null);
  assert.equal(reading(evaluator, 90, 3_000, settings, remote), null);
  assert.equal(reading(evaluator, 90, 6_000, settings, { ...remote, sharing: true }), null);
  assert.ok(reading(evaluator, 90, 9_000, settings, { ...remote, sharing: true }));
});

test('remote sharing pauses discard their pending confirmation', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  const remote = { id: 'bob', sharing: true };
  assert.equal(reading(evaluator, 90, 0, settings, remote), null);
  assert.equal(reading(evaluator, 90, 3_000, settings, { ...remote, sharing: false }), null);
  assert.equal(reading(evaluator, 90, 6_000, settings, remote), null);
  assert.ok(reading(evaluator, 90, 9_000, settings, remote));
});

test('hysteresis keeps one episode until speed drops at least 3 km/h below the limit', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  reading(evaluator, 90, 0);
  assert.ok(reading(evaluator, 90, 3_000));
  assert.equal(reading(evaluator, 79, 64_000), null);
  assert.equal(reading(evaluator, 90, 67_000), null);
  assert.equal(reading(evaluator, 90, 70_000), null);
  assert.equal(reading(evaluator, 77, 73_000), null);
  assert.equal(reading(evaluator, 90, 76_000), null);
  assert.ok(reading(evaluator, 90, 79_000));
});

test('a rearmed episode still observes the 60-second alert cooldown', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  reading(evaluator, 90, 0);
  assert.ok(reading(evaluator, 90, 3_000));
  reading(evaluator, 70, 6_000);
  reading(evaluator, 90, 9_000);
  assert.equal(reading(evaluator, 90, 12_000), null);
  assert.equal(reading(evaluator, 90, 40_000), null);
  assert.equal(reading(evaluator, 90, 62_999), null);
  assert.ok(reading(evaluator, 90, 63_000));
});

test('disabled alerts, invalid limits and configuration changes reset evaluation', () => {
  for (const change of [{ enabled: false }, { limitKmh: 201 }, { limitKmh: NaN }]) {
    const evaluator = api.createSpeedAlertEvaluator();
    reading(evaluator, 90, 0);
    assert.equal(reading(evaluator, 90, 3_000, { ...settings, ...change }), null);
    assert.equal(reading(evaluator, 90, 6_000), null);
    assert.ok(reading(evaluator, 90, 9_000));
  }
  const evaluator = api.createSpeedAlertEvaluator();
  reading(evaluator, 90, 0);
  assert.equal(reading(evaluator, 90, 3_000, { ...settings, limitKmh: 85 }), null);
  assert.ok(reading(evaluator, 90, 6_000, { ...settings, limitKmh: 85 }));
});

test('account changes and removed members cannot reuse a previous confirmation', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  reading(evaluator, 90, 0);
  const account = { ...settings, scope: 'different-account' };
  assert.equal(reading(evaluator, 90, 3_000, account), null);
  evaluator.retainDevices([]);
  assert.equal(reading(evaluator, 90, 6_000, account), null);
  assert.ok(reading(evaluator, 90, 9_000, account));
});

test('foreground pause clears confirmation but preserves a reported remote episode', () => {
  const evaluator = api.createSpeedAlertEvaluator();
  const remote = { id: 'bob', sharing: true };
  reading(evaluator, 90, 0, settings, remote);
  evaluator.pause();
  assert.equal(reading(evaluator, 90, 3_000, settings, remote), null);
  assert.ok(reading(evaluator, 90, 6_000, settings, remote));
  evaluator.pause();
  assert.equal(reading(evaluator, 90, 70_000, { ...settings, ownTracking: false }, remote), null);
  assert.equal(reading(evaluator, 90, 73_000, settings, remote), null);
});

test('saved preferences validate threshold bounds and preserve safe defaults', () => {
  for (const value of [null, '', '{', '{}', '{"enabled":true,"limitKmh":9}', '{"enabled":"true","limitKmh":80}', '{"enabled":true,"limitKmh":201}']) {
    assert.deepEqual(plain(api.parseSpeedPreferences(value)), { enabled: false, limitKmh: 80 });
  }
  assert.deepEqual(plain(api.parseSpeedPreferences('{"enabled":true,"limitKmh":10}')), { enabled: true, limitKmh: 10 });
  assert.deepEqual(plain(api.parseSpeedPreferences('{"enabled":true,"limitKmh":200}')), { enabled: true, limitKmh: 200 });
  for (const value of [9, 201, 80.5, null, NaN, Infinity, '80']) assert.equal(api.validSpeedLimit(value), false);
  assert.equal(api.speedPreferencesKey('alice'), '@closeby/alice/speed-alerts/v1');
  assert.notEqual(api.speedPreferencesKey('alice'), api.speedPreferencesKey('local-device'));
  assert.equal(api.speedPreferencesKey('account/a'), '@closeby/account%2Fa/speed-alerts/v1');
});

function hooks() {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let pending = [];
  let component;
  let argument;
  let output;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { value: callback, dependencies };
      return slots[index].value;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
        const previous = slots[index];
        const next = { dependencies, cleanup: undefined };
        slots[index] = next;
        pending.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  function flush() {
    let attempts = 0;
    do {
      if (++attempts > 20) throw new Error('Hook did not settle');
      dirty = false;
      cursor = 0;
      output = component(argument);
      const effects = pending;
      pending = [];
      for (const effect of effects) effect();
    } while (dirty || pending.length);
    return output;
  }
  return {
    react,
    render(hook, args) { component = hook; argument = args; return flush(); },
    flush,
    async settle() { await new Promise(resolve => setImmediate(resolve)); return flush(); },
  };
}

test('preference updates persist in order and stay separated by account', async () => {
  const harness = hooks();
  const saved = new Map();
  const storage = { getItem: async key => saved.get(key) ?? null, setItem: async (key, value) => { saved.set(key, value); } };
  const { useSpeedPreferences } = load('src/hooks/useSpeedPreferences.ts', {
    react: harness.react, '@react-native-async-storage/async-storage': storage, '../lib/speedAlerts': api,
  });
  let preferences = harness.render(useSpeedPreferences, 'alice');
  await Promise.all([preferences.setEnabled(true), preferences.setLimitKmh(100)]);
  preferences = await harness.settle();
  assert.equal(preferences.enabled, true);
  assert.equal(preferences.limitKmh, 100);
  assert.deepEqual(JSON.parse(saved.get(api.speedPreferencesKey('alice'))), { enabled: true, limitKmh: 100 });
  preferences = harness.render(useSpeedPreferences, 'bob');
  assert.equal(preferences.enabled, false);
  assert.equal(preferences.limitKmh, 80);
  preferences = await harness.settle();
  await assert.rejects(preferences.setLimitKmh(201), /10 to 200/);
  await preferences.setLimitKmh(60);
  assert.deepEqual(JSON.parse(saved.get(api.speedPreferencesKey('bob'))), { enabled: false, limitKmh: 60 });
  harness.render(useSpeedPreferences, 'alice');
  preferences = await harness.settle();
  assert.equal(preferences.enabled, true);
  assert.equal(preferences.limitKmh, 100);
});

test('an old account hydration cannot enable alerts for a new account', async () => {
  const harness = hooks();
  let finishAlice;
  const slowAlice = new Promise(resolve => { finishAlice = resolve; });
  const storage = {
    getItem: key => key === api.speedPreferencesKey('alice') ? slowAlice : Promise.resolve(null),
    setItem: async () => {},
  };
  const { useSpeedPreferences } = load('src/hooks/useSpeedPreferences.ts', {
    react: harness.react, '@react-native-async-storage/async-storage': storage, '../lib/speedAlerts': api,
  });
  harness.render(useSpeedPreferences, 'alice');
  harness.render(useSpeedPreferences, 'local-device');
  finishAlice('{"enabled":true,"limitKmh":100}');
  const preferences = await harness.settle();
  assert.equal(preferences.enabled, false);
  assert.equal(preferences.limitKmh, 80);
  assert.equal(preferences.loaded, true);
});

test('the hook gates remote alerts in the background and requires fresh confirmation on resume', () => {
  const harness = hooks();
  let now = BASE;
  let stateListener;
  const appState = {
    currentState: 'active',
    addEventListener: (_event, callback) => { stateListener = callback; return { remove() {} }; },
  };
  const { useSpeedAlerts } = load('src/hooks/useSpeedAlerts.ts', {
    react: harness.react, 'react-native': { AppState: appState }, '../lib/speedAlerts': api,
  }, { Date: class extends Date { static now() { return now; } } });
  const remote = { id: 'bob', sharing: true };
  const render = elapsed => {
    now = BASE + elapsed;
    return harness.render(useSpeedAlerts, { ...settings, devices: [device(90, elapsed, remote)] });
  };
  assert.equal(render(0).latestAlert, null);
  appState.currentState = 'background'; stateListener('background');
  assert.equal(render(3_000).latestAlert, null);
  appState.currentState = 'active'; stateListener('active');
  assert.equal(render(6_000).latestAlert, null);
  const result = render(9_000);
  assert.equal(result.latestAlert.deviceId, 'bob');
  result.dismissAlert();
  assert.equal(harness.flush().latestAlert, null);
});

test('simultaneous member warnings queue until dismissed, and account changes clear them', () => {
  const harness = hooks();
  let now = BASE;
  const appState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
  const { useSpeedAlerts } = load('src/hooks/useSpeedAlerts.ts', {
    react: harness.react, 'react-native': { AppState: appState }, '../lib/speedAlerts': api,
  }, { Date: class extends Date { static now() { return now; } } });
  const render = (elapsed, scope = settings.scope) => {
    now = BASE + elapsed;
    return harness.render(useSpeedAlerts, {
      ...settings, scope,
      devices: [device(90, elapsed), device(95, elapsed, { id: 'bob', sharing: true })],
    });
  };
  render(0);
  let result = render(3_000);
  assert.equal(result.latestAlert.deviceId, 'alice');
  result.dismissAlert();
  result = harness.flush();
  assert.equal(result.latestAlert.deviceId, 'bob');
  assert.equal(render(6_000, 'another-account').latestAlert, null);
});

test('trip kilometre totals preserve the full measured distance when the displayed route is reduced', async () => {
  const harness = hooks();
  let now = BASE;
  let receive;
  const saved = new Map();
  const appState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
  const storage = {
    multiGet: async keys => keys.map(key => [key, null]),
    setItem: async (key, value) => { saved.set(key, value); },
  };
  const location = {
    Accuracy: { High: 4 },
    getForegroundPermissionsAsync: async () => ({ granted: true }),
    requestForegroundPermissionsAsync: async () => ({ granted: true }),
    hasServicesEnabledAsync: async () => true,
    watchPositionAsync: async (_options, callback) => { receive = callback; return { remove() {} }; },
  };
  const { useTracking, distanceMeters } = load('src/hooks/useTracking.ts', {
    react: harness.react,
    'react-native': { AppState: appState, Platform: { OS: 'web' }, Alert: { alert() {} } },
    '@react-native-async-storage/async-storage': storage,
    'expo-battery': {}, 'expo-device': { isDevice: false },
    '../lib/uuid': { randomUuid: () => 'recorded-trip' }, 'expo-location': location,
    '../components/AppDialog': { useAppDialog: () => ({ alert() {} }) },
  }, { Date: class extends Date { static now() { return now; } }, setInterval: () => 1, clearInterval() {} });
  let tracking = harness.render(useTracking, { scope: 'alice' });
  assert.equal(await tracking.startTracking(), true);
  tracking = await harness.settle();
  tracking.startTrip();
  const points = [];
  for (let index = 0; index < 650; index++) {
    now = BASE + index * 3_000;
    const point = {
      latitude: 14.55 + 0.01 * Math.sin(index * Math.PI / 50),
      longitude: 121.02 + 0.01 * Math.cos(index * Math.PI / 50),
    };
    points.push(point);
    receive({ timestamp: now, coords: { ...point, accuracy: 5, speed: null, heading: null } });
  }
  tracking = harness.flush();
  const fullDistance = points.reduce((sum, point, index) => sum + (index ? distanceMeters(points[index - 1], point) : 0), 0);
  const reducedDistance = tracking.route.reduce((sum, point, index, route) => sum + (index ? distanceMeters(route[index - 1], point) : 0), 0);
  assert.ok(tracking.route.length < points.length, 'the displayed route should be bounded');
  assert.ok(fullDistance > reducedDistance + 1, 'route reduction should omit some curved-path distance');
  assert.ok(Math.abs(tracking.tripDistanceMeters - fullDistance) < 1e-6);
  await tracking.endTrip();
  tracking = await harness.settle();
  assert.equal(tracking.tripDistanceMeters, 0);
  assert.ok(Math.abs(tracking.trips[0].distanceMeters - fullDistance) < 1e-6);
});
