import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAvatarId, type AvatarId } from '../lib/avatars';
import { firebaseAuth, requireFirestore } from '../lib/firebase';

type Snapshot = { scope: string; avatarId: AvatarId | null; loaded: boolean; saving: boolean; error: string | null };
type Store = { scope: string; uid?: string; disposed: boolean; loaded: boolean; pending: number; hydration: Promise<void>; writes: Promise<void> };
const storageKey = (scope: string) => `@closeby/avatar/v1/${scope}`;
const initialSnapshot = (scope: string): Snapshot => ({ scope, avatarId: null, loaded: false, saving: false, error: null });

export function useAvatarProfile(uid?: string) {
  const scope = uid ? `account:${uid}` : 'local-device';
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const storeRef = useRef<Store | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => initialSnapshot(scope));

  useEffect(() => {
    const store: Store = { scope, uid, disposed: false, loaded: false, pending: 0, hydration: Promise.resolve(), writes: Promise.resolve() };
    storeRef.current = store;
    setSnapshot(initialSnapshot(scope));
    const current = () => !store.disposed && storeRef.current === store && scopeRef.current === scope;
    let unsubscribe: (() => void) | undefined;

    if (!uid) {
      store.hydration = (async () => {
        let avatarId: AvatarId | null = null, error: string | null = null;
        try {
          const saved = await AsyncStorage.getItem(storageKey(scope));
          if (isAvatarId(saved)) avatarId = saved;
        } catch { error = 'Your saved avatar could not be loaded. You can choose it again.'; }
        store.loaded = true;
        if (current()) setSnapshot({ scope, avatarId, loaded: true, saving: false, error });
      })();
    } else {
      try {
        if (firebaseAuth?.currentUser?.uid !== uid) throw new Error('Your account changed. Reopen your profile and try again.');
        unsubscribe = onSnapshot(doc(requireFirestore(), 'profiles', uid), profile => {
          if (!current() || firebaseAuth?.currentUser?.uid !== uid) return;
          store.loaded = true;
          const value: unknown = profile.data()?.avatarId;
          setSnapshot(previous => ({ ...previous, scope, avatarId: isAvatarId(value) ? value : null, loaded: true, saving: store.pending > 0, error: null }));
        }, () => {
          store.loaded = true;
          if (current()) setSnapshot(previous => ({ ...previous, loaded: true, error: 'Your avatar could not be loaded. Check your connection and try again.' }));
        });
      } catch (cause) {
        store.loaded = true;
        if (current()) setSnapshot({ ...initialSnapshot(scope), loaded: true, error: cause instanceof Error ? cause.message : 'Your avatar could not be loaded.' });
      }
    }
    return () => { store.disposed = true; unsubscribe?.(); };
  }, [scope, uid]);

  const saveAvatar = useCallback(async (id: string | null): Promise<void> => {
    const store = storeRef.current;
    const current = () => Boolean(store && !store.disposed && storeRef.current === store && scopeRef.current === scope);
    if (!store || store.scope !== scope || !current()) throw new Error('Your profile changed. Reopen it and try again.');
    if (id !== null && !isAvatarId(id)) throw new Error('Choose one of the available avatars.');
    await store.hydration;
    if (!current() || (uid && firebaseAuth?.currentUser?.uid !== uid)) throw new Error('Your account changed. Reopen your profile and try again.');
    if (!store.loaded) throw new Error('Your avatar is still loading. Try again in a moment.');
    store.pending += 1;
    setSnapshot(previous => ({ ...previous, saving: true, error: null }));
    const pending = store.writes.catch(() => undefined).then(async () => {
      if (!current() || (uid && firebaseAuth?.currentUser?.uid !== uid)) throw new Error('Your account changed. Reopen your profile and try again.');
      if (uid) await setDoc(doc(requireFirestore(), 'profiles', uid), { avatarId: id, updatedAt: serverTimestamp() });
      else if (id === null) await AsyncStorage.removeItem(storageKey(scope));
      else await AsyncStorage.setItem(storageKey(scope), id);
    });
    store.writes = pending;
    try {
      await pending;
      if (current()) setSnapshot(previous => ({ ...previous, avatarId: id as AvatarId | null, error: null }));
    } catch (cause) {
      const message = cause instanceof Error && /account changed/.test(cause.message) ? cause.message : uid
        ? 'Your avatar could not be saved. Check your connection and try again.'
        : 'Your avatar could not be saved on this device. Please try again.';
      if (current()) setSnapshot(previous => ({ ...previous, error: message }));
      throw new Error(message);
    } finally {
      store.pending -= 1;
      if (current()) setSnapshot(previous => ({ ...previous, saving: store.pending > 0 }));
    }
  }, [scope, uid]);

  const current = snapshot.scope === scope ? snapshot : initialSnapshot(scope);
  return { avatarId: current.avatarId, loaded: current.loaded, saving: current.saving, error: current.error, saveAvatar };
}
