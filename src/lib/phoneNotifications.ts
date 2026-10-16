import type { SafeZone } from '../types';

export const phoneChannels = { emergency: 'closeby-emergencies-v1', call: 'closeby-calls-v1', message: 'closeby-messages-v1', arrival: 'closeby-arrivals-v1', departure: 'closeby-arrivals-v1', speed: 'closeby-speed-v1' } as const;
export type PhoneNotificationKind = keyof typeof phoneChannels;
export type PhoneNotificationTarget = { type: 'closeby'; kind: PhoneNotificationKind; eventId: string; uid: string; spaceId: string; resourceId: string; deviceId?: string; expiresAt: number };
export type PhoneAlertSettings = { enabled: boolean; arrivals: boolean; speed: boolean; speedLimitKmh: number; zones: SafeZone[]; generation: string };

export function phoneNotificationTarget(raw: unknown, uid: string | undefined, spaceId: string | undefined, now = Date.now()): PhoneNotificationTarget | null {
  if (!raw || typeof raw !== 'object' || !uid || !spaceId) return null;
  const value = raw as Record<string, unknown>;
  if (value.type !== 'closeby' || !Object.hasOwn(phoneChannels, String(value.kind)) || value.uid !== uid || value.spaceId !== spaceId
    || !Number.isFinite(Number(value.expiresAt)) || Number(value.expiresAt) <= now) return null;
  for (const key of ['eventId', 'resourceId']) if (typeof value[key] !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value[key])) return null;
  if (value.deviceId !== undefined && (typeof value.deviceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.deviceId))) return null;
  return { ...value, expiresAt: Number(value.expiresAt) } as PhoneNotificationTarget;
}

export function notificationZones(zones: SafeZone[]): SafeZone[] {
  return zones.filter(zone => zone && typeof zone.id === 'string' && zone.id.length > 0 && zone.id.length <= 160 && typeof zone.name === 'string' && zone.name.trim().length > 0 && zone.name.length <= 80
    && Number.isFinite(zone.radius) && zone.radius >= 25 && zone.radius <= 10000 && typeof zone.enabled === 'boolean'
    && zone.coordinate && Number.isFinite(zone.coordinate.latitude) && Math.abs(zone.coordinate.latitude) <= 90
    && Number.isFinite(zone.coordinate.longitude) && Math.abs(zone.coordinate.longitude) <= 180).slice(0, 20)
    .map(zone => ({ id: zone.id, name: zone.name.trim(), coordinate: { latitude: zone.coordinate.latitude, longitude: zone.coordinate.longitude }, radius: zone.radius, enabled: zone.enabled, color: '#1186FF' }));
}
