const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
function load(file, dependencies, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { assert(name in dependencies, name); return dependencies[name]; }, ...globals });
  return module.exports;
}
const config = load('src/lib/emergencyRing.ts', {});
const flush = () => new Promise(resolve => setImmediate(resolve));
function native(options = {}) {
  const timers = new Map(), errors = [], state = { creates: 0, plays: 0, pauses: 0, removes: 0, unsubscribe: 0 };
  let status;
  const player = { play() { state.plays++; }, pause() { state.pauses++; }, remove() { state.removes++; }, addListener(_type, callback) { status = callback; return { remove() { state.unsubscribe++; } }; } };
  const service = load('src/services/emergencyRing.ts', {
    '../lib/emergencyRing': config, '../../assets/sounds/emergency-ring.wav': 1,
    'expo-audio': { setAudioModeAsync: async value => { state.mode = value; if (options.wait) await options.wait; if (options.fail) throw Error('Unavailable'); }, createAudioPlayer: () => { state.creates++; return player; } },
  }, { setTimeout: (callback, delay) => { timers.set(1, { callback, delay }); return 1; }, clearTimeout: id => timers.delete(id) });
  return { start: () => service.startEmergencyRing(message => errors.push(message)), player, state, timers, errors, status: value => status(value) };
}
test('an emergency rings repeatedly and stops/reclaims playback when acknowledged', async () => {
  const h = native(), stop = h.start(); await flush();
  assert.equal(h.state.plays, 1); assert.equal(h.player.loop, true); assert.equal(h.player.volume, 1);
  assert.equal(h.state.mode.shouldPlayInBackground, false);
  stop(); stop(); assert.equal(h.state.pauses, 1); assert.equal(h.state.removes, 1); assert.equal(h.state.unsubscribe, 1); assert.equal(h.timers.size, 0);
});
test('unanswered emergency rings stop automatically after thirty seconds', async () => {
  const h = native(); h.start(); await flush();
  assert.equal(h.timers.get(1).delay, 30000); h.timers.get(1).callback(); assert.equal(h.state.removes, 1);
});
test('dismissal while audio is loading prevents any late playback', async () => {
  let resume; const wait = new Promise(resolve => { resume = resolve; });
  const h = native({ wait }), stop = h.start(); await flush(); stop(); resume(); await flush();
  assert.equal(h.state.creates, 0); assert.equal(h.state.plays, 0); assert.equal(h.timers.size, 0);
});
test('native load and playback failures stop audio and expose a retryable error', async () => {
  const failed = native({ fail: true }); failed.start(); await flush(); assert.equal(failed.errors.length, 1); assert.equal(failed.state.creates, 0);
  const h = native(); h.start(); await flush(); h.status({ error: 'Decoder failed' }); h.status({ error: 'Duplicate' });
  assert.equal(h.errors.length, 1); assert.equal(h.state.removes, 1); assert.equal(h.timers.size, 0);
});

function hook() {
  const slots = [], starts = []; let cursor = 0, dirty = false, effects = [], args, result;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(value) { return slots[cursor++] ||= { current: value }; },
    useState(value) { const index = cursor++; slots[index] ||= { value }; return [slots[index].value, next => { if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }]; },
    useCallback(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, callback }; return slots[index].callback; },
    useEffect(effect, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const old = slots[index]; const slot = slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slot.cleanup = effect(); }); } },
  };
  const { useEmergencyRing } = load('src/hooks/useEmergencyRing.ts', { react, '../services/emergencyRing': { startEmergencyRing: onError => { const item = { stopped: false, onError }; starts.push(item); return () => { item.stopped = true; }; } } });
  function render(key, active = true) { args = [key, active]; let count = 0; do { assert(++count < 20); dirty = false; cursor = 0; result = useEmergencyRing(...args); const pending = effects; effects = []; pending.forEach(effect => effect()); } while (dirty); return result; }
  return { render, starts, unmount: () => slots.forEach(slot => slot.cleanup?.()) };
}
test('rerenders do not restart ringing; opening, dismissing, backgrounding and account/space changes stop it', () => {
  const h = hook(); h.render(undefined); assert.equal(h.starts.length, 0);
  h.render('alice/space/alert'); h.render('alice/space/alert'); assert.equal(h.starts.length, 1);
  h.render('alice/space/alert', false); assert(h.starts[0].stopped); assert.equal(h.starts.length, 1);
  h.render('alice/space/alert'); h.render('bob/other/alert'); assert(h.starts[1].stopped);
  h.render(undefined); assert(h.starts[2].stopped); h.render('bob/other/new'); h.unmount(); assert(h.starts[3].stopped);
});
test('Retry alert sound starts a new player and clears an earlier playback error', () => {
  const h = hook(); h.render('alice/space/alert'); h.starts[0].onError('Blocked');
  const state = h.render('alice/space/alert'); assert.equal(state.error, 'Blocked'); state.retry();
  assert(h.starts[0].stopped); assert.equal(h.starts.length, 2); assert.equal(h.render('alice/space/alert').error, null); h.unmount();
});
test('browser autoplay denial is handled and all media is released without an unhandled promise', async () => {
  const timers = new Map(), errors = [], players = [];
  class Audio {
    constructor() { players.push(this); } play() { return Promise.reject(Error('Autoplay blocked')); }
    pause() { this.paused = true; } removeAttribute() { this.sourceRemoved = true; } load() {}
  }
  const { startEmergencyRing } = load('src/services/emergencyRing.web.ts', { 'expo-asset': { Asset: { fromModule: () => ({ uri: '/ring.wav' }) } }, '../lib/emergencyRing': config, '../../assets/sounds/emergency-ring.wav': 1 },
    { Audio, setTimeout: callback => { timers.set(1, callback); return 1; }, clearTimeout: id => timers.delete(id) });
  startEmergencyRing(error => errors.push(error)); await flush();
  assert.equal(errors.length, 1); assert(players[0].paused); assert(players[0].sourceRemoved); assert.equal(timers.size, 0);
});
