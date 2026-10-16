import type { DeviceProfile, LocationFix, SafeZone } from '../types';

export type PlacePresence = { zoneId: string; name: string; description: string; since: number; updatedAt: number; arrivalObserved: boolean };
export type PlaceEvent = { id: string; deviceId: string; deviceName: string; zoneId: string; placeName: string; kind: 'arrival' | 'departure'; timestamp: number; since: number };
type Observation = { zoneId: string | null; since: number; lastFix: number; arrivalObserved: boolean; candidate: { zoneId: string | null; since: number } | null };
const FRESH_MS = 45000;
const GAP_MS = 120000;

export function batteryPercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? Math.round(value * 100) : null;
}
export function shortStay(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  if (minutes < 1) return 'less than 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return `${hours} hr${remainder ? ` ${remainder} min` : ''}`;
}
export function arrivalClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function presenceCaption(presence: PlacePresence, now: number): { title: string; detail: string; time: string } {
  const fresh = now - presence.updatedAt <= FRESH_MS && presence.updatedAt <= now + 5000;
  return { title: presence.name,
    detail: fresh ? `Here for ${presence.arrivalObserved ? '' : 'at least '}${shortStay(Math.max(0, now - presence.since))}` : 'Last seen here',
    time: `${presence.arrivalObserved ? 'Arrived' : 'First seen'} ${arrivalClock(presence.since)}` };
}
function distance(a: LocationFix, b: SafeZone['coordinate']): number {
  const r = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * r / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin((b.longitude - a.longitude) * r / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.max(0, h)), Math.sqrt(Math.max(0, 1 - h)));
}
function reliable(fix: LocationFix | null, now: number): fix is LocationFix & { accuracy: number } {
  return Boolean(fix && Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90 && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180
    && Number.isFinite(fix.timestamp) && fix.timestamp > 0 && now - fix.timestamp <= FRESH_MS && fix.timestamp <= now + 5000
    && typeof fix.accuracy === 'number' && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= 100);
}

/** Observed arrivals only. Reconnecting or seeing a person for the first time establishes a baseline. */
export class PlacePresenceTracker {
  private observations = new Map<string, Observation>();
  private zoneKey = '';
  reset() { this.observations.clear(); }
  serialize(context?: string): string { return JSON.stringify({ zoneKey: this.zoneKey, observations: [...this.observations], context }); }
  restore(raw: string | null, expectedContext?: string, now = Date.now()) {
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (expectedContext !== undefined && data.context !== expectedContext) return;
      if (typeof data.zoneKey !== 'string' || !Array.isArray(data.observations) || data.observations.length > 100) return;
      const restored = new Map<string, Observation>();
      for (const [id, observation] of data.observations) {
        if (typeof id !== 'string' || !observation || !(observation.zoneId === null || typeof observation.zoneId === 'string')
          || !Number.isFinite(observation.since) || observation.since <= 0 || !Number.isFinite(observation.lastFix) || observation.lastFix < observation.since || observation.lastFix > now + 5000
          || typeof observation.arrivalObserved !== 'boolean') return;
        const candidate = observation.candidate;
        if (candidate && (!(candidate.zoneId === null || typeof candidate.zoneId === 'string') || !Number.isFinite(candidate.since) || candidate.since <= 0 || candidate.since > observation.lastFix)) return;
        restored.set(id, { ...observation, candidate: candidate ? { zoneId: candidate.zoneId, since: candidate.since } : null });
      }
      this.zoneKey = data.zoneKey; this.observations = restored;
    } catch { /* A corrupt cached observation cannot manufacture an arrival. */ }
  }
  update(devices: DeviceProfile[], zones: SafeZone[], ownId: string, ownTracking: boolean, now: number): { presence: Record<string, PlacePresence>; events: PlaceEvent[] } {
    const places = zones.filter(zone => Number.isFinite(zone.radius) && zone.radius >= 25 && zone.radius <= 10000
      && Number.isFinite(zone.coordinate.latitude) && Math.abs(zone.coordinate.latitude) <= 90 && Number.isFinite(zone.coordinate.longitude) && Math.abs(zone.coordinate.longitude) <= 180);
    const zoneKey = JSON.stringify(places.map(zone => [zone.id, zone.coordinate, zone.radius, zone.enabled]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    if (zoneKey !== this.zoneKey) { this.reset(); this.zoneKey = zoneKey; }
    const events: PlaceEvent[] = [], presence: Record<string, PlacePresence> = {};
    const eligible = devices.filter(device => device.id === ownId ? ownTracking : device.sharing);
    const ids = new Set(eligible.filter(device => device.location).map(device => device.id));
    this.observations.forEach((_value, id) => { if (!ids.has(id)) this.observations.delete(id); });
    for (const device of eligible) {
      const fix = device.location;
      let previous = this.observations.get(device.id);
      if (reliable(fix, now) && (!previous || fix.timestamp > previous.lastFix)) {
        if (previous && fix.timestamp - previous.lastFix > GAP_MS) { this.observations.delete(device.id); previous = undefined; }
        const distances = places.map(zone => ({ zone, distance: distance(fix, zone.coordinate) }));
        const current = distances.find(item => item.zone.id === previous?.zoneId);
        let zoneId: string | null | undefined;
        if (current && current.distance - fix.accuracy <= current.zone.radius) zoneId = current.zone.id;
        else {
          const inside = distances.filter(item => fix.accuracy <= Math.min(100, item.zone.radius / 2) && item.distance + fix.accuracy < item.zone.radius).sort((a, b) => a.distance - b.distance)[0];
          zoneId = inside?.zone.id ?? (distances.every(item => item.distance - fix.accuracy > item.zone.radius) ? null : undefined);
        }
        if (zoneId !== undefined) {
          if (!previous) {
            previous = { zoneId, since: fix.timestamp, lastFix: fix.timestamp, arrivalObserved: false, candidate: null };
          } else if (zoneId === previous.zoneId) previous.candidate = null;
          else if (!previous.candidate || previous.candidate.zoneId !== zoneId) previous.candidate = { zoneId, since: fix.timestamp };
          else if (fix.timestamp - previous.candidate.since >= 3000) {
            const timestamp = previous.candidate.since;
            const leaving = places.find(zone => zone.id === previous!.zoneId), arriving = places.find(zone => zone.id === zoneId);
            for (const [kind, zone] of [['departure', leaving], ['arrival', arriving]] as const) {
              if (zone?.enabled) events.push({ id: `${device.id}/${zone.id}/${kind}/${timestamp}`, deviceId: device.id, deviceName: device.name,
                zoneId: zone.id, placeName: zone.name, kind, timestamp, since: kind === 'departure' ? previous.since : timestamp });
            }
            previous = { zoneId, since: timestamp, lastFix: fix.timestamp, arrivalObserved: true, candidate: null };
          }
        } else if (previous) previous.candidate = null;
        if (previous) { previous.lastFix = fix.timestamp; this.observations.set(device.id, previous); }
      }
      const zone = previous && places.find(zone => zone.id === previous.zoneId);
      if (previous && zone) presence[device.id] = { zoneId: zone.id, name: zone.name, description: zone.description ?? '', since: previous.since, updatedAt: previous.lastFix, arrivalObserved: previous.arrivalObserved };
    }
    return { presence, events };
  }
}
