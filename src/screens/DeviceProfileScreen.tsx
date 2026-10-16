import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { LiveMap } from '../components/LiveMap';
import type { MapType } from '../lib/mapModel';
import { Avatar, Button, RoundButton, SettingRow, ui } from '../components/Ui';
import { age, battery, coordinates, deviceStatus, speed } from '../lib/format';
import { colors } from '../theme';
import type { DeviceProfile, LocationFix, SafeZone } from '../types';

export function DeviceProfileScreen({ device, route, zones, mapType, now, onBack, onHistory, onZones, onPrivacy, onShare, onEmergency }: {
  device: DeviceProfile; route: LocationFix[]; zones: SafeZone[]; now: number; mapType?: MapType;
  onBack: () => void; onHistory: () => void; onZones: () => void; onPrivacy: () => void; onShare: () => void; onEmergency: () => void;
}) {
  const live = Boolean(device.location && now - device.location.timestamp < 45_000);
  return <View style={ui.screen}>
    <View style={styles.header}><RoundButton small icon="back" label="Back to map" onPress={onBack} /><Text style={styles.headerTitle}>{device.name}</Text><RoundButton small icon="info" label="Location privacy information" onPress={onPrivacy} /></View>
    <ScrollView contentContainerStyle={ui.content} showsVerticalScrollIndicator={false}>
      <View style={styles.identity}><Avatar device={device} size={78} /><View style={{ flex: 1, gap: 7 }}><Text style={styles.name}>{device.name}</Text><Text style={ui.caption}>{age(device.location?.timestamp ?? device.lastSeen, now)}</Text><Text style={ui.caption}>{coordinates(device.location)}</Text><View style={[styles.liveBadge, !live && styles.pausedBadge]}><View style={[styles.dot, !live && { backgroundColor: colors.muted }]} /><Text style={{ color: live ? colors.green : colors.muted, fontSize: 10 }}>{deviceStatus(device, now)}</Text></View></View></View>
      <View style={styles.stats}>
        <View style={styles.stat}><Icon name="battery" color={colors.green} size={22} /><Text style={styles.value}>{battery(device.batteryLevel)}</Text><Text style={ui.caption}>Battery</Text></View>
        <View style={styles.stat}><Icon name="signal" color={colors.blueLight} size={22} /><Text style={styles.value}>{device.location?.accuracy !== null && device.location?.accuracy !== undefined ? `±${Math.round(device.location.accuracy)} m` : '—'}</Text><Text style={ui.caption}>GPS accuracy</Text></View>
        <View style={styles.stat}><Icon name="speed" color={colors.blueLight} size={22} /><Text style={styles.value}>{speed(device.location, now)}</Text><Text style={ui.caption}>Speed</Text></View>
      </View>
      <View style={ui.card}><View style={styles.map}><LiveMap style={{ height: '100%', minHeight: 0 }} devices={[device]} selectedId={device.id} onSelect={() => {}} location={device.location} route={route} zones={zones} mapType={mapType} /></View><Pressable onPress={onBack} accessibilityRole="button" style={styles.locationRow}><Icon name="pin" size={21} color="#B8CDE9" /><View style={{ flex: 1, gap: 4 }}><Text style={styles.rowTitle}>{device.location ? 'Current coordinates' : 'Location unavailable'}</Text><Text style={ui.caption}>{coordinates(device.location)}</Text></View><Text style={styles.liveText}>{live ? 'Live' : 'GPS'}</Text></Pressable></View>
      <View style={ui.card}>
        <SettingRow icon="history" title="History & Activity" subtitle="View shared routes, stops, and travel time" onPress={onHistory} />
        <SettingRow icon="shield" title="Geofence Alerts" subtitle="Manage safe zones on this device" onPress={onZones} />
        <SettingRow icon="lock" title="Location Privacy" subtitle="Control who can see your location" onPress={onPrivacy} />
      </View>
      <Button danger icon="alert" title="Send emergency alert" onPress={onEmergency} />
      <Button secondary icon="pin" title="Share this location" disabled={!device.location} onPress={onShare} />
      <Text style={[ui.caption, { textAlign: 'center' }]}>Your emergency alert uses your own phone. Sharing this selected location opens your phone’s share sheet.</Text>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  headerTitle: { color: colors.ink, fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'center' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 17, paddingVertical: 4 },
  name: { color: colors.ink, fontSize: 17, fontWeight: '600' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, backgroundColor: '#0B2A1D', borderColor: '#245D3A', borderWidth: 1, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 9 },
  pausedBadge: { backgroundColor: '#15202A', borderColor: '#304052' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.green },
  stats: { flexDirection: 'row', gap: 9 },
  stat: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 13, alignItems: 'center', paddingVertical: 17, gap: 9 },
  value: { color: colors.ink, fontSize: 13, fontWeight: '500' },
  map: { height: 190 },
  locationRow: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowTitle: { fontSize: 12, color: colors.ink, fontWeight: '500' },
  liveText: { color: colors.blueLight, fontSize: 10, borderWidth: 1, borderColor: '#23517B', backgroundColor: '#10253A', borderRadius: 20, padding: 7 },
});
