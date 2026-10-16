import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { backendError, firestore } from '../lib/firebase';
import { activityErrorKey, captureConfig, captureFix, configureCapture, newCaptureSession, readActivityDay, subscribeActivity, type CaptureConfig } from '../services/activityCapture';
import { backgroundIsRunning, startBackgroundTracking, stopAllActivity, stopBackgroundTracking } from '../services/backgroundTracking';
import { resumeHistoryUploads, setHistoryConsent, stopHistoryUploads, watchActivityDay, watchHistoryConsents } from '../services/activityHistory';
import type { ActivitySample, DeviceProfile, HistoryConsent, LocationFix, SafeZone } from '../types';

type Options = {
  scope: string; uid?: string; spaceId?: string; selectedId: string; day: string; ownDevice: DeviceProfile;
  tracking: boolean; location: LocationFix | null; zones: SafeZone[];
  onBackgroundChange: (enabled: boolean) => void; startGPS: () => Promise<boolean>;
};
export function useActivityHistory(options: Options) {
  const { scope, uid, spaceId, selectedId, day, ownDevice, tracking, location, zones } = options;
  const [enabled, setEnabled] = useState(false), [background, setBackground] = useState(false), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [consentState, setConsentState] = useState<{ spaceId?: string; values: Record<string, HistoryConsent> }>({ values: {} });
  const consents = consentState.spaceId === spaceId ? consentState.values : {};
  const [blocked, setBlocked] = useState(false);
  const [result, setResult] = useState<{ key: string; samples: ActivitySample[]; truncated: boolean; loading: boolean }>({ key: '', samples: [], truncated: false, loading: false });
  const latest = useRef(options); latest.current = options;
  const session = useRef(newCaptureSession()), enabledAt = useRef(Date.now()), lock = useRef(false);
  const wasRecording = useRef(false), paused = useRef(false);
  const ownConsent = uid ? consents[uid] : undefined;
  const selectedConsent = consents[selectedId];
  const own = selectedId === ownDevice.id;
  const resultKey = `${scope}/${spaceId ?? ''}/${selectedId}/${day}/${own ? 'own' : selectedConsent?.enabled ? selectedConsent.generation : 'off'}`;
  const preferencesKey = `@closeby/${encodeURIComponent(scope)}/activity-preferences/v1`;

  useEffect(() => {
    let active = true;
    const read = () => { if (AppState.currentState === 'active') void AsyncStorage.getItem(activityErrorKey(scope)).then(message => { if (active && message) setError(message); }).catch(() => undefined); };
    read(); const timer = setInterval(read, 15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') read(); });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [scope]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [raw, saved, running] = await Promise.all([AsyncStorage.getItem(preferencesKey), captureConfig(), backgroundIsRunning()]);
        if (!active) return;
        const preferences = raw ? JSON.parse(raw) as { enabled?: boolean } : {};
        setEnabled(preferences.enabled === true);
        const restored = Boolean(running && saved?.scope === scope && saved.enabled && saved.background);
        setBackground(restored); latest.current.onBackgroundChange(restored);
        if (restored && saved) { session.current = saved.sessionId; enabledAt.current = saved.enabledAt; wasRecording.current = true; void latest.current.startGPS(); }
        else if (saved?.background) await stopAllActivity();
      } catch (cause) { if (active) setError(backendError(cause)); }
      finally { if (active) setLoaded(true); }
    })();
    return () => { active = false; };
  }, [scope, preferencesKey]);

  useEffect(() => {
    setConsentState({ spaceId, values: {} }); setBlocked(false);
    if (!spaceId || !uid || !firestore) return;
    return watchHistoryConsents(spaceId, values => setConsentState({ spaceId, values }), cause => setError(backendError(cause)));
  }, [spaceId, uid]);

  useEffect(() => {
    if (!loaded) return;
    if (!tracking && !background) paused.current = false;
    const recording = enabled && (tracking || background) && !paused.current;
    if (recording && !wasRecording.current) { session.current = newCaptureSession(); enabledAt.current = Date.now(); }
    wasRecording.current = recording;
    const shared = !blocked && ownConsent?.enabled && ownConsent.startedAt > 0 && uid && spaceId
      ? { uid, spaceId, generation: ownConsent.generation, startedAt: ownConsent.startedAt } : null;
    if (uid) { if (shared && ownDevice.sharing) resumeHistoryUploads(uid); else stopHistoryUploads(uid); }
    const config: CaptureConfig = { scope, enabled: recording, enabledAt: enabledAt.current,
      sessionId: session.current, background, zones, shared, device: { ...ownDevice, location: null },
      liveSharing: ownDevice.sharing, liveSpaceId: spaceId ?? null };
    void configureCapture(config).catch(cause => setError(backendError(cause)));
  }, [loaded, enabled, tracking, background, scope, uid, spaceId, ownConsent?.generation, ownConsent?.enabled, blocked, ownDevice.sharing, ownDevice.name, zones]);

  useEffect(() => {
    if (loaded && enabled && tracking && location) void captureFix(location, false, { scope }).catch(cause => setError(backendError(cause)));
  }, [loaded, enabled, tracking, location]);

  useEffect(() => {
    let active = true;
    setResult({ key: resultKey, samples: [], truncated: false, loading: true });
    const next = (samples: ActivitySample[], truncated: boolean) => { if (active) setResult({ key: resultKey, samples, truncated, loading: false }); };
    if (own) {
      let local: ActivitySample[] = [], remote: ActivitySample[] = [], capped = false, localCapped = false;
      const merge = () => next([...new Map([...remote, ...local].map(sample => [sample.id, sample])).values()].sort((a, b) => a.fix.timestamp - b.fix.timestamp), capped || localCapped);
      const read = () => { void readActivityDay(scope, day).then(data => { local = data.samples; localCapped = data.truncated; merge(); }).catch(cause => { next([], false); setError(backendError(cause)); }); };
      read();
      const unsubscribe = subscribeActivity(changedScope => { if (changedScope === scope) read(); });
      const subscription = AppState.addEventListener('change', state => { if (state === 'active') read(); });
      const remoteSubscription = spaceId && uid && firestore ? watchActivityDay(spaceId, uid, day, null, (samples, truncated) => { remote = samples; capped = truncated; merge(); }, cause => { if (active) setError(backendError(cause)); }) : undefined;
      return () => { active = false; unsubscribe(); subscription.remove(); remoteSubscription?.(); };
    }
    if (!spaceId || !selectedConsent?.enabled || !firestore) { next([], false); return; }
    const unsubscribe = watchActivityDay(spaceId, selectedId, day, selectedConsent.generation, next, cause => { if (active) setError(backendError(cause)); });
    return () => { active = false; unsubscribe(); };
  }, [resultKey, own]);

  const setSaving = useCallback(async (value: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      await AsyncStorage.removeItem(activityErrorKey(scope));
      if (value && !(await latest.current.startGPS())) return;
      if (!value) { setEnabled(false); await stopAllActivity(); setBackground(false); latest.current.onBackgroundChange(false); }
      else { session.current = newCaptureSession(); enabledAt.current = Date.now(); }
      await AsyncStorage.setItem(preferencesKey, JSON.stringify({ enabled: value })); setEnabled(value);
    } catch (cause) { setError(backendError(cause)); }
    finally { lock.current = false; setBusy(false); }
  }, [preferencesKey]);

  const setBackgroundRecording = useCallback(async (value: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      if (value) {
        if (!enabled) throw new Error('Enable activity history before turning on background recording.');
        if (!(await latest.current.startGPS())) return;
        const config = await captureConfig();
        if (!config) throw new Error('Activity history is still starting. Try again.');
        if (config.scope !== scope || config.sessionId !== session.current) throw new Error('The recording session changed. Open history settings for the current account.');
        // Android may open Settings for background permission; preserve foreground GPS during that step.
        latest.current.onBackgroundChange(true);
        await configureCapture({ ...config, background: true, enabled: true });
        try { await startBackgroundTracking({ scope, sessionId: config.sessionId }); } catch (cause) {
          latest.current.onBackgroundChange(false);
          const current = await captureConfig();
          if (current?.sessionId === config.sessionId) await configureCapture({ ...current, background: false });
          throw cause;
        }
      } else await stopBackgroundTracking();
      setBackground(value); latest.current.onBackgroundChange(value);
    } catch (cause) { setError(backendError(cause)); }
    finally { lock.current = false; setBusy(false); }
  }, [enabled]);

  const shareHistory = async (value: boolean) => {
    if (lock.current) return;
    if (!uid || !spaceId) { setError('Sign in and join a space to share history.'); return; }
    if (value && !enabled) { setError('Enable activity history before sharing it with your space.'); return; }
    lock.current = true; setBusy(true); setError(null);
    try {
      if (!value) {
        setBlocked(true); stopHistoryUploads(uid);
        const config = await captureConfig().catch(() => null);
        if (config?.scope === scope) await configureCapture({ ...config, shared: null }).catch(() => undefined);
      }
      await setHistoryConsent(spaceId, value, uid); setBlocked(false);
    }
    catch (cause) { setError(value ? backendError(cause) : 'New history uploads are stopped on this phone. Reconnect and turn sharing off again to hide past shared history.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const pause = async () => { paused.current = true; if (uid) stopHistoryUploads(uid); await stopAllActivity(); setBackground(false); latest.current.onBackgroundChange(false); };

  return { enabled, background, loaded, busy, error, consents, sharingHistory: !blocked && Boolean(ownConsent?.enabled),
    samples: result.key === resultKey ? result.samples : [], truncated: result.key === resultKey && result.truncated,
    loading: result.key !== resultKey || result.loading, canView: own || Boolean(selectedConsent?.enabled),
    setSaving, setBackgroundRecording, shareHistory, pause, clearError: () => setError(null) };
}
