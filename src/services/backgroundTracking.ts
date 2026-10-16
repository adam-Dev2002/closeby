import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { activityErrorKey, captureConfig, captureFix, configureCapture } from './activityCapture';
import { firebaseAuth } from '../lib/firebase';
import { publishDevice } from './circles';
import type { LocationFix } from '../types';
import { validActivityFix } from '../lib/activity';

export const BACKGROUND_LOCATION_TASK = 'closeby-background-location-v1';
export function backgroundSupported() {
  // A development-client manifest can also contain expoGoConfig. Check the
  // native execution environment rather than the manifest's development data.
  return Platform.OS !== 'web' && Constants.executionEnvironment !== 'storeClient' && Constants.appOwnership !== 'expo';
}
export function locationFix(result: Location.LocationObject): LocationFix {
  const nullable = (value: number | null) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return { latitude: result.coords.latitude, longitude: result.coords.longitude, timestamp: result.timestamp,
    accuracy: nullable(result.coords.accuracy), speed: nullable(result.coords.speed), heading: nullable(result.coords.heading) };
}
export async function processBackgroundLocations(locations: Location.LocationObject[]) {
  let last: { fix: LocationFix; sessionId: string } | null = null;
  for (const result of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
    const config = await captureConfig();
    if (!config?.enabled || !config.background) return;
    if (config.scope !== 'local-device') {
      await firebaseAuth?.authStateReady();
      if (firebaseAuth?.currentUser?.uid !== config.scope) { await stopAllActivity(); return; }
    }
    const fix = locationFix(result);
    if (!validActivityFix(fix)) continue;
    await captureFix(fix, true, { scope: config.scope, sessionId: config.sessionId });
    last = { fix, sessionId: config.sessionId };
  }
  if (last && Date.now() - last.fix.timestamp <= 45000) {
    const latest = await captureConfig();
    if (latest?.sessionId !== last.sessionId || !latest.enabled || !latest.background || !latest.liveSharing || !latest.liveSpaceId || !latest.device) return;
    await firebaseAuth?.authStateReady();
    if (firebaseAuth?.currentUser?.uid === latest.device.ownerId) {
      try { await publishDevice(latest.liveSpaceId, latest.device.ownerId, { ...latest.device, location: last.fix }, true); }
      catch { /* The recorder retains the location locally even when sharing cannot sync. */ }
    }
  }
}

if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    const config = await captureConfig();
    if (error) { if (config) await AsyncStorage.setItem(activityErrorKey(config.scope), 'Background GPS reported an error. Check location access and reopen Closeby.'); return; }
    try { if (data?.locations) await processBackgroundLocations(data.locations); }
    catch { if (config) await AsyncStorage.setItem(activityErrorKey(config.scope), 'Background history could not be saved. Reopen Closeby and check available storage.'); }
  });
}

export async function startBackgroundTracking(expected?: { scope: string; sessionId: string }) {
  if (!backgroundSupported() || !(await TaskManager.isAvailableAsync())) throw new Error('Background history needs an installed native development build. Expo Go and browsers record only while open.');
  const existingForeground = await Location.getForegroundPermissionsAsync();
  const foreground = existingForeground.granted ? existingForeground : await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error('Allow location access before recording background history.');
  const existingBackground = await Location.getBackgroundPermissionsAsync();
  const permission = existingBackground.granted ? existingBackground : await Location.requestBackgroundPermissionsAsync();
  if (!permission.granted) throw new Error('Allow location all the time in phone settings to record when Closeby is in the background.');
  const config = await captureConfig();
  if (expected && (config?.scope !== expected.scope || config.sessionId !== expected.sessionId || !config.enabled || !config.background)) throw new Error('Background recording was cancelled because this account or recording session changed.');
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High, timeInterval: 30000, distanceInterval: 0,
    deferredUpdatesInterval: 30000, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
    foregroundService: { notificationTitle: 'Closeby history is recording', notificationBody: 'Recording your location history. Open Closeby to pause.', notificationColor: '#8295FF', killServiceOnDestroy: true },
  });
}
export async function backgroundIsRunning() {
  return backgroundSupported() && await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
}
export async function stopBackgroundTracking() {
  const config = await captureConfig();
  if (config?.background) await configureCapture({ ...config, background: false });
  if (backgroundSupported() && await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
}
export async function stopAllActivity() {
  // Persist the stop before awaiting native shutdown, so headless callbacks also stop.
  await configureCapture(null);
  await stopBackgroundTracking();
}
