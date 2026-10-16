import type { StyleProp, ViewStyle } from 'react-native';
import type { Coordinate, DeviceProfile, LocationFix, SafeZone } from '../types';
import type { PlacePresence } from './placePresence';

export type MapType = 'dark' | 'standard' | 'satellite' | 'hybrid' | 'terrain';
export const defaultMapType: MapType = 'hybrid';
// Public, basemap-only client token. Expo inlines this direct env access.
export const arcgisApiKey = process.env.EXPO_PUBLIC_ARCGIS_API_KEY?.trim() || '';
export const hasArcgisImagery = Boolean(arcgisApiKey);
export const mapModes: { id: MapType; title: string; detail: string }[] = [
  { id: 'dark', title: 'Google Dark', detail: 'Dark Google streets with blue pins and white GPS trails' },
  { id: 'standard', title: 'Google Street', detail: 'Google roads and place names in a light street view' },
  { id: 'satellite', title: 'Satellite', detail: 'Google satellite and aerial imagery in its original colors' },
  { id: 'hybrid', title: 'Satellite + streets', detail: 'Google satellite imagery with roads and place labels' },
  { id: 'terrain', title: 'Terrain', detail: 'Google terrain, roads, and elevation detail' },
];
export type LiveMapProps = {
  devices: DeviceProfile[]; selectedId: string; onSelect: (id: string) => void;
  location: LocationFix | null; route: LocationFix[]; zones: SafeZone[];
  routeSegments?: LocationFix[][];
  presence?: Record<string, PlacePresence>;
  onMapPress?: (coordinate: Coordinate) => void;
  onPlacePress?: (coordinate: Coordinate, name: string) => void;
  focusCoordinate?: Coordinate | null;
  showZoneBoundaries?: boolean;
  onZoneSelect?: (id: string) => void;
  recenterKey?: number; mapType?: MapType;
  bottomInset?: number; style?: StyleProp<ViewStyle>;
};

export function validCoordinate(value: unknown): value is Coordinate {
  if (!value || typeof value !== 'object') return false;
  const point = value as Coordinate;
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}
export function hasMeasuredLocation(value: LocationFix | null | undefined): value is LocationFix {
  return validCoordinate(value) && typeof value.timestamp === 'number' && Number.isFinite(value.timestamp) && value.timestamp > 0;
}
export function locationIsFresh(value: LocationFix | null | undefined, now = Date.now()): boolean {
  return hasMeasuredLocation(value) && now - value.timestamp <= 45000 && value.timestamp <= now + 5000;
}
export function visibleDevices(devices: DeviceProfile[]): (DeviceProfile & { location: LocationFix })[] {
  return devices.filter((device): device is DeviceProfile & { location: LocationFix } => hasMeasuredLocation(device.location));
}
export function validZones(zones: SafeZone[]): SafeZone[] {
  return zones.filter(zone => validCoordinate(zone.coordinate) && Number.isFinite(zone.radius) && zone.radius > 0 && zone.radius <= 10000);
}
export function googleMapType(type: MapType): 'roadmap' | 'satellite' | 'hybrid' | 'terrain' {
  return type === 'standard' || type === 'dark' ? 'roadmap' : type;
}
export function googleMapsUrl(point: Coordinate, action: 'map' | 'street-view' = 'map'): string | null {
  if (!validCoordinate(point)) return null;
  const position = encodeURIComponent(`${point.latitude},${point.longitude}`);
  return action === 'street-view'
    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${position}`
    : `https://www.google.com/maps/search/?api=1&query=${position}`;
}
export function openStreetMapUrl(point: Coordinate): string | null {
  if (!validCoordinate(point)) return null;
  return `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=16/${point.latitude}/${point.longitude}`;
}
export function routeBounds(points: Coordinate[]) {
  const valid = points.filter(validCoordinate);
  if (!valid.length) return null;
  const latitudes = valid.map(point => point.latitude);
  const longitudes = valid.map(point => point.longitude).sort((a, b) => a - b);
  let gap = -1; let index = 0;
  longitudes.forEach((longitude, position) => {
    const next = position === longitudes.length - 1 ? longitudes[0]! + 360 : longitudes[position + 1]!;
    if (next - longitude > gap) { gap = next - longitude; index = position; }
  });
  return { north: Math.max(...latitudes), south: Math.min(...latitudes), west: longitudes[(index + 1) % longitudes.length]!, east: longitudes[index]! };
}

export const googleMapsWebKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY?.trim();
export const googleMapsWebMapId = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_MAP_ID?.trim() || 'DEMO_MAP_ID';
export const googleMapsAndroidKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY?.trim();
export const googleMapsIosKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY?.trim();

export const googleStreetStyle = [
  { elementType: 'geometry', stylers: [{ color: '#142435' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#142435' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9AB1CA' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#081523' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#314B65' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#476586' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#16362D' }] },
];
