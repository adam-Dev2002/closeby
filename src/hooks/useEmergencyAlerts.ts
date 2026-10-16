import { useEffect, useState } from 'react';
import { backendError } from '../lib/firebase';
import { watchEmergencyAlerts } from '../services/emergencies';
import type { SpaceEmergencyAlert } from '../types';

export function useEmergencyAlerts(spaceId: string | undefined, uid: string | undefined) {
  const key = spaceId && uid ? `${uid}/${spaceId}` : undefined;
  const [state, setState] = useState<{
    key: string | undefined; alerts: SpaceEmergencyAlert[]; loading: boolean; error: string | null;
  }>({ key, alerts: [], loading: Boolean(key), error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setState({ key, alerts: [], loading: Boolean(key), error: null });
    if (!spaceId || !uid) return;
    const onError = (cause: unknown) => {
      if (active) setState({ key, alerts: [], loading: false, error: backendError(cause) });
    };
    try {
      unsubscribe = watchEmergencyAlerts(spaceId, uid, alerts => {
        if (active) setState({ key, alerts, loading: false, error: null });
      }, onError);
    } catch (cause) { onError(cause); }
    return () => { active = false; unsubscribe?.(); };
  }, [spaceId, uid, key, attempt]);
  return {
    alerts: state.key === key ? state.alerts : [],
    loading: state.key === key ? state.loading : Boolean(key),
    error: state.key === key ? state.error : null,
    retry: () => setAttempt(value => value + 1),
  };
}
