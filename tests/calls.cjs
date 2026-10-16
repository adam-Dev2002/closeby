const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
function load(file, dependencies = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { module, exports: module.exports, URL, AbortController, setTimeout, clearTimeout, process: { env: {} }, require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw Error(name); }, ...globals });
  return module.exports;
}
const api = load('src/lib/calls.ts');
const htmlApi = load('src/lib/callMediaHtml.ts', { './calls': api });
const base = { id: 'call', spaceId: 'family', callerId: 'alice', calleeId: 'bob', callerName: 'Alice', calleeName: 'Bob', mode: 'video', status: 'ringing', offer: null, answer: null, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 10000 };
const candidate = { candidate: 'candidate:1 1 udp 1 127.0.0.1 1234 typ host', sdpMid: '0', sdpMLineIndex: 0 };

test('native media messages accept Android source origins and legacy document URLs only from the owned page', () => {
  for (const source of ['https://closeby.local', 'https://closeby.local/call/', 'about:blank', undefined]) {
    assert(htmlApi.isCallMediaSource(source), `Trusted source: ${source}`);
  }
  for (const source of ['https://closeby.local.evil.example', 'https://closeby.local@evil.example/', 'http://closeby.local/call/', 'https://evil.example/', 'null', 'data:text/html,test']) {
    assert.equal(htmlApi.isCallMediaSource(source), false, `Untrusted source: ${source}`);
  }
});

test('Android origin-only WebView events reach native call state and signaling callbacks', () => {
  let stateIndex = 0;
  const channel = 'closeby-call:call:alice', signals = [], states = [], errors = [];
  const react = { useRef: current => ({ current }), useEffect() {}, useMemo: create => create(),
    useState: initial => [stateIndex++ === 0 ? { channel, role: 'caller', mode: 'video', iceServers: [] } : initial, () => {}] };
  const jsx = (type, props) => ({ type, props });
  const native = { View: 'View', Text: 'Text', ActivityIndicator: 'Spinner', PermissionsAndroid: {}, Platform: { OS: 'android' }, StyleSheet: { create: value => value } };
  const component = load('src/components/CallMedia.tsx', { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'react-native-webview': { WebView: 'WebView' }, '../lib/callMediaHtml': htmlApi, '../lib/calls': api, '../services/calls': {}, '../theme': { colors: {} } });
  const tree = component.CallMedia({ call: { ...base, status: 'accepted' }, uid: 'alice', candidates: [], muted: false, cameraOff: false,
    onSignal: event => signals.push(event), onState: state => states.push(state), onError: error => errors.push(error) });
  const webview = tree.props.children.find(child => child?.type === 'WebView');
  const emit = (url, event) => webview.props.onMessage({ nativeEvent: { url, data: JSON.stringify({ channel, ...event }) } });
  emit('https://closeby.local', { type: 'state', state: 'connected' });
  emit('https://closeby.local', { type: 'offer', description: { type: 'offer', sdp: 'v=0' } });
  emit('https://closeby.local', { type: 'error', message: 'Camera unavailable' });
  assert.deepEqual(states, ['connected']); assert.equal(signals.length, 1); assert.deepEqual(errors, ['Camera unavailable']);
  emit('https://closeby.local.evil.example/', { type: 'state', state: 'closed' });
  emit('https://evil.example/', { type: 'offer', description: { type: 'offer', sdp: 'v=0' } });
  emit('https://closeby.local', { channel: 'another-call', type: 'state', state: 'closed' });
  assert.deepEqual(states, ['connected']); assert.equal(signals.length, 1);
});
test('acceptance belongs only to the named recipient of an unexpired ringing request', () => {
  assert(api.canAccept(base, 'bob')); assert(!api.canAccept(base, 'alice')); assert(!api.canAccept(base, 'admin'));
  assert(!api.canAccept({ ...base, status: 'ended' }, 'bob')); assert(!api.canAccept(base, 'bob', base.expiresAt));
});
test('signaling requires acceptance, participant identity, sequence and immutable descriptions', () => {
  assert(!api.canSignal(base, 'alice', 'offer'));
  const accepted = { ...base, status: 'accepted' };
  assert(api.canSignal(accepted, 'alice', 'offer')); assert(!api.canSignal(accepted, 'bob', 'offer'));
  assert(!api.canSignal(accepted, 'bob', 'answer')); assert(!api.canSignal(accepted, 'admin', 'candidate'));
  const offered = { ...accepted, offer: { type: 'offer', sdp: 'v=0' } };
  assert(api.canSignal(offered, 'bob', 'answer')); assert(!api.canSignal(offered, 'alice', 'offer'));
  assert(!api.canSignal({ ...offered, answer: { type: 'answer', sdp: 'v=0' } }, 'bob', 'answer'));
  assert(!api.canSignal(accepted, 'alice', 'candidate', accepted.expiresAt));
});
test('media bridge ignores other call channels, unknown events and malformed descriptions/candidates', () => {
  assert.equal(api.parseMediaEvent('not-json', 'mine'), null);
  assert.equal(api.parseMediaEvent({ channel: 'other', type: 'ready' }, 'mine'), null);
  assert.equal(api.parseMediaEvent({ channel: 'mine', type: 'spy' }, 'mine'), null);
  assert.equal(api.parseMediaEvent({ channel: 'mine', type: 'offer', description: { type: 'answer', sdp: 'v=0' } }, 'mine'), null);
  assert.equal(api.parseMediaEvent({ channel: 'mine', type: 'candidate', candidate: { ...candidate, sdpMLineIndex: -1 } }, 'mine'), null);
  assert.equal(api.parseMediaEvent({ channel: 'mine', type: 'candidate', candidate: { ...candidate, token: 'unexpected' } }, 'mine'), null);
  assert.equal(api.parseMediaEvent({ channel: 'mine', type: 'offer', description: { type: 'offer', sdp: 'x'.repeat(api.MAX_SDP_LENGTH + 1) } }, 'mine'), null);
  assert.equal(api.parseMediaEvent({ channel: 'mine', type: 'state', state: 'connected' }, 'mine').state, 'connected');
});
test('document configuration cannot terminate its script or inject HTML', () => {
  const html = htmlApi.callMediaHtml({ channel: '</script><script>alert(1)</script>', role: 'caller', mode: 'voice', iceServers: api.defaultIceServers });
  assert.equal((html.match(/<script>/g) || []).length, 1); assert(!html.includes('</script><script>alert'));
});
test('ICE configuration permits STUN and authenticated TURN and rejects unsafe URLs or missing credentials', () => {
  assert(api.validIceServers(api.defaultIceServers)); assert(api.validIceServers([{ urls: 'turns:relay.example:443?transport=tcp', username: 'temporary', credential: 'temporary' }]));
  assert.equal(api.validIceServers([{ urls: 'https://relay.example' }]), null);
  assert.equal(api.validIceServers([{ urls: 'turn:relay.example' }]), null);
  assert.equal(api.validIceServers([{ urls: 'turn:user@relay.example', username: 'x', credential: 'y' }]), null);
});

function engine(role = 'caller', mode = 'video', secure = true, access, options = {}) {
  const messages = [], events = {}, elements = new Map();
  const tracks = ['audio', ...(mode === 'video' ? ['video'] : [])].map(kind => ({ kind, enabled: true, stopped: false, getSettings: () => ({ facingMode: options.facing ?? (access === 'back' ? 'environment' : 'user') }), stop() { this.stopped = true; } }));
  const stream = { getTracks: () => tracks, getVideoTracks: () => tracks.filter(track => track.kind === 'video') };
  let requested = 0, peer, constraints;
  const element = id => { if (!elements.has(id)) elements.set(id, { classList: { add() {} }, style: {}, srcObject: null, play: async () => {}, textContent: '' }); return elements.get(id); };
  class Peer {
    constructor() { peer = this; this.connectionState = 'connecting'; this.added = []; this.candidates = []; }
    addTrack(track) { this.added.push(track); }
    addTransceiver(kind, options) { this.added.push({ kind, ...options }); }
    async createOffer() { return { type: 'offer', sdp: 'caller-offer' }; }
    async createAnswer() { return { type: 'answer', sdp: 'callee-answer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    async addIceCandidate(value) { this.candidates.push(value); }
    close() { this.closed = true; }
  }
  const window = { isSecureContext: secure, RTCPeerConnection: Peer, ReactNativeWebView: { postMessage: value => messages.push(JSON.parse(value)) }, addEventListener: (name, action) => { events[name] = action; } };
  const document = { hidden: false, getElementById: element, addEventListener: (name, action) => { events[name] = action; } };
  const html = htmlApi.callMediaHtml({ channel: 'mine', role, mode, access, iceServers: api.defaultIceServers });
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], { window, document, navigator: { mediaDevices: { getSupportedConstraints: () => ({ facingMode: options.supportsFacing !== false }), getUserMedia: async value => { requested++; constraints = value; if (options.denied) throw { name: 'NotAllowedError' }; if (options.defer) await options.defer; assert.equal(value.video === false, mode === 'voice'); return stream; } } }, RTCPeerConnection: Peer, MediaStream: class {}, location: { origin: 'https://closeby.local' }, setTimeout, clearTimeout });
  return { messages, events, tracks, window, document, get peer() { return peer; }, get constraints() { return constraints; }, get requested() { return requested; }, flush: async () => { await new Promise(resolve => setImmediate(resolve)); }, update: value => window.closebyCallUpdate({ channel: 'mine', ...value }) };
}
test('video engine emits caller offer, buffers remote ICE until an answer, and applies mute/camera controls', async () => {
  const value = engine(); await value.flush();
  assert.equal(value.requested, 1); assert.equal(value.peer.added.length, 2); assert(value.messages.some(item => item.type === 'offer'));
  value.update({ type: 'remote', description: null, candidates: [{ id: 'first', ...candidate }] }); await value.flush(); assert.equal(value.peer.candidates.length, 0);
  value.update({ type: 'remote', description: { type: 'answer', sdp: 'remote-answer' }, candidates: [{ id: 'first', ...candidate }] }); await value.flush(); assert.equal(value.peer.candidates.length, 1);
  value.update({ type: 'controls', muted: true, cameraOff: true }); await value.flush(); assert(value.tracks.every(track => !track.enabled));
  value.update({ type: 'controls', muted: false, cameraOff: false }); await value.flush(); assert(value.tracks.every(track => track.enabled));
  value.update({ type: 'stop' }); assert(value.tracks.every(track => track.stopped)); assert(value.peer.closed);
});
test('callee emits an answer only after receiving an offer and ignores duplicate remote candidates', async () => {
  const value = engine('callee', 'voice'); await value.flush(); assert(!value.messages.some(item => item.type === 'answer'));
  value.update({ type: 'remote', description: { type: 'offer', sdp: 'remote-offer' }, candidates: [{ id: 'same', ...candidate }] }); await value.flush();
  value.update({ type: 'remote', description: { type: 'offer', sdp: 'remote-offer' }, candidates: [{ id: 'same', ...candidate }] }); await value.flush();
  assert.equal(value.messages.filter(item => item.type === 'answer').length, 1); assert.equal(value.peer.candidates.length, 1); value.update({ type: 'stop' });
});
test('insecure browser pages never request media and explain the HTTPS/localhost requirement', async () => {
  const value = engine('caller', 'voice', false); await value.flush(); assert.equal(value.requested, 0); assert(value.messages.some(item => item.type === 'error' && item.message.includes('secure')));
});
test('wrong-channel stop cannot interrupt capture; background/hidden state stops every media track', async () => {
  const value = engine(); await value.flush(); value.window.closebyCallUpdate({ channel: 'other', type: 'stop' }); assert(value.tracks.every(track => !track.stopped));
  value.document.hidden = true; value.events.visibilitychange(); assert(value.tracks.every(track => track.stopped)); assert(value.messages.some(item => item.type === 'state' && item.state === 'closed'));
});

function service(options = {}) {
  let identity = 'alice', sequence = 0, tokens = 0;
  const records = new Map(), writes = [], listeners = [];
  class Timestamp { constructor(value) { this.value = value; } toMillis() { return this.value; } static fromMillis(value) { return new Timestamp(value); } }
  const collection = (parent, ...parts) => ({ path: [parent?.path, ...parts].filter(Boolean).join('/') });
  const doc = (parent, ...parts) => ({ path: parts.length ? [parent?.path, ...parts].filter(Boolean).join('/') : `${parent.path}/new-${++sequence}`, id: parts.length ? parts.at(-1) : `new-${sequence}` });
  const snapshot = ref => ({ id: ref.id, exists: () => records.has(ref.path), data: () => records.get(ref.path) });
  const firestore = { Timestamp, collection, doc, serverTimestamp: () => Timestamp.fromMillis(Date.now()), where: (...args) => args, orderBy: (...args) => args, limit: value => value, query: (...args) => args,
    runTransaction: async (_db, action) => action({ get: async ref => snapshot(ref), set: (ref, value) => { records.set(ref.path, value); writes.push({ path: ref.path, value }); }, update: (ref, value) => { records.set(ref.path, { ...records.get(ref.path), ...value }); writes.push({ path: ref.path, value }); } }),
    addDoc: async (parent, value) => { const ref = doc(parent); records.set(ref.path, value); writes.push({ path: ref.path, value }); return ref; },
    onSnapshot: (ref, next, fail) => { const listener = { ref, next, fail, stopped: false }; listeners.push(listener); return () => { listener.stopped = true; }; },
  };
  const firebaseAuth = { get currentUser() { return { uid: identity, getIdToken: async () => { tokens++; return 'private-session-token'; } }; } };
  records.set('circles/family/members/bob', { uid: 'bob' });
  const api = load('src/services/calls.ts', { 'firebase/firestore': firestore, '../lib/firebase': { firebaseAuth, requireFirestore: () => ({}) }, '../lib/calls': globalApi }, { process: { env: options.endpoint ? { EXPO_PUBLIC_CALLS_TURN_CREDENTIALS_URL: options.endpoint } : {} }, fetch: options.fetch });
  return { api, records, writes, Timestamp, listeners, setUser: uid => { identity = uid; }, get tokens() { return tokens; } };
}
const globalApi = api;
test('call creation contains no media, starts ringing and expires in two minutes', async () => {
  const value = service(), now = Date.now(); const call = await value.api.startCall('family', 'alice', 'Alice', 'bob', 'Bob', 'voice');
  assert.equal(call.status, 'ringing'); assert.equal(call.offer, null); assert.equal(call.answer, null); assert(call.expiresAt >= now + api.RING_TIMEOUT_MS);
  assert.deepEqual(Object.keys(value.writes[0].value).sort(), ['answer', 'calleeId', 'calleeName', 'callerId', 'callerName', 'createdAt', 'expiresAt', 'mode', 'offer', 'status', 'updatedAt'].sort());
});
test('service requires the current account and an existing recipient; self-calls are rejected', async () => {
  const value = service(); await assert.rejects(value.api.startCall('family', 'admin', 'Admin', 'bob', 'Bob', 'voice'), /Sign in/);
  await assert.rejects(value.api.startCall('family', 'alice', 'Alice', 'alice', 'Alice', 'voice'), /another member/);
  await assert.rejects(value.api.startCall('family', 'alice', 'Alice', 'stranger', 'Unknown', 'voice'), /left your space/); assert.equal(value.writes.length, 0);
});
test('recipient acceptance is explicit, caller cannot accept, and SDP authors cannot overwrite each other', async () => {
  const value = service(); const call = await value.api.startCall('family', 'alice', 'Alice', 'bob', 'Bob', 'video');
  await assert.rejects(value.api.acceptCall(call, 'alice'), /ended or expired/);
  value.setUser('bob'); await value.api.acceptCall(call, 'bob'); let accepted = { ...call, status: 'accepted', expiresAt: Date.now() + api.CALL_MAX_MS };
  assert.equal(value.records.get(`circles/family/calls/${call.id}`).status, 'accepted');
  await assert.rejects(value.api.publishSignal(accepted, 'bob', { type: 'offer', description: { type: 'offer', sdp: 'v=0' } }), /not ready/);
  value.setUser('alice'); await value.api.publishSignal(accepted, 'alice', { type: 'offer', description: { type: 'offer', sdp: 'v=0' } });
  await assert.rejects(value.api.publishSignal(accepted, 'alice', { type: 'offer', description: { type: 'offer', sdp: 'v=0 again' } }), /already configured/);
  value.setUser('bob'); accepted = { ...accepted, offer: { type: 'offer', sdp: 'v=0' } }; await value.api.publishSignal(accepted, 'bob', { type: 'answer', description: { type: 'answer', sdp: 'v=0 answer' } });
  await value.api.finishCall(accepted, 'bob'); await assert.rejects(value.api.publishSignal(accepted, 'bob', { type: 'answer', description: { type: 'answer', sdp: 'late' } }), /ended/);
});
test('default calling uses STUN without exposing Firebase tokens to a relay', async () => {
  const value = service(); const result = await value.api.loadCallIce('alice'); assert.equal(result.relay, false); assert.equal(value.tokens, 0);
});
test('relay fetch uses HTTPS and authenticated headers; returned credentials are validated', async () => {
  let request;
  const value = service({ endpoint: 'https://relay.example/credentials', fetch: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ iceServers: [{ urls: 'turns:relay.example:443', username: 'temporary', credential: 'temporary' }], expiresAt: Date.now() + 60000 }) }; } });
  assert.equal((await value.api.loadCallIce('alice')).relay, true); assert.equal(request.options.headers.Authorization, 'Bearer private-session-token');
  const insecure = service({ endpoint: 'http://relay.example/credentials' }); await assert.rejects(insecure.api.loadCallIce('alice'), /HTTPS/); assert.equal(insecure.tokens, 0);
  const expired = service({ endpoint: 'https://relay.example/credentials', fetch: async () => ({ ok: true, json: async () => ({ iceServers: api.defaultIceServers, expiresAt: 1 }) }) }); await assert.rejects(expired.api.loadCallIce('alice'), /expired/);
});
test('incoming and ringing calls do not mount a media capture screen before acceptance', () => {
  const jsx = (type, props) => ({ type, props }), Media = function Media() {};
  const component = load('src/components/CallPanel.tsx', { 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, react: { useEffect() {}, useState: value => [value, () => {}] },
    'react-native': { Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: value => value } }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    './CallMedia': { CallMedia: Media }, './BackgroundCallMedia': { BackgroundCallMedia: 'BackgroundMedia' }, '../lib/calls': api, './Ui': { Button: 'Button', RoundButton: 'RoundButton', ui: {} }, './Icon': { Icon: 'Icon' }, '../theme': { colors: {} } });
  function hasMedia(tree) { if (!tree || typeof tree !== 'object') return false; if (Array.isArray(tree)) return tree.some(hasMedia); return tree.type === Media || hasMedia(tree.props?.children); }
  const controller = { uid: 'alice', error: null, loading: false, phase: 'ringing', candidates: [] };
  assert(!hasMedia(component.CallPanel({ call: { ...controller, active: null, incoming: base } })));
  assert(!hasMedia(component.CallPanel({ call: { ...controller, active: base, incoming: null } })));
  assert(hasMedia(component.CallPanel({ call: { ...controller, active: { ...base, status: 'accepted' }, incoming: null } })));
  for (const access of ['microphone', 'front', 'back']) {
    assert(!hasMedia(component.CallPanel({ call: { ...controller, active: null, incoming: { ...base, access } } })));
    assert(!hasMedia(component.CallPanel({ call: { ...controller, active: { ...base, access }, incoming: null } })));
  }
});

test('device access requesters receive only and never request microphone or camera capture', async () => {
  for (const access of ['microphone', 'front', 'back']) {
    const value = engine('caller', access === 'microphone' ? 'voice' : 'video', true, access); await value.flush();
    assert.equal(value.requested, 0); assert.equal(value.peer.added.length, access === 'microphone' ? 1 : 2);
    assert(value.peer.added.every(track => track.direction === 'recvonly'));
    assert(value.messages.some(item => item.type === 'offer')); value.update({ type: 'stop' });
  }
});
test('approved front and rear camera requests require the exact camera and keep capture local to the recipient', async () => {
  for (const access of ['front', 'back']) {
    const value = engine('callee', 'video', true, access); await value.flush();
    assert.equal(value.constraints.video.facingMode.exact, access === 'back' ? 'environment' : 'user');
    assert.equal(value.peer.added.length, 2); assert(!value.messages.some(item => item.type === 'offer'));
    value.update({ type: 'stop' }); assert(value.tracks.every(track => track.stopped));
  }
});
test('unavailable or unconfirmed approved cameras fail closed without publishing an offer or answer', async () => {
  for (const options of [{ supportsFacing: false }, { facing: 'user' }, { denied: true }]) {
    const value = engine('callee', 'video', true, 'back', options); await value.flush();
    assert(value.messages.some(item => item.type === 'error')); assert(!value.peer);
    assert(!value.messages.some(item => item.type === 'offer' || item.type === 'answer'));
    if (options.facing) assert(value.tracks.every(track => track.stopped));
  }
});
test('stopping during a pending permission prompt stops any late tracks without creating a connection', async () => {
  let resolve;
  const value = engine('callee', 'video', true, 'front', { defer: new Promise(done => { resolve = done; }) });
  value.update({ type: 'stop' }); resolve(); await value.flush();
  assert(value.tracks.every(track => track.stopped)); assert(!value.peer);
});
test('microphone requests capture audio only and permission revocation closes the session', async () => {
  const value = engine('callee', 'voice', true, 'microphone'); await value.flush();
  assert.equal(value.constraints.video, false); assert.equal(value.peer.added.length, 1);
  value.tracks[0].onended(); assert(value.tracks.every(track => track.stopped)); assert(value.peer.closed);
  assert(value.messages.some(item => item.type === 'error'));
});
test('device access creation preserves the approved mode and rejects invalid camera choices', async () => {
  const value = service();
  for (const access of ['microphone', 'front', 'back']) {
    const call = await value.api.startCall('family', 'alice', 'Alice', 'bob', 'Bob', access === 'microphone' ? 'voice' : 'video', access);
    assert.equal(call.access, access); assert.equal(call.status, 'ringing');
  }
  await assert.rejects(value.api.startCall('family', 'alice', 'Alice', 'bob', 'Bob', 'voice', 'back'), /Choose a microphone/);
  await assert.rejects(value.api.startCall('family', 'alice', 'Alice', 'bob', 'Bob', 'video', 'hidden'), /Choose a microphone/);
});
test('incoming listeners constrain caller membership, handle larger spaces and clear requests on failure', () => {
  const value = service(); value.setUser('bob'); let calls = [];
  const members = Array.from({ length: 18 }, (_, index) => `member${index}`);
  value.api.watchIncoming('family', 'bob', ['bob', ...members], next => { calls = next; }, () => {});
  assert.equal(value.listeners.length, 3);
  for (const listener of value.listeners) {
    const filter = listener.ref.find(part => Array.isArray(part) && part[0] === 'callerId');
    assert.equal(filter[1], 'in'); assert(filter[2].length <= 8); assert(!filter[2].includes('bob'));
  }
  assert.equal(calls.length, 0);
  value.listeners[0].fail(new Error('Membership revoked')); assert.equal(calls.length, 0);
});
