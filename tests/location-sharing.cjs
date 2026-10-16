const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

function runtime() {
  const slots = [], timers = new Map(), appListeners = new Set();
  let cursor = 0, pending = [], dirty = false, renderHook, props, result, sequence = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        const previous = slots[index], slot = slots[index] = { deps };
        pending.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
  const globals = {
    setTimeout(callback, delay) { timers.set(++sequence, { callback, delay }); return sequence; },
    clearTimeout: id => timers.delete(id), setInterval: () => 0, clearInterval() {},
  };
  const appState = { currentState: 'active', addEventListener(_name, callback) { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } };
  function load(file, dependencies) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { module, exports: module.exports, ...globals, require(name) {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        throw Error('Unexpected dependency: ' + name);
      } });
    return module.exports;
  }
  function flush() {
    let attempts = 0;
    do {
      assert(++attempts < 40, 'Hooks must settle'); dirty = false; cursor = 0;
      result = renderHook(props);
      const effects = pending; pending = []; effects.forEach(effect => effect());
    } while (dirty || pending.length);
    return result;
  }
  return {
    react, appState, timers, load, flush,
    render(hook, next) { renderHook = hook; props = next; return flush(); },
    async settle() { for (let i = 0; i < 25; i++) { await Promise.resolve(); flush(); } return result; },
    state(next) { appState.currentState = next; [...appListeners].forEach(callback => callback(next)); return flush(); },
    tick(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert(entry, `Expected a ${delay}ms timer`); timers.delete(entry[0]); entry[1].callback(); return flush();
    },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}
const fix = () => ({ latitude: 14.55, longitude: 121.02, accuracy: 5, speed: null, heading: null, timestamp: Date.now() });
const device = () => ({ id: 'alice', ownerId: 'alice', name: 'Alice phone', platform: 'android', photoURL: null, batteryLevel: .8, location: fix(), sharing: true, lastSeen: Date.now() });

function trackingHarness(saved = new Map(), permission = { granted: true, status: 'granted' }) {
  const h = runtime(), watches = [], calls = { requests: 0 }, storage = {
    getItem: async key => saved.get(key) ?? null,
    multiGet: async keys => keys.map(key => [key, saved.get(key) ?? null]),
    setItem: async (key, value) => { saved.set(key, value); },
  };
  const location = {
    Accuracy: { High: 4 }, getForegroundPermissionsAsync: async () => permission,
    requestForegroundPermissionsAsync: async () => { calls.requests++; return permission; },
    hasServicesEnabledAsync: async () => true,
    watchPositionAsync: async (_options, next) => { const watch = { next, removed: false }; watches.push(watch); return { remove: () => { watch.removed = true; } }; },
  };
  const preferences = h.load('src/hooks/useLocationPreferences.ts', { react: h.react, '@react-native-async-storage/async-storage': storage });
  const tracking = h.load('src/hooks/useTracking.ts', {
    react: h.react, '@react-native-async-storage/async-storage': storage,
    'react-native': { AppState: h.appState, Platform: { OS: 'web' } },
    'expo-location': location, 'expo-battery': {}, 'expo-device': { isDevice: false }, '../lib/uuid': { randomUuid: () => 'trip' },
  });
  const hook = scope => {
    const prefs = preferences.useLocationPreferences(scope);
    const gps = tracking.useTracking({ scope, autoStart: prefs.loaded && prefs.gps, onEnabledChange: prefs.setGps });
    return { prefs, gps };
  };
  return { ...h, saved, calls, watches, hook };
}

test('GPS and sharing resume after reopening without requesting an existing grant', async () => {
  const saved = new Map(), first = trackingHarness(saved);
  first.render(first.hook, 'alice'); await first.settle();
  assert.equal(await first.flush().gps.startTracking(), true);
  first.flush().prefs.setSharing(true); await first.settle();
  assert.equal(first.calls.requests, 0); first.unmount();
  const reopened = trackingHarness(saved); reopened.render(reopened.hook, 'alice');
  const current = await reopened.settle();
  assert.equal(current.gps.tracking, true); assert.equal(current.prefs.sharing, true);
  assert.equal(reopened.calls.requests, 0); assert.equal(reopened.watches.length, 1);
  reopened.unmount();
});

test('backgrounding and returning restores GPS; a brief inactive state does not stop it', async () => {
  const h = trackingHarness(); h.render(h.hook, 'alice'); await h.settle();
  await h.flush().gps.startTracking(); h.flush().prefs.setSharing(true); await h.settle();
  h.state('inactive'); assert.equal(h.flush().gps.tracking, true); assert.equal(h.watches[0].removed, false);
  h.state('background'); assert.equal(h.flush().gps.tracking, false); assert.equal(h.flush().prefs.sharing, true);
  assert.equal(h.watches[0].removed, true);
  h.state('active'); const next = await h.settle();
  assert.equal(next.gps.tracking, true); assert.equal(next.prefs.sharing, true);
  assert.equal(h.calls.requests, 0); assert.equal(h.watches.length, 2); h.unmount();
});

test('Pause GPS persists the off choice and never restarts on focus or reopening', async () => {
  const h = trackingHarness(); h.render(h.hook, 'alice'); await h.settle();
  await h.flush().gps.startTracking(); h.flush().prefs.setSharing(true); await h.settle();
  h.flush().gps.stopTracking(); await h.settle(); h.state('background'); h.state('active');
  assert.equal((await h.settle()).gps.tracking, false); assert.equal(h.flush().prefs.sharing, false); h.unmount();
  const reopened = trackingHarness(h.saved); reopened.render(reopened.hook, 'alice');
  assert.equal((await reopened.settle()).gps.tracking, false); assert.equal(reopened.watches.length, 0); reopened.unmount();
});

test('automatic restore does not prompt when permission was revoked; explicit enable can request it', async () => {
  const saved = new Map([['@closeby/alice/location-preferences/v1', JSON.stringify({ gps: true, sharing: true })]]);
  const h = trackingHarness(saved, { granted: false, status: 'denied', canAskAgain: true });
  h.render(h.hook, 'alice'); const current = await h.settle();
  assert.equal(current.gps.tracking, false); assert.equal(h.calls.requests, 0); assert.equal(h.watches.length, 0);
  await current.gps.startTracking(); assert.equal(h.calls.requests, 1); h.unmount();
});

test('switching accounts cannot inherit another account location choices or accept its late GPS fix', async () => {
  const h = trackingHarness(); h.render(h.hook, 'alice'); await h.settle();
  await h.flush().gps.startTracking(); h.flush().prefs.setSharing(true); await h.settle();
  h.render(h.hook, 'bob'); const bob = await h.settle();
  assert.equal(bob.prefs.gps, false); assert.equal(bob.prefs.sharing, false); assert.equal(bob.gps.tracking, false);
  h.watches[0].next({ coords: fix(), timestamp: Date.now() });
  assert.equal(h.flush().gps.location, null); h.unmount();
});

function circleHarness() {
  const h = runtime(), listeners = [], writes = [], auth = { currentUser: { uid: 'alice' } };
  const firestore = {
    doc: (_db, ...path) => path.join('/'), collection: (_db, ...path) => path.join('/'), serverTimestamp: () => 'server-time',
    onSnapshot(path, next, fail) { const listener = { path, next, fail, stopped: false }; listeners.push(listener); return () => { listener.stopped = true; }; },
    setDoc: async (path, value) => { writes.push({ path, value }); }, updateDoc: async () => {},
  };
  const service = h.load('src/services/circles.ts', {
    'firebase/firestore': firestore, 'expo-crypto': {}, '../lib/firebase': { firebaseAuth: auth, requireFirestore: () => ({}) },
    '../lib/profileIdentity': {}, './activityHistory': { stopHistoryUploads() {} },
    '../lib/invitations': {},
  });
  const hook = h.load('src/hooks/useCircle.ts', {
    react: h.react, 'react-native': { AppState: h.appState }, '../lib/firebase': { firestore: {}, backendError: cause => cause.message }, '../services/circles': service,
  });
  const props = { uid: 'alice', sharing: true, own: device() };
  const renderHook = value => { auth.currentUser = { uid: value.uid }; return hook.useCircle({ uid: value.uid, displayName: value.uid }, value.own, value.sharing); };
  const last = path => listeners.filter(listener => listener.path === path).at(-1);
  function connect(space = 'family') {
    last(`users/${auth.currentUser.uid}`).next({ data: () => ({ circleId: space }) }); h.flush();
    last(`circles/${space}`).next({ id: space, exists: () => true, data: () => ({ name: 'Family', ownerId: 'alice', inviteCode: 'A'.repeat(32) }) });
    last(`circles/${space}/members`).next({ docs: [{ id: 'bob', data: () => ({ name: 'Bob' }) }] });
    last(`circles/${space}/devices`).next({ docs: [{ id: 'bob', data: () => ({ ...device(), id: 'bob', ownerId: 'bob' }) }] });
    return h.flush();
  }
  h.render(renderHook, props);
  return { ...h, listeners, writes, props, renderHook, last, connect };
}

test('failed shared-location listeners reconnect and deliver the partner coordinates', async () => {
  const h = circleHarness(); assert.equal(h.connect().members[0].id, 'bob'); await h.settle();
  h.last('circles/family/devices').fail(Error('Denied')); let current = h.flush();
  assert.match(current.error, /Shared locations/); assert.equal(current.members.length, 0);
  h.tick(1000); current = h.connect();
  assert.equal(current.error, null); assert.equal(current.members[0].location.latitude, 14.55);
  assert.equal(current.circle.id, 'family'); assert.equal(current.loading, false); h.unmount();
});

test('location retries are bounded; focus and manual retry reconnect without changing sharing consent', async () => {
  const h = circleHarness();
  for (let i = 0; i < 4; i++) {
    h.last('users/alice').fail(Error('Denied')); h.flush();
    if (i < 3) h.tick([1000, 3000, 10000][i]);
  }
  assert.equal(h.timers.size, 0);
  h.flush().retryLocations(); h.flush(); assert.equal(h.listeners.filter(l => l.path === 'users/alice').length, 5);
  h.state('active'); assert.equal(h.listeners.filter(l => l.path === 'users/alice').length, 6);
  h.unmount(); assert(h.listeners.every(listener => listener.stopped));
});

test('old space and account callbacks cannot reintroduce private coordinates', () => {
  const h = circleHarness(); h.connect();
  const oldDevices = h.last('circles/family/devices');
  h.connect('other');
  oldDevices.next({ docs: [{ id: 'old', data: device }] }); assert.equal(h.flush().members[0].id, 'bob');
  h.render(h.renderHook, { ...h.props, uid: 'charlie', own: { ...device(), id: 'charlie', ownerId: 'charlie' }, sharing: false });
  oldDevices.next({ docs: [{ id: 'old', data: device }] }); assert.equal(h.flush().members.length, 0); h.unmount();
});

test('GPS alone publishes no coordinates, and enabling sharing uploads the first fix immediately', async () => {
  const h = circleHarness(); h.render(h.renderHook, { ...h.props, sharing: false }); h.connect();
  h.tick(0); await h.settle(); assert.equal(h.writes.at(-1).value.location, null);
  h.render(h.renderHook, h.props); h.tick(0); await h.settle();
  assert.equal(h.writes.at(-1).value.sharing, true); assert.equal(h.writes.at(-1).value.location.latitude, 14.55); h.unmount();
});
