import { AppState, NativeEventEmitter, NativeModules, PermissionsAndroid } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore';
import { createBackgroundMedia } from '../lib/backgroundMedia';
import { deviceAccessLabel, type SpaceCall } from '../lib/calls';
import { firebaseAuth, requireFirestore } from '../lib/firebase';
import { finishCall, loadCallIce, publishSignal, watchCall, watchCandidates } from './calls';
export type { BackgroundMediaSnapshot } from '../lib/backgroundMedia';

type Bridge = { start: (id: string, detail: string, camera: boolean, expiresAt: number) => Promise<void>;
  stop: (id: string) => void; registerResources: (id: string, peerId: number, streamId: string, tracks: string[]) => Promise<void>; addListener: (name: string) => void; removeListeners: (count: number) => void };
const bridge = NativeModules.ClosebyMediaSession as Bridge | undefined;
export const backgroundMediaSupported = () => Boolean(bridge && NativeModules.WebRTCModule);
// Loaded only after approval, in an installed native app; Expo Go stays usable.
const rtc = () => require('react-native-webrtc') as typeof import('react-native-webrtc');
const engine = createBackgroundMedia({
  async validate(call, uid) {
    if (firebaseAuth?.currentUser?.uid !== uid || AppState.currentState !== 'active') throw new Error('Open Closeby and sign in before approving background sharing.');
    const db = requireFirestore();
    const [record, circle, member] = await Promise.all([
      getDocFromServer(doc(db, 'circles', call.spaceId, 'calls', call.id)),
      getDocFromServer(doc(db, 'circles', call.spaceId)),
      getDocFromServer(doc(db, 'circles', call.spaceId, 'members', call.callerId)),
    ]);
    const data = record.data();
    if (!data || data.status !== 'accepted' || data.calleeId !== uid || data.callerId !== call.callerId || data.access !== call.access || data.mode !== call.mode
      || data.expiresAt?.toMillis() <= Date.now() || !member.exists() || circle.data()?.ownerId !== call.callerId && member.data()?.canRequestMedia !== true) {
      throw new Error('This device access request is no longer approved or authorized.');
    }
    return { ...call, expiresAt: data.expiresAt.toMillis() };
  },
  async startService(call) {
    if (!bridge || !backgroundMediaSupported()) throw new Error('Install the rebuilt Android app to use background sharing.');
    const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      ...(call.mode === 'video' ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
    // POST_NOTIFICATIONS is a runtime permission on Android 13 and later.
    const { Platform } = require('react-native') as typeof import('react-native');
    const required = permissions.filter(permission => permission !== PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS || Number(Platform.Version) >= 33);
    const granted = await PermissionsAndroid.requestMultiple(required);
    if (!required.every(permission => granted[permission] === PermissionsAndroid.RESULTS.GRANTED)) throw new Error('Allow camera/microphone and visible notifications before using background sharing.');
    if (firebaseAuth?.currentUser?.uid !== call.calleeId) throw new Error('Background sharing stopped because you signed out.');
    await bridge.start(call.id, `Sharing your ${deviceAccessLabel(call.access!)} with ${call.callerName}. Continues after closing Recent apps.`, call.mode === 'video', call.expiresAt);
  },
  stopService: id => bridge?.stop(id),
  async createMedia(call, isActive) {
    const { mediaDevices, RTCPeerConnection } = rtc(), ice = await loadCallIce(call.calleeId);
    let video: false | { deviceId: { exact: string }; facingMode: { exact: string }; width: number; height: number } = false;
    if (call.mode === 'video') {
      const facing = call.access === 'back' ? 'environment' : 'front';
      const devices = await mediaDevices.enumerateDevices() as { kind: string; facing: string; deviceId: string }[];
      const camera = devices.find(device => device.kind === 'videoinput' && device.facing === facing);
      if (!camera) throw new Error('The approved camera is unavailable on this phone.');
      video = { deviceId: { exact: camera.deviceId }, facingMode: { exact: call.access === 'back' ? 'environment' : 'user' }, width: 640, height: 480 };
    }
    if (!isActive() || firebaseAuth?.currentUser?.uid !== call.calleeId) throw new Error('Background sharing was stopped.');
    const stream = await mediaDevices.getUserMedia({ audio: true, video });
    try {
      if (!stream.getAudioTracks().length || video && (stream.getVideoTracks().length !== 1 || stream.getVideoTracks()[0]?.getSettings().facingMode !== video.facingMode.exact)) throw new Error('The device could not confirm the approved camera and microphone.');
      const peer = new RTCPeerConnection({ iceServers: ice.iceServers });
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      return { peer, stream };
    } catch (error) { stream.getTracks().forEach(track => track.stop()); stream.release(); throw error; }
  },
  async registerResources(id, peer, stream) { await bridge!.registerResources(id, peer._pcId, stream.toURL(), stream.getTracks().map(track => track.id)); },
  watchCall, watchCandidates, signal: publishSignal, finish: finishCall,
  watchAccess(call, uid, stop) {
    const db = requireFirestore(), stops: (() => void)[] = [];
    let owner: string | undefined, caller: { exists: boolean; allowed: boolean } | undefined;
    const check = () => {
      if (caller && (!caller.exists || owner !== undefined && owner !== call.callerId && !caller.allowed)) stop('Background sharing stopped because the requester is no longer authorized.');
    };
    const fail = () => stop('Background sharing stopped because space access could not be verified.');
    stops.push(onAuthStateChanged(firebaseAuth!, user => { if (user?.uid !== uid) stop('Background sharing stopped because you signed out.'); }));
    stops.push(onSnapshot(doc(db, 'circles', call.spaceId, 'members', uid), value => { if (!value.exists()) fail(); }, fail));
    stops.push(onSnapshot(doc(db, 'circles', call.spaceId), circle => {
      if (!circle.exists()) { fail(); return; }
      owner = circle.data().ownerId; check();
    }, fail));
    stops.push(onSnapshot(doc(db, 'circles', call.spaceId, 'members', call.callerId), member => {
      caller = { exists: member.exists(), allowed: member.data()?.canRequestMedia === true }; check();
    }, fail));
    stops.push(onSnapshot(doc(db, 'circles', call.spaceId, 'calls', call.id), record => {
      const data = record.data();
      if (!data || data.status !== 'accepted' || data.access !== call.access || data.calleeId !== uid || data.callerId !== call.callerId || data.expiresAt?.toMillis() <= Date.now()) stop('This approved sharing session ended.');
    }, fail));
    return () => stops.forEach(unsubscribe => unsubscribe());
  },
});
if (bridge) new NativeEventEmitter(bridge).addListener('ClosebyMediaStopped', (id: string) => {
  if (engine.get()?.call.id === id) engine.stop();
});
export const getBackgroundMedia = engine.get;
export const backgroundMediaError = engine.error;
export const subscribeBackgroundMedia = engine.subscribe;
export const startBackgroundMedia = engine.start;
export const setBackgroundMediaControls = engine.controls;
export function stopBackgroundMedia(id?: string) { if (!id || engine.get()?.call.id === id) engine.stop(); }
export async function runBackgroundMediaTask(data: { id: string }) { await engine.wait(data.id); }
