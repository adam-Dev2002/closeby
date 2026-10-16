const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('../node_modules/typescript');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, setTimeout, clearTimeout, require: name => { if (name in dependencies) return dependencies[name]; throw Error(`Unexpected dependency ${name}`); } });
  return module.exports;
}
const pure = load('src/lib/phoneNotifications.ts'), id = '12345678-1234-4123-a123-123456789abc';
function harness() {
  const storage = new Map(), records = new Map(), sequence = [], channels = [], auth = { currentUser: { uid: 'alice' } };
  let granted = true, listener, wait;
  const notifications = { AndroidImportance: { HIGH: 6 }, AndroidNotificationVisibility: { PRIVATE: 2 },
    setNotificationChannelAsync: async (id, value) => { channels.push({ id, ...value }); sequence.push('channel'); },
    requestPermissionsAsync: async () => { sequence.push('request'); return { granted }; }, getPermissionsAsync: async () => { sequence.push('check'); return { granted }; },
    getDevicePushTokenAsync: async () => { sequence.push('token'); if (wait) await wait; return { data: 'synthetic-token' }; },
    addPushTokenListener: callback => { listener = callback; return { remove() { listener = null; } }; },
    unregisterForNotificationsAsync: async () => sequence.push('unregister'), dismissAllNotificationsAsync: async () => {},
  };
  const api = load('src/services/phoneNotifications.ts', {
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => storage.set(key, value) } },
    'react-native': { Platform: { OS: 'android' } }, 'expo-constants': { __esModule: true, default: { executionEnvironment: 'bare' } },
    '../lib/firebase': { firebaseAuth: auth, requireFirestore: () => ({}) }, '../lib/uuid': { randomUuid: () => id }, '../lib/phoneNotifications': pure,
    './notificationRuntime': { notificationApi: async () => notifications },
    'firebase/firestore': { doc: (_db, ...parts) => parts.join('/'), serverTimestamp: () => 'server-time',
      setDoc: async (path, value) => { records.set(path, value); sequence.push('save'); },
      updateDoc: async (path, value) => { if (!records.has(path)) throw { code: 'not-found' }; records.set(path, { ...records.get(path), ...value }); sequence.push('disable'); },
      deleteDoc: async path => { records.delete(path); sequence.push('delete'); }, onSnapshot() {} },
  });
  return { api, storage, records, sequence, channels, auth, deny: () => { granted = false; }, wait: value => { wait = value; },
    rotate: async value => { listener?.({ data: value }); await new Promise(resolve => setImmediate(resolve)); } };
}
test('sound channels precede permission/token registration without accessing GPS, camera or microphone', async () => {
  const h = harness(), stop = await h.api.registerPhoneNotifications('alice', true);
  assert.equal(h.channels.length, 5); assert(h.channels.every(channel => channel.sound && channel.enableVibrate && channel.bypassDnd === false));
  assert.equal(h.channels.find(channel => channel.id === pure.phoneChannels.emergency).sound, 'closeby_alert.wav');
  assert.equal(h.channels.find(channel => channel.id === pure.phoneChannels.call).sound, 'closeby_call.wav');
  assert(h.sequence.lastIndexOf('channel') < h.sequence.indexOf('request')); assert(h.sequence.indexOf('request') < h.sequence.indexOf('token'));
  assert(h.records.has(`users/alice/pushDevices/${id}`)); assert(await h.api.savedPhoneNotifications('alice')); stop();
});
test('permission denial never registers an endpoint or enables saved consent', async () => {
  const h = harness(); h.deny(); await assert.rejects(h.api.registerPhoneNotifications('alice', true), /Allow Closeby notifications/);
  assert.equal(h.records.size, 0); assert(!h.sequence.includes('token')); assert(!await h.api.savedPhoneNotifications('alice'));
});
test('reopening checks permission without prompting; token rotation is scoped to the signed-in account', async () => {
  const h = harness(); await h.api.registerPhoneNotifications('alice', false); assert(!h.sequence.includes('request'));
  await h.rotate('rotated'); assert.equal(h.records.get(`users/alice/pushDevices/${id}`).token, 'rotated');
  h.auth.currentUser.uid = 'bob'; await h.rotate('other-account'); assert.equal(h.records.get(`users/alice/pushDevices/${id}`).token, 'rotated');
});
test('turning alerts off erases private places, removes the endpoint, then unregisters native push', async () => {
  const h = harness(); await h.api.registerPhoneNotifications('alice', true); h.records.set('users/alice/notificationSettings/main', { enabled: true, zones: ['private-place'] });
  await h.api.disablePhoneNotifications('alice'); assert.equal(h.records.get('users/alice/notificationSettings/main').enabled, false);
  assert.equal(h.records.get('users/alice/notificationSettings/main').zones.length, 0); assert(!h.records.has(`users/alice/pushDevices/${id}`));
  assert(!await h.api.savedPhoneNotifications('alice')); assert(h.sequence.indexOf('disable') < h.sequence.indexOf('delete')); assert(h.sequence.indexOf('delete') < h.sequence.indexOf('unregister'));
});
test('turning alerts off during a pending registration cannot restore them afterward', async () => {
  const h = harness(); let release; h.wait(new Promise(resolve => { release = resolve; })); const pending = h.api.registerPhoneNotifications('alice', true);
  while (!h.sequence.includes('token')) await new Promise(resolve => setImmediate(resolve));
  await h.api.disablePhoneNotifications('alice'); release(); await pending; assert.equal(h.records.size, 0); assert(!await h.api.savedPhoneNotifications('alice'));
});
test('notification taps require the current account, space, known event kind and unexpired content', () => {
  const value = { type: 'closeby', kind: 'call', eventId: 'event', uid: 'alice', spaceId: 'space', resourceId: 'call', expiresAt: String(Date.now() + 50000) };
  assert(pure.phoneNotificationTarget(value, 'alice', 'space'));
  for (const change of [{ uid: 'bob' }, { spaceId: 'other' }, { kind: 'unknown' }, { expiresAt: 'NaN' }, { expiresAt: 0 }, { resourceId: '../call' }, { deviceId: '../user' }]) assert.equal(pure.phoneNotificationTarget({ ...value, ...change }, 'alice', 'space'), null);
});
test('all saved places are checked and extra fields stripped before trusted server evaluation', () => {
  const zone = { id: 'home', name: 'Home', radius: 100, enabled: true, coordinate: { latitude: 14.55, longitude: 121.02, extra: 'discard' }, extra: 'discard' };
  const values = pure.notificationZones([...Array(19).fill(zone), { ...zone, coordinate: { latitude: 91, longitude: 121 } }]);
  assert.equal(values.length, 19); assert(values.every(value => !('extra' in value.coordinate) && !('extra' in value)));
  assert.equal(pure.notificationZones([null, {}, { ...zone, radius: 0 }]).length, 0);
});
