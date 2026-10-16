import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeInvitationCode, parseInvitationLink } from '../lib/invitations';

export type PendingInvitation = { code: string; key: string; receivedAt: number };
const KEY = '@closeby/pending-invitation/v1';
let writes = Promise.resolve();

/** Links prepare a join form. They never accept an invitation or start GPS. */
export function useInvitationLink() {
  const [pending, setPending] = useState<PendingInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<PendingInvitation | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  const persist = useCallback((value: PendingInvitation | null) => {
    const next = writes.catch(() => undefined).then(() => value
      ? AsyncStorage.setItem(KEY, JSON.stringify(value)) : AsyncStorage.removeItem(KEY));
    writes = next;
    void next.then(() => { if (mounted.current && current.current === value) setError(null); }).catch(() => {
      if (mounted.current && current.current === value) setError('This invitation is available now but could not be saved for reopening.');
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    let live = true;
    const initialGeneration = generation.current;
    const receive = (url: string) => {
      const code = parseInvitationLink(url, Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined);
      if (!live || !code) return;
      const receivedAt = Date.now();
      const value = { code, receivedAt, key: `${receivedAt}-${++generation.current}` };
      current.current = value; setPending(value); persist(value);
    };
    const subscription = Linking.addEventListener('url', event => receive(event.url));
    void (async () => {
      await writes.catch(() => undefined);
      const raw = await AsyncStorage.getItem(KEY);
      if (!live || generation.current !== initialGeneration || !raw) return;
      const value = JSON.parse(raw) as PendingInvitation;
      const code = normalizeInvitationCode(value?.code);
      if (code && typeof value.key === 'string' && Number.isFinite(value.receivedAt)
        && Date.now() - value.receivedAt <= 7 * 24 * 60 * 60 * 1000 && value.receivedAt <= Date.now() + 30_000) {
        current.current = { ...value, code }; setPending(current.current);
      }
    })().catch(() => { if (live) setError('A saved invitation could not be read. Open the invitation link again.'); });
    void Linking.getInitialURL().then(url => {
      if (live && url && generation.current === initialGeneration) receive(url);
    }).catch(() => undefined);
    return () => { live = false; mounted.current = false; subscription.remove(); };
  }, [persist]);

  const dismiss = useCallback((key: string) => {
    if (current.current?.key !== key) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined'
      && parseInvitationLink(window.location.href, window.location.origin) === current.current.code) {
      window.history.replaceState(null, '', '/');
    }
    ++generation.current;
    current.current = null; setPending(null); persist(null);
  }, [persist]);
  return { pending, error, dismiss };
}
