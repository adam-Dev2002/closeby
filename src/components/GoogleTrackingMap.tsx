import { isRunningInExpoGo } from 'expo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, Text, UIManager, useWindowDimensions, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE, type MapMarker, type Region } from 'react-native-maps';
import { defaultMapType, googleMapsAndroidKey, googleMapsIosKey, googleStreetStyle, hasMeasuredLocation, locationIsFresh, validCoordinate, validZones, visibleDevices, type LiveMapProps } from '../lib/mapModel';
import { colors } from '../theme';
import type { DeviceProfile, LocationFix, SafeZone } from '../types';
import { MapUnavailable } from './MapUnavailable';
import { Avatar } from './Ui';
import { avatarImageSource, isAvatarId } from '../lib/avatars';
import { Icon } from './Icon';
import { BatteryBadge } from './BatteryBadge';
import { batteryPercent, presenceCaption, type PlacePresence } from '../lib/placePresence';

export type { LiveMapProps } from '../lib/mapModel';

const expoGo = isRunningInExpoGo();

export function LocationMarker({ device, selected, fresh, mapLoaded, onSelect, presence, now = Date.now(), compact = false }: {
  device: DeviceProfile & { location: LocationFix }; selected: boolean; fresh: boolean; mapLoaded: boolean; onSelect: (id: string) => void; presence?: PlacePresence; now?: number; compact?: boolean;
}) {
  const marker = useRef<MapMarker>(null);
  const photoURL = isAvatarId(device.avatarId) ? null : avatarImageSource(device);
  const [photoSettled, setPhotoSettled] = useState(!photoURL);
  const [trackingPortrait, setTrackingPortrait] = useState(true);
  const redrawTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identity = JSON.stringify([device.name, device.photoURL ?? null, device.avatarId ?? null]);
  const caption = presence ? presenceCaption(presence, now) : null;
  const pinTop = caption ? compact ? 88 : 52 : 0, pinWidth = caption ? compact ? 190 : 226 : 64, pinLeft = caption && compact ? 63 : 0;
  const percent = batteryPercent(device.batteryLevel);
  const redraw = useCallback(() => {
    setTrackingPortrait(true);
    if (redrawTimer.current) clearTimeout(redrawTimer.current);
    // Capture again after the decoded image has had time to paint. Pending
    // network photos keep tracking enabled until onLoad or onError fires.
    redrawTimer.current = setTimeout(() => {
      redrawTimer.current = null;
      marker.current?.redraw();
      setTrackingPortrait(false);
    }, 300);
  }, []);
  useEffect(() => {
    redraw();
    return () => { if (redrawTimer.current) clearTimeout(redrawTimer.current); };
  }, [identity, selected, fresh, mapLoaded, redraw, percent, caption?.title, caption?.detail, caption?.time]);
  const finishPhoto = useCallback(() => { setPhotoSettled(true); redraw(); }, [redraw]);
  const status = fresh ? 'Current GPS position' : 'Last known position';
  return <Marker ref={marker} identifier={device.id} coordinate={device.location} title={device.name} description={status}
    anchor={{ x: (pinLeft + 32) / pinWidth, y: 1 }} tracksViewChanges={!photoSettled || trackingPortrait} opacity={fresh ? 1 : .75} zIndex={selected ? 3 : 2} stopPropagation
    accessibilityRole="button" accessibilityLabel={`${device.name}. ${status}. Battery ${percent === null ? 'unavailable' : percent + '%'}${caption ? `. ${caption.title}. ${caption.detail}. ${caption.time}` : ''}${selected ? '. Selected' : ''}`} accessibilityState={{ selected }}
    onPress={() => onSelect(device.id)}>
    <View collapsable={false} onLayout={redraw} style={{ width: pinWidth, height: pinTop + 73 }}>
    <View collapsable={false} style={[styles.pin, { position: 'absolute', top: pinTop, left: pinLeft }]}>
      <View collapsable={false} style={[styles.portraitHalo, selected && styles.selectedHalo]}>
        <View collapsable={false} style={styles.portraitFrame}><Avatar key={identity} device={photoURL ? { ...device, photoURL: null } : device} size={46} onLoadEnd={redraw} /></View>
      </View>
      <View style={[styles.pinPointer, selected && { borderTopColor: colors.blueLight }]} />
    </View>
    </View>
    {/* Android's MapMarker attaches the image loader only to direct Image
        children. A nested network Image can stay detached and never load. */}
    {photoURL && <Image key={photoURL} source={{ uri: photoURL }} style={[styles.markerPhoto, { top: 10 + pinTop, left: 9 + pinLeft }]} resizeMode="cover" fadeDuration={0}
      accessible={false} onLoad={finishPhoto} onError={finishPhoto} />}
    <View pointerEvents="none" onLayout={redraw} style={[styles.pinBattery, { top: pinTop + 45, left: pinLeft }]}><BatteryBadge level={device.batteryLevel} fresh={fresh} /></View>
    <View pointerEvents="none" style={[styles.statusDot, { left: pinLeft + 47, backgroundColor: fresh ? colors.green : '#8596A8' }]} />
    {caption && <View pointerEvents="none" onLayout={redraw} style={[styles.arrivalBubble, compact && { left: 15 }]}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Icon name="home" size={14} color={colors.blueLight} /><Text style={styles.arrivalPlace} numberOfLines={1}>{caption.title}</Text></View><Text style={styles.arrivalDetail}>{caption.detail}</Text><Text style={styles.arrivalTime}>{caption.time}</Text></View>}
  </Marker>;
}

function unavailableReason(): string | null {
  if (Platform.OS === 'ios' && !UIManager.hasViewManagerConfig('AIRGoogleMap')) return 'Google Maps on iPhone needs a development build with the Google Maps SDK and iOS key. See docs/GOOGLE_MAPS_SETUP.md.';
  if (!expoGo && !(Platform.OS === 'android' ? googleMapsAndroidKey : googleMapsIosKey)) return 'Configure this platform’s Google Maps key and rebuild the app. You can test Google Maps in Android Expo Go first. See docs/GOOGLE_MAPS_SETUP.md.';
  return null;
}

function ZoneMarker({ zone, mapLoaded, onSelect }: { zone: SafeZone; mapLoaded: boolean; onSelect?: (id: string) => void }) {
  const marker = useRef<MapMarker>(null);
  const [tracking, setTracking] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redraw = useCallback(() => {
    setTracking(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { marker.current?.redraw(); setTracking(false); timer.current = null; }, 300);
  }, []);
  useEffect(() => { redraw(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [mapLoaded, redraw]);
  const color = /^#[0-9a-f]{6}$/i.test(zone.color) ? zone.color : colors.blue;
  // Portrait pins end at the coordinate from above; place labels start below
  // it so a person at Home cannot cover the saved place's name.
  return <Marker ref={marker} identifier={`zone-${zone.id}`} coordinate={zone.coordinate} anchor={{ x: .5, y: 0 }} tracksViewChanges={tracking}
    opacity={zone.enabled ? 1 : .65} zIndex={1} stopPropagation onPress={() => onSelect?.(zone.id)}
    accessibilityRole="button" accessibilityLabel={`Safe zone: ${zone.name}${zone.description ? '. ' + zone.description : ''}`}>
    <View collapsable={false} onLayout={redraw} style={styles.zonePin}>
      <View style={[styles.zonePointer, { borderBottomColor: color }]} />
      <View style={[styles.zoneLabel, { borderColor: color }]}><Icon name="pin" size={19} color={color} /><View style={{ maxWidth: 135, gap: 2 }}><Text style={styles.zoneName} numberOfLines={1}>{zone.name}</Text>{Boolean(zone.description) && <Text style={styles.zoneDescription} numberOfLines={1}>{zone.description}</Text>}</View></View>
    </View>
  </Marker>;
}

export function LiveMap({ devices, selectedId, onSelect, location, route, routeSegments, zones, presence, onMapPress, onPlacePress, focusCoordinate, showZoneBoundaries = false, onZoneSelect, recenterKey = 0, mapType = defaultMapType, bottomInset = 0, style }: LiveMapProps) {
  const map = useRef<MapView>(null);
  const { width: viewportWidth } = useWindowDimensions();
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(Date.now());
  const follow = useRef(true), centered = useRef(false);
  const previous = useRef({ selectedId, recenterKey });
  const reason = unavailableReason();
  const members = visibleDevices(devices);
  const measured = hasMeasuredLocation(location) ? location : null;
  const target = validCoordinate(focusCoordinate) ? focusCoordinate : members.find(device => device.id === selectedId)?.location ?? measured ?? members[0]?.location ?? null;
  const segments = useMemo(() => (routeSegments ?? [route]).map(segment => segment.filter(validCoordinate)), [route, routeSegments]);
  const points = useMemo(() => segments.flat(), [segments]);
  const safeZones = validZones(zones);
  const initialRegion = useRef<Region>(target
    ? { latitude: target.latitude, longitude: target.longitude, latitudeDelta: .015, longitudeDelta: .015 }
    : { latitude: 20, longitude: 0, latitudeDelta: 100, longitudeDelta: 300 });

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (reason || loaded || error) return;
    const timer = setTimeout(() => setError(expoGo
      ? 'Google Maps could not load in Expo Go. Expo Go uses its own Maps key. Open the Closeby development build to use your configured key, and check your internet connection.'
      : `Google Maps could not load. Check your internet connection. In Google Cloud, enable billing and Maps SDK for ${Platform.OS === 'android' ? 'Android' : 'iOS'}, and verify that the key's app restrictions match this build.`), 30000);
    return () => clearTimeout(timer);
  }, [reason, loaded, error, reloadKey]);
  useEffect(() => {
    if (!ready) return;
    const changed = previous.current.selectedId !== selectedId || previous.current.recenterKey !== recenterKey;
    if (changed) follow.current = true;
    if (target && (!centered.current || changed || follow.current)) {
      map.current?.animateCamera({ center: { latitude: target.latitude, longitude: target.longitude }, ...(centered.current ? {} : { zoom: 16 }) }, { duration: changed ? 300 : 0 });
      centered.current = true;
    } else if (!target && (!centered.current || changed || follow.current) && points.length) {
      map.current?.fitToCoordinates(points, { edgePadding: { top: 35, right: 35, bottom: 35, left: 35 }, animated: false });
      centered.current = true;
    }
    previous.current = { selectedId, recenterKey };
  }, [ready, selectedId, recenterKey, target?.latitude, target?.longitude, measured?.timestamp, points]);

  // Leave the SDK's attribution inside a visible map area above app sheets/cards.
  return <View style={[styles.container, style]}><View style={[styles.mapArea, { marginBottom: Math.max(0, bottomInset) }]}>
    {reason ? <MapUnavailable message={reason} location={measured} /> : <>
      <MapView key={reloadKey} ref={map} provider={PROVIDER_GOOGLE} style={StyleSheet.absoluteFill} initialRegion={initialRegion.current}
        mapType={mapType === 'dark' ? 'standard' : mapType} customMapStyle={mapType === 'dark' ? googleStreetStyle : []}
        userInterfaceStyle={mapType === 'dark' ? 'dark' : 'light'}
        showsUserLocation={false} showsMyLocationButton={false} toolbarEnabled={false} showsCompass showsScale
        zoomControlEnabled={false} moveOnMarkerPress={false} loadingEnabled={false}
        onMapReady={() => { setReady(true); setError(null); }} onMapLoaded={() => { setLoaded(true); setError(null); }}
        onPanDrag={() => { follow.current = false; }} onRegionChangeComplete={(_region, details) => { if (details?.isGesture) follow.current = false; }}
        onPress={event => { if (validCoordinate(event.nativeEvent.coordinate)) onMapPress?.(event.nativeEvent.coordinate); }}
        onPoiClick={event => { if (validCoordinate(event.nativeEvent.coordinate)) { if (onPlacePress) onPlacePress(event.nativeEvent.coordinate, event.nativeEvent.name); else onMapPress?.(event.nativeEvent.coordinate); } }}
        accessibilityLabel="Google Maps showing measured GPS locations">
        {members.map(device => {
          const selected = selectedId === device.id, fresh = locationIsFresh(device.location, now);
          return <LocationMarker key={JSON.stringify([device.id, device.photoURL, device.avatarId])} device={device} selected={selected} fresh={fresh} mapLoaded={loaded} onSelect={onSelect} presence={selected ? presence?.[device.id] : undefined} now={now} compact={viewportWidth < 360} />;
        })}
        {segments.map((segment, index) => segment.length > 1 && <Polyline key={index} coordinates={segment} strokeWidth={4} strokeColor="#EEF2FF" geodesic />)}
        {safeZones.map(zone => <ZoneMarker key={JSON.stringify([zone.id, zone.name, zone.description, zone.color])} zone={zone} mapLoaded={loaded} onSelect={onZoneSelect} />)}
        {showZoneBoundaries && safeZones.map(zone => {
          const color = /^#[0-9a-f]{6}$/i.test(zone.color) ? zone.color : colors.blue;
          return <Circle key={zone.id} center={zone.coordinate} radius={zone.radius} strokeColor={color} strokeWidth={1.5} fillColor={color + (zone.enabled ? '24' : '08')} />;
        })}
        {measured && typeof measured.accuracy === 'number' && Number.isFinite(measured.accuracy) && measured.accuracy > 0 && <Circle center={measured} radius={measured.accuracy} strokeColor="#4AB2FF66" fillColor="#1186FF18" strokeWidth={1} />}
      </MapView>
      {!loaded && !error && <View pointerEvents="none" style={styles.loading}><ActivityIndicator color={colors.blueLight} /><Text style={styles.caption}>Loading Google Maps…</Text></View>}
      {error && <MapUnavailable message={error} location={measured} onRetry={() => { centered.current = false; setReady(false); setLoaded(false); setError(null); setReloadKey(value => value + 1); }} />}
    </>}
  </View></View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 360, minHeight: 220, overflow: 'hidden', backgroundColor: '#080F17' },
  mapArea: { flex: 1, minHeight: 0 },
  loading: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#080F17' },
  caption: { color: colors.muted, fontSize: 12 },
  zonePin: { alignItems: 'center', padding: 3 },
  zonePointer: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginBottom: -1 },
  zoneLabel: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1.5, borderRadius: 13, backgroundColor: '#0B1521', paddingHorizontal: 10, paddingVertical: 8 },
  zoneName: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  zoneDescription: { color: colors.muted, fontSize: 10 },
  pin: { width: 64, height: 73, alignItems: 'center', paddingTop: 3 },
  portraitHalo: { width: 60, height: 60, borderRadius: 30, borderWidth: 3, borderColor: '#E9F1FC', backgroundColor: '#152B42', alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: .3, shadowRadius: 5 },
  selectedHalo: { borderColor: colors.blueLight, backgroundColor: colors.blue },
  portraitFrame: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  markerPhoto: { position: 'absolute', left: 9, top: 10, width: 46, height: 46, borderRadius: 23 },
  pinBattery: { position: 'absolute', left: 0 },
  arrivalBubble: { position: 'absolute', left: 62, top: 0, width: 160, padding: 9, gap: 3, borderRadius: 13, borderBottomLeftRadius: 3, backgroundColor: '#0B1521', borderColor: '#50779D', borderWidth: 1 },
  arrivalPlace: { color: colors.ink, fontSize: 11, fontWeight: '700', flexShrink: 1 },
  arrivalDetail: { color: colors.ink, fontSize: 10, fontWeight: '500' },
  arrivalTime: { color: colors.muted, fontSize: 9 },
  pinPointer: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#E9F1FC', marginTop: -1 },
  statusDot: { position: 'absolute', bottom: 14, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: '#FFFFFF' },
});
