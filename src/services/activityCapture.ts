import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUuid } from '../lib/uuid';
import { dateKey, HISTORY_DAYS, MAX_DAY_SAMPLES, MAX_GAP_MS, placeAt, recentDays, segmentDistance, validActivityFix, validSample } from '../lib/activity';
import { firebaseAuth } from '../lib/firebase';
import { publishActivity } from './activityHistory';
import type { ActivitySample, DeviceProfile, LocationFix, SafeZone } from '../types';

export type CaptureConfig = {
  scope: string; enabled: boolean; enabledAt: number; sessionId: string; background: boolean; zones: SafeZone[];
  shared: { spaceId: string; uid: string; generation: string; startedAt: number } | null;
  device: DeviceProfile | null; liveSharing: boolean;
  liveSpaceId: string | null;
};
const CONFIG_KEY = '@closeby/activity-capture/v1';
const listeners = new Set<(scope: string) => void>();
let current: CaptureConfig | null | undefined;
let writes: Promise<void> = Promise.resolve();
let configWrites: Promise<void> = Promise.resolve();
const key = (scope: string, day: string) => `@closeby/${encodeURIComponent(scope)}/activity/${day}/v1`;
type Runtime = { sessionId: string; last: LocationFix | null; sampled: LocationFix | null; distance: number };
const runtime = new Map<string, Runtime>();

export function subscribeActivity(listener: (scope: string) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const activityErrorKey = (scope: string) => `@closeby/${encodeURIComponent(scope)}/activity-error/v1`;
export async function captureConfig(): Promise<CaptureConfig | null> {
  if (current === undefined) {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    if (current === undefined) current = raw ? JSON.parse(raw) as CaptureConfig : null;
  }
  return current ?? null;
}
export async function configureCapture(config: CaptureConfig | null): Promise<void> {
  current = config;
  const pending = configWrites.catch(() => undefined).then(() => AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config)));
  configWrites = pending; await pending;
}
export async function readActivityDay(scope: string, day: string): Promise<{ samples: ActivitySample[]; truncated: boolean }> {
  const raw = await AsyncStorage.getItem(key(scope, day));
  const data = raw ? JSON.parse(raw) as { samples: unknown[]; truncated: boolean } : { samples: [], truncated: false };
  return { samples: Array.isArray(data.samples) ? data.samples.filter(validSample) : [], truncated: Boolean(data.truncated) };
}
export async function clearActivityDay(scope: string, day: string) {
  // Serialize deletion with capture so an older write cannot resurrect deleted points.
  const pending = writes.catch(() => undefined).then(() => AsyncStorage.removeItem(key(scope, day)));
  writes = pending; await pending; listeners.forEach(listener => listener(scope));
}

export function captureFix(fix: LocationFix, batched = false, expected?: { scope: string; sessionId?: string }): Promise<void> {
  // Rules and TTL use integer milliseconds; iOS location timestamps can contain fractions.
  fix = { ...fix, timestamp: Math.round(fix.timestamp) };
  const pending = writes.catch(() => undefined).then(async () => {
    const config = await captureConfig();
    if (expected && (config?.scope !== expected.scope || expected.sessionId && config.sessionId !== expected.sessionId)) return;
    if (!config?.enabled || !validActivityFix(fix) || fix.timestamp < config.enabledAt
      || fix.timestamp > Date.now() + 30000 || Date.now() - fix.timestamp > (batched ? HISTORY_DAYS * 86400000 : MAX_GAP_MS)) return;
    let previous = runtime.get(config.scope);
    if (!previous) {
      const raw = await AsyncStorage.getItem(`@closeby/${encodeURIComponent(config.scope)}/activity-runtime/v1`);
      previous = raw ? JSON.parse(raw) as Runtime : { sessionId: config.sessionId, last: null, sampled: null, distance: 0 };
    }
    if (previous.sessionId !== config.sessionId) previous = { sessionId: config.sessionId, last: null, sampled: null, distance: 0 };
    if (previous.last && fix.timestamp <= previous.last.timestamp) return;
    if (previous.last) previous.distance += segmentDistance(previous.last, fix);
    previous.last = fix;
    const sinceSample = previous.sampled ? fix.timestamp - previous.sampled.timestamp : Infinity;
    // Keep enough stationary fixes for stop detection, without uploading every GPS callback.
    const moving = previous.sampled ? segmentDistance(previous.sampled, fix) > 0 : true;
    const shouldSave = sinceSample >= (moving ? 30000 : 60000);
    runtime.set(config.scope, previous);
    if (!shouldSave) return;
    previous.sampled = fix;
    if (!current?.enabled || current.sessionId !== config.sessionId) return;
    const sample: ActivitySample = { id: `${config.sessionId}_${fix.timestamp}`, sessionId: config.sessionId, fix,
      distanceMeters: previous.distance, place: placeAt(fix, config.zones) };
    const day = dateKey(fix.timestamp), data = await readActivityDay(config.scope, day);
    data.samples.push(sample);
    if (data.samples.length > MAX_DAY_SAMPLES) { data.samples = data.samples.slice(-MAX_DAY_SAMPLES); data.truncated = true; }
    // Each day is a separate small record; expired local days are removed during capture.
    const daysKey = `@closeby/${encodeURIComponent(config.scope)}/activity-days/v1`;
    const dayList: string[] = JSON.parse(await AsyncStorage.getItem(daysKey) || '[]');
    const allowed = new Set(recentDays());
    const expired = dayList.filter(item => !allowed.has(item));
    if (expired.length) await AsyncStorage.multiRemove(expired.map(item => key(config.scope, item)));
    await AsyncStorage.multiSet([
      [key(config.scope, day), JSON.stringify(data)], [daysKey, JSON.stringify([...new Set([day, ...dayList.filter(item => allowed.has(item))])])],
      [`@closeby/${encodeURIComponent(config.scope)}/activity-runtime/v1`, JSON.stringify(previous)],
    ]);
    listeners.forEach(listener => listener(config.scope));
    if (config.shared && current?.shared?.generation === config.shared.generation && current.liveSharing) {
      await firebaseAuth?.authStateReady();
      const shared = config.shared;
      if (current?.enabled && current.shared?.generation === shared.generation && firebaseAuth?.currentUser?.uid === shared.uid) {
        try { await publishActivity(shared.spaceId, shared.uid, shared.generation, sample); }
        catch { await AsyncStorage.setItem(activityErrorKey(config.scope), 'History sync could not reach your space. This sample is saved on this phone; a gap may appear in shared history.'); }
      }
    }
  });
  writes = pending; return pending;
}

export function newCaptureSession(): string { return randomUuid(); }
