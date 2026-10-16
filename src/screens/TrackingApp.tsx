import { useAppDialog } from '../components/AppDialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocationPreferences } from '../hooks/useLocationPreferences';
import type { PendingInvitation } from '../hooks/useInvitationLink';
import { formatInvitationCode, invitationLink } from '../lib/invitations';
import { AppState, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, useWindowDimensions, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../auth/AuthProvider';
import { Icon, type IconName } from '../components/Icon';
import { BrandLogo } from '../components/BrandLogo';
import { usePhoneNotifications } from '../hooks/usePhoneNotifications';
import { phoneNotificationTarget } from '../lib/phoneNotifications';
import { watchPhoneNotificationTaps } from '../services/phoneNotifications';
import { LiveMap } from '../components/LiveMap';
import { ActivitySettings } from '../components/ActivitySettings';
import { AvatarEditor } from '../components/AvatarEditor';
import { CallPanel } from '../components/CallPanel';
import { DeviceAccessSettings } from '../components/DeviceAccessSettings';
import { Avatar, Button, Field, RoundButton, SettingRow, ui } from '../components/Ui';
import { EmergencyComposer } from '../components/EmergencyComposer';
import { SpeedSettings } from '../components/SpeedSettings';
import { useCircle } from '../hooks/useCircle';
import { useAvatarProfile } from '../hooks/useAvatarProfile';
import { useCall } from '../hooks/useCall';
import { useTracking } from '../hooks/useTracking';
import { useActivityHistory } from '../hooks/useActivityHistory';
import { dateKey } from '../lib/activity';
import { useEmergencyAlerts } from '../hooks/useEmergencyAlerts';
import { useEmergencyInbox } from '../hooks/useEmergencyInbox';
import { useEmergencyRing } from '../hooks/useEmergencyRing';
import { useSpeedAlerts } from '../hooks/useSpeedAlerts';
import { useSpeedPreferences } from '../hooks/useSpeedPreferences';
import { usePlacePresence } from '../hooks/usePlacePresence';
import { useArrivalMonitoring } from '../hooks/useArrivalMonitoring';
import { arrivalClock, shortStay } from '../lib/placePresence';
import { watchArrivalNotificationTaps } from '../services/arrivalMonitoring';
import { age, battery, coordinates, deviceStatus, speed } from '../lib/format';
import { backendError } from '../lib/firebase';
import { speedKmh } from '../lib/speedAlerts';
import { defaultMapType, googleMapsUrl, hasMeasuredLocation, mapModes, type MapType } from '../lib/mapModel';
import { stopSharing } from '../services/circles';
import { createEmergencyAlertId, sendEmergencyAlert, type EmergencyAlertInput } from '../services/emergencies';
import { colors } from '../theme';
import type { DeviceProfile, RecordedTrip } from '../types';
import { DeviceProfileScreen } from './DeviceProfileScreen';
import { GeofenceScreen } from './GeofenceScreen';
import { HistoryScreen } from './HistoryScreen';
import { SpaceScreen } from './SpaceScreen';
import { SafetyScreen } from './SafetyScreen';

type Tab = 'map' | 'spaces' | 'safety' | 'history' | 'settings';
const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'map', label: 'Map', icon: 'pin' }, { id: 'spaces', label: 'Spaces', icon: 'people' },
  { id: 'safety', label: 'Safety', icon: 'shield' },
  { id: 'history', label: 'History', icon: 'history' }, { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function TrackingApp({ onAccount, pendingInvitation, invitationError, onDismissInvitation }: {
  onAccount: () => void; pendingInvitation?: PendingInvitation | null; invitationError?: string | null;
  onDismissInvitation?: (key: string) => void;
}) {
  const auth = useAuth();
  const latestInvitation = useRef(pendingInvitation);
  latestInvitation.current = pendingInvitation;
  const dialog = useAppDialog();
  const avatarProfile = useAvatarProfile(auth.user?.uid);
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('map');
  const [page, setPage] = useState<'profile' | 'geofence' | null>(null);
  const scope = auth.user?.uid ?? 'local-device';
  const locationPreferences = useLocationPreferences(scope);
  const { sharing, setSharing } = locationPreferences;
  const [zoneAlerts, setZoneAlerts] = useState(true);
  const [backgroundActive, setBackgroundActive] = useState(false);
  const [arrivalBackgroundActive, setArrivalBackgroundActive] = useState(false);
  const [historyDay, setHistoryDay] = useState(() => dateKey());
  const tracking = useTracking({ scope, background: backgroundActive || arrivalBackgroundActive,
    autoStart: locationPreferences.loaded && locationPreferences.gps, onEnabledChange: locationPreferences.setGps });
  const [now, setNow] = useState(Date.now());
  const [selectedId, setSelectedId] = useState(auth.user?.uid ?? 'this-device');
  const [notificationTarget, setNotificationTarget] = useState<string | null>(null);
  const [phoneNotification, setPhoneNotification] = useState<unknown>(null);
  const [incomingCallId, setIncomingCallId] = useState<string>();
  const [notificationChatKey, setNotificationChatKey] = useState<string>();
  const [recenterKey, setRecenterKey] = useState(0);
  const [mapType, setMapType] = useState<MapType>(defaultMapType);
  const [mapBottomHeight, setMapBottomHeight] = useState(220);
  const [mapPreferencesLoaded, setMapPreferencesLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<'circle' | 'trip' | 'emergency' | 'map' | 'avatar' | 'people' | 'access' | null>(null);
  const [viewingTrip, setViewingTrip] = useState<RecordedTrip | null>(null);
  const [circleName, setCircleName] = useState('My family');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [emergencySending, setEmergencySending] = useState(false);
  const [emergencyError, setEmergencyError] = useState<string | null>(null);
  const emergencyAttempt = useRef<{ key: string; id: string; payload: EmergencyAlertInput } | null>(null);
  const emergencyLock = useRef(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const speedPreferences = useSpeedPreferences(scope);
  const phoneAlerts = usePhoneNotifications({ uid: auth.user?.uid, zones: tracking.zones, arrivals: zoneAlerts,
    speed: speedPreferences.enabled, speedLimitKmh: speedPreferences.limitKmh, preferencesLoaded: speedPreferences.loaded });
  const ownDevice = useMemo<DeviceProfile>(() => ({
    id: auth.user?.uid ?? 'this-device', ownerId: auth.user?.uid ?? '',
    name: auth.user?.displayName ? `${auth.user.displayName.split(' ')[0]}’s Phone` : 'My Phone',
    photoURL: auth.user?.photoURL ?? null, platform: Platform.OS,
    avatarId: avatarProfile.avatarId,
    batteryLevel: tracking.batteryLevel, location: tracking.location,
    sharing, lastSeen: tracking.location?.timestamp ?? 0,
  }), [auth.user?.uid, auth.user?.displayName, auth.user?.photoURL, avatarProfile.avatarId, tracking.batteryLevel, tracking.location, sharing]);
  const circle = useCircle(auth.user, ownDevice, sharing && tracking.tracking && Boolean(tracking.location), avatarProfile.loaded && locationPreferences.loaded);
  const call = useCall({ uid: auth.user?.uid, spaceId: circle.circle?.id, name: auth.user?.displayName || 'Closeby member',
    incomingId: incomingCallId, memberIds: circle.roster.map(member => member.uid), requesterIds: circle.roster.filter(member => member.uid === circle.circle?.ownerId || member.canRequestMedia).map(member => member.uid) });
  const callVisible = Boolean(call.active || call.incoming || call.loading || call.error || call.incomingError);
  const devices = useMemo<DeviceProfile[]>(() => [ownDevice, ...circle.roster.filter(member => member.uid !== ownDevice.id).map(member => {
    const device = circle.members.find(device => device.id === member.uid);
    return device ? { ...device, photoURL: member.photoURL, avatarId: member.avatarId }
      : { id: member.uid, ownerId: member.uid, name: member.name, photoURL: member.photoURL, avatarId: member.avatarId, platform: '', batteryLevel: null, location: null, sharing: false, lastSeen: 0 };
  })], [ownDevice, circle.members, circle.roster]);
  const selected = devices.find(device => device.id === selectedId) ?? ownDevice;
  const arrivals = usePlacePresence({ devices, zones: tracking.zones, ownId: ownDevice.id, ownTracking: tracking.tracking, enabled: zoneAlerts, scope, spaceId: circle.circle?.id });
  const phoneArrivals = useArrivalMonitoring({ scope, ownDevice, zones: tracking.zones, spaceId: circle.circle?.id ?? null, sharing: sharing && tracking.tracking,
    alerts: zoneAlerts, startGPS: tracking.startTracking, onEnabledChange: setArrivalBackgroundActive });
  const selectedIsOwn = selected.id === ownDevice.id;
  const currentRoute = selectedIsOwn ? tracking.route : [];
  const activity = useActivityHistory({ scope, uid: auth.user?.uid, spaceId: circle.circle?.id, selectedId: selected.id,
    day: historyDay, ownDevice, tracking: tracking.tracking, location: tracking.location, zones: tracking.zones,
    onBackgroundChange: setBackgroundActive, startGPS: tracking.startTracking });
  const routeDistance = tracking.tripDistanceMeters;
  const speedAlerts = useSpeedAlerts({ devices, enabled: speedPreferences.loaded && speedPreferences.enabled, limitKmh: speedPreferences.limitKmh, scope, ownDeviceId: ownDevice.id, ownTracking: tracking.tracking });
  const emergencies = useEmergencyAlerts(circle.circle?.id, auth.user?.uid);
  const inbox = useEmergencyInbox(emergencies.alerts, auth.user?.uid, circle.circle?.id);
  const incoming = inbox.incoming;
  const emergencyRing = useEmergencyRing(incoming ? `${scope}/${circle.circle?.id}/${incoming.id}` : undefined, appActive);
  const speedWarning = speedAlerts.latestAlert;
  const arrivalNotice = arrivals.incoming;
  const compactMap = height < 700 || Boolean(incoming || speedWarning || arrivalNotice);
  const ownerName = circle.roster.find(member => member.uid === circle.circle?.ownerId)?.name ?? 'Space owner';
  useEffect(() => {
    if (!pendingInvitation || !auth.user) return;
    setJoinCode(formatInvitationCode(pendingInvitation.code));
    setTab('spaces'); setPage(null); setSheet('circle');
  }, [pendingInvitation?.key, auth.user?.uid]);
  useEffect(() => {
    let live = true, remove = () => {};
    void watchPhoneNotificationTaps(value => { if (live) setPhoneNotification(value); }).then(stop => { if (live) remove = stop; else stop(); }).catch(() => undefined);
    return () => { live = false; remove(); };
  }, [scope]);
  useEffect(() => {
    const target = phoneNotificationTarget(phoneNotification, auth.user?.uid, circle.circle?.id);
    if (!target) return;
    setPhoneNotification(null); setPage(null); setSheet(null);
    if (target.kind === 'call') { setIncomingCallId(target.resourceId); call.retryIncoming(); }
    else if (target.kind === 'emergency') setTab('safety');
    else if (target.kind === 'message') { setNotificationChatKey(target.eventId); setTab('spaces'); }
    else if (target.deviceId) { setNotificationTarget(target.deviceId); setTab('map'); }
  }, [phoneNotification, auth.user?.uid, circle.circle?.id]);
  useEffect(() => {
    let cancelled = false, remove = () => {};
    void watchArrivalNotificationTaps(id => {
      if (!cancelled) setNotificationTarget(id);
    }).then(cleanup => { if (cancelled) cleanup(); else remove = cleanup; }).catch(() => undefined);
    return () => { cancelled = true; remove(); };
  }, [scope]);
  useEffect(() => {
    if (notificationTarget && devices.some(device => device.id === notificationTarget)) {
      setSelectedId(notificationTarget); setPage(null); setTab('map'); setRecenterKey(value => value + 1); setNotificationTarget(null);
    }
  }, [notificationTarget, devices]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (appActive && Platform.OS !== 'web' && incoming) Vibration.vibrate([0, 300, 150, 300]);
  }, [appActive, incoming?.id]);
  useEffect(() => {
    if (appActive && Platform.OS !== 'web' && speedWarning) Vibration.vibrate(150);
  }, [appActive, speedWarning?.deviceId, speedWarning?.timestamp]);

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    void AsyncStorage.getItem('@closeby/preferences/zone-alerts').then(value => { if (value !== null) setZoneAlerts(value === 'true'); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    // Adopt the chosen satellite default once; later style changes stay saved.
    void AsyncStorage.getItem('@closeby/preferences/map-v5').then(value => {
      if (value) {
        const stored = JSON.parse(value) as { mapType?: MapType };
        if (mapModes.some(mode => mode.id === stored.mapType)) setMapType(stored.mapType!);
      }
    }).catch(() => undefined).finally(() => setMapPreferencesLoaded(true));
  }, []);
  useEffect(() => {
    if (mapPreferencesLoaded) void AsyncStorage.setItem('@closeby/preferences/map-v5', JSON.stringify({ mapType })).catch(() => undefined);
  }, [mapType, mapPreferencesLoaded]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); }
    catch (error) { dialog.alert('Could not complete that', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  function navigate(next: Tab) { setPage(null); setTab(next); setQuery(''); }
  function privacy() {
    dialog.alert('Your location, your choice', 'GPS starts after you enable it. Current locations and activity history have separate sharing controls. History sharing starts with new samples and is visible only to current space members. Background recording runs only after you enable it and grant background access. Pause GPS to stop recording. Manual trips and safe zones stay on this phone.');
  }
  function openProfile(device: DeviceProfile) { setSelectedId(device.id); setPage('profile'); }
  function openCircle() {
    if (!auth.user) { dialog.alert('Sign in to share', 'Use Google or a free email account to create a private space for your family and friends.', [{ text: 'Later', style: 'cancel' }, { text: 'Log in / Sign up', onPress: onAccount }]); return; }
    navigate('spaces'); setSheet('circle');
  }
  async function shareInvitation() {
    if (!circle.circle) return;
    try {
      const link = invitationLink(circle.circle.inviteCode);
      await Share.share({ title: 'Join my Closeby space', message: `Join my Closeby space “${circle.circle.name}”.\n${link}\n\nOr open Closeby → Spaces and enter ${formatInvitationCode(circle.circle.inviteCode)}.` });
    } catch (cause) { dialog.alert('Could not share invitation', cause instanceof Error ? cause.message : 'Please try again.'); }
  }
  async function acceptInvitation() {
    const key = pendingInvitation?.key;
    await circle.joinCircle(joinCode.trim());
    if (key) onDismissInvitation?.(key);
    if (!latestInvitation.current || latestInvitation.current.key === key) setJoinCode('');
  }
  async function toggleSharing(value: boolean) {
    if (!value) {
      setSharing(false);
      if (auth.user) await perform(async () => { await stopSharing(auth.user!.uid); });
      return;
    }
    if (!auth.user || !circle.circle) { openCircle(); return; }
    if (!tracking.tracking && !(await tracking.startTracking())) return;
    setSharing(true);
  }
  function togglePhoneAlerts(value: boolean) {
    if (!value) { void perform(() => phoneAlerts.setEnabled(false)); return; }
    if (!auth.user) { onAccount(); return; }
    dialog.alert('Phone notifications', 'Receive emergency alerts, calls, device requests, messages, arrivals and enabled speed alerts while Closeby is closed. For arrival and speed alerts, your saved places and alert settings are saved privately to your account. Receiving notifications does not start GPS, camera or microphone sharing.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Enable notifications', onPress: () => void perform(() => phoneAlerts.setEnabled(true)) },
    ]);
  }
  async function record() {
    if (tracking.activeTrip) { await tracking.endTrip(); return; }
    if (!tracking.tracking && !(await tracking.startTracking())) return;
    tracking.startTrip();
    navigate('map');
  }
  function openEmergency() {
    if (emergencyLock.current) return;
    emergencyAttempt.current = null; setEmergencyError(null); setSheet('emergency');
  }
  async function sendEmergency(audience: 'owner' | 'everyone', note: string, includeLocation: boolean) {
    if (!auth.user || !circle.circle || emergencyLock.current) return;
    emergencyLock.current = true;
    setEmergencySending(true); setEmergencyError(null);
    try {
      const key = JSON.stringify([circle.circle.id, audience, note, includeLocation]);
      if (!emergencyAttempt.current || emergencyAttempt.current.key !== key) {
        emergencyAttempt.current = { key, id: createEmergencyAlertId(circle.circle.id), payload: {
          audience, ownerId: circle.circle.ownerId, text: note.trim() || 'I need help. Please check on me.',
          location: includeLocation ? tracking.location : null,
        } };
      }
      const attempt = emergencyAttempt.current;
      await sendEmergencyAlert(circle.circle.id, attempt.id, attempt.payload);
      emergencyAttempt.current = null;
      setSheet(current => current === 'emergency' ? null : current);
      navigate('safety');
    } catch (cause) { setEmergencyError(backendError(cause)); }
    finally { emergencyLock.current = false; setEmergencySending(false); }
  }
  function dismissSheet() { if (!emergencySending && !avatarProfile.saving) setSheet(null); }
  function shareLocation() {
    const fix = selected.location;
    if (!fix) return;
    dialog.alert('Share emergency location?', 'Choose a trusted contact in your phone’s share sheet. This does not call or notify emergency services.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Share location', onPress: () => { void Share.share({ message: `I need help. ${selected.name}: https://www.google.com/maps?q=${fix.latitude},${fix.longitude}\nLocation recorded ${new Date(fix.timestamp).toLocaleString()}.` }).catch(error => dialog.alert('Could not share', String(error))); } },
    ]);
  }
  function clearHistory() { dialog.alert('Delete location history?', 'Recorded trips on this device will be permanently deleted.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void perform(tracking.clearHistory) }]); }
  function openExternalMap() {
    if (!hasMeasuredLocation(selected.location)) return;
    const url = googleMapsUrl(selected.location);
    if (url) void Linking.openURL(url).catch(() => dialog.alert('Could not open map', 'Please try again.'));
  }
  function endSession() {
    dialog.alert('Sign out?', 'Location tracking and sharing will stop for this account.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', onPress: () => void perform(async () => { await pauseGps(); await auth.signOut(); onAccount(); }) }]);
  }
  async function pauseGps() { setSharing(false); tracking.stopTracking(); await phoneArrivals.setEnabled(false); await activity.pause(); }
  function togglePhoneArrivals(value: boolean) {
    if (!value) { void perform(() => phoneArrivals.setEnabled(false)); return; }
    if (!tracking.zones.some(zone => zone.enabled)) {
      dialog.alert('Add a safe place first', 'Pin a place such as Home or School and enable its arrival alerts. Closeby can then notify when you or a sharing family member arrives there.', [
        { text: 'Later', style: 'cancel' }, { text: 'Choose a place', onPress: () => setPage('geofence') },
      ]); return;
    }
    dialog.alert('Arrival alerts while Closeby is closed', 'Closeby will use background location and check your family’s shared locations about once a minute. You can receive arrival and departure notifications at your saved places while the phone is locked or the app is in the background. Android keeps a monitoring notification visible. Pause GPS or turn this setting off to stop. Force-stopping Closeby stops alerts.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Enable arrival notifications', onPress: () => void perform(() => phoneArrivals.setEnabled(true)) },
    ]);
  }
  const status = selectedIsOwn && !sharing
    ? tracking.tracking ? 'GPS active · Sharing paused' : 'GPS paused'
    : deviceStatus(selected, now);

  return <View style={ui.screen}>
    {arrivalNotice && !incoming && !speedWarning && <View accessibilityLiveRegion="polite" style={styles.arrivalBanner}>
      <Icon name={arrivalNotice.kind === 'arrival' ? 'home' : 'navigate'} size={22} color={colors.green} />
      <Pressable accessibilityRole="button" accessibilityLabel="View arrival on map" style={{ flex: 1, gap: 4 }} onPress={() => { setSelectedId(arrivalNotice.deviceId); setRecenterKey(value => value + 1); arrivals.dismiss(arrivalNotice.id); navigate('map'); }}>
        <Text style={styles.safetyBannerTitle}>{arrivalNotice.deviceId === ownDevice.id ? 'You' : arrivalNotice.deviceName} {arrivalNotice.kind === 'arrival' ? 'arrived at' : 'left'} {arrivalNotice.placeName}</Text>
        <Text style={styles.safetyBannerDetail}>{arrivalClock(arrivalNotice.timestamp)}{arrivalNotice.kind === 'departure' ? ` · Observed stay: ${shortStay(arrivalNotice.timestamp - arrivalNotice.since)}` : ' · Arrival observed from GPS'}</Text>
      </Pressable><RoundButton small icon="close" label="Dismiss arrival notification" onPress={() => arrivals.dismiss(arrivalNotice.id)} />
    </View>}
    {(incoming || speedWarning) && <View accessibilityLiveRegion="assertive" style={[styles.safetyBanner, incoming && styles.emergencyBanner]}>
      <Icon name={incoming ? 'alert' : 'speed'} size={21} color={incoming ? '#FFB2BC' : '#FFD0A0'} />
      <Pressable accessibilityRole="button" accessibilityLabel={incoming ? 'View incoming emergency alert' : 'View speed warning'} style={{ flex: 1, gap: 4 }} onPress={() => { if (incoming) inbox.markSeen(incoming.id); navigate('safety'); }}>
        <Text numberOfLines={2} style={styles.safetyBannerTitle}>{incoming ? `Emergency from ${incoming.senderName}` : `${speedWarning!.name} exceeded ${speedWarning!.limitKmh} km/h`}</Text>
        <Text numberOfLines={2} style={styles.safetyBannerDetail}>{incoming ? `${incoming.text} · ${incoming.createdAt ? new Date(incoming.createdAt).toLocaleString() : ''}` : `${Math.round(speedWarning!.speedKmh)} km/h recorded. Tap to view speed.`}</Text>
      </Pressable><RoundButton small icon="close" label={incoming ? 'Dismiss emergency notification' : 'Dismiss speed warning'} onPress={() => incoming ? inbox.markSeen(incoming.id) : speedAlerts.dismissAlert()} />
    </View>}
    {incoming && emergencyRing.error && <View style={[ui.error, { margin: 8 }]}><Text accessibilityRole="alert" style={ui.errorText}>{emergencyRing.error}</Text><Button secondary title="Retry alert sound" onPress={emergencyRing.retry} /></View>}
    {page === 'profile' ? <DeviceProfileScreen device={selected} now={now} route={currentRoute} zones={tracking.zones} mapType={mapType}
      onBack={() => setPage(null)} onPrivacy={privacy} onShare={shareLocation} onEmergency={openEmergency}
      onHistory={() => navigate('history')}
      onZones={() => { setSelectedId(ownDevice.id); setPage('geofence'); }} />
      : page === 'geofence' ? <GeofenceScreen device={ownDevice} zones={tracking.zones} mapType={mapType} onBack={() => setPage(null)} onSave={tracking.saveZone} onDelete={tracking.deleteZone} onEnable={() => void tracking.startTracking()} />
        : <>
          {tab === 'map' && <View style={styles.mapScreen}>
            <LiveMap style={{ flex: 1, height: '100%', minHeight: 0 }} devices={devices} selectedId={selected.id} onSelect={id => { setSelectedId(id); setQuery(''); }} location={selected.location} route={currentRoute} zones={tracking.zones} presence={arrivals.presence} recenterKey={recenterKey} mapType={mapType} bottomInset={mapBottomHeight + 25} />
            <View style={styles.mapTop}>
              <View style={styles.search}><Icon name="search" size={20} color="#C4D9F4" /><TextInput accessibilityLabel="Search devices" value={query} onChangeText={setQuery} placeholder="Search your devices…" placeholderTextColor="#9AB1CE" style={styles.searchInput} returnKeyType="search" />{query ? <RoundButton small icon="close" label="Clear search" onPress={() => setQuery('')} /> : <Pressable accessibilityRole="button" accessibilityLabel="Send emergency alert" onPress={openEmergency} style={styles.sosButton}><Icon name="alert" size={18} color="#FFABB6" /></Pressable>}</View>
              {query ? <View style={styles.searchResults}>{devices.filter(device => device.name.toLowerCase().includes(query.toLowerCase())).length ? devices.filter(device => device.name.toLowerCase().includes(query.toLowerCase())).map(device => <Pressable key={device.id} accessibilityRole="button" onPress={() => { setSelectedId(device.id); setQuery(''); setRecenterKey(key => key + 1); }} style={styles.searchRow}><Avatar device={device} size={30} /><Text style={styles.searchName}>{device.name}</Text><Icon name="chevron" size={15} /></Pressable>) : <Text style={[ui.caption, { padding: 14 }]}>No devices match that name.</Text>}</View>
                : <View style={styles.mapBadges}><View style={styles.gpsBadge}><View style={[styles.dot, { backgroundColor: tracking.tracking ? colors.green : colors.muted }]} /><Text style={styles.gpsBadgeText}>{tracking.tracking ? 'GPS ACTIVE' : 'GPS PAUSED'}</Text></View><Pressable onPress={openCircle} style={styles.gpsBadge}><Icon name="people" size={12} color={colors.blueLight} /><Text style={styles.gpsBadgeText}>{sharing ? 'SHARING ON' : circle.circle ? circle.circle.name.slice(0, 20).toUpperCase() : 'YOUR SPACE'}</Text></Pressable></View>}
            </View>
            <View style={[styles.mapControls, compactMap && styles.compactMapControls]}>
              <RoundButton icon="layers" label="Change map style" active={mapType !== defaultMapType} onPress={() => setSheet('map')} />
              <RoundButton icon="target" label="Recenter on my location" onPress={() => { setSelectedId(ownDevice.id); setRecenterKey(key => key + 1); if (!tracking.tracking) void tracking.startTracking(); }} />
              <RoundButton icon="shield" label="Open geofence zones" onPress={() => setPage('geofence')} />
            </View>
            <View style={styles.mapBottom} onLayout={event => setMapBottomHeight(event.nativeEvent.layout.height)}>
              {circle.error && <View style={styles.mapError}><Icon name="info" size={16} color="#F7BF84" /><Text accessibilityRole="alert" style={styles.mapErrorText}>{circle.error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry shared locations" onPress={circle.retryLocations}><Text style={{ color: colors.blueLight, fontSize: 11 }}>Retry</Text></Pressable></View>}
              {tracking.error && <View style={styles.mapError}><Icon name="info" size={16} color="#F7BF84" /><Text style={styles.mapErrorText}>{tracking.error}</Text>{tracking.permission === 'denied' && <Pressable onPress={() => void Linking.openSettings()}><Text style={{ color: colors.blueLight, fontSize: 11 }}>Settings</Text></Pressable>}</View>}
              {locationPreferences.error && <View style={styles.mapError}><Text accessibilityRole="alert" style={styles.mapErrorText}>{locationPreferences.error}</Text></View>}
              <Pressable accessibilityRole="button" accessibilityLabel="View people in your space" onPress={() => setSheet('people')} style={styles.peopleBar}>
                <View style={{ flex: 1, gap: 3 }}><Text style={styles.peopleTitle}>People <Text style={ui.caption}>{devices.length}</Text></Text><Text style={ui.caption}>{circle.circle?.name ?? 'Your phone'}</Text></View>
                <View style={styles.peopleAvatars}>{devices.slice(0, 4).map(device => <View key={device.id} style={styles.peopleAvatar}><Avatar device={device} size={35} /></View>)}</View><Icon name="chevron" size={15} />
              </Pressable>
              <View style={styles.deviceCard}>
                <Pressable accessibilityRole="button" accessibilityLabel="Open device profile" onPress={() => openProfile(selected)} style={styles.selectedHeader}>
                  <Avatar device={selected} size={43} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.deviceName}>{selected.name}</Text><Text style={[styles.statusText, { color: selected.location && now - selected.location.timestamp < 45_000 ? colors.green : colors.muted }]}>{status}{selected.location?.speed !== null && selected.location?.speed !== undefined ? ` · ${speed(selected.location, now)}` : ''}</Text></View><View style={ui.row}><Icon name="battery" size={16} color={colors.green} /><Text style={styles.batteryText}>{battery(selected.batteryLevel)}</Text></View>
                </Pressable>
                <View style={styles.cardDivider} />
                <View style={ui.between}><View style={{ flex: 1, gap: 5 }}><Text style={styles.coordinateText}>{coordinates(selected.location)}</Text><Text style={ui.caption}>{tracking.activeTrip && selectedIsOwn ? `${(routeDistance / 1000).toFixed(2)} km recorded · ${tracking.route.length} GPS points` : selected.location ? age(selected.location.timestamp, now) : selectedIsOwn ? 'Enable location to find this phone' : 'This member has not shared a location'}</Text>{selected.location && <Text style={ui.caption}>{typeof selected.location.accuracy === 'number' && Number.isFinite(selected.location.accuracy) && selected.location.accuracy >= 0 ? `GPS accuracy ±${Math.round(selected.location.accuracy)} m` : 'GPS accuracy unavailable'}{tracking.activeTrip && selectedIsOwn ? ` · ${age(selected.location.timestamp, now)}` : ''}</Text>}</View><RoundButton small icon="chevron" label="View device details" onPress={() => openProfile(selected)} /></View>
                {auth.user && circle.circle && <View style={ui.between}><View style={{ flex: 1, gap: 3 }}><Text style={styles.recordText}>Share my location</Text><Text style={ui.caption}>{sharing ? 'Sharing with your space while Closeby is open' : 'Turn on so your space can see this phone'}</Text></View><Switch accessibilityLabel="Share my location from the map" value={sharing} onValueChange={value => void toggleSharing(value)} trackColor={{ false: '#314259', true: colors.blue }} thumbColor="#FFFFFF" /></View>}
                {!selectedIsOwn && !selected.location && <Text style={ui.caption}>{selected.sharing ? 'Their phone is waiting for a GPS fix. Ask them to keep Closeby open and check location access.' : 'Ask this person to open Closeby and turn on Share my location. Phone location alone does not enable sharing.'}</Text>}
                {!tracking.tracking ? <Button title="Enable location" icon="navigate" onPress={() => void tracking.startTracking()} /> : <View style={styles.mapActions}><Pressable accessibilityRole="button" onPress={() => void record()} style={styles.recordButton}><Icon name={tracking.activeTrip ? 'stop' : 'record'} size={15} color={tracking.activeTrip ? colors.red : colors.blueLight} /><Text style={styles.recordText}>{tracking.activeTrip ? 'End trip' : 'Record trip'}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void pauseGps().catch(cause => dialog.alert('Could not stop GPS', backendError(cause)))} style={styles.recordButton}><Icon name="pause" size={15} color={colors.muted} /><Text style={styles.pauseText}>Pause GPS</Text></Pressable></View>}
              </View>
              {!tracking.isPhysicalDevice && tracking.tracking && <Text style={styles.emulatorNote}>Android emulator · location comes from the emulator’s GPS</Text>}
            </View>
          </View>}

          {tab === 'spaces' && <SpaceScreen notificationChatKey={notificationChatKey} key={circle.circle?.id ?? 'no-space'} user={auth.user} circle={circle.circle} roster={circle.roster}
            devices={devices} ownDevice={ownDevice} sharing={sharing} loading={circle.loading} error={circle.error ?? tracking.error} now={now}
            onManage={openCircle} onAccount={onAccount} onSharing={value => void toggleSharing(value)} onRetry={circle.retryLocations} onInvite={() => void shareInvitation()} onEmergency={openEmergency} onProfile={openProfile}
            onMap={device => { setSelectedId(device.id); setRecenterKey(key => key + 1); navigate('map'); }} />}

          {tab === 'history' && <HistoryScreen devices={devices} selectedId={selected.id} onSelect={setSelectedId} ownId={ownDevice.id}
            day={historyDay} onDay={setHistoryDay} activity={activity} hasSpace={Boolean(auth.user && circle.circle)} mapType={mapType}
            trips={tracking.trips} activeTrip={tracking.activeTrip} route={tracking.route} onRecord={() => void record()} onEnd={() => void tracking.endTrip()} onClear={clearHistory} onViewTrip={trip => { setViewingTrip(trip); setSheet('trip'); }} />}

          {tab === 'safety' && <SafetyScreen speedKmh={speedKmh(tracking.location, now)} tracking={tracking.tracking} activeTrip={tracking.activeTrip} tripDistanceMeters={routeDistance}
            speedAlertsEnabled={speedPreferences.enabled} limitKmh={speedPreferences.limitKmh} alerts={emergencies.alerts} loading={emergencies.loading} error={emergencies.error}
            hasSpace={Boolean(circle.circle)} uid={auth.user?.uid} now={now} onEmergency={openEmergency} onEnableGps={() => void tracking.startTracking()}
            onRecord={() => void record()} onSettings={() => navigate('settings')} onSpace={auth.user ? openCircle : onAccount} onRetry={emergencies.retry} />}

          {tab === 'settings' && <ScrollView contentContainerStyle={ui.content} showsVerticalScrollIndicator={false}>
            <View style={styles.settingsHeading}><Text accessibilityRole="header" style={styles.settingsTitle}>Settings</Text></View>
            <View style={styles.avatarCard}><Avatar device={ownDevice} size={66} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.deviceName}>{auth.user?.displayName || 'Your profile'}</Text><Text style={ui.caption}>{avatarProfile.avatarId ? 'Your custom avatar' : auth.user?.photoURL ? 'Your Google photo' : 'Choose a face for your map pin'}</Text><Pressable accessibilityRole="button" accessibilityLabel={avatarProfile.avatarId ? 'Edit avatar' : 'Create avatar'} disabled={!avatarProfile.loaded} onPress={() => setSheet('avatar')}><Text style={styles.avatarLink}>{avatarProfile.avatarId ? 'Edit avatar' : 'Create avatar'}</Text></Pressable></View></View>
            {avatarProfile.error && <View style={ui.error}><Text style={ui.errorText}>{avatarProfile.error}</Text></View>}
            <Text style={ui.sectionLabel}>Speed & safety</Text>
            <SpeedSettings enabled={speedPreferences.enabled} limitKmh={speedPreferences.limitKmh} loading={!speedPreferences.loaded}
              onEnabledChange={value => void speedPreferences.setEnabled(value).catch(() => undefined)} onLimitChange={speedPreferences.setLimitKmh} />
            {speedPreferences.error && <View style={ui.error}><Text style={ui.errorText}>{speedPreferences.error}</Text></View>}
            <View style={ui.card}><SettingRow icon="alert" title="Emergency alerts" subtitle="Send to the space owner or everyone" onPress={openEmergency} /></View>
            <View style={ui.card}><SettingRow icon="people" title="Voice & video calls" subtitle="Call a space member. They choose whether to accept." onPress={() => setSheet('people')} /></View>
            <View style={ui.card}><SettingRow icon="shield" title="Camera & microphone requests" subtitle="Authorize requesters and ask for approval each time" onPress={() => setSheet('access')} /></View>
            <Text style={ui.sectionLabel}>Preferences</Text>
            <Text style={ui.sectionLabel}>History & activity</Text><ActivitySettings activity={activity} hasSpace={Boolean(auth.user && circle.circle)} />
            {activity.error && <View style={ui.error}><Text style={ui.errorText}>{activity.error}</Text></View>}
            <View style={ui.card}>
              <SettingRow icon="bell" title="Phone notifications" subtitle={phoneAlerts.enabled ? phoneAlerts.ready ? 'Emergency alerts, calls, messages and enabled location alerts' : 'Enabled on this phone; delivery is awaiting activation' : 'Receive alerts even when Closeby is closed'} trailing={<Switch accessibilityLabel="Phone notifications for calls and alerts" value={phoneAlerts.enabled} disabled={!phoneAlerts.loaded || phoneAlerts.busy || !phoneAlerts.supported} onValueChange={togglePhoneAlerts} trackColor={{ false: '#314259', true: colors.blue }} thumbColor="#FFFFFF" />} />
              <SettingRow icon="bell" title="Arrival notifications" subtitle="Arrival times and departures at your pinned places" trailing={<Switch accessibilityLabel="Safe-zone notifications" value={zoneAlerts} onValueChange={value => { setZoneAlerts(value); if (!value) void perform(() => phoneArrivals.setEnabled(false)); void AsyncStorage.setItem('@closeby/preferences/zone-alerts', String(value)).catch(() => dialog.alert('Preference not saved', 'This preference will reset after restarting.')); }} trackColor={{ false: '#314259', true: colors.blue }} thumbColor="#FFFFFF" />} />
              <SettingRow icon="phone" title="Background location monitoring" subtitle={phoneArrivals.supported ? 'Keep GPS and saved-place monitoring active when the app closes' : 'Install the updated development build to enable'} trailing={<Switch accessibilityLabel="Phone arrival notifications" value={phoneArrivals.enabled} disabled={!phoneArrivals.loaded || phoneArrivals.busy || !zoneAlerts} onValueChange={togglePhoneArrivals} trackColor={{ false: '#314259', true: colors.blue }} thumbColor="#FFFFFF" />} />
              <SettingRow icon="map" title="Map Style" subtitle={mapModes.find(mode => mode.id === mapType)?.title} onPress={() => setSheet('map')} />
              <SettingRow icon="people" title="Location Sharing" subtitle={sharing ? phoneArrivals.enabled ? 'Sharing with your space, including in the background' : 'Sharing with your space while the app is open' : 'Share with family and trusted people'} trailing={<Switch accessibilityLabel="Share my location with my space" value={sharing} onValueChange={value => void toggleSharing(value)} trackColor={{ false: '#314259', true: colors.blue }} thumbColor="#FFFFFF" />} />
              <SettingRow icon="moon" title="Dark Theme" subtitle="Dark mode across the app" trailing={<Text style={styles.onText}>On</Text>} />
            </View>
            {phoneArrivals.error && <View style={ui.error}><Text style={ui.errorText}>{phoneArrivals.error}</Text></View>}
            {phoneAlerts.error && <View style={ui.error}><Text style={ui.errorText}>{phoneAlerts.error}</Text></View>}
            <Text style={ui.sectionLabel}>Privacy & Security</Text>
            <View style={ui.card}><SettingRow icon="lock" title="Location Privacy" subtitle="Control who can see your location" onPress={privacy} /><SettingRow icon="shield" title="Data & Permissions" subtitle="Manage location access on your phone" onPress={() => void Linking.openSettings()} /><SettingRow icon="trash" title="Clear Trip History" subtitle="Delete routes stored on this device" onPress={clearHistory} /></View>
            <Text style={ui.sectionLabel}>Account</Text>
            <View style={ui.card}><SettingRow icon="user" title="Profile" subtitle={auth.user?.email ?? 'Log in with Google or sign up free'} onPress={() => auth.user ? openProfile(ownDevice) : onAccount()} /><SettingRow icon="people" title="Spaces" subtitle={circle.circle?.name ?? 'Create or join a private space'} onPress={openCircle} />{auth.user && <SettingRow icon="logout" title="Sign Out" subtitle="Stop tracking and remove your shared location" color="#F29099" onPress={endSession} />}</View>
            {!auth.isConfigured && <View style={styles.infoNote}><Icon name="info" color={colors.blueLight} size={19} /><Text style={[ui.caption, { flex: 1 }]}>This phone’s GPS works now. Accounts and family sharing will be available after your Firebase project is connected.</Text></View>}
            {(circle.error || auth.error) && <View style={ui.error}><Text style={ui.errorText}>{circle.error ?? auth.error}</Text></View>}
            <View style={{ alignItems: 'center', gap: 10 }}><BrandLogo size={44} /><Text style={[ui.caption, { textAlign: 'center' }]}>Closeby · {activity.background ? 'Background recording enabled' : 'GPS tracking while the app is open'}</Text></View>
          </ScrollView>}
        </>}

    {!page && <View style={styles.tabBar} accessibilityRole="tablist">{tabs.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: item.id === tab }} onPress={() => navigate(item.id)} style={({ pressed }) => [styles.tab, pressed && ui.pressed]}><View style={[styles.tabGlow, item.id === tab && styles.tabGlowActive]}><Icon name={item.icon} size={21} color={item.id === tab ? colors.blueLight : '#91A9C6'} /></View><Text style={[styles.tabLabel, item.id === tab && { color: colors.blueLight }]}>{item.label}</Text></Pressable>)}</View>}

    <Modal visible={sheet !== null || callVisible} transparent animationType="fade" onRequestClose={() => { if (!callVisible) dismissSheet(); else if (call.active || call.loading && !call.incoming) call.end(); else if (call.incoming) void call.decline(); else if (call.incomingError) call.retryIncoming(); else call.clearError(); }}>
      {callVisible ? <CallPanel call={call} embedded /> : <View style={styles.modalOverlay}><Pressable style={StyleSheet.absoluteFill} onPress={dismissSheet} accessibilityRole="button" accessibilityLabel="Dismiss dialog" /><SafeAreaView edges={['bottom']} style={styles.sheet} accessibilityViewIsModal>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
          <View style={ui.between}><Text style={ui.title}>{sheet === 'circle' ? pendingInvitation ? 'Space invitation' : circle.circle?.name ?? 'Your private space' : sheet === 'emergency' ? 'Emergency alert' : sheet === 'map' ? 'Map style' : sheet === 'avatar' ? 'Create your avatar' : sheet === 'people' ? 'Your people' : sheet === 'access' ? 'Camera & microphone' : 'Recorded Trip'}</Text><RoundButton small icon="close" label="Close dialog" onPress={dismissSheet} /></View>
          {sheet === 'circle' && pendingInvitation && <View style={styles.personCard}>
            <Text style={styles.deviceName}>Your invitation is ready</Text>
            {circle.circle && <Text style={ui.body}>{circle.circle.inviteCode === pendingInvitation.code ? `You already belong to ${circle.circle.name}.` : `You already belong to ${circle.circle.name}. Leave that space first if you want to accept another invitation.`}</Text>}
            {!circle.circle && <Text style={ui.body}>Review the invitation below and choose Accept invitation &amp; join. Location sharing stays your choice.</Text>}
            {invitationError && <Text style={ui.errorText}>{invitationError}</Text>}
            <Button secondary title="Dismiss invitation" disabled={busy} onPress={() => { onDismissInvitation?.(pendingInvitation.key); setJoinCode(''); }} />
          </View>}
          {sheet === 'access' && (circle.circle && auth.user ? <DeviceAccessSettings key={`${circle.circle.id}/${auth.user.uid}`} spaceId={circle.circle.id} ownerId={circle.circle.ownerId} uid={auth.user.uid} members={circle.roster}
            disabled={call.loading || Boolean(call.active || call.incoming)} onRequest={(member, access) => { setSheet(null); void call.requestAccess(member.uid, member.name, access); }} />
            : <><Text style={ui.body}>Sign in and join a private space to request device access or manage request permissions.</Text><Button title={auth.user ? 'Create or join a space' : 'Sign in'} onPress={() => { setSheet(null); auth.user ? openCircle() : onAccount(); }} /></>)}
          {sheet === 'avatar' && <AvatarEditor value={avatarProfile.avatarId} photoURL={ownDevice.photoURL} name={auth.user?.displayName || 'My avatar'} saving={avatarProfile.saving} error={avatarProfile.error} onCancel={dismissSheet} onSave={async id => { await avatarProfile.saveAvatar(id); setSheet(null); }} />}
          {sheet === 'people' && <>
            {circle.error && <View style={ui.error}><Text accessibilityRole="alert" style={ui.errorText}>{circle.error}</Text><Button secondary title="Retry shared locations" onPress={circle.retryLocations} /></View>}
            <Text style={ui.body}>Select a person to find their shared position. Camera and microphone access requires an accepted call.</Text>
            {circle.circle && <Button secondary title="Camera & microphone requests" onPress={() => setSheet('access')} />}
            {devices.map(device => <View key={device.id} style={styles.personCard}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Show ${device.name} on map`} onPress={() => { setSelectedId(device.id); setRecenterKey(key => key + 1); setSheet(null); navigate('map'); }} style={styles.selectedHeader}>
                <Avatar device={device} size={52} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.deviceName}>{device.id === ownDevice.id ? `${device.name} (you)` : device.name}</Text><Text style={ui.caption}>{deviceStatus(device, now)}{device.location ? ` · ${age(device.location.timestamp, now)}` : ''}</Text></View><Icon name="chevron" size={15} />
              </Pressable>
              {device.id === ownDevice.id ? <Pressable accessibilityRole="button" accessibilityLabel="Create or edit your avatar" onPress={() => setSheet('avatar')}><Text style={styles.avatarLink}>{avatarProfile.avatarId ? 'Edit your avatar' : 'Create your avatar'}</Text></Pressable>
                : auth.user && circle.circle && <View style={ui.row}><View style={{ flex: 1 }}><Button secondary title="Voice call" disabled={call.loading || Boolean(call.active)} onPress={() => { setSheet(null); void call.startCall(device.ownerId, device.name, 'voice').catch(() => undefined); }} /></View><View style={{ flex: 1 }}><Button secondary title="Video call" disabled={call.loading || Boolean(call.active)} onPress={() => { setSheet(null); void call.startCall(device.ownerId, device.name, 'video').catch(() => undefined); }} /></View></View>}
            </View>)}
            {!circle.circle && <Button secondary title={auth.user ? 'Create or join a space' : 'Sign in to connect with people'} onPress={() => { setSheet(null); auth.user ? openCircle() : onAccount(); }} />}
          </>}
          {sheet === 'map' && <>
            <Text style={ui.body}>Choose a view for your live GPS locations.</Text>
            <View accessibilityRole="radiogroup" style={ui.card}>{mapModes.map(mode => <Pressable key={mode.id} accessibilityRole="radio" accessibilityLabel={mode.title} aria-checked={mode.id === mapType} accessibilityState={{ checked: mode.id === mapType }} onPress={() => setMapType(mode.id)} style={styles.mapModeRow}>
              <Icon name="layers" size={21} color={mode.id === mapType ? colors.blueLight : colors.muted} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.deviceName}>{mode.title}</Text><Text style={ui.caption}>{mode.detail}</Text></View><Icon name={mode.id === mapType ? 'check' : 'record'} size={19} color={mode.id === mapType ? colors.blueLight : colors.muted} />
            </Pressable>)}</View>
            <Text style={ui.caption}>Google Dark gives streets a dark appearance. Satellite keeps the imagery’s original colors. Image detail and dates vary by area.</Text>
            <Button secondary title="Open position in Google Maps" icon="navigate" disabled={!hasMeasuredLocation(selected.location)} onPress={openExternalMap} />
            <Text style={ui.caption}>Pins use your phone’s measured GPS. Satellite imagery is a background photo, not a live view of your phone. Map data and image dates vary by location.</Text>
            <Button title="Done" onPress={dismissSheet} />
          </>}
          {sheet === 'emergency' && <EmergencyComposer ownerName={ownerName} isOwner={circle.circle?.ownerId === auth.user?.uid} hasSpace={Boolean(auth.user && circle.circle)}
            location={emergencyAttempt.current && (emergencyError || emergencySending) ? emergencyAttempt.current.payload.location : tracking.location}
            sending={emergencySending} error={emergencyError} onSend={(audience, note, includeLocation) => void sendEmergency(audience, note, includeLocation)}
            onDraftChange={() => { emergencyAttempt.current = null; setEmergencyError(null); }}
            onAccount={() => { setSheet(null); if (auth.user) openCircle(); else onAccount(); }} />}
          {sheet === 'emergency' && emergencyError && emergencyAttempt.current && <Text style={ui.caption}>Retry keeps the original captured position. Edit the message or recipient to start a new alert with the current GPS fix.</Text>}
          {sheet === 'circle' && (circle.circle ? <>
            <Text style={ui.body}>Send an invitation link. It opens Closeby with the code filled in, ready for them to accept.</Text>
            <Button title="Share invitation link" icon="people" onPress={() => void shareInvitation()} />
            <View style={styles.codeCard}><Text style={styles.codeLabel}>OR ENTER THIS CODE IN SPACES</Text><Text selectable accessibilityLabel="Space invitation code" style={styles.codeText}>{formatInvitationCode(circle.circle.inviteCode)}</Text><Text style={ui.caption}>Expires 7 days after creation or renewal</Text></View>
            <Button secondary title={sharing ? "Pause location sharing" : "Share my location with this space"} icon="navigate" onPress={() => void toggleSharing(!sharing)} />
            {circle.circle.ownerId === auth.user?.uid && <Button secondary title="Renew invitation code" busy={busy || circle.loading} onPress={() => dialog.alert('Renew invitation?', 'The old code will stop working. Existing members will stay in your space.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Renew', onPress: () => void perform(circle.renewInvitation) }])} />}
            <Text style={ui.caption}>Location sharing: {sharing ? 'On while this app is open' : 'Off until you enable it in Settings'}.</Text>
            <Button secondary title="Leave space" busy={busy} onPress={() => dialog.alert('Leave this space?', 'Your shared location will be removed, and you will lose access to this space.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => void perform(async () => { setSharing(false); await circle.leaveCircle(); setSelectedId(ownDevice.id); setSheet(null); }) }])} />
          </> : <>
            <Text style={ui.body}>Only accepted space members can access locations you choose to share.</Text>
            {!pendingInvitation && <><Field label="Space name" value={circleName} onChangeText={setCircleName} maxLength={60} placeholder="My family" /><Button title="Create a space" busy={busy || circle.loading} onPress={() => void perform(() => circle.createCircle(circleName))} /><View style={styles.sheetDivider} /><Text style={ui.sectionLabel}>Have an invitation?</Text></>}
            <Field label="Invitation code" value={joinCode} onChangeText={setJoinCode} autoCapitalize="characters" autoCorrect={false} placeholder="Paste an invitation link or code" maxLength={512} /><Button secondary title="Accept invitation & join" busy={busy || circle.loading} disabled={!joinCode.trim()} onPress={() => void perform(acceptInvitation)} />
          </>)}
          {sheet === 'trip' && viewingTrip && <>
            <Text style={ui.body}>{new Date(viewingTrip.startedAt).toLocaleString()} · {(viewingTrip.distanceMeters / 1000).toFixed(2)} km recorded</Text><View style={styles.tripMap}><LiveMap style={{ height: '100%', minHeight: 0 }} devices={[]} selectedId="" onSelect={() => {}} location={null} route={viewingTrip.points} zones={[]} mapType={mapType} /></View><Text style={ui.caption}>Your recorded GPS path. Accuracy depends on the locations reported by your phone.</Text>
          </>}
          {circle.error && sheet === 'circle' && <View style={ui.error}><Text style={ui.errorText}>{circle.error}</Text></View>}
        </ScrollView>
      </SafeAreaView></View>}
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  sosButton: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#401D2C', alignItems: 'center', justifyContent: 'center' },
  safetyBanner: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#352419', borderBottomWidth: 1, borderBottomColor: '#7B5432' },
  arrivalBanner: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#102A24', borderBottomWidth: 1, borderBottomColor: '#235E49' },
  emergencyBanner: { backgroundColor: '#451D2A', borderBottomColor: '#9F3D51' },
  safetyBannerTitle: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  safetyBannerDetail: { color: '#E6C2C8', fontSize: 10, lineHeight: 16 },
  mapScreen: { flex: 1, backgroundColor: '#0D1925' },
  mapTop: { position: 'absolute', top: 14, left: 16, right: 16, gap: 12 },
  search: { backgroundColor: '#152334F2', borderColor: '#48607C', borderWidth: 1, borderRadius: 24, paddingHorizontal: 15, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 12, paddingVertical: 12 },
  mapBadges: { flexDirection: 'row', gap: 7 },
  gpsBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: '#091623ED', borderWidth: 1, borderColor: '#263A50' },
  gpsBadgeText: { fontSize: 8, letterSpacing: 0.8, fontWeight: '600', color: '#BCD0E7' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  mapControls: { position: 'absolute', right: 16, top: 125, gap: 12 },
  compactMapControls: { flexDirection: 'row', gap: 8 },
  mapBottom: { position: 'absolute', left: 16, right: 16, bottom: 17, gap: 10 },
  peopleBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 17, borderWidth: 1, borderColor: '#2A3B4D', backgroundColor: '#08131EF5' },
  peopleTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  peopleAvatars: { flexDirection: 'row', paddingLeft: 7 },
  peopleAvatar: { marginLeft: -7, padding: 2, borderRadius: 24, backgroundColor: '#08131E' },
  avatarCard: { flexDirection: 'row', alignItems: 'center', gap: 15, padding: 17, backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.line },
  avatarLink: { color: colors.blueLight, fontSize: 13, fontWeight: '600', paddingVertical: 6 },
  personCard: { gap: 13, padding: 16, borderRadius: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  deviceCard: { borderWidth: 1, borderColor: '#2A3B4D', borderRadius: 19, backgroundColor: '#08131EF5', padding: 15, gap: 14 },
  selectedHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  deviceName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  statusText: { fontSize: 11 },
  batteryText: { fontSize: 10, color: '#C4D6EC' },
  cardDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#304256' },
  coordinateText: { fontSize: 13, fontWeight: '500', color: colors.ink },
  mapActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2A3C50', paddingTop: 10, gap: 10 },
  recordButton: { flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', minHeight: 28 },
  recordText: { color: colors.blueLight, fontSize: 11, fontWeight: '500' },
  pauseText: { color: colors.muted, fontSize: 11 },
  emulatorNote: { color: '#A5BED8', fontSize: 9, textAlign: 'center', backgroundColor: '#08111CE0', borderRadius: 8, padding: 6 },
  mapModeRow: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  mapError: { padding: 11, backgroundColor: '#281E17F2', borderWidth: 1, borderColor: '#5C4735', borderRadius: 13, flexDirection: 'row', gap: 8, alignItems: 'center' },
  mapErrorText: { flex: 1, color: '#F4C598', fontSize: 11, lineHeight: 17 },
  tabBar: { flexDirection: 'row', backgroundColor: '#070F18', borderTopWidth: 1, borderTopColor: '#1D2C3C', paddingHorizontal: 10, paddingTop: 9, paddingBottom: 9 },
  tab: { flex: 1, alignItems: 'center', gap: 4, minHeight: 49, justifyContent: 'center' },
  tabGlow: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 15 },
  tabGlowActive: { backgroundColor: '#0A2845' },
  tabLabel: { fontSize: 10, color: '#9FB5CE' },
  infoNote: { flexDirection: 'row', gap: 10, backgroundColor: '#0C1D2F', borderWidth: 1, borderColor: '#193654', padding: 15, borderRadius: 14 },
  settingsHeading: { alignItems: 'center', paddingVertical: 11 },
  settingsTitle: { fontSize: 18, color: colors.ink, fontWeight: '600' },
  onText: { fontSize: 11, color: colors.blueLight, backgroundColor: '#123153', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 10 },
  searchResults: { backgroundColor: '#0C1826F8', borderWidth: 1, borderColor: colors.line, borderRadius: 15, overflow: 'hidden' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  searchName: { color: colors.ink, fontSize: 12, flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: '#000000B0', alignItems: 'center', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 600, maxHeight: '90%', backgroundColor: '#0B1521', borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, borderColor: '#263A52', overflow: 'hidden' },
  sheetContent: { padding: 22, gap: 19 },
  codeCard: { backgroundColor: '#0E243B', padding: 19, gap: 14, borderWidth: 1, borderColor: '#254D78', borderRadius: 15, alignItems: 'center' },
  codeLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 1.5, color: colors.muted },
  codeText: { fontSize: 15, color: colors.blueLight, fontWeight: '600', textAlign: 'center', lineHeight: 23 },
  sheetDivider: { height: 1, backgroundColor: colors.line, marginTop: 4 },
  tripMap: { height: 340, overflow: 'hidden', borderRadius: 17, borderWidth: 1, borderColor: colors.line },
});
