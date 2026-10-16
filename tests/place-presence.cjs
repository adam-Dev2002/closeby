const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const moduleApi = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/placePresence.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: moduleApi, exports: moduleApi.exports, Date, Map, Set });
const { PlacePresenceTracker, batteryPercent, presenceCaption, shortStay } = moduleApi.exports;
const BASE = Date.now() - 1000000;
const zone = { id: 'home', name: 'Home', description: 'Family home', coordinate: { latitude: 14.55, longitude: 121.02 }, radius: 100, color: '#1186FF', enabled: true };
const fix = (seconds, latitude = 14.55, accuracy = 5) => ({ latitude, longitude: 121.02, accuracy, timestamp: BASE + seconds * 1000, speed: 0, heading: null });
const device = (seconds, latitude, rest = {}) => ({ id: 'own', name: 'My phone', sharing: false, batteryLevel: .92, location: fix(seconds, latitude), ...rest });
const plain = value => JSON.parse(JSON.stringify(value));
const update = (tracker, devices, seconds, zones = [zone]) => tracker.update(devices, zones, 'own', true, BASE + seconds * 1000);

test('battery badges use measured percentages and preserve unknown values', () => {
  assert.equal(batteryPercent(.92), 92); assert.equal(batteryPercent(0), 0); assert.equal(batteryPercent(1), 100);
  for (const value of [null, undefined, NaN, Infinity, -1, 1.1, '92']) assert.equal(batteryPercent(value), null);
});
test('an already-present person gets a first-seen timer without a fabricated arrival alert', () => {
  const tracker = new PlacePresenceTracker();
  const initial = update(tracker, [device(0)], 0);
  assert.equal(initial.events.length, 0); assert.equal(initial.presence.own.arrivalObserved, false);
  const current = update(tracker, [device(60)], 60);
  assert.equal(current.events.length, 0); assert.equal(current.presence.own.since, BASE);
  const caption = presenceCaption(current.presence.own, BASE + 60000);
  assert.match(caption.detail, /Here for at least 1 min/); assert.match(caption.time, /^First seen/);
});
test('distinct confirmed GPS fixes produce one arrival with the first observed arrival time', () => {
  const tracker = new PlacePresenceTracker();
  update(tracker, [device(0, 14.552)], 0);
  assert.equal(update(tracker, [device(10)], 10).events.length, 0);
  const arrival = update(tracker, [device(14)], 14);
  assert.equal(arrival.events.length, 1); assert.equal(arrival.events[0].kind, 'arrival');
  assert.equal(arrival.events[0].timestamp, BASE + 10000); assert.equal(arrival.presence.own.arrivalObserved, true);
  assert.match(presenceCaption(arrival.presence.own, BASE + 14000).time, /^Arrived/);
  assert.equal(update(tracker, [device(20)], 20).events.length, 0);
});
test('duplicate, out-of-order, stale, future, and uncertain fixes cannot invent a crossing', () => {
  const tracker = new PlacePresenceTracker();
  update(tracker, [device(0, 14.552)], 0);
  for (const candidate of [device(0), device(-1), device(3, 14.55, { location: fix(3, 14.55, null) }), device(4, 14.55, { location: fix(4, 14.55, 200) }), device(100)]) {
    assert.equal(update(tracker, [candidate], 10).events.length, 0);
  }
  assert.equal(update(tracker, [device(10)], 100).events.length, 0);
});
test('a short spike and boundary uncertainty do not create repeated arrival/departure alerts', () => {
  const tracker = new PlacePresenceTracker();
  update(tracker, [device(0, 14.552)], 0); update(tracker, [device(10)], 10);
  assert.equal(update(tracker, [device(14, 14.552)], 14).events.length, 0);
  update(tracker, [device(20)], 20); assert.equal(update(tracker, [device(24)], 24).events.length, 1);
  assert.equal(update(tracker, [device(30, 14.55088)], 30).events.length, 0);
  update(tracker, [device(40, 14.552)], 40);
  const left = update(tracker, [device(44, 14.552)], 44);
  assert.equal(left.events[0].kind, 'departure'); assert.equal(left.events[0].since, BASE + 20000);
});
test('a long signal gap establishes a new baseline and stale labels stop claiming a live stay', () => {
  const tracker = new PlacePresenceTracker();
  update(tracker, [device(0, 14.552)], 0);
  const result = update(tracker, [device(200)], 200);
  assert.equal(result.events.length, 0); assert.equal(result.presence.own.arrivalObserved, false);
  assert.equal(presenceCaption(result.presence.own, BASE + 246000).detail, 'Last seen here');
});
test('only actively sharing members contribute presence and revoking sharing removes a cached member', () => {
  const tracker = new PlacePresenceTracker();
  assert.deepEqual(plain(update(tracker, [device(0, 14.55, { id: 'member' })], 0).presence), {});
  assert(update(tracker, [device(1, 14.55, { id: 'member', sharing: true })], 1).presence.member);
  assert.deepEqual(plain(update(tracker, [device(2, 14.55, { id: 'member', sharing: false })], 2).presence), {});
});
test('editing a place resets its baseline; paused place alerts retain a name without notifying', () => {
  const tracker = new PlacePresenceTracker();
  update(tracker, [device(0, 14.552)], 0);
  const paused = { ...zone, enabled: false };
  update(tracker, [device(10)], 10, [paused]);
  const result = update(tracker, [device(14)], 14, [paused]);
  assert.equal(result.events.length, 0); assert.equal(result.presence.own.name, 'Home');
  const moved = { ...zone, coordinate: { latitude: 14.552, longitude: 121.02 } };
  assert.equal(update(tracker, [device(20, 14.552)], 20, [moved]).events.length, 0);
});
test('background invocations restore pending confirmations, deduplicate delivery, and retain observed times', () => {
  const first = new PlacePresenceTracker(); update(first, [device(0, 14.552)], 0);
  update(first, [device(60)], 60);
  const next = new PlacePresenceTracker(); next.restore(first.serialize());
  const arrival = update(next, [device(120)], 120);
  assert.equal(arrival.events.length, 1); assert.equal(arrival.events[0].timestamp, BASE + 60000);
  const reloaded = new PlacePresenceTracker(); reloaded.restore(next.serialize());
  assert.equal(update(reloaded, [device(120)], 120).events.length, 0);
  assert.equal(update(reloaded, [device(180)], 180).presence.own.since, BASE + 60000);
  const corrupt = new PlacePresenceTracker(); corrupt.restore('{broken');
  assert.equal(update(corrupt, [device(200)], 200).events.length, 0);
});
test('stay labels format measured minutes and hours without negative elapsed times', () => {
  assert.equal(shortStay(-1), 'less than 1 min'); assert.equal(shortStay(152 * 60000), '2 hr 32 min');
});
test('cached observations from a different space cannot establish arrival continuity', () => {
  const first = new PlacePresenceTracker(); update(first, [device(0, 14.552)], 0); update(first, [device(10)], 10);
  const next = new PlacePresenceTracker(); next.restore(first.serialize('old-space'), 'new-space');
  const result = update(next, [device(14)], 14);
  assert.equal(result.events.length, 0); assert.equal(result.presence.own.arrivalObserved, false);
});
