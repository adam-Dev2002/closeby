import type { MediaStream, RTCPeerConnection } from 'react-native-webrtc';
import { callExpired, type CallCandidate, type CallSignal, type SpaceCall } from './calls';

export type BackgroundMediaSnapshot = { call: SpaceCall; uid: string; phase: 'connecting' | 'connected'; streamURL: string | null; muted: boolean; cameraOff: boolean };
type Stop = () => void;
export type BackgroundMediaDependencies = {
  validate: (call: SpaceCall, uid: string) => Promise<SpaceCall>;
  startService: (call: SpaceCall) => Promise<void>;
  stopService: (id: string) => void;
  createMedia: (call: SpaceCall, isActive: () => boolean) => Promise<{ peer: RTCPeerConnection; stream: MediaStream }>;
  registerResources: (id: string, peer: RTCPeerConnection, stream: MediaStream) => Promise<void>;
  watchCall: (call: SpaceCall, uid: string, next: (call: SpaceCall | null) => void, fail: (error: unknown) => void) => Stop;
  watchCandidates: (call: SpaceCall, uid: string, next: (candidates: CallCandidate[]) => void, fail: (error: unknown) => void) => Stop;
  watchAccess: (call: SpaceCall, uid: string, stop: (message: string) => void) => Stop;
  signal: (call: SpaceCall, uid: string, signal: CallSignal) => Promise<void>;
  finish: (call: SpaceCall, uid: string) => Promise<void>;
};

// Lives outside React screens. The foreground Headless JS task owns this engine.
// No consent, session, media or authentication is persisted by this module.
export function createBackgroundMedia(deps: BackgroundMediaDependencies) {
  type Session = { snapshot: BackgroundMediaSnapshot; peer?: RTCPeerConnection; stream?: MediaStream;
    stops: Stop[]; timers: ReturnType<typeof setTimeout>[]; done: Promise<void>; resolve: Stop;
    chain: Promise<void>; offered: boolean; seen: Set<string>; candidates: CallCandidate[] };
  let session: Session | null = null, version = 0, starting = false;
  let lastError: string | null = null;
  const listeners = new Set<Stop>();
  const notify = () => listeners.forEach(listener => listener());
  const release = (peer?: RTCPeerConnection, stream?: MediaStream) => {
    try { stream?.getTracks().forEach(track => track.stop()); stream?.release(); } finally { peer?.close(); }
  };
  function stop(message?: string) {
    version++;
    const value = session;
    session = null; starting = false; lastError = message || null;
    if (value) {
      value.stops.forEach(unsubscribe => unsubscribe()); value.timers.forEach(clearTimeout);
      release(value.peer, value.stream); deps.stopService(value.snapshot.call.id); value.resolve();
      void deps.finish(value.snapshot.call, value.snapshot.uid).catch(() => undefined);
    }
    notify();
  }
  function enqueue(value: Session, action: () => Promise<void>) {
    value.chain = value.chain.then(async () => { if (session === value) await action(); }).catch(error => {
      if (session === value) stop(error instanceof Error ? error.message : 'Background sharing could not connect.');
    });
  }
  async function flushCandidates(value: Session) {
    if (!value.peer?.remoteDescription) return;
    for (const candidate of value.candidates.splice(0)) {
      if (session !== value) return;
      await value.peer.addIceCandidate({ candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex });
    }
  }
  async function start(request: SpaceCall, uid: string) {
    if (session || starting) throw new Error('End your current background session first.');
    if (!request.access || request.calleeId !== uid || request.status !== 'accepted' || callExpired(request)) throw new Error('Approve this device sharing request first.');
    starting = true; lastError = null;
    const attempt = ++version;
    let value: Session | undefined;
    try {
      const call = await deps.validate(request, uid);
      if (attempt !== version) return;
      let resolve!: Stop;
      value = { snapshot: { call, uid, phase: 'connecting', streamURL: null, muted: false, cameraOff: false },
        stops: [], timers: [], done: new Promise<void>(done => { resolve = done; }), resolve: () => resolve(), chain: Promise.resolve(), offered: false, seen: new Set(), candidates: [] };
      session = value; notify();
      // Observe withdrawal while permissions/relay setup are still pending,
      // before opening any camera or microphone.
      const pending = value;
      const accessStop = deps.watchAccess(call, uid, message => { if (session === pending) stop(message); });
      if (session !== pending) { accessStop(); return; }
      pending.stops.push(accessStop);
      await deps.startService(call);
      if (session !== value) { deps.stopService(call.id); return; }
      const media = await deps.createMedia(call, () => session === value);
      if (session !== value) { release(media.peer, media.stream); return; }
      value.peer = media.peer; value.stream = media.stream;
      await deps.registerResources(call.id, media.peer, media.stream);
      if (session !== value) return;
      const current = value;
      const register = (unsubscribe: Stop) => { if (session === current) current.stops.push(unsubscribe); else unsubscribe(); };
      current.snapshot = { ...current.snapshot, streamURL: media.stream.toURL() }; notify();
      const fail = (cause: unknown) => { if (session === current) stop(cause instanceof Error ? cause.message : 'Background sharing lost access to this session.'); };
      media.stream.getTracks().forEach(track => track.addEventListener('ended', () => fail(new Error('Camera or microphone access was revoked.'))));
      media.peer.addEventListener('icecandidate', event => {
        if (session !== current || !event.candidate) return;
        const candidate = event.candidate;
        void deps.signal(current.snapshot.call, uid, { type: 'candidate', candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null } }).catch(fail);
      });
      let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
      media.peer.addEventListener('connectionstatechange', () => {
        if (session !== current) return;
        const state = media.peer.connectionState;
        clearTimeout(disconnectTimer);
        if (state === 'failed' || state === 'closed') { stop('The background sharing connection ended.'); return; }
        current.snapshot = { ...current.snapshot, phase: state === 'connected' ? 'connected' : 'connecting' }; notify();
        if (state === 'disconnected') { disconnectTimer = setTimeout(() => { if (session === current) stop('Background sharing lost its network connection.'); }, 15000); current.timers.push(disconnectTimer); }
      });
      register(deps.watchCall(call, uid, next => {
        if (session !== current) return;
        if (!next || next.status !== 'accepted' || callExpired(next)) { stop(); return; }
        if (next.access !== call.access || next.calleeId !== uid || next.callerId !== call.callerId) { stop('The approved sharing request changed.'); return; }
        current.snapshot = { ...current.snapshot, call: next }; notify();
        if (next.offer && !current.offered) {
          current.offered = true;
          enqueue(current, async () => {
            await media.peer.setRemoteDescription(next.offer!);
            if (session !== current) return;
            await flushCandidates(current);
            const answer = await media.peer.createAnswer();
            if (session !== current) return;
            await media.peer.setLocalDescription(answer);
            if (session !== current) return;
            const sdp = media.peer.localDescription?.sdp;
            if (!sdp) throw new Error('The sharing connection did not provide an answer.');
            await deps.signal(current.snapshot.call, uid, { type: 'answer', description: { type: 'answer', sdp } });
          });
        }
      }, fail));
      if (session !== current) return;
      register(deps.watchCandidates(call, uid, candidates => {
        if (session !== current) return;
        for (const candidate of candidates) if (!current.seen.has(candidate.id)) { current.seen.add(candidate.id); current.candidates.push(candidate); }
        enqueue(current, () => flushCandidates(current));
      }, fail));
      current.timers.push(setTimeout(() => { if (session === current && current.snapshot.phase !== 'connected') stop('Background sharing could not connect.'); }, 60000));
      current.timers.push(setTimeout(() => { if (session === current) stop('This sharing session reached its time limit.'); }, Math.max(0, call.expiresAt - Date.now())));
    } catch (error) {
      if (session === value && value) stop(error instanceof Error ? error.message : 'Background sharing could not start.');
      throw error;
    } finally { if (attempt === version) starting = false; }
  }
  return {
    start, stop,
    get: (): BackgroundMediaSnapshot | null => session?.snapshot ?? null,
    error: () => lastError,
    subscribe: (listener: Stop): Stop => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    wait: async (id: string) => { const value = session; if (value?.snapshot.call.id === id) await value.done; },
    controls: (id: string, muted: boolean, cameraOff: boolean) => {
      const value = session;
      if (!value || value.snapshot.call.id !== id) return;
      value.stream?.getTracks().forEach(track => { track.enabled = track.kind === 'audio' ? !muted : !cameraOff; });
      value.snapshot = { ...value.snapshot, muted, cameraOff }; notify();
    },
  };
}
