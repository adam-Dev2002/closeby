import { defaultMapType, hasMeasuredLocation, mapModes, routeBounds, validCoordinate, validZones, visibleDevices, type LiveMapProps, type MapType } from './mapModel';
import type { Coordinate, LocationFix } from '../types';
import { avatarImageSource } from './avatars';
import { batteryPercent, type PlacePresence } from './placePresence';

export type OpenMapState = {
  mapType: MapType;
  devices: { id: string; name: string; location: LocationFix; portraitSource: string | null; batteryPercent: number | null; presence: PlacePresence | null }[];
  selectedId: string;
  location: LocationFix | null;
  route: Coordinate[];
  routes: Coordinate[][];
  zones: LiveMapProps['zones'];
  bounds: ReturnType<typeof routeBounds>;
  recenterKey: number;
  bottomInset: number;
  focusCoordinate: Coordinate | null;
  showZoneBoundaries: boolean;
};

export function openMapState(props: LiveMapProps): OpenMapState {
  const routes = (props.routeSegments ?? [props.route]).map(segment => segment.filter(validCoordinate).map(({ latitude, longitude }) => ({ latitude, longitude })));
  const route = routes.flat();
  return {
    mapType: mapModes.some(mode => mode.id === props.mapType) ? props.mapType! : defaultMapType,
    devices: visibleDevices(props.devices).map(device => ({ id: device.id, name: device.name, location: device.location, portraitSource: avatarImageSource(device), batteryPercent: batteryPercent(device.batteryLevel), presence: props.presence?.[device.id] ?? null })),
    selectedId: props.selectedId,
    location: hasMeasuredLocation(props.location) ? props.location : null,
    route,
    routes,
    zones: validZones(props.zones),
    bounds: routeBounds(route),
    recenterKey: props.recenterKey ?? 0,
    bottomInset: Number.isFinite(props.bottomInset) ? Math.max(0, props.bottomInset ?? 0) : 0,
    focusCoordinate: validCoordinate(props.focusCoordinate) ? props.focusCoordinate : null,
    showZoneBoundaries: props.showZoneBoundaries ?? false,
  };
}

// Data is embedded in HTML on both platforms, so a device name must never end a script tag.
export function mapJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

type MapMessage = { type: 'ready' } | { type: 'error'; message: string } | { type: 'select' | 'selectZone'; id: string } | { type: 'press'; coordinate: Coordinate };
export function readMapMessage(value: unknown, channel: string, state: OpenMapState): MapMessage | null {
  try {
    const message = (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown> | null;
    if (!message || message.channel !== channel) return null;
    if (message.type === 'ready') return { type: 'ready' };
    if (message.type === 'error' && typeof message.message === 'string') return { type: 'error', message: message.message.slice(0, 240) };
    if (message.type === 'select' && typeof message.id === 'string' && state.devices.some(device => device.id === message.id)) return { type: 'select', id: message.id };
    if (message.type === 'selectZone' && typeof message.id === 'string' && state.zones.some(zone => zone.id === message.id)) return { type: 'selectZone', id: message.id };
    if (message.type === 'press' && validCoordinate(message.coordinate)) return { type: 'press', coordinate: message.coordinate };
  } catch { /* Ignore malformed messages from the embedded document. */ }
  return null;
}

export function attributionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['www.openmaptiles.org', 'openmaptiles.org', 'www.openstreetmap.org', 'openstreetmap.org', 'maps.eox.at', 'eox.at', 's2maps.eu', 'creativecommons.org', 'www.esri.com', 'www.arcgis.com'].includes(url.hostname);
  } catch { return false; }
}
