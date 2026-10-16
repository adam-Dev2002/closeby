import type { DeviceProfile, LocationFix } from '../types';
import { speedKmh } from './speedAlerts';

export function coordinates(location: LocationFix | null): string {
  return location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'Waiting for location';
}
export function age(timestamp: number, now = Date.now()): string {
  if (!timestamp) return 'No location received';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  if (seconds < 3600) return `Updated ${Math.floor(seconds / 60)} min ago`;
  return `Updated ${Math.floor(seconds / 3600)} hr ago`;
}
export function battery(value: number | null): string {
  return typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1 ? '—' : `${Math.round(value * 100)}%`;
}
export function speed(location: LocationFix | null, now = Date.now()): string {
  const value = speedKmh(location, now);
  return value === null ? '—' : `${Math.round(value)} km/h`;
}
export function deviceStatus(device: DeviceProfile, now: number): string {
  if (!device.location) return device.sharing ? 'Waiting for GPS' : 'Not sharing';
  if (now - device.location.timestamp > 45_000) return 'Last known location';
  return (device.location.speed ?? 0) > 0.8 ? 'Live · Moving' : 'Live · Stationary';
}
