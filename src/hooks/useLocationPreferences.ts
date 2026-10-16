import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Preferences = { scope: string; loaded: boolean; gps: boolean; sharing: boolean; revision: number };
const writes = new Map<string, Promise<void>>();
const storageKey = (scope: string) => `@closeby/${encodeURIComponent(scope)}/location-preferences/v1`;

/** Remember only this phone's choices for this account, never cached coordinates. */
export function useLocationPreferences(scope: string) {
  const [state, setState] = useState<Preferences>({ scope, loaded: false, gps: false, sharing: false, revision: 0 });
  const [error, setError] = useState<string | null>(null);
  const current = useRef(state);
  if (current.current.scope !== scope) current.current = { scope, loaded: false, gps: false, sharing: false, revision: 0 };
  const value = state.scope === scope ? state : current.current;

  useEffect(() => {
    let live = true;
    const initial = current.current;
    setError(null);
    void (async () => {
      try {
        await writes.get(scope)?.catch(() => undefined);
        const raw = await AsyncStorage.getItem(storageKey(scope));
        const saved: unknown = raw ? JSON.parse(raw) : null;
        if (!live || current.current.scope !== scope || current.current.revision !== initial.revision) return;
        const gps = Boolean(saved && typeof saved === 'object' && 'gps' in saved && saved.gps === true);
        const sharing = gps && Boolean(saved && typeof saved === 'object' && 'sharing' in saved && saved.sharing === true);
        current.current = { ...initial, loaded: true, gps, sharing };
        setState(current.current);
      } catch {
        if (live && current.current.scope === scope) {
          current.current = { ...current.current, loaded: true };
          setState(current.current);
          setError('Saved location choices could not be read. Enable GPS and sharing again on this phone.');
        }
      }
    })();
    return () => { live = false; };
  }, [scope]);

  const update = useCallback((patch: Partial<Pick<Preferences, 'gps' | 'sharing'>>) => {
    if (current.current.scope !== scope) return;
    const next = { ...current.current, ...patch, loaded: true, revision: current.current.revision + 1 };
    current.current = next;
    setState(next);
    const pending = (writes.get(scope) ?? Promise.resolve()).catch(() => undefined).then(() =>
      AsyncStorage.setItem(storageKey(scope), JSON.stringify({ gps: next.gps, sharing: next.sharing })));
    writes.set(scope, pending);
    void pending.then(() => {
      if (current.current === next) setError(null);
    }).catch(() => {
      if (current.current === next) setError('Your location choice works now but could not be saved for next time.');
    }).finally(() => { if (writes.get(scope) === pending) writes.delete(scope); });
  }, [scope]);

  const setGps = useCallback((gps: boolean) => update(gps ? { gps } : { gps, sharing: false }), [update]);
  const setSharing = useCallback((sharing: boolean) => update(sharing ? { gps: true, sharing } : { sharing }), [update]);
  return { gps: value.gps, sharing: value.sharing, loaded: value.loaded, setGps, setSharing, error };
}
