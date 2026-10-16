import { useEffect, useState } from 'react';
import { backendError } from '../lib/firebase';
import { watchMessages } from '../services/messages';
import type { SpaceMessage } from '../types';

export function useSpaceMessages(spaceId: string | undefined, uid: string | undefined) {
  const key = spaceId && uid ? `${uid}/${spaceId}` : undefined;
  const [state, setState] = useState<{ key: string | undefined; messages: SpaceMessage[]; loading: boolean; error: string | null }>({ key, messages: [], loading: Boolean(key), error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ key, messages: [], loading: Boolean(key), error: null });
    if (!spaceId || !uid) return;
    const unsubscribe = watchMessages(spaceId, messages => {
      if (active) setState({ key, messages, loading: false, error: null });
    }, cause => {
      if (active) setState({ key, messages: [], loading: false, error: backendError(cause) });
    });
    return () => { active = false; unsubscribe(); };
  }, [spaceId, uid, key, attempt]);
  return {
    messages: state.key === key ? state.messages : [],
    loading: state.key === key ? state.loading : Boolean(key),
    error: state.key === key ? state.error : null,
    retry: () => setAttempt(value => value + 1),
  };
}
