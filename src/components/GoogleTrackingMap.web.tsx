import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { loadGoogleMaps, onGoogleMapsAuthFailure } from '../lib/googleMaps.web';
import { avatarImageSource, avatarPlaceholderSvg } from '../lib/avatars';
import { defaultMapType, googleMapsWebKey, googleMapsWebMapId, googleMapType, hasMeasuredLocation, locationIsFresh, routeBounds, validCoordinate, validZones, visibleDevices, type LiveMapProps } from '../lib/mapModel';
import { colors } from '../theme';
import { MapUnavailable } from './MapUnavailable';
import { batteryPercent, presenceCaption } from '../lib/placePresence';

export type { LiveMapProps } from '../lib/mapModel';

type Pin = { marker: google.maps.marker.AdvancedMarkerElement; node: HTMLDivElement; halo: HTMLDivElement; face: HTMLDivElement; pointer: HTMLDivElement; status: HTMLDivElement; battery: HTMLDivElement; arrival: HTMLDivElement; identity?: string };

function updatePortrait(face: HTMLDivElement, device: LiveMapProps['devices'][number]) {
  face.replaceChildren();
  face.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarPlaceholderSvg)}")`;
  face.style.backgroundSize = 'cover';
  const source = avatarImageSource(device);
  if (!source) return;
  const image = document.createElement('img');
  image.alt = '';
  image.referrerPolicy = 'no-referrer';
  image.draggable = false;
  Object.assign(image.style, { position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' });
  image.onerror = () => { image.remove(); };
  image.src = source;
  face.appendChild(image);
}

function createPinNode() {
  const node = document.createElement('div'), halo = document.createElement('div'), face = document.createElement('div');
  const pointer = document.createElement('div'), status = document.createElement('div');
  const battery = document.createElement('div'), arrival = document.createElement('div');
  Object.assign(node.style, { position: 'relative', width: '64px', height: '73px', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '3px', boxSizing: 'border-box', cursor: 'pointer' });
  Object.assign(halo.style, { width: '60px', height: '60px', borderRadius: '50%', border: '3px solid #E9F1FC', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#152B42', boxShadow: '0 3px 10px #0006' });
  Object.assign(face.style, { position: 'relative', width: '50px', height: '50px', borderRadius: '50%', border: '2px solid #FFFFFF', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#25394F' });
  Object.assign(pointer.style, { width: '0', height: '0', borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: '10px solid #E9F1FC', marginTop: '-1px' });
  Object.assign(status.style, { position: 'absolute', bottom: '14px', right: '4px', width: '13px', height: '13px', borderRadius: '50%', border: '2px solid #FFFFFF', boxSizing: 'border-box' });
  Object.assign(node.style, { alignItems: 'flex-start' }); halo.style.marginLeft = '2px'; pointer.style.marginLeft = '25px';
  Object.assign(status.style, { left: '47px', right: 'auto' });
  Object.assign(battery.style, { position: 'absolute', left: '0', bottom: '12px', minWidth: '40px', height: '18px', boxSizing: 'border-box', padding: '2px 4px', borderRadius: '7px', border: '1px solid #DDE9F8', background: '#0B1521', font: '700 9px system-ui', textAlign: 'center' });
  Object.assign(arrival.style, { position: 'absolute', top: '0', left: '62px', width: '160px', boxSizing: 'border-box', padding: '8px 9px', borderRadius: '13px 13px 13px 3px', background: '#0B1521', color: '#F2F6FE', border: '1px solid #50779D', font: '500 10px/15px system-ui', whiteSpace: 'pre-line', display: 'none' });
  halo.appendChild(face); node.appendChild(halo); node.appendChild(pointer); node.appendChild(status); node.appendChild(battery); node.appendChild(arrival);
  return { node, halo, face, pointer, status, battery, arrival };
}

export function LiveMap({ devices, selectedId, onSelect, location, route, routeSegments, zones, presence, onMapPress, focusCoordinate, showZoneBoundaries = false, onZoneSelect, recenterKey = 0, mapType = defaultMapType, bottomInset = 0, style }: LiveMapProps) {
  const { width: viewportWidth } = useWindowDimensions();
  const element = useRef<HTMLDivElement>(null), map = useRef<google.maps.Map | null>(null);
  const sdk = useRef<{ maps: typeof google.maps; markers: google.maps.MarkerLibrary } | null>(null);
  const pins = useRef(new Map<string, Pin>()), zoneCircles = useRef(new Map<string, google.maps.Circle>());
  const zonePins = useRef(new Map<string, { marker: google.maps.marker.AdvancedMarkerElement; node: HTMLDivElement }>());
  const accuracy = useRef<google.maps.Circle | null>(null), routeLines = useRef<google.maps.Polyline[]>([]);
  const follow = useRef(true), centered = useRef(false), previous = useRef({ selectedId, recenterKey });
  const latest = useRef({ onSelect, onMapPress, onZoneSelect }); latest.current = { onSelect, onMapPress, onZoneSelect };
  const [ready, setReady] = useState(false), [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0), [now, setNow] = useState(Date.now());
  const members = useMemo(() => visibleDevices(devices), [devices]);
  const segments = useMemo(() => (routeSegments ?? [route]).map(segment => segment.filter(validCoordinate)), [route, routeSegments]);
  const points = useMemo(() => segments.flat(), [segments]), safeZones = useMemo(() => validZones(zones), [zones]);
  const measured = hasMeasuredLocation(location) ? location : null;
  const target = validCoordinate(focusCoordinate) ? focusCoordinate : members.find(device => device.id === selectedId)?.location ?? measured ?? members[0]?.location ?? null;

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!googleMapsWebKey) return;
    let active = true;
    let listeners: google.maps.MapsEventListener[] = [];
    const stopAuthentication = onGoogleMapsAuthFailure(() => { if (active) setError('Google Maps rejected the key. Check API access, billing, and website restrictions, then refresh.'); });
    setReady(false); setError(null); centered.current = false; follow.current = true;
    void loadGoogleMaps().then(libraries => {
      if (!active || !element.current) return;
      sdk.current = libraries;
      const googleMap = new libraries.maps.Map(element.current, {
        center: { lat: 20, lng: 0 }, zoom: 2, mapId: googleMapsWebMapId,
        colorScheme: mapType === 'dark' ? 'DARK' : 'LIGHT', mapTypeId: googleMapType(mapType),
        disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false, keyboardShortcuts: true,
      });
      map.current = googleMap;
      listeners = [
        googleMap.addListener('dragstart', () => { follow.current = false; }),
        googleMap.addListener('click', (event: google.maps.MapMouseEvent) => {
          const coordinate = event.latLng ? { latitude: event.latLng.lat(), longitude: event.latLng.lng() } : null;
          if (validCoordinate(coordinate)) latest.current.onMapPress?.(coordinate);
        }),
      ];
      setReady(true);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Google Maps could not initialize.'); });
    return () => {
      active = false; stopAuthentication(); listeners.forEach(listener => listener.remove());
      pins.current.forEach(pin => pin.marker.map = null); pins.current.clear();
      zoneCircles.current.forEach(circle => circle.setMap(null)); zoneCircles.current.clear();
      zonePins.current.forEach(pin => { pin.marker.map = null; if (sdk.current) sdk.current.maps.event.clearInstanceListeners(pin.marker); }); zonePins.current.clear();
      accuracy.current?.setMap(null); accuracy.current = null;
      routeLines.current.forEach(line => line.setMap(null)); routeLines.current = [];
      if (map.current && sdk.current) sdk.current.maps.event.clearInstanceListeners(map.current);
      map.current = null; sdk.current = null;
      element.current?.replaceChildren();
    };
    // Google's colorScheme is fixed when a map is constructed.
  }, [reloadKey, mapType]);

  useEffect(() => {
    const googleMap = map.current, libraries = sdk.current;
    if (!ready || !googleMap || !libraries) return;
    const visible = new Set(members.map(device => device.id));
    pins.current.forEach((pin, id) => { if (!visible.has(id)) { pin.marker.map = null; libraries.maps.event.clearInstanceListeners(pin.marker); pins.current.delete(id); } });
    members.forEach(device => {
      let pin = pins.current.get(device.id);
      if (!pin) {
        const content = createPinNode();
        const marker = new libraries.markers.AdvancedMarkerElement({ map: googleMap, position: { lat: device.location.latitude, lng: device.location.longitude }, title: device.name, gmpClickable: true });
        marker.appendChild(content.node); marker.addListener('click', () => latest.current.onSelect(device.id));
        pin = { marker, ...content }; pins.current.set(device.id, pin);
      }
      const selected = device.id === selectedId, fresh = locationIsFresh(device.location, now);
      pin.marker.position = { lat: device.location.latitude, lng: device.location.longitude };
      pin.marker.zIndex = selected ? 2 : 1;
      pin.marker.title = device.name + (fresh ? ' - current GPS position' : ' - last known position');
      pin.node.setAttribute('aria-label', pin.marker.title);
      pin.node.setAttribute('aria-hidden', 'true'); // AdvancedMarker provides the accessible title and click action.
      pin.node.style.opacity = fresh ? '1' : '.75';
      pin.halo.style.borderColor = selected ? colors.blueLight : '#E9F1FC';
      pin.halo.style.background = selected ? colors.blue : '#152B42';
      pin.pointer.style.borderTopColor = selected ? colors.blueLight : '#E9F1FC';
      pin.status.style.background = fresh ? colors.green : '#8596A8';
      const percent = batteryPercent(device.batteryLevel), place = selected ? presence?.[device.id] : undefined;
      const caption = place ? presenceCaption(place, now) : null;
      const compact = Boolean(caption && viewportWidth < 360), pinLeft = compact ? 63 : 0;
      pin.marker.anchorLeft = `-${pinLeft + 32}px`;
      pin.node.style.width = caption ? compact ? '190px' : '226px' : '64px';
      pin.node.style.height = caption ? compact ? '161px' : '125px' : '73px';
      pin.node.style.paddingTop = caption ? compact ? '91px' : '55px' : '3px';
      pin.halo.style.marginLeft = `${pinLeft + 2}px`; pin.pointer.style.marginLeft = `${pinLeft + 25}px`;
      pin.status.style.left = `${pinLeft + 47}px`; pin.battery.style.left = `${pinLeft}px`;
      pin.arrival.style.left = compact ? '15px' : '62px';
      pin.battery.textContent = `▰ ${percent === null ? '—' : percent + '%'}`;
      pin.battery.style.color = percent === null ? colors.muted : percent <= 20 ? '#E7434F' : colors.green;
      pin.battery.setAttribute('aria-label', `${fresh ? '' : 'Last reported '}battery ${percent === null ? 'unavailable' : percent + '%'}`);
      pin.arrival.style.display = caption ? 'block' : 'none';
      pin.arrival.textContent = caption ? `${caption.title}\n${caption.detail}\n${caption.time}` : '';
      pin.marker.title += `. Battery ${percent === null ? 'unavailable' : percent + '%'}${caption ? `. ${caption.title}. ${caption.detail}. ${caption.time}` : ''}`;
      const identity = JSON.stringify([device.name, device.photoURL ?? null, device.avatarId ?? null]);
      if (pin.identity !== identity) { updatePortrait(pin.face, device); pin.identity = identity; }
    });
    while (routeLines.current.length > segments.length) routeLines.current.pop()?.setMap(null);
    segments.forEach((segment, index) => {
      if (!routeLines.current[index]) routeLines.current[index] = new libraries.maps.Polyline({ map: googleMap, strokeColor: '#EEF2FF', strokeWeight: 4, geodesic: true, clickable: false });
      routeLines.current[index]!.setPath(segment.map(point => ({ lat: point.latitude, lng: point.longitude })));
    });
    const zoneIds = new Set(safeZones.map(zone => zone.id));
    zonePins.current.forEach((pin, id) => { if (!zoneIds.has(id)) { pin.marker.map = null; libraries.maps.event.clearInstanceListeners(pin.marker); zonePins.current.delete(id); } });
    zoneCircles.current.forEach((circle, id) => { if (!zoneIds.has(id)) { circle.setMap(null); zoneCircles.current.delete(id); } });
    safeZones.forEach(zone => {
      let circle = zoneCircles.current.get(zone.id);
      if (!circle) { circle = new libraries.maps.Circle({ map: googleMap, clickable: false }); zoneCircles.current.set(zone.id, circle); }
      const color = /^#[0-9a-f]{6}$/i.test(zone.color) ? zone.color : colors.blue;
      circle.setOptions({ center: { lat: zone.coordinate.latitude, lng: zone.coordinate.longitude }, radius: zone.radius, visible: showZoneBoundaries, strokeColor: color, strokeWeight: 1.5, fillColor: color, fillOpacity: zone.enabled ? .14 : .035 });
      let pin = zonePins.current.get(zone.id);
      if (!pin) {
        const node = document.createElement('div');
        Object.assign(node.style, { position: 'relative', maxWidth: '180px', border: '2px solid', borderRadius: '13px', padding: '8px 11px', background: '#0B1521', color: '#F2F6FE', font: '600 12px system-ui', whiteSpace: 'pre-line', boxShadow: '0 3px 8px #0006', textAlign: 'center', cursor: 'pointer' });
        // Keep saved names below the coordinate, clear of portrait pins above it.
        const marker = new libraries.markers.AdvancedMarkerElement({ map: googleMap, gmpClickable: true, zIndex: 0, anchorTop: '12px' });
        marker.appendChild(node); marker.addListener('click', () => latest.current.onZoneSelect?.(zone.id));
        pin = { marker, node }; zonePins.current.set(zone.id, pin);
      }
      pin.marker.position = { lat: zone.coordinate.latitude, lng: zone.coordinate.longitude };
      pin.marker.title = `Safe zone: ${zone.name}${zone.description ? '. ' + zone.description : ''}`;
      const pointer = document.createElement('div');
      Object.assign(pointer.style, { position: 'absolute', top: '-10px', left: 'calc(50% - 7px)', width: '0', height: '0', borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderBottom: `10px solid ${color}` });
      pin.node.textContent = zone.name + (zone.description ? '\n' + zone.description : '');
      pin.node.appendChild(pointer);
      pin.node.style.borderColor = color; pin.node.style.opacity = zone.enabled ? '1' : '.65';
    });
    if (measured && typeof measured.accuracy === 'number' && Number.isFinite(measured.accuracy) && measured.accuracy > 0) {
      if (!accuracy.current) accuracy.current = new libraries.maps.Circle({ map: googleMap, clickable: false, strokeColor: colors.blueLight, strokeWeight: 1, strokeOpacity: .4, fillColor: colors.blue, fillOpacity: .08 });
      accuracy.current.setCenter({ lat: measured.latitude, lng: measured.longitude }); accuracy.current.setRadius(measured.accuracy);
    } else { accuracy.current?.setMap(null); accuracy.current = null; }
    const changed = previous.current.selectedId !== selectedId || previous.current.recenterKey !== recenterKey;
    if (changed) follow.current = true;
    if (target && (!centered.current || changed || follow.current)) {
      googleMap.setCenter({ lat: target.latitude, lng: target.longitude });
      if (!centered.current) googleMap.setZoom(16);
      centered.current = true;
    } else if (!target && (!centered.current || changed || follow.current) && points.length) {
      const bounds = routeBounds(points);
      if (bounds) googleMap.fitBounds(bounds, 35);
      centered.current = true;
    }
    previous.current = { selectedId, recenterKey };
  }, [ready, members, points, safeZones, location, selectedId, recenterKey, mapType, now, focusCoordinate?.latitude, focusCoordinate?.longitude, showZoneBoundaries, presence, viewportWidth]);

  const message = !googleMapsWebKey ? 'Browser maps need EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY. Android Expo Go can use Google Maps now. See docs/GOOGLE_MAPS_SETUP.md.' : error;
  return <View style={[styles.container, style]}><View style={[styles.mapArea, { marginBottom: Math.max(0, bottomInset) }]}>
    {createElement('div', { ref: element, 'aria-label': 'Google Maps showing measured GPS locations', style: { position: 'absolute', inset: 0, background: '#080F17' } })}
    {message ? <MapUnavailable message={message} location={measured} onRetry={googleMapsWebKey ? () => setReloadKey(value => value + 1) : undefined} />
      : !ready && <View pointerEvents="none" style={styles.loading}><ActivityIndicator color={colors.blueLight} /><Text style={styles.caption}>Loading Google Maps…</Text></View>}
  </View></View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 360, minHeight: 220, overflow: 'hidden', backgroundColor: '#080F17' },
  mapArea: { flex: 1, minHeight: 0 },
  loading: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#080F17' },
  caption: { color: colors.muted, fontSize: 12 },
});
