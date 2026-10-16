import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUuid } from '../lib/uuid';
import { arrivalErrorKey, arrivalMonitorConfig, arrivalMonitorRunning, arrivalNotificationsSupported, configureArrivalMonitor, startArrivalMonitor, stopArrivalMonitor, type ArrivalMonitorConfig } from '../services/arrivalMonitoring';
import type { DeviceProfile, SafeZone } from '../types';

type Options = { scope: string; ownDevice: DeviceProfile; zones: SafeZone[]; spaceId: string | null; sharing: boolean; alerts: boolean; startGPS: () => Promise<boolean>; onEnabledChange: (enabled: boolean) => void };
export function useArrivalMonitoring(options: Options) {
  const [enabled, setEnabledState] = useState(false), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const latest = useRef(options); latest.current = options;
  const generation = useRef(''), operation = useRef(0), locked = useRef(false);
  const supported = arrivalNotificationsSupported();
  const config = (): ArrivalMonitorConfig => ({ scope: latest.current.scope, ownDevice: latest.current.ownDevice, zones: latest.current.zones,
    spaceId: latest.current.spaceId, sharing: latest.current.sharing, alerts: latest.current.alerts, enabled: true, generation: generation.current });
  useEffect(() => {
    let cancelled = false;
    setEnabledState(false); setLoaded(false);
    void (async () => {
      try {
        const saved = await arrivalMonitorConfig();
        if (cancelled) return;
        const restored = Boolean(supported && saved?.scope === options.scope && await arrivalMonitorRunning());
        if (cancelled) return;
        if (saved && !restored) await stopArrivalMonitor();
        generation.current = restored && saved ? saved.generation : '';
        setEnabledState(restored); latest.current.onEnabledChange(restored);
        if (restored) await latest.current.startGPS();
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Arrival monitoring could not be restored.'); }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; operation.current++; };
  }, [options.scope, supported]);
  useEffect(() => {
    if (!enabled || !loaded) return;
    void configureArrivalMonitor(config()).catch(cause => setError(cause instanceof Error ? cause.message : 'Arrival settings could not be saved.'));
  }, [enabled, loaded, options.scope, options.spaceId, options.sharing, options.alerts, options.zones, options.ownDevice.name, options.ownDevice.photoURL, options.ownDevice.avatarId, options.ownDevice.batteryLevel]);
  useEffect(() => {
    let active = true;
    const read = () => { if (AppState.currentState === 'active') void AsyncStorage.getItem(arrivalErrorKey(options.scope)).then(message => { if (active) setError(message); }).catch(() => undefined); };
    read(); const timer = setInterval(read, 15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') read(); });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [options.scope]);
  const setEnabled = useCallback(async (value: boolean) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    const token = ++operation.current;
    try {
      if (!value) { setEnabledState(false); latest.current.onEnabledChange(false); await stopArrivalMonitor(); return; }
      if (!arrivalNotificationsSupported()) throw new Error('Install the updated Closeby development build to enable phone arrival notifications.');
      if (!(await latest.current.startGPS()) || token !== operation.current) return;
      generation.current = randomUuid();
      const requested = config();
      await startArrivalMonitor(requested);
      if (token !== operation.current) { if ((await arrivalMonitorConfig())?.generation === requested.generation) await stopArrivalMonitor(); return; }
      setEnabledState(true); latest.current.onEnabledChange(true);
      // Android's permission settings may have paused the foreground watcher.
      await latest.current.startGPS();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Arrival notifications could not be updated.'); throw cause; }
    finally { locked.current = false; setBusy(false); }
  }, []);
  return { enabled, loaded, busy, error, supported, setEnabled };
}
