import type { ActivityEntry, ActivitySample, LocationFix, SafeZone } from '../types';

export const HISTORY_DAYS = 30;
export const MAX_DAY_SAMPLES = 3000;
export const MAX_GAP_MS = 120000;
export const STOP_MIN_MS = 120000;

export function dateKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dayRange(day: string): { start: number; end: number } {
  const [year, month, date] = day.split('-').map(Number);
  const start = new Date(year!, month! - 1, date!).getTime();
  return { start, end: new Date(year!, month! - 1, date! + 1).getTime() };
}
export function recentDays(now = Date.now()): string[] {
  return Array.from({ length: HISTORY_DAYS }, (_, index) => {
    const date = new Date(now); date.setDate(date.getDate() - index);
    return dateKey(date.getTime());
  });
}
export function metres(a: LocationFix, b: LocationFix): number {
  const radians = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * radians / 2) ** 2
    + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin((b.longitude - a.longitude) * radians / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.max(0, h)), Math.sqrt(Math.max(0, 1 - h)));
}
export function validActivityFix(value: unknown): value is LocationFix {
  if (!value || typeof value !== 'object') return false;
  const fix = value as LocationFix;
  return Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90
    && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180
    && Number.isFinite(fix.timestamp) && fix.timestamp > 0
    && typeof fix.accuracy === 'number' && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= 80
    && (fix.speed === null || Number.isFinite(fix.speed) && fix.speed >= 0)
    && (fix.heading === null || Number.isFinite(fix.heading) && fix.heading >= 0 && fix.heading <= 360);
}
export function validSample(value: unknown): value is ActivitySample {
  if (!value || typeof value !== 'object') return false;
  const item = value as ActivitySample;
  return typeof item.id === 'string' && item.id.length <= 100 && typeof item.sessionId === 'string' && item.sessionId.length <= 80
    && validActivityFix(item.fix) && Number.isFinite(item.distanceMeters) && item.distanceMeters >= 0
    && (item.place === null || typeof item.place === 'string' && item.place.length <= 80);
}
export function segmentDistance(a: LocationFix, b: LocationFix): number {
  const elapsed = b.timestamp - a.timestamp;
  if (elapsed <= 0 || elapsed > MAX_GAP_MS) return 0;
  const distance = metres(a, b);
  // Suppress GPS jitter and implausible jumps instead of treating them as journeys.
  if (distance < Math.max(8, (a.accuracy ?? 0) + (b.accuracy ?? 0)) || distance / (elapsed / 1000) > 85) return 0;
  return distance;
}
export function placeAt(fix: LocationFix, zones: SafeZone[]): string | null {
  const zone = zones.find(item => item.enabled && metres(fix, { ...fix, ...item.coordinate }) + (fix.accuracy ?? 0) < item.radius);
  return zone?.name.slice(0, 80) ?? null;
}

export function activityTimeline(input: ActivitySample[]): { entries: ActivityEntry[]; routes: LocationFix[][]; distanceMeters: number; observedMs: number; stoppedMs: number } {
  const samples = input.filter(validSample).sort((a, b) => a.fix.timestamp - b.fix.timestamp)
    .filter((sample, index, all) => !index || sample.fix.timestamp !== all[index - 1]!.fix.timestamp);
  const groups: ActivitySample[][] = [];
  for (const sample of samples) {
    const group = groups[groups.length - 1], previous = group?.[group.length - 1];
    const gap = previous ? sample.fix.timestamp - previous.fix.timestamp : 0;
    const jump = previous && gap > 0 && metres(previous.fix, sample.fix) / (gap / 1000) > 85;
    if (!previous || previous.sessionId !== sample.sessionId || gap > MAX_GAP_MS || jump) groups.push([sample]);
    else group!.push(sample);
  }
  const entries: ActivityEntry[] = [];
  const routes = groups.map(group => group.map(sample => sample.fix));
  let observedMs = 0, totalDistance = 0, stoppedMs = 0;
  function entry(kind: ActivityEntry['kind'], group: ActivitySample[], departed = false): ActivityEntry {
    const first = group[0]!, last = group[group.length - 1]!;
    const distance = group.slice(1).reduce((sum, item, i) => sum + segmentDistance(group[i]!.fix, item.fix), 0);
    return { id: `${kind}-${first.id}`, kind, startedAt: first.fix.timestamp, endedAt: last.fix.timestamp,
      points: group.map(item => item.fix), distanceMeters: kind === 'move' ? distance : 0,
      place: group.find(item => item.place)?.place ?? null, departed };
  }
  groups.forEach((group, groupIndex) => {
    const first = group[0]!, last = group[group.length - 1]!;
    if (groupIndex) {
      const before = groups[groupIndex - 1]!.at(-1)!;
      entries.push({ id: `gap-${first.id}`, kind: 'gap', startedAt: before.fix.timestamp, endedAt: first.fix.timestamp, points: [], distanceMeters: 0, place: null, departed: false });
    }
    observedMs += last.fix.timestamp - first.fix.timestamp;
    let start = 0, index = 0;
    while (index < group.length) {
      let end = index + 1;
      const anchor = group[index]!.fix;
      while (end < group.length && metres(anchor, group[end]!.fix) <= Math.max(50, (anchor.accuracy ?? 0) + (group[end]!.fix.accuracy ?? 0))) end++;
      const stopEnd = end - 1;
      if (group[stopEnd]!.fix.timestamp - anchor.timestamp >= STOP_MIN_MS) {
        if (index > start) entries.push(entry('move', group.slice(start, index + 1)));
        const stop = entry('stop', group.slice(index, end), end < group.length);
        stoppedMs += stop.endedAt - stop.startedAt; entries.push(stop);
        start = stopEnd; index = end;
      } else index++;
    }
    if (start < group.length - 1) {
      // A trailing confirmed stop is already represented by its stop entry.
      const lastEntry = entries[entries.length - 1];
      if (!(lastEntry?.kind === 'stop' && lastEntry.endedAt === last.fix.timestamp)) entries.push(entry('move', group.slice(start)));
    } else if (group.length === 1) entries.push(entry('move', group));
  });
  totalDistance = entries.filter(item => item.kind === 'move').reduce((sum, item) => sum + item.distanceMeters, 0);
  return { entries, routes, distanceMeters: totalDistance, observedMs, stoppedMs };
}

export const clock = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export function duration(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  return minutes < 1 ? '<1 min' : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}
