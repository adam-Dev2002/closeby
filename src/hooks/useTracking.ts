import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import { randomUuid } from '../lib/uuid';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import type { Coordinate, LocationFix, RecordedTrip, SafeZone } from '../types';

const MAX_TRIPS = 12;
const MAX_POINTS = 600;
const MAX_ZONES = 20;
const STALE_AFTER_MS = 45_000;

type Permission = 'undetermined' | 'granted' | 'denied';
type Options = { scope?: string; background?: boolean; autoStart?: boolean; onEnabledChange?: (enabled: boolean) => void };
type LocalStore = {
  scope: string;
  trips: RecordedTrip[];
  zones: SafeZone[];
  hydration: Promise<void>;
  writes: Promise<void>;
};

function newStore(scope: string): LocalStore {
  return { scope, trips: [], zones: [], hydration: Promise.resolve(), writes: Promise.resolve() };
}

function storageKey(scope: string, kind: 'trips' | 'zones') {
  return `@closeby/${encodeURIComponent(scope)}/${kind}/v1`;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isCoordinate(value: unknown): value is Coordinate {
  return object(value) && finite(value.latitude) && finite(value.longitude)
    && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180;
}

function isFix(value: unknown): value is LocationFix {
  if (!object(value)) return false;
  const fix: Record<string, unknown> = value;
  return isCoordinate(value) && finite(fix.timestamp) && fix.timestamp > 0
    && (fix.accuracy === null || (finite(fix.accuracy) && fix.accuracy >= 0))
    && (fix.speed === null || (finite(fix.speed) && fix.speed >= 0))
    && (fix.heading === null || (finite(fix.heading) && fix.heading >= 0 && fix.heading <= 360));
}

function isZone(value: unknown): value is SafeZone {
  return object(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 160
    && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 80
    && (value.description === undefined || (typeof value.description === 'string' && value.description.length <= 240))
    && isCoordinate(value.coordinate) && finite(value.radius) && value.radius >= 25 && value.radius <= 10_000
    && typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color)
    && typeof value.enabled === 'boolean';
}

function isTrip(value: unknown): value is RecordedTrip {
  return object(value) && typeof value.id === 'string' && value.id.length <= 160
    && finite(value.startedAt) && finite(value.endedAt) && value.endedAt >= value.startedAt
    && finite(value.distanceMeters) && value.distanceMeters >= 0
    && Array.isArray(value.points) && value.points.length >= 2 && value.points.every(isFix);
}

/** Great-circle distance from measured coordinates, in metres. */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180;
  const latitude = (b.latitude - a.latitude) * radians;
  const longitude = (b.longitude - a.longitude) * radians;
  const haversine = Math.sin(latitude / 2) ** 2
    + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(Math.max(0, haversine)), Math.sqrt(Math.max(0, 1 - haversine)));
}

function boundedPoints(points: LocationFix[]): LocationFix[] {
  if (points.length <= MAX_POINTS) return points;
  // Preserve both endpoints while reducing older detail. Distance is accumulated before reduction.
  const last = points[points.length - 1];
  const reduced = points.filter((_, index) => index % 2 === 0);
  if (last && reduced[reduced.length - 1] !== last) reduced.push(last);
  return boundedPoints(reduced);
}

async function write(store: LocalStore, kind: 'trips' | 'zones', value: RecordedTrip[] | SafeZone[]) {
  const serialized = JSON.stringify(value);
  const pending = store.writes.catch(() => undefined).then(() => AsyncStorage.setItem(storageKey(store.scope, kind), serialized));
  store.writes = pending;
  await pending;
}

/** Foreground GPS only. No background task, account upload, or location permission prompt on mount. */
export function useTracking({ scope = 'local-device', background = false, autoStart = false, onEnabledChange }: Options = {}) {
  const [location, setLocation] = useState<LocationFix | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [tracking, setTracking] = useState(false);
  const [permission, setPermission] = useState<Permission>('undetermined');
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<LocationFix[]>([]);
  const [trips, setTrips] = useState<RecordedTrip[]>([]);
  const [zones, setZones] = useState<SafeZone[]>([]);
  const [activeTrip, setActiveTrip] = useState(false);
  const [tripDistanceMeters, setTripDistanceMeters] = useState(0);
  const mounted = useRef(false);
  const storeRef = useRef<LocalStore>(newStore(scope));
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const session = useRef(0);
  const starting = useRef(false);
  const trackingRef = useRef(false);
  const latestFix = useRef<LocationFix | null>(null);
  const routeRef = useRef<LocationFix[]>([]);
  const tripStart = useRef<number | null>(null);
  const tripDistance = useRef(0);
  const startedTrackingAt = useRef(0);
  const backgroundEnabled = useRef(background);
  backgroundEnabled.current = background;
  const enabledChange = useRef(onEnabledChange);
  enabledChange.current = onEnabledChange;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const store = newStore(scope);
    storeRef.current = store;
    let cancelled = false;
    ++session.current;
    watcher.current?.remove();
    watcher.current = null;
    starting.current = false;
    trackingRef.current = false;
    latestFix.current = null;
    routeRef.current = [];
    tripStart.current = null;
    tripDistance.current = 0;
    setTracking(false);
    setLocation(null);
    setRoute([]);
    setActiveTrip(false);
    setTripDistanceMeters(0);
    setTrips([]);
    setZones([]);
    setError(null);

    store.hydration = (async () => {
      try {
        const entries = await AsyncStorage.multiGet([storageKey(scope, 'trips'), storageKey(scope, 'zones')]);
        const rawTrips = entries[0]?.[1];
        const rawZones = entries[1]?.[1];
        const savedTrips: unknown = rawTrips ? JSON.parse(rawTrips) : [];
        const savedZones: unknown = rawZones ? JSON.parse(rawZones) : [];
        store.trips = Array.isArray(savedTrips)
          ? savedTrips.filter(isTrip).slice(0, MAX_TRIPS).map((trip) => ({ ...trip, points: boundedPoints(trip.points) })) : [];
        store.zones = Array.isArray(savedZones) ? savedZones.filter(isZone).slice(0, MAX_ZONES) : [];
        if (!cancelled && mounted.current && storeRef.current === store) {
          setTrips(store.trips);
          setZones(store.zones);
        }
      } catch {
        if (!cancelled && mounted.current) setError('Saved trips and safe zones could not be read from this device.');
      }
    })();

    return () => {
      cancelled = true;
      ++session.current;
      watcher.current?.remove();
      watcher.current = null;
      trackingRef.current = false;
      starting.current = false;
    };
  }, [scope]);

  useEffect(() => {
    let cancelled = false;
    // This checks the existing status; only startTracking requests permission.
    void Location.getForegroundPermissionsAsync().then((result) => {
      if (!cancelled) setPermission(result.granted ? 'granted' : result.status === 'denied' ? 'denied' : 'undetermined');
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let subscription: Battery.Subscription | undefined;
    let polling: ReturnType<typeof setInterval> | undefined;
    const update = (level: number) => {
      if (!cancelled) setBatteryLevel(finite(level) && level >= 0 && level <= 1 ? level : null);
    };
    const read = async () => {
      try { update(await Battery.getBatteryLevelAsync()); } catch { if (!cancelled) setBatteryLevel(null); }
    };
    void (async () => {
      try {
        // Expo's web fallback returns a constant 1; do not present it as measured battery data.
        if (Platform.OS === 'web' || !(await Battery.isAvailableAsync()) || cancelled) return;
        await read();
        if (cancelled) return;
        subscription = Battery.addBatteryLevelListener(({ batteryLevel: value }) => update(value));
        polling = setInterval(() => { void read(); }, 60_000);
      } catch { if (!cancelled) setBatteryLevel(null); }
    })();
    return () => { cancelled = true; subscription?.remove(); if (polling) clearInterval(polling); };
  }, []);

  const endTrip = useCallback(async () => {
    const startedAt = tripStart.current;
    if (startedAt === null) return;
    const points = routeRef.current;
    const distance = tripDistance.current;
    const store = storeRef.current;
    tripStart.current = null;
    routeRef.current = [];
    tripDistance.current = 0;
    if (mounted.current) { setActiveTrip(false); setRoute([]); setTripDistanceMeters(0); }
    if (points.length < 2) {
      if (mounted.current) setError('A trip needs at least two fresh GPS fixes before it can be saved.');
      return;
    }
    const trip: RecordedTrip = {
      id: randomUuid(), startedAt, endedAt: Date.now(), points, distanceMeters: distance,
    };
    await store.hydration;
    store.trips = [trip, ...store.trips].slice(0, MAX_TRIPS);
    if (mounted.current && storeRef.current === store) setTrips(store.trips);
    try { await write(store, 'trips', store.trips); }
    catch { if (mounted.current && storeRef.current === store) setError('The trip is available this session, but could not be saved to device storage.'); }
  }, []);

  const stopTracking = useCallback((remember = true) => {
    ++session.current;
    starting.current = false;
    trackingRef.current = false;
    watcher.current?.remove();
    watcher.current = null;
    latestFix.current = null;
    if (mounted.current) { setTracking(false); setLocation(null); }
    if (remember) enabledChange.current?.(false);
    void endTrip();
  }, [endTrip]);

  const receiveFix = useCallback((result: Location.LocationObject, token: number) => {
    if (!mounted.current || token !== session.current || !trackingRef.current || AppState.currentState !== 'active') return;
    const fix: LocationFix = {
      latitude: result.coords.latitude,
      longitude: result.coords.longitude,
      accuracy: finite(result.coords.accuracy) && result.coords.accuracy >= 0 ? result.coords.accuracy : null,
      speed: finite(result.coords.speed) && result.coords.speed >= 0 ? result.coords.speed : null,
      heading: finite(result.coords.heading) && result.coords.heading >= 0 ? result.coords.heading : null,
      timestamp: result.timestamp,
    };
    if (!isFix(fix)) return;
    if (Date.now() - fix.timestamp > STALE_AFTER_MS || fix.timestamp > Date.now() + 30_000) {
      setError('The GPS fix is stale. Waiting for a fresh location.');
      return;
    }
    if (latestFix.current && fix.timestamp <= latestFix.current.timestamp) return;
    latestFix.current = fix;
    setLocation(fix);
    setError(fix.accuracy !== null && fix.accuracy > 100 ? 'GPS accuracy is low. Move outdoors or enable precise location for a better fix.' : null);

    if (tripStart.current !== null && (fix.accuracy === null || fix.accuracy <= 100)) {
      const previous = routeRef.current[routeRef.current.length - 1];
      const distance = previous ? distanceMeters(previous, fix) : 0;
      if (!previous || distance >= 5 || fix.timestamp - previous.timestamp >= 30_000) {
        tripDistance.current += distance;
        setTripDistanceMeters(tripDistance.current);
        routeRef.current = boundedPoints([...routeRef.current, fix]);
        setRoute(routeRef.current);
      }
    }

  }, []);

  const startTracking = useCallback(async (requestPermission = true): Promise<boolean> => {
    if (trackingRef.current) return true;
    if (starting.current) return false;
    starting.current = true;
    const token = ++session.current;
    setError(null);
    const currentSession = () => mounted.current && token === session.current;
    try {
      const existing = await Location.getForegroundPermissionsAsync();
      if (!currentSession()) return false;
      // Android/iOS retain grants. Only an explicit enable action may ask again.
      const result = existing.granted || !requestPermission ? existing : await Location.requestForegroundPermissionsAsync();
      if (!currentSession()) return false;
      setPermission(result.granted ? 'granted' : 'denied');
      if (!result.granted) {
        setError(result.canAskAgain ? 'Location permission was denied. Start GPS again when you are ready to allow it.' : 'Location permission is blocked. Allow location in your phone settings, then start GPS again.');
        return false;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        if (currentSession()) setError('Location services are off. Turn on your phone’s location service, then start GPS again.');
        return false;
      }
      if (!currentSession() || AppState.currentState !== 'active') return false;
      trackingRef.current = true;
      startedTrackingAt.current = Date.now();
      setTracking(true);
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3_000, distanceInterval: 0, mayShowUserSettingsDialog: true },
        (fix) => receiveFix(fix, token),
        () => { if (currentSession()) setError('GPS could not obtain a location. Check location services and precise-location access.'); },
      );
      if (!currentSession() || !trackingRef.current) { subscription.remove(); return false; }
      watcher.current = subscription;
      if (requestPermission) enabledChange.current?.(true);
      return true;
    } catch {
      if (currentSession()) {
        trackingRef.current = false;
        setTracking(false);
        watcher.current?.remove();
        watcher.current = null;
        setError('GPS could not start. Check your location permission and location services, then try again.');
      }
      return false;
    } finally {
      if (token === session.current) starting.current = false;
    }
  }, [receiveFix]);

  useEffect(() => {
    const resume = () => {
      if (autoStart && AppState.currentState === 'active') void startTracking(false);
    };
    resume();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') resume(); });
    return () => subscription.remove();
  }, [scope, autoStart, startTracking]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' && backgroundEnabled.current && tripStart.current !== null) {
        // Manual trips use foreground fixes; automatic history continues in the native task.
        void endTrip();
      }
      if (state === 'background' && trackingRef.current && !backgroundEnabled.current) {
        stopTracking(false);
        setError('GPS is paused while Closeby is in the background. It will resume when you return.');
      }
    });
    const timer = setInterval(() => {
      if (!trackingRef.current) return;
      if (AppState.currentState !== 'active' && backgroundEnabled.current) return;
      const token = session.current;
      const fix = latestFix.current;
      if (fix && Date.now() - fix.timestamp > STALE_AFTER_MS) {
        latestFix.current = null;
        setLocation(null);
        setError('Location signal is stale. Waiting for a fresh GPS fix.');
      } else if (!fix && Date.now() - startedTrackingAt.current > 20_000) {
        setError('Waiting for a GPS fix. Move outdoors, check precise location, or supply a location through emulator controls.');
      }
      void Location.hasServicesEnabledAsync().then((enabled) => {
        if (!enabled && mounted.current && token === session.current && trackingRef.current) {
          stopTracking(false);
          setError('Location services were turned off. Enable them and start GPS again.');
        }
      }).catch(() => undefined);
    }, 10_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [stopTracking, endTrip]);

  const startTrip = useCallback(() => {
    if (tripStart.current !== null) return;
    if (!trackingRef.current) { setError('Start GPS tracking before recording a trip.'); return; }
    tripStart.current = Date.now();
    tripDistance.current = 0;
    const fix = latestFix.current;
    routeRef.current = fix && Date.now() - fix.timestamp <= STALE_AFTER_MS
      && (fix.accuracy === null || fix.accuracy <= 100) ? [fix] : [];
    setRoute(routeRef.current);
    setTripDistanceMeters(0);
    setActiveTrip(true);
  }, []);

  const saveZone = useCallback(async (zone: SafeZone) => {
    if (!isZone(zone)) {
      const message = 'Choose a name, a valid location, and a safe-zone radius from 25 to 10,000 metres.';
      setError(message);
      throw new Error(message);
    }
    const store = storeRef.current;
    await store.hydration;
    if (!store.zones.some((item) => item.id === zone.id) && store.zones.length >= MAX_ZONES) {
      const message = `You can keep up to ${MAX_ZONES} safe zones on this device.`;
      if (mounted.current && storeRef.current === store) setError(message);
      throw new Error(message);
    }
    store.zones = [{ ...zone, name: zone.name.trim(), description: zone.description?.trim() ?? '' }, ...store.zones.filter((item) => item.id !== zone.id)];
    if (mounted.current && storeRef.current === store) setZones(store.zones);
    try { await write(store, 'zones', store.zones); }
    catch {
      const message = 'The safe zone is available this session, but could not be saved to device storage.';
      if (mounted.current && storeRef.current === store) setError(message);
      throw new Error(message);
    }
  }, []);

  const deleteZone = useCallback(async (id: string) => {
    const store = storeRef.current;
    await store.hydration;
    store.zones = store.zones.filter((zone) => zone.id !== id);
    if (mounted.current && storeRef.current === store) setZones(store.zones);
    try { await write(store, 'zones', store.zones); }
    catch {
      const message = 'The safe zone was removed for this session, but the change could not be saved to device storage.';
      if (mounted.current && storeRef.current === store) setError(message);
      throw new Error(message);
    }
  }, []);

  const clearHistory = useCallback(async () => {
    const store = storeRef.current;
    await store.hydration;
    store.trips = [];
    if (mounted.current && storeRef.current === store) setTrips([]);
    try { await write(store, 'trips', []); }
    catch { if (mounted.current && storeRef.current === store) setError('Trip history could not be cleared from device storage.'); }
  }, []);

  return {
    location, batteryLevel, isPhysicalDevice: Device.isDevice, tracking, permission, error,
    route, trips, zones, activeTrip, tripDistanceMeters, startTracking, stopTracking, startTrip, endTrip,
    saveZone, deleteZone, clearHistory,
  };
}
