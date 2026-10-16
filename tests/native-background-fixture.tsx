// Dedicated Metro entry for the isolated emulator integration test. Never
// imported by the app entry, and never connects to Firebase or real accounts.
import React, { useEffect, useState } from 'react';
import { registerRootComponent } from 'expo';
import { AppRegistry, Button, NativeEventEmitter, NativeModules, Text, View } from 'react-native';
import { mediaDevices, RTCPeerConnection, RTCView } from 'react-native-webrtc';
import { createBackgroundMedia } from '../src/lib/backgroundMedia';
import type { DeviceAccess, SpaceCall } from '../src/lib/calls';
if (!__DEV__) throw new Error('This fixture is for local development only.');
const origin = 'http://127.0.0.1:8095';
const bridge = NativeModules.ClosebyMediaSession;
let peer: RTCPeerConnection | null = null;
const post = (path: string, body: unknown) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const engine = createBackgroundMedia({
  validate: async call => call,
  startService: call => bridge.start(call.id, `LOCAL TEST: ${call.access} shared after explicit approval. Stop sharing below.`, call.mode === 'video', call.expiresAt),
  stopService: id => bridge.stop(id),
  async createMedia(call, isActive) {
    if (!isActive()) throw new Error('Stopped');
    const stream = await mediaDevices.getUserMedia({ audio: true, video: call.mode === 'video' ? { facingMode: { exact: call.access === 'back' ? 'environment' : 'user' }, width: 320, height: 240 } : false });
    if (call.mode === 'video' && stream.getVideoTracks()[0]?.getSettings().facingMode !== (call.access === 'back' ? 'environment' : 'user')) {
      stream.getTracks().forEach(track => track.stop()); stream.release(); throw new Error('The approved test camera was not selected.');
    }
    peer = new RTCPeerConnection({ iceServers: [] });
    stream.getTracks().forEach(track => peer!.addTrack(track, stream));
    return { peer, stream };
  },
  registerResources: (id, peer, stream) => bridge.registerResources(id, peer._pcId, stream.toURL(), stream.getTracks().map(track => track.id)),
  watchCall: (call, _uid, next, fail) => {
    const poll = () => { void fetch(`${origin}/signal`).then(value => value.json()).then(value => next({ ...call, offer: value.offer })).catch(fail); };
    poll(); const timer = setInterval(poll, 500); return () => clearInterval(timer);
  },
  watchCandidates: (_call, _uid, next, fail) => {
    const poll = () => { void fetch(`${origin}/signal`).then(value => value.json()).then(value => next(value.candidates)).catch(fail); };
    poll(); const timer = setInterval(poll, 500); return () => clearInterval(timer);
  },
  watchAccess: () => () => {},
  signal: async (_call, _uid, signal) => { await post('/native-signal', signal); },
  finish: async () => { await post('/native-stopped', {}); },
});
new NativeEventEmitter(bridge).addListener('ClosebyMediaStopped', id => { if (engine.get()?.call.id === id) engine.stop(); });
AppRegistry.registerHeadlessTask('ClosebyMediaSession', () => async ({ id }: { id: string }) => engine.wait(id));
engine.subscribe(() => { void post('/native-state', { session: engine.get(), error: engine.error() }).catch(() => undefined); });

function Fixture() {
  const [snapshot, setSnapshot] = useState(engine.get), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void post('/screen-mounted', {});
    // Explicit approval comes from the isolated local test driver. This entry
    // is never imported into the product, and uses only virtual emulator media.
    void fetch(`${origin}/configuration`).then(value => value.json()).then(value => {
      if (value.approveLocalTest === true && ['microphone', 'front', 'back'].includes(value.access)) return start(value.access);
    });
    const unsubscribe = engine.subscribe(() => setSnapshot(engine.get()));
    return () => { unsubscribe(); void post('/screen-unmounted', {}); };
  }, []);
  async function start(access: DeviceAccess) {
    try {
      const call: SpaceCall = { id: `local-${Date.now()}`, spaceId: 'local-fixture', callerId: 'local-browser', calleeId: 'local-emulator', callerName: 'Local browser', calleeName: 'Local emulator', access,
        mode: access === 'microphone' ? 'voice' : 'video', status: 'accepted', offer: null, answer: null, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 300000 };
      await engine.start(call, call.calleeId);
    } catch (cause) { setError(String(cause)); void post('/native-error', String(cause)); }
  }
  return <View style={{ flex: 1, padding: 30, paddingTop: 70, backgroundColor: '#102030', gap: 20 }}>
    <Text style={{ color: 'white', fontSize: 20 }}>Local background media test</Text>
    <Text style={{ color: 'white' }}>{snapshot ? `${snapshot.phase}: ${snapshot.call.access}` : 'Ready for explicit test approval'}</Text>
    <Text style={{ color: 'white' }}>{error || engine.error()}</Text>
    {(['microphone', 'front', 'back'] as const).map(access => <Button key={access} title={`Approve test ${access}`} onPress={() => void start(access)} />)}
    <Button title="Stop sharing" onPress={() => engine.stop()} />
    {snapshot?.streamURL && snapshot.call.mode === 'video' && <RTCView streamURL={snapshot.streamURL} style={{ flex: 1 }} />}
  </View>;
}
registerRootComponent(Fixture);
