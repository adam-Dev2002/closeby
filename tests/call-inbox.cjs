const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

function harness() {
  const slots = [], listeners = [], appListeners = new Set(), timers = new Map();
  let cursor = 0, dirty = false, pending = [], props, result, sequence = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; dirty = true; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        const previous = slots[index], slot = slots[index] = { deps };
        pending.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
  const dependencies = {
    react,
    'react-native': { AppState: { currentState: 'active', addEventListener: (_event, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } } },
    '../lib/firebase': { firestore: {}, backendError: cause => cause.message },
    '../lib/calls': { callExpired: call => call.expiresAt <= Date.now() },
    '../services/calls': {
      watchIncoming: (_space, uid, _members, next, fail) => { const listener = { uid, next, fail, stopped: false }; listeners.push(listener); return () => { listener.stopped = true; }; },
      finishCall: async () => {}, watchCall: () => () => {}, watchCandidates: () => () => {},
      startCall: async (spaceId, uid, name, target, targetName, mode) => ({ id: 'outgoing', spaceId, callerId: uid, calleeId: target, mode, status: 'ringing', expiresAt: Date.now() + 120000 }),
    },
    '../services/backgroundMedia': { getBackgroundMedia: () => null, backgroundMediaError: () => null, subscribeBackgroundMedia: () => () => {}, backgroundMediaSupported: () => false },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/hooks/useCall.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => dependencies[name],
      setTimeout: (callback, delay) => { timers.set(++sequence, { callback, delay }); return sequence; }, clearTimeout: id => timers.delete(id), setInterval: () => 0, clearInterval() {} });
  function flush() {
    let attempts = 0;
    do {
      assert(++attempts < 30, 'Hook must settle'); dirty = false; cursor = 0;
      result = module.exports.useCall(props);
      const effects = pending; pending = []; effects.forEach(effect => effect());
    } while (dirty || pending.length);
    return result;
  }
  return {
    render(next = { uid: 'bob', spaceId: 'space', name: 'Bob', memberIds: ['alice', 'bob'], requesterIds: ['alice'] }) { props = next; return flush(); },
    flush, listeners, timers,
    focus() { [...appListeners].forEach(callback => callback('active')); return flush(); },
    tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); return flush(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}
const incoming = { id: 'incoming', callerId: 'alice', calleeId: 'bob', status: 'ringing', access: 'front', expiresAt: Date.now() + 120000 };

test('a denied incoming listener reconnects and delivers recipient approval without restarting the app', () => {
  const value = harness(); value.render();
  value.listeners[0].fail(new Error('Firebase denied access'));
  assert.match(value.flush().incomingError, /Firebase denied access/);
  assert.equal(value.timers.size, 1);
  value.tick(); assert(value.listeners[0].stopped);
  value.listeners[1].next([incoming]);
  const call = value.flush(); assert.equal(call.incoming.id, incoming.id); assert.equal(call.incomingError, null); assert.equal(call.active, null);
  value.unmount();
});

test('automatic retries are bounded and manual retry and app resume restart failed subscriptions', () => {
  const value = harness(); value.render();
  for (let index = 0; index < 4; index++) {
    value.listeners.at(-1).fail(new Error('Denied')); value.flush();
    if (index < 3) value.tick();
  }
  assert.equal(value.timers.size, 0);
  value.flush().retryIncoming(); value.flush(); assert.equal(value.listeners.length, 5);
  value.listeners.at(-1).fail(new Error('Denied')); value.flush();
  value.focus(); assert.equal(value.listeners.length, 6); assert.equal(value.timers.size, 0);
  value.unmount(); assert(value.listeners.every(listener => listener.stopped));
});

test('an incoming-listener failure cannot replace or stop an outbound request', async () => {
  const value = harness(); const call = value.render();
  await call.startCall('alice', 'Alice', 'video'); value.flush();
  value.listeners[0].fail(new Error('Denied'));
  const current = value.flush(); assert.equal(current.active.id, 'outgoing'); assert.equal(current.error, null); assert(current.incomingError);
  value.unmount();
});

test('changing accounts cancels pending retries and ignores callbacks from the old subscription', () => {
  const value = harness(); value.render(); value.listeners[0].fail(new Error('Denied')); value.flush();
  value.render({ uid: 'charlie', spaceId: 'other', name: 'Charlie', memberIds: ['charlie'], requesterIds: [] });
  assert.equal(value.timers.size, 0); assert(value.listeners[0].stopped);
  value.listeners[0].next([incoming]); assert.equal(value.flush().incoming, null);
  value.unmount();
});
