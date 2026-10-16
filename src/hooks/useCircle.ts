import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AuthUser } from '../auth/AuthProvider';
import { backendError, firestore } from '../lib/firebase';
import {
  beginCircleSession,
  createCircle as createRemoteCircle,
  joinCircle as joinRemoteCircle,
  leaveCircle as leaveRemoteCircle,
  pauseDevice,
  publishDevice,
  renewInvitation,
  updateMemberIdentity,
  watchCircle,
  type Circle,
} from '../services/circles';
import type { DeviceProfile, SpaceMember } from '../types';

export function useCircle(user: AuthUser | null, ownDevice: DeviceProfile | null, sharing: boolean, identityReady = true) {
  const [circle, setCircle] = useState<Circle | null>(null);
  const [members, setMembers] = useState<DeviceProfile[]>([]);
  const [roster, setRoster] = useState<SpaceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const retries = useRef(0);
  const latestDevice = useRef(ownDevice);
  latestDevice.current = ownDevice;
  const lastPublished = useRef(0);
  const mounted = useRef(true);
  const uid = user?.uid;
  const previousConsent = useRef({ uid, sharing });
  const hasDevice = ownDevice !== null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setCircle(null); setMembers([]); setRoster([]); setError(null); setSyncError(null);
    lastPublished.current = 0;
    retries.current = 0;
    if (uid && firestore) beginCircleSession(uid);
  }, [uid]);

  const retryLocations = useCallback(() => {
    retries.current = 0;
    lastPublished.current = 0;
    setConnectionVersion(value => value + 1);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') retryLocations();
    });
    return () => subscription.remove();
  }, [retryLocations]);

  useEffect(() => {
    if (!uid || !firestore) { setLoading(false); return; }
    let live = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    const fail = (cause: unknown) => {
      if (!live) return;
      setError(`Shared locations could not connect. ${backendError(cause)}`);
      setLoading(false);
      if (retryTimer !== undefined) return;
      const delay = [1000, 3000, 10000][retries.current++];
      if (delay !== undefined) retryTimer = setTimeout(() => {
        if (live) { lastPublished.current = 0; setConnectionVersion(value => value + 1); }
      }, delay);
    };
    try {
      unsubscribe = watchCircle(uid, next => { if (live) setCircle(next); },
        next => { if (live) setMembers(next); }, fail,
        next => { if (live) setRoster(next); }, () => {
          if (live) { setError(null); setLoading(false); retries.current = 0; }
        });
    } catch (cause) { fail(cause); }
    return () => { live = false; if (retryTimer !== undefined) clearTimeout(retryTimer); unsubscribe?.(); };
  }, [uid, connectionVersion]);

  useEffect(() => {
    const previous = previousConsent.current;
    if (uid && sharing && (previous.uid !== uid || !previous.sharing)) {
      beginCircleSession(uid);
      lastPublished.current = 0;
    }
    previousConsent.current = { uid, sharing };
  }, [uid, sharing]);

  // Pause writes bypass the throttle. Any previous timer is cancelled before a
  // pause, circle change, or sign-out can schedule another coordinate upload.
  useEffect(() => {
    if (!uid || !circle || !ownDevice || !identityReady) return;
    let cancelled = false;
    void updateMemberIdentity(circle.id, uid, {
      name: user?.displayName?.trim() || 'Member', photoURL: ownDevice.photoURL, avatarId: ownDevice.avatarId,
    }).catch(cause => { if (!cancelled && mounted.current) setSyncError(backendError(cause)); });
    return () => { cancelled = true; };
  }, [uid, circle?.id, identityReady, user?.displayName, ownDevice?.photoURL, ownDevice?.avatarId]);

  useEffect(() => {
    if (!uid || !circle || !identityReady || (sharing && !hasDevice)) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const publish = () => {
      const device = latestDevice.current;
      if (cancelled) return;
      // The native task owns background updates; an old UI fix must not overwrite them.
      if (sharing && AppState.currentState !== 'active') return;
      lastPublished.current = Date.now();
      const pending = device ? publishDevice(circle.id, uid, device, sharing) : pauseDevice(circle.id, uid);
      void pending.then(() => {
        if (!cancelled && mounted.current) setSyncError(null);
      }).catch((cause) => {
        if (!cancelled && mounted.current) setSyncError(backendError(cause));
      });
    };
    const delay = sharing ? Math.max(0, 10000 - (Date.now() - lastPublished.current)) : 0;
    const timer = setTimeout(() => {
      publish();
      if (sharing) interval = setInterval(publish, 10000);
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); if (interval) clearInterval(interval); };
  }, [uid, circle?.id, hasDevice, sharing, identityReady, connectionVersion, ownDevice?.name, ownDevice?.photoURL, ownDevice?.avatarId]);

  const act = useCallback(async (action: () => Promise<void>) => {
    setLoading(true); setError(null);
    try { await action(); setSyncError(null); }
    catch (cause) { const message = backendError(cause); setError(message); throw new Error(message); }
    finally { if (mounted.current) setLoading(false); }
  }, []);

  return {
    circle, members, roster, loading, error: error || syncError, retryLocations,
    createCircle: (name: string) => act(() => createRemoteCircle(name)),
    joinCircle: (code: string) => act(() => joinRemoteCircle(code)),
    leaveCircle: () => act(leaveRemoteCircle),
    renewInvitation: () => act(async () => {
      if (!circle) throw new Error('Join a space first.');
      await renewInvitation(circle.id);
    }),
  };
}
