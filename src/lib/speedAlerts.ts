import type { DeviceProfile, LocationFix } from '../types';

export type SpeedPreferences = { enabled: boolean; limitKmh: number };
export type SpeedAlertEvent = {
  deviceId: string;
  name: string;
  speedKmh: number;
  limitKmh: number;
  timestamp: number;
};
export type SpeedAlertOptions = SpeedPreferences & {
  scope: string;
  ownDeviceId: string;
  ownTracking: boolean;
};

export const DEFAULT_SPEED_PREFERENCES: Readonly<SpeedPreferences> = Object.freeze({ enabled: false, limitKmh: 80 });
export const MIN_SPEED_LIMIT_KMH = 10;
export const MAX_SPEED_LIMIT_KMH = 200;
const STALE_AFTER_MS = 45_000;
const FUTURE_TOLERANCE_MS = 5_000;
const CONFIRM_AFTER_MS = 3_000;
const MAX_CONFIRM_GAP_MS = 30_000;
const ALERT_COOLDOWN_MS = 60_000;
const HYSTERESIS_KMH = 3;

export function validSpeedLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_SPEED_LIMIT_KMH && value <= MAX_SPEED_LIMIT_KMH;
}

export function speedPreferencesKey(scope: string): string {
  return `@closeby/${encodeURIComponent(scope)}/speed-alerts/v1`;
}

export function parseSpeedPreferences(value: string | null): SpeedPreferences {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    if (typeof parsed === 'object' && parsed !== null && 'enabled' in parsed && 'limitKmh' in parsed
      && typeof parsed.enabled === 'boolean' && validSpeedLimit(parsed.limitKmh)) {
      return { enabled: parsed.enabled, limitKmh: parsed.limitKmh };
    }
  } catch { /* An invalid saved value uses the safe defaults. */ }
  return { ...DEFAULT_SPEED_PREFERENCES };
}

/** GPS speed is measured in metres per second; missing speed stays unknown. */
export function speedKmh(fix: LocationFix | null | undefined, now = Date.now()): number | null {
  if (!fix || typeof fix.speed !== 'number' || !Number.isFinite(fix.speed) || fix.speed < 0
    || !Number.isFinite(fix.timestamp) || fix.timestamp <= 0 || !Number.isFinite(now)
    || now - fix.timestamp > STALE_AFTER_MS || fix.timestamp > now + FUTURE_TOLERANCE_MS) return null;
  const result = fix.speed * 3.6;
  return Number.isFinite(result) ? result : null;
}

type DeviceState = {
  lastTimestamp: number;
  firstHighTimestamp: number | null;
  previousHighTimestamp: number | null;
  armed: boolean;
  lastAlertAt: number | null;
};

/** Stateful confirmation avoids single GPS spikes and repeated alerts in one episode. */
export function createSpeedAlertEvaluator() {
  const states = new Map<string, DeviceState>();
  let configuration: string | null = null;

  function reset() { states.clear(); configuration = null; }

  function evaluate(device: DeviceProfile, options: SpeedAlertOptions, now = Date.now()): SpeedAlertEvent | null {
    const nextConfiguration = JSON.stringify([options.scope, options.enabled, options.limitKmh, options.ownDeviceId]);
    if (configuration !== nextConfiguration) { states.clear(); configuration = nextConfiguration; }
    if (!options.enabled || !validSpeedLimit(options.limitKmh)) return null;

    const eligible = device.id === options.ownDeviceId ? options.ownTracking : device.sharing;
    if (!eligible) { states.delete(device.id); return null; }
    const fix = device.location;
    const measuredSpeed = speedKmh(fix, now);
    const state = states.get(device.id) ?? {
      lastTimestamp: 0, firstHighTimestamp: null, previousHighTimestamp: null, armed: true, lastAlertAt: null,
    };
    states.set(device.id, state);

    // A duplicate listener snapshot is not a second measurement. Out-of-order data is ignored.
    if (fix && Number.isFinite(fix.timestamp) && fix.timestamp <= state.lastTimestamp) return null;
    if (fix && Number.isFinite(fix.timestamp) && fix.timestamp > 0 && fix.timestamp <= now + FUTURE_TOLERANCE_MS) {
      state.lastTimestamp = fix.timestamp;
    }
    if (measuredSpeed === null || !fix || typeof fix.accuracy !== 'number'
      || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 50) {
      state.firstHighTimestamp = null;
      state.previousHighTimestamp = null;
      return null;
    }

    if (measuredSpeed <= options.limitKmh) {
      state.firstHighTimestamp = null;
      state.previousHighTimestamp = null;
      if (measuredSpeed <= options.limitKmh - HYSTERESIS_KMH) state.armed = true;
      return null;
    }
    if (!state.armed) return null;

    const previous = state.previousHighTimestamp;
    if (state.firstHighTimestamp === null || previous === null || fix.timestamp - previous > MAX_CONFIRM_GAP_MS) {
      state.firstHighTimestamp = fix.timestamp;
    } else if (fix.timestamp - state.firstHighTimestamp > MAX_CONFIRM_GAP_MS) {
      // Keep a recent consecutive pair when a sustained episode outlasts the cooldown.
      state.firstHighTimestamp = previous;
    }
    state.previousHighTimestamp = fix.timestamp;
    if (fix.timestamp - state.firstHighTimestamp < CONFIRM_AFTER_MS) return null;
    if (state.lastAlertAt !== null && now - state.lastAlertAt < ALERT_COOLDOWN_MS) return null;

    state.armed = false;
    state.lastAlertAt = now;
    state.firstHighTimestamp = null;
    state.previousHighTimestamp = null;
    return { deviceId: device.id, name: device.name, speedKmh: measuredSpeed, limitKmh: options.limitKmh, timestamp: fix.timestamp };
  }

  function retainDevices(ids: readonly string[]) {
    const present = new Set(ids);
    for (const id of states.keys()) if (!present.has(id)) states.delete(id);
  }

  function pause() {
    for (const state of states.values()) {
      state.firstHighTimestamp = null;
      state.previousHighTimestamp = null;
    }
  }
  function serialize() { return JSON.stringify({ configuration, states: [...states] }); }
  function restore(raw: string | null) {
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      if (typeof saved.configuration !== 'string' || !Array.isArray(saved.states) || saved.states.length > 100) return;
      const restored = new Map<string, DeviceState>();
      for (const [id, state] of saved.states) {
        if (typeof id !== 'string' || !state || typeof state.armed !== 'boolean' || !Number.isFinite(state.lastTimestamp) || state.lastTimestamp < 0
          || !['firstHighTimestamp', 'previousHighTimestamp', 'lastAlertAt'].every(key => state[key] === null || (Number.isFinite(state[key]) && state[key] >= 0))) return;
        restored.set(id, state);
      }
      states.clear(); for (const [id, state] of restored) states.set(id, state); configuration = saved.configuration;
    } catch { /* Invalid persisted state cannot create an alert. */ }
  }
  return { evaluate, reset, retainDevices, pause, serialize, restore, removeDevice: (id: string) => states.delete(id) };
}
