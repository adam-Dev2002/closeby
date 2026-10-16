import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlacePresenceTracker, type PlaceEvent, type PlacePresence } from '../lib/placePresence';
import type { DeviceProfile, SafeZone } from '../types';

export function usePlacePresence({ devices, zones, ownId, ownTracking, enabled, scope, spaceId }: {
  devices: DeviceProfile[]; zones: SafeZone[]; ownId: string; ownTracking: boolean; enabled: boolean; scope: string; spaceId?: string;
}) {
  const tracker = useRef(new PlacePresenceTracker());
  const currentScope = useRef(scope);
  const [snapshot, setSnapshot] = useState<{ scope: string; spaceId?: string; presence: Record<string, PlacePresence>; events: PlaceEvent[] }>({ scope, spaceId, presence: {}, events: [] });
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [hydrated, setHydrated] = useState('');
  const previousSpace = useRef(spaceId);
  const latest = useRef({ scope, spaceId }); latest.current = { scope, spaceId };
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        void AsyncStorage.setItem(`@closeby/${encodeURIComponent(latest.current.scope)}/arrival-runtime/v1`, tracker.current.serialize(latest.current.spaceId ?? '')).catch(() => undefined);
      }
      setActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let cancelled = false;
    tracker.current.reset(); setHydrated('');
    if (!active) return;
    if (previousSpace.current !== spaceId) { previousSpace.current = spaceId; setHydrated(scope); return; }
    void AsyncStorage.getItem(`@closeby/${encodeURIComponent(scope)}/arrival-runtime/v1`).then(raw => {
      if (!cancelled) { tracker.current.restore(raw, spaceId ?? ''); currentScope.current = scope; setHydrated(scope); }
    }).catch(() => { if (!cancelled) setHydrated(scope); });
    return () => { cancelled = true; };
  }, [scope, active, spaceId]);
  useEffect(() => {
    if (currentScope.current !== scope) { tracker.current.reset(); currentScope.current = scope; }
    if (!active || hydrated !== scope) { setSnapshot({ scope, spaceId, presence: {}, events: [] }); return; }
    const result = tracker.current.update(devices, zones, ownId, ownTracking, Date.now());
    setSnapshot(previous => ({ scope, spaceId, presence: result.presence, events: enabled
      ? [...(previous.scope === scope && previous.spaceId === spaceId ? previous.events : []), ...result.events].filter(event => devices.some(device => device.id === event.deviceId && (device.id === ownId ? ownTracking : device.sharing)) && zones.some(zone => zone.id === event.zoneId && zone.enabled)).slice(-20)
      : [] }));
  }, [devices, zones, ownId, ownTracking, enabled, scope, spaceId, active, hydrated]);
  const current = snapshot.scope === scope && snapshot.spaceId === spaceId ? snapshot : { presence: {}, events: [] };
  return { presence: current.presence, events: current.events, incoming: current.events[0] ?? null,
    dismiss: (id: string) => setSnapshot(previous => ({ ...previous, events: previous.events.filter(event => event.id !== id) })) };
}
