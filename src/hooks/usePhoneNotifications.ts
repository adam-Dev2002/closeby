import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUuid } from '../lib/uuid';
import { backendError } from '../lib/firebase';
import { notificationZones } from '../lib/phoneNotifications';
import { disablePhoneNotifications, phoneNotificationsSupported, registerPhoneNotifications, savedPhoneNotifications, syncPhoneAlertSettings, watchPushDelivery } from '../services/phoneNotifications';
import type { SafeZone } from '../types';

export function usePhoneNotifications({ uid, zones, arrivals, speed, speedLimitKmh, preferencesLoaded }: {
  uid?: string; zones: SafeZone[]; arrivals: boolean; speed: boolean; speedLimitKmh: number; preferencesLoaded: boolean;
}) {
  const [enabled, setEnabledState] = useState(false), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(''), session = useRef(0), unregister = useRef<() => void>(() => {}), locked = useRef(false);
  const latest = useRef({ uid, zones, arrivals, speed, speedLimitKmh, preferencesLoaded }); latest.current = { uid, zones, arrivals, speed, speedLimitKmh, preferencesLoaded };
  const supported = phoneNotificationsSupported();
  const settingsKey = JSON.stringify([zones, arrivals, speed, speedLimitKmh]);
  useEffect(() => {
    if (uid) void AsyncStorage.setItem(`@closeby/${encodeURIComponent(uid)}/cloud-arrivals/v1`, String(enabled && ready && arrivals)).catch(() => undefined);
  }, [uid, enabled, ready, arrivals]);
  function sync(value: boolean) {
    const current = latest.current;
    if (!current.uid || !current.preferencesLoaded) return Promise.resolve();
    return syncPhoneAlertSettings(current.uid, { enabled: value, arrivals: current.arrivals, speed: current.speed, speedLimitKmh: current.speedLimitKmh,
      zones: value ? notificationZones(current.zones) : [], generation: generation.current });
  }
  useEffect(() => {
    const token = ++session.current; let live = true;
    setEnabledState(false); setLoaded(false); setReady(false); setError(null); generation.current = '';
    if (!uid || !supported) { setLoaded(true); return; }
    const stopStatus = watchPushDelivery(setReady, cause => { if (live) setError(backendError(cause)); });
    void (async () => {
      try {
        if (await savedPhoneNotifications(uid)) {
          const remove = await registerPhoneNotifications(uid, false);
          if (!live || token !== session.current) { remove(); return; }
          unregister.current = remove; generation.current = randomUuid(); setEnabledState(true);
        }
      } catch (cause) { if (live) setError(backendError(cause)); }
      finally { if (live) setLoaded(true); }
    })();
    return () => { live = false; session.current++; unregister.current(); stopStatus(); };
  }, [uid, supported]);
  useEffect(() => {
    if (!enabled || !uid || !preferencesLoaded || !generation.current) return;
    // A changed place/threshold establishes a fresh observation baseline on the server.
    generation.current = randomUuid();
    let live = true;
    void sync(true).catch(cause => { if (live) setError(backendError(cause)); });
    return () => { live = false; };
  }, [enabled, uid, preferencesLoaded, settingsKey]);
  useEffect(() => {
    if (!enabled || !uid) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const token = session.current;
      void registerPhoneNotifications(uid, false).then(remove => { if (token !== session.current) { remove(); return; } unregister.current(); unregister.current = remove; setError(null); }).catch(cause => { if (token === session.current) setError(backendError(cause)); });
    });
    return () => subscription.remove();
  }, [enabled, uid]);
  async function setEnabled(value: boolean) {
    if (locked.current || !uid) return;
    locked.current = true; setBusy(true); setError(null);
    const token = session.current;
    try {
      if (!value) { setEnabledState(false); unregister.current(); await disablePhoneNotifications(uid); return; }
      const remove = await registerPhoneNotifications(uid, true);
      if (token !== session.current) { remove(); return; }
      unregister.current(); unregister.current = remove; generation.current = randomUuid();
      await sync(true);
      if (token === session.current) setEnabledState(true);
    } catch (cause) { if (token === session.current) setError(backendError(cause)); throw cause; }
    finally { locked.current = false; if (token === session.current) setBusy(false); }
  }
  return { enabled, loaded, busy, ready, error, supported, setEnabled };
}
