import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { backendError, firestore } from '../lib/firebase';
import { callExpired, type CallCandidate, type CallMode, type CallPhase, type CallSignal, type DeviceAccess, type SpaceCall } from '../lib/calls';
import { acceptCall, finishCall, publishSignal, startCall as createCall, watchCall, watchCandidates, watchIncoming } from '../services/calls';
import { backgroundMediaError, backgroundMediaSupported, getBackgroundMedia, setBackgroundMediaControls, startBackgroundMedia, stopBackgroundMedia, subscribeBackgroundMedia } from '../services/backgroundMedia';

export function useCall({ uid, spaceId, name, memberIds, requesterIds, incomingId }: { uid?: string; spaceId?: string; name: string; memberIds: string[]; requesterIds: string[]; incomingId?: string }) {
  const key = uid && spaceId ? `${uid}/${spaceId}` : '';
  const memberKey = [...memberIds].sort().join('/'), requesterKey = [...requesterIds].sort().join('/');
  const [state, setState] = useState<{ key: string; active: SpaceCall | null; incoming: SpaceCall[]; candidates: CallCandidate[] }>({ key, active: null, incoming: [], candidates: [] });
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [mediaState, setMediaState] = useState<'connecting' | 'connected'>('connecting');
  const [incomingError, setIncomingError] = useState<string | null>(null), [inboxVersion, setInboxVersion] = useState(0);
  const inboxRetries = useRef(0);
  const current = useRef({ key, uid, spaceId, active: null as SpaceCall | null });
  const busy = useRef(false), mounted = useRef(true), generation = useRef(0);
  const active = state.key === key ? state.active : null;
  current.current = { key, uid, spaceId, active };
  const eligibleIncoming = state.key === key && !active ? state.incoming.filter(call => !callExpired(call) && (!call.access || requesterIds.includes(call.callerId))) : [];
  const incoming = eligibleIncoming.find(call => call.id === incomingId) ?? eligibleIncoming[0] ?? null;
  const candidates = state.key === key ? state.candidates : [];
  const background = getBackgroundMedia();
  const nativeManaged = Boolean(active && background?.call.id === active.id);

  useEffect(() => {
    const update = () => {
      const value = getBackgroundMedia();
      if (value && value.uid !== uid) { stopBackgroundMedia(); return; }
      if (value && !spaceId) return; // Space membership is still loading after reopening.
      if (value && value.call.spaceId !== spaceId) { stopBackgroundMedia(); return; }
      if (value) {
        setState(previous => ({ ...previous, key, active: value.call, candidates: [] }));
        setMediaState(value.phase);
      } else {
        setState(previous => previous.active?.id === backgroundId.current ? { ...previous, active: null, candidates: [] } : previous);
        const message = backgroundMediaError();
        if (message) setError(message);
      }
      backgroundId.current = value?.call.id ?? null;
    };
    const unsubscribe = subscribeBackgroundMedia(update);
    update();
    return unsubscribe;
  }, [key, uid, spaceId]);
  const backgroundId = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; const value = current.current; if (value.active && value.uid && getBackgroundMedia()?.call.id !== value.active.id) void finishCall(value.active, value.uid).catch(() => undefined); };
  }, []);
  useEffect(() => {
    const running = getBackgroundMedia();
    const restored = running?.uid === uid && running?.call.spaceId === spaceId ? running : null;
    generation.current++; busy.current = false; setLoading(false); setError(null); setMediaState(restored?.phase ?? 'connecting');
    setState({ key, active: restored?.call ?? null, incoming: [], candidates: [] });
  }, [key]);
  function retryIncoming() { inboxRetries.current = 0; setIncomingError(null); setInboxVersion(value => value + 1); }
  useEffect(() => {
    inboxRetries.current = 0; setIncomingError(null);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') retryIncoming(); });
    return () => subscription.remove();
  }, [key, memberKey]);
  useEffect(() => {
    if (!uid || !spaceId || !firestore) return;
    let live = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (cause: unknown) => {
      if (!live) return;
      setIncomingError(`Incoming requests could not connect. ${backendError(cause)}`);
      const delay = [1000, 3000, 10000][inboxRetries.current++];
      if (delay !== undefined) retryTimer = setTimeout(() => { if (live) setInboxVersion(value => value + 1); }, delay);
    };
    let unsubscribe: (() => void) | undefined;
    setState(value => value.key === key ? { ...value, incoming: [] } : value);
    try { unsubscribe = watchIncoming(spaceId, uid, memberIds, calls => { if (live) { setIncomingError(null); setState(value => value.key === key ? { ...value, incoming: calls } : value); } }, fail); }
    catch (cause) { fail(cause); }
    const timer = setInterval(() => { if (live) setState(value => value.key === key ? { ...value, incoming: value.incoming.filter(call => !callExpired(call)) } : value); }, 1000);
    return () => { live = false; clearInterval(timer); clearTimeout(retryTimer); unsubscribe?.(); };
  }, [key, uid, spaceId, memberKey, inboxVersion]);
  useEffect(() => {
    if (active?.access && !nativeManaged && !requesterIds.includes(active.callerId)) { end(); setError('Device sharing stopped because the requester is no longer authorized.'); }
  }, [active?.id, requesterKey, nativeManaged]);
  useEffect(() => {
    if (!active || !uid || nativeManaged) return;
    let live = true;
    const call = active;
    const close = (message?: string) => {
      if (!live) return;
      setState(value => value.key === key && value.active?.id === call.id ? { ...value, active: null, candidates: [] } : value);
      setMediaState('connecting');
      if (message) setError(message);
    };
    let unwatch: (() => void) | undefined;
    try { unwatch = watchCall(call, uid, next => {
      if (!next || next.status === 'ended' || next.status === 'declined') { close(next?.status === 'declined' ? 'The other person declined your call.' : undefined); return; }
      if (callExpired(next)) { close('This call expired. You can start another call.'); void finishCall(next, uid).catch(() => undefined); return; }
      if (live) setState(value => value.key === key && value.active?.id === call.id ? { ...value, active: next } : value);
    }, cause => { close(backendError(cause)); void finishCall(call, uid).catch(() => undefined); }); }
    catch (cause) { close(backendError(cause)); }
    const timer = setInterval(() => {
      const latest = current.current.active;
      if (latest?.id === call.id && callExpired(latest)) { close(latest.status === 'ringing' ? 'No answer. The call request expired.' : 'The call reached its two-hour limit.'); void finishCall(latest, uid).catch(() => undefined); }
    }, 1000);
    return () => { live = false; clearInterval(timer); unwatch?.(); if (getBackgroundMedia()?.call.id !== call.id) void finishCall(call, uid).catch(() => undefined); };
  }, [active?.id, uid, key, nativeManaged]);
  useEffect(() => {
    if (!active || active.status !== 'accepted' || !uid || nativeManaged) return;
    let live = true;
    let unsubscribe: (() => void) | undefined;
    try { unsubscribe = watchCandidates(active, uid, next => { if (live) setState(value => value.key === key && value.active?.id === active.id ? { ...value, candidates: next } : value); }, cause => {
      if (live) { setError(backendError(cause)); setState(value => value.key === key && value.active?.id === active.id ? { ...value, active: null, candidates: [] } : value); }
    }); }
    catch (cause) { setError(backendError(cause)); }
    return () => { live = false; unsubscribe?.(); };
  }, [active?.id, active?.status, uid, key, nativeManaged]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'background') return;
      const running = getBackgroundMedia();
      if (running && running.uid === current.current.uid) return;
      end();
    });
    return () => subscription.remove();
  }, []);

  async function act(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(null);
    const version = generation.current;
    try { await action(); }
    catch (cause) { if (mounted.current && generation.current === version) setError(backendError(cause)); }
    finally { if (mounted.current && generation.current === version) { busy.current = false; setLoading(false); } }
  }
  function end() {
    const value = current.current;
    if (getBackgroundMedia()?.call.id === value.active?.id) stopBackgroundMedia(value.active?.id);
    generation.current++; busy.current = false; setLoading(false);
    setState(previous => ({ ...previous, active: null, candidates: [] })); setMediaState('connecting');
    if (value.active && value.uid) void finishCall(value.active, value.uid).catch(cause => { if (mounted.current && current.current.key === value.key) setError(`Call stopped on this phone. ${backendError(cause)}`); });
  }
  const phase: CallPhase = !active ? 'idle' : active.status === 'ringing' ? 'ringing' : mediaState;
  const begin = (targetId: string, targetName: string, mode: CallMode, access?: DeviceAccess) => act(async () => {
    if (!uid || !spaceId) throw new Error('Sign in and join a space before contacting a member.');
    if (current.current.active) throw new Error('End your current session before starting another.');
    if (access && !requesterIds.includes(uid)) throw new Error('The space owner must authorize you to request device access.');
    if (AppState.currentState !== 'active') throw new Error('Keep Closeby open to send a request.');
    const attempt = generation.current, value = await createCall(spaceId, uid, name, targetId, targetName, mode, access);
    if (!mounted.current || current.current.key !== key || generation.current !== attempt) { void finishCall(value, uid).catch(() => undefined); return; }
    setMediaState('connecting'); setState(previous => ({ ...previous, active: value, candidates: [] }));
  });
  return {
    uid, incoming, active, candidates, phase, loading, error, incomingError, retryIncoming, nativeManaged, backgroundSupported: backgroundMediaSupported(),
    backgroundControls: nativeManaged ? background : null,
    setBackgroundControls: (muted: boolean, cameraOff: boolean) => { if (active && nativeManaged) setBackgroundMediaControls(active.id, muted, cameraOff); },
    clearError: () => setError(null), end,
    startCall: (targetId: string, targetName: string, mode: CallMode) => begin(targetId, targetName, mode),
    requestAccess: (targetId: string, targetName: string, access: DeviceAccess) => begin(targetId, targetName, access === 'microphone' ? 'voice' : 'video', access),
    accept: (allowBackground = false) => act(async () => {
      if (!incoming || !uid || current.current.active) return;
      if (AppState.currentState !== 'active') throw new Error('Keep Closeby open to accept this call.');
      const attempt = generation.current;
      await acceptCall(incoming, uid);
      if (!mounted.current || current.current.key !== key || generation.current !== attempt) { void finishCall(incoming, uid).catch(() => undefined); return; }
      const approved = { ...incoming, status: 'accepted' as const, expiresAt: Date.now() + 2 * 60 * 60 * 1000 };
      if (allowBackground) {
        try {
          await startBackgroundMedia(approved, uid);
          if (getBackgroundMedia()?.call.id !== approved.id) throw new Error('Background sharing was stopped. Approve a new request to start again.');
        }
        catch (cause) { void finishCall(approved, uid).catch(() => undefined); throw cause; }
        if (!mounted.current || current.current.key !== key || generation.current !== attempt) { stopBackgroundMedia(approved.id); return; }
      }
      setMediaState('connecting'); setState(previous => ({ ...previous, active: getBackgroundMedia()?.call.id === approved.id ? getBackgroundMedia()!.call : approved, incoming: [], candidates: [] }));
    }),
    decline: () => act(async () => { if (incoming && uid) { await finishCall(incoming, uid, true); setState(previous => ({ ...previous, incoming: previous.incoming.filter(call => call.id !== incoming.id) })); } }),
    signal: async (signal: CallSignal) => {
      const value = current.current;
      if (!value.active || value.active.status !== 'accepted' || !value.uid) return;
      try { await publishSignal(value.active, value.uid, signal); }
      catch (cause) { if (mounted.current && current.current.active?.id === value.active.id) { end(); setError(`The call could not connect. ${backendError(cause)}`); } }
    },
    mediaState: (value: 'connecting' | 'connected' | 'closed') => { if (value === 'closed') end(); else setMediaState(value); },
    mediaError: (message: string) => { end(); setError(message); },
  };
}
export type CallController = ReturnType<typeof useCall>;
