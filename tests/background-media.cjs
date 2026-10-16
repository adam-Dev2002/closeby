const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, setTimeout, clearTimeout, require: name => dependencies[name] });
  return module.exports;
}
const calls = load('src/lib/calls.ts');
const { createBackgroundMedia } = load('src/lib/backgroundMedia.ts', { './calls': calls });
const call = () => ({ id: 'session', spaceId: 'family', callerId: 'alice', calleeId: 'bob', callerName: 'Alice', calleeName: 'Bob', mode: 'video', access: 'back', status: 'accepted', offer: null, answer: null, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 7200000 });
function harness(options = {}) {
  const events = {}, signals = [], services = [], finishes = [], stopped = [], listeners = {};
  const tracks = ['audio', 'video'].map(kind => ({ kind, enabled: true, stopped: false, stop() { this.stopped = true; }, addEventListener(name, listener) { listeners[`${kind}:${name}`] = listener; } }));
  const stream = { getTracks: () => tracks, toURL: () => 'native-stream', release() { this.released = true; } };
  const peer = { remoteDescription: null, localDescription: null, candidates: [],
    addEventListener: (name, listener) => { events[name] = listener; },
    async addIceCandidate(candidate) { this.candidates.push(candidate); },
    async setRemoteDescription(value) { this.remoteDescription = value; },
    async createAnswer() { return { type: 'answer', sdp: 'native-answer' }; },
    async setLocalDescription(value) { this.localDescription = value; },
    close() { this.closed = true; }, connectionState: 'connecting' };
  const deps = {
    validate: async value => { if (options.validationError) throw new Error('Not authorized'); return value; },
    startService: async value => { services.push(value); if (options.serviceError) throw new Error('Notification permission denied'); },
    stopService: id => stopped.push(id),
    createMedia: async () => { if (options.capture) await options.capture; return { peer, stream }; },
    registerResources: async () => {},
    watchCall: (_call, _uid, next, fail) => { events.call = next; events.callError = fail; return () => { events.callStopped = true; }; },
    watchCandidates: (_call, _uid, next) => { events.candidates = next; return () => { events.candidatesStopped = true; }; },
    watchAccess: (_call, _uid, next) => { events.revoke = next; if (options.withdrawn) next('Approval withdrawn'); return () => { events.accessStopped = true; }; },
    signal: async (_call, uid, signal) => { signals.push({ uid, ...signal }); },
    finish: async value => { finishes.push(value); },
  };
  const engine = createBackgroundMedia(deps);
  return { engine, peer, stream, tracks, events, signals, services, finishes, stopped, listeners, flush: () => new Promise(resolve => setImmediate(resolve)) };
}
test('background media refuses unapproved, expired, regular-call and wrong-recipient sessions before starting a service', async () => {
  for (const override of [{ status: 'ringing' }, { expiresAt: 1 }, { access: undefined }]) {
    const value = harness(); await assert.rejects(value.engine.start({ ...call(), ...override }, 'bob'), /Approve/); assert.equal(value.services.length, 0);
  }
  const value = harness(); await assert.rejects(value.engine.start(call(), 'alice'), /Approve/); assert.equal(value.services.length, 0);
});
test('server authorization or notification failure never leaves capture running', async () => {
  for (const options of [{ validationError: true }, { serviceError: true }]) {
    const value = harness(options); await assert.rejects(value.engine.start(call(), 'bob'));
    assert.equal(value.engine.get(), null); assert.equal(value.peer.localDescription, null);
  }
});
test('approval withdrawn during startup prevents the foreground service and capture from starting', async () => {
  const value = harness({ withdrawn: true }); await value.engine.start(call(), 'bob');
  assert.equal(value.engine.get(), null); assert.equal(value.services.length, 0); assert(value.events.accessStopped);
});
test('a native session outlives screen subscriptions, answers the approved offer and preserves mute when the screen reopens', async () => {
  const value = harness(), request = call();
  let updates = 0; const unsubscribeScreen = value.engine.subscribe(() => { updates++; });
  await value.engine.start(request, 'bob'); assert.equal(value.engine.get().streamURL, 'native-stream');
  unsubscribeScreen(); // React screen/task removal does not own the media engine.
  const previous = updates;
  value.engine.controls(request.id, true, true); assert(value.tracks.every(track => !track.enabled));
  let reopened = value.engine.get(); assert.equal(reopened.muted, true); assert.equal(reopened.cameraOff, true);
  value.events.call({ ...request, offer: { type: 'offer', sdp: 'browser-offer' } }); await value.flush();
  assert.equal(value.signals[0].type, 'answer'); assert.equal(value.signals[0].uid, 'bob');
  value.peer.connectionState = 'connected'; value.events.connectionstatechange();
  assert.equal(value.engine.get().phase, 'connected'); assert.equal(updates, previous);
  assert.equal(value.stream.released, undefined); assert.equal(value.stopped.length, 0);
  value.engine.stop(); assert(value.tracks.every(track => track.stopped)); assert(value.stream.released); assert(value.peer.closed);
});
test('the headless task stays alive until stop releases native capture and finishes the session', async () => {
  const value = harness(); await value.engine.start(call(), 'bob'); let finished = false;
  const task = value.engine.wait('session').then(() => { finished = true; });
  await value.flush(); assert.equal(finished, false);
  value.engine.stop(); await task;
  assert(finished); assert(value.stream.released); assert(value.peer.closed); assert.equal(value.stopped[0], 'session'); assert.equal(value.finishes.length, 1);
  assert(value.events.callStopped && value.events.candidatesStopped && value.events.accessStopped);
});
test('revocation, remote stop, camera changes and permission loss release all capture without waiting for backend writes', async () => {
  for (const trigger of [value => value.events.revoke('Authorization revoked'), value => value.events.call({ ...call(), status: 'ended' }), value => value.events.call({ ...call(), access: 'front' }), value => value.listeners['video:ended'](), value => value.events.callError(new Error('Membership lost'))]) {
    const value = harness(); await value.engine.start(call(), 'bob'); trigger(value);
    assert.equal(value.engine.get(), null); assert(value.tracks.every(track => track.stopped)); assert(value.stream.released); assert(value.peer.closed);
  }
});
test('stopping while media permission is pending releases late resources and never restores a session', async () => {
  let resolve;
  const value = harness({ capture: new Promise(done => { resolve = done; }) });
  const start = value.engine.start(call(), 'bob'); await value.flush(); value.engine.stop(); resolve(); await start;
  assert.equal(value.engine.get(), null); assert(value.stream.released); assert(value.peer.closed);
});
test('ICE waits for the offer and ignores duplicate candidates, and no second session may replace approved capture', async () => {
  const value = harness(), request = call(); await value.engine.start(request, 'bob');
  await assert.rejects(value.engine.start({ ...request, id: 'another' }, 'bob'), /End your current/);
  const candidate = { id: 'ice', candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 };
  value.events.candidates([candidate]); await value.flush(); assert.equal(value.peer.candidates.length, 0);
  value.events.call({ ...request, offer: { type: 'offer', sdp: 'browser-offer' } }); await value.flush();
  value.events.candidates([candidate]); await value.flush(); assert.equal(value.peer.candidates.length, 1);
  value.engine.stop();
});
