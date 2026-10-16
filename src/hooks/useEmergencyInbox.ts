import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SpaceEmergencyAlert } from '../types';

/** Read markers stay on this device, separately for each account and space. */
export function useEmergencyInbox(alerts: SpaceEmergencyAlert[], uid: string | undefined, spaceId: string | undefined) {
  const key = uid && spaceId ? `@closeby/${encodeURIComponent(uid)}/${encodeURIComponent(spaceId)}/emergency-seen/v1` : undefined;
  const [state, setState] = useState<{ key: string | undefined; ready: boolean; seen: string[] }>({ key, ready: false, seen: [] });
  useEffect(() => {
    let active = true;
    setState({ key, ready: false, seen: [] });
    if (!key) return;
    void AsyncStorage.getItem(key).then(value => {
      const saved: unknown = value ? JSON.parse(value) : [];
      if (active) setState({ key, ready: true, seen: Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string').slice(-200) : [] });
    }).catch(() => { if (active) setState({ key, ready: true, seen: [] }); });
    return () => { active = false; };
  }, [key]);
  const unseen = useMemo(() => state.key === key && state.ready
    ? alerts.filter(alert => !alert.pending && alert.senderId !== uid && alert.createdAt !== null && !state.seen.includes(alert.id)) : [], [alerts, uid, key, state]);
  const markSeen = useCallback((id: string) => {
    if (!key) return;
    setState(previous => {
      if (previous.key !== key) return previous;
      const seen = [...previous.seen.filter(value => value !== id), id].slice(-200);
      void AsyncStorage.setItem(key, JSON.stringify(seen)).catch(() => undefined);
      return { ...previous, seen };
    });
  }, [key]);
  return { incoming: unseen[0] ?? null, unseenCount: unseen.length, markSeen };
}
