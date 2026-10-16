import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SPEED_PREFERENCES, parseSpeedPreferences, speedPreferencesKey, validSpeedLimit, type SpeedPreferences } from '../lib/speedAlerts';

type Store = {
  scope: string;
  preferences: SpeedPreferences;
  hydration: Promise<void>;
  writes: Promise<void>;
};
type Snapshot = SpeedPreferences & { scope: string; loaded: boolean; error: string | null };
function newStore(scope: string): Store {
  return { scope, preferences: { ...DEFAULT_SPEED_PREFERENCES }, hydration: Promise.resolve(), writes: Promise.resolve() };
}

/** Preferences remain on this device, separately for every account and the signed-out session. */
export function useSpeedPreferences(scope = 'local-device') {
  const storeRef = useRef<Store>(newStore(scope));
  const [snapshot, setSnapshot] = useState<Snapshot>({ ...DEFAULT_SPEED_PREFERENCES, scope, loaded: false, error: null });

  useEffect(() => {
    const store = newStore(scope);
    storeRef.current = store;
    let cancelled = false;
    setSnapshot({ ...DEFAULT_SPEED_PREFERENCES, scope, loaded: false, error: null });
    store.hydration = (async () => {
      let error: string | null = null;
      try { store.preferences = parseSpeedPreferences(await AsyncStorage.getItem(speedPreferencesKey(scope))); }
      catch { error = 'Speed-alert preferences could not be read from this device.'; }
      if (!cancelled && storeRef.current === store) setSnapshot({ ...store.preferences, scope, loaded: true, error });
    })();
    return () => { cancelled = true; };
  }, [scope]);

  const update = useCallback(async (change: Partial<SpeedPreferences>) => {
    const store = storeRef.current;
    if (store.scope !== scope) return;
    await store.hydration;
    store.preferences = { ...store.preferences, ...change };
    if (storeRef.current === store) setSnapshot({ ...store.preferences, scope, loaded: true, error: null });
    const serialized = JSON.stringify(store.preferences);
    const pending = store.writes.catch(() => undefined)
      .then(() => AsyncStorage.setItem(speedPreferencesKey(store.scope), serialized));
    store.writes = pending;
    try { await pending; }
    catch {
      const message = 'The speed-alert preference could not be saved. It applies this session only.';
      if (storeRef.current === store) setSnapshot(previous => ({ ...previous, error: message }));
      throw new Error(message);
    }
  }, [scope]);

  const setEnabled = useCallback((enabled: boolean) => update({ enabled }), [update]);
  const setLimitKmh = useCallback(async (limitKmh: number) => {
    if (!validSpeedLimit(limitKmh)) throw new Error('Choose a whole-number speed limit from 10 to 200 km/h.');
    await update({ limitKmh });
  }, [update]);
  const current = snapshot.scope === scope ? snapshot : { ...DEFAULT_SPEED_PREFERENCES, scope, loaded: false, error: null };
  return { enabled: current.enabled, limitKmh: current.limitKmh, loaded: current.loaded, error: current.error, setEnabled, setLimitKmh };
}
