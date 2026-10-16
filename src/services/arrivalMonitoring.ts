import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Battery from 'expo-battery';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { firebaseAuth, requireFirestore } from '../lib/firebase';
import { PlacePresenceTracker, arrivalClock, shortStay, type PlaceEvent } from '../lib/placePresence';
import { publishDevice } from './circles';
import type { DeviceProfile, LocationFix, SafeZone } from '../types';
import { notificationApi as sharedNotificationApi } from './notificationRuntime';

export const ARRIVAL_LOCATION_TASK = 'closeby-arrival-monitor-v1';
const CONFIG_KEY = '@closeby/arrival-monitor/config/v1';
const CHANNEL = 'arrivals';
export const arrivalRuntimeKey = (scope: string) => `@closeby/${encodeURIComponent(scope)}/arrival-runtime/v1`;
export const arrivalErrorKey = (scope: string) => `@closeby/${encodeURIComponent(scope)}/arrival-error/v1`;
export type ArrivalMonitorConfig = { scope: string; enabled: boolean; alerts: boolean; generation: string; zones: SafeZone[]; ownDevice: DeviceProfile; spaceId: string | null; sharing: boolean };
let processing: Promise<void> = Promise.resolve();
const appIsActive = () => AppState.currentState === 'active';

export function arrivalNotificationsSupported(): boolean {
  if (Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo') return false;
  try { return Boolean(requireOptionalNativeModule('ExpoNotificationScheduler')); } catch { return false; }
}
async function notificationApi() {
  if (!arrivalNotificationsSupported()) throw new Error('Install the updated Closeby development build to enable phone arrival notifications.');
  return sharedNotificationApi();
}
export async function arrivalMonitorConfig(): Promise<ArrivalMonitorConfig | null> {
  const raw = await AsyncStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try { const config = JSON.parse(raw) as ArrivalMonitorConfig; return config?.enabled && typeof config.scope === 'string' && typeof config.generation === 'string' && Array.isArray(config.zones) && config.ownDevice ? config : null; }
  catch { return null; }
}
export async function configureArrivalMonitor(config: ArrivalMonitorConfig) {
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, ownDevice: { ...config.ownDevice, location: null } }));
}
export async function arrivalMonitorRunning() {
  return Platform.OS !== 'web' && await Location.hasStartedLocationUpdatesAsync(ARRIVAL_LOCATION_TASK);
}
export async function startArrivalMonitor(config: ArrivalMonitorConfig) {
  if (!config.zones.some(zone => zone.enabled)) throw new Error('Save a safe place with arrival alerts enabled before turning on phone notifications.');
  const api = await notificationApi();
  if (Platform.OS === 'android') await api.setNotificationChannelAsync(CHANNEL, { name: 'Place arrivals and departures', importance: api.AndroidImportance.HIGH, lightColor: '#1186FF' });
  const permission = await api.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Allow Closeby notifications in phone settings to receive arrival alerts.');
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted && !(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Allow location access to monitor your pinned places.');
  const background = await Location.getBackgroundPermissionsAsync();
  if (!background.granted && !(await Location.requestBackgroundPermissionsAsync()).granted) throw new Error('Allow location all the time to monitor arrivals while Closeby is in the background.');
  if (config.scope !== 'local-device') {
    await firebaseAuth?.authStateReady();
    if (firebaseAuth?.currentUser?.uid !== config.scope) throw new Error('Sign in again before enabling family arrival alerts.');
  }
  await configureArrivalMonitor(config);
  try {
    await Location.startLocationUpdatesAsync(ARRIVAL_LOCATION_TASK, {
      accuracy: Location.Accuracy.High, timeInterval: 30000, distanceInterval: 0, deferredUpdatesInterval: 30000,
      pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: 'Closeby arrival alerts are on', notificationBody: 'Monitoring your pinned places and shared family locations. Open Closeby to pause.', notificationColor: '#1186FF', killServiceOnDestroy: false },
    });
    await AsyncStorage.removeItem(arrivalErrorKey(config.scope));
  } catch (error) { await AsyncStorage.removeItem(CONFIG_KEY); throw error; }
}
export async function stopArrivalMonitor() {
  // Clear consent before native shutdown or any in-flight server response.
  await AsyncStorage.removeItem(CONFIG_KEY);
  if (arrivalNotificationsSupported() && await Location.hasStartedLocationUpdatesAsync(ARRIVAL_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(ARRIVAL_LOCATION_TASK);
}
async function familyDevices(spaceId: string): Promise<DeviceProfile[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await Promise.race([getDocsFromServer(collection(requireFirestore(), 'circles', spaceId, 'devices')),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Family location updates timed out.')), 10000); })]);
    return snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id } as DeviceProfile));
  } finally { if (timer) clearTimeout(timer); }
}
export async function presentArrivalNotification(event: PlaceEvent, ownId: string) {
  const api = await notificationApi();
  const who = event.deviceId === ownId ? 'You' : event.deviceName;
  await api.scheduleNotificationAsync({ identifier: event.id,
    content: { title: `${who} ${event.kind === 'arrival' ? 'arrived at' : 'left'} ${event.placeName}`,
      body: `${arrivalClock(event.timestamp)}${event.kind === 'departure' ? ` · Observed stay: ${shortStay(event.timestamp - event.since)}` : event.deviceId === ownId ? ' · Arrival observed by this phone.' : ' · Arrival observed from shared GPS.'}`,
      sound: 'default', data: { type: 'arrival', deviceId: event.deviceId, zoneId: event.zoneId } },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null });
}
export async function watchArrivalNotificationTaps(onTap: (deviceId: string) => void): Promise<() => void> {
  if (!arrivalNotificationsSupported()) return () => {};
  const api = await notificationApi();
  let last = '';
  const receive = (response: import('expo-notifications').NotificationResponse | null) => {
    if (!response || last === response.notification.request.identifier) return;
    const data = response.notification.request.content.data;
    if (data?.type === 'arrival' && typeof data.deviceId === 'string') { last = response.notification.request.identifier; onTap(data.deviceId); }
  };
  const subscription = api.addNotificationResponseReceivedListener(receive);
  receive(await api.getLastNotificationResponseAsync());
  return () => subscription.remove();
}
export function processArrivalLocations(locations: Location.LocationObject[]): Promise<void> {
  const pending = processing.catch(() => undefined).then(async () => {
    if (appIsActive()) return;
    const config = await arrivalMonitorConfig();
    if (!config?.enabled) return;
    if (config.scope !== 'local-device') {
      await firebaseAuth?.authStateReady();
      if (firebaseAuth?.currentUser?.uid !== config.scope) { await stopArrivalMonitor(); return; }
    }
    const latest = [...locations].sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!latest || Date.now() - latest.timestamp > 45000 || latest.timestamp > Date.now() + 5000) return;
    const fix: LocationFix = { latitude: latest.coords.latitude, longitude: latest.coords.longitude, timestamp: latest.timestamp,
      accuracy: latest.coords.accuracy, speed: latest.coords.speed, heading: latest.coords.heading };
    if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90 || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180) return;
    let batteryLevel = config.ownDevice.batteryLevel;
    try { if (await Battery.isAvailableAsync()) { const value = await Battery.getBatteryLevelAsync(); batteryLevel = value >= 0 && value <= 1 ? value : null; } } catch { batteryLevel = null; }
    const ownDevice = { ...config.ownDevice, location: fix, batteryLevel, sharing: config.sharing, lastSeen: fix.timestamp };
    if (config.sharing && config.spaceId && config.scope !== 'local-device') {
      const current = await arrivalMonitorConfig();
      if (current?.generation === config.generation && current.scope === config.scope && current.spaceId === config.spaceId && current.sharing) await publishDevice(config.spaceId, ownDevice.ownerId, ownDevice, true).catch(() => undefined);
    }
    const pollKey = `@closeby/${encodeURIComponent(config.scope)}/arrival-last-poll/v1`;
    const lastPoll = Number(await AsyncStorage.getItem(pollKey) || 0);
    if (Date.now() - lastPoll < 55000) return;
    await AsyncStorage.setItem(pollKey, String(Date.now()));
    const cloudArrivals = await AsyncStorage.getItem(`@closeby/${encodeURIComponent(config.scope)}/cloud-arrivals/v1`) === 'true';
    let family: DeviceProfile[] = [];
    if (config.spaceId && config.scope !== 'local-device' && !cloudArrivals) {
      try { family = await familyDevices(config.spaceId); await AsyncStorage.removeItem(arrivalErrorKey(config.scope)); }
      catch { await AsyncStorage.setItem(arrivalErrorKey(config.scope), 'Family updates could not be refreshed. Own-place alerts continue; family alerts resume when shared locations reconnect.'); }
    }
    const current = await arrivalMonitorConfig();
    if (current?.generation !== config.generation || current.spaceId !== config.spaceId || JSON.stringify(current.zones) !== JSON.stringify(config.zones)) return;
    const tracker = new PlacePresenceTracker(); tracker.restore(await AsyncStorage.getItem(arrivalRuntimeKey(config.scope)), config.spaceId ?? '');
    const result = tracker.update([ownDevice, ...family.filter(device => device.id !== ownDevice.id)], config.zones, ownDevice.id, true, Date.now());
    const outboxKey = `@closeby/${encodeURIComponent(config.scope)}/arrival-outbox/v1`;
    let savedOutbox: { generation: string; spaceId: string | null; events: PlaceEvent[] } | null = null;
    try { savedOutbox = JSON.parse(await AsyncStorage.getItem(outboxKey) || 'null'); } catch { /* Ignore a damaged retry queue. */ }
    const currentIds = new Set([ownDevice.id, ...family.filter(device => device.sharing).map(device => device.id)]);
    const queued = savedOutbox?.generation === config.generation && savedOutbox.spaceId === config.spaceId && Array.isArray(savedOutbox.events)
      ? savedOutbox.events.filter(event => event && typeof event.id === 'string' && typeof event.deviceId === 'string' && typeof event.zoneId === 'string' && Number.isFinite(event.timestamp)
        && currentIds.has(event.deviceId) && config.zones.some(zone => zone.id === event.zoneId && zone.enabled)) : [];
    const outbox = [...new Map([...queued, ...result.events].map(event => [event.id, event])).values()].slice(-20);
    await AsyncStorage.multiSet([[arrivalRuntimeKey(config.scope), tracker.serialize(config.spaceId ?? '')], [outboxKey, JSON.stringify({ generation: config.generation, spaceId: config.spaceId, events: outbox })]]);
    for (const event of [...outbox]) {
      if (cloudArrivals && (event.deviceId !== ownDevice.id || config.sharing)) continue;
      const consent = await arrivalMonitorConfig();
      if (consent?.generation !== config.generation || consent.scope !== config.scope || consent.spaceId !== config.spaceId || !consent.alerts || !consent.zones.some(zone => zone.id === event.zoneId && zone.enabled)) return;
      if (appIsActive()) return;
      await presentArrivalNotification(event, ownDevice.id);
      const index = outbox.findIndex(item => item.id === event.id); if (index >= 0) outbox.splice(index, 1);
      await AsyncStorage.setItem(outboxKey, JSON.stringify({ generation: config.generation, spaceId: config.spaceId, events: outbox }));
    }
  });
  processing = pending; return pending;
}
if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(ARRIVAL_LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(ARRIVAL_LOCATION_TASK, async ({ data, error }) => {
    const config = await arrivalMonitorConfig();
    if (!config) return;
    if (error) { await AsyncStorage.setItem(arrivalErrorKey(config.scope), 'Arrival monitoring reported an error. Reopen Closeby to check location access.'); return; }
    try { if (data?.locations) await processArrivalLocations(data.locations); }
    catch { await AsyncStorage.setItem(arrivalErrorKey(config.scope), 'An arrival alert could not be delivered. Check notification access and reopen Closeby.'); }
  });
}
