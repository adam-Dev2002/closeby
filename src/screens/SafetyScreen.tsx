import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Button, EmptyState, ui } from '../components/Ui';
import { age, coordinates } from '../lib/format';
import { colors } from '../theme';
import type { SpaceEmergencyAlert } from '../types';

type Props = {
  speedKmh: number | null; tracking: boolean; activeTrip: boolean; tripDistanceMeters: number;
  speedAlertsEnabled: boolean; limitKmh: number; alerts: SpaceEmergencyAlert[];
  loading: boolean; error: string | null; hasSpace: boolean; uid: string | undefined; now: number;
  onEmergency: () => void; onEnableGps: () => void; onRecord: () => void;
  onSettings: () => void; onSpace: () => void; onRetry: () => void;
};

export function SafetyScreen({ speedKmh, tracking, activeTrip, tripDistanceMeters, speedAlertsEnabled, limitKmh, alerts, loading, error, hasSpace, uid, now, onEmergency, onEnableGps, onRecord, onSettings, onSpace, onRetry }: Props) {
  const overLimit = speedKmh !== null && speedKmh > limitKmh;
  return <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={ui.title}>Safety & speed</Text>
    <Button danger icon="alert" title="Send emergency alert" onPress={onEmergency} />
    <Text style={ui.caption}>Choose the space owner or everyone. Alerts appear in the app; recipients can check them when they return.</Text>
    <View style={styles.speedCard}>
      <View style={ui.between}><View style={ui.row}><Icon name="speed" color={colors.blueLight} size={22} /><Text style={styles.label}>THIS PHONE’S SPEED</Text></View><Text style={ui.caption}>{tracking ? 'GPS active' : 'GPS paused'}</Text></View>
      <View style={styles.speedReading}><Text accessibilityLabel={speedKmh === null ? 'Speed unavailable' : `${Math.round(speedKmh)} kilometres per hour`} style={[styles.speedValue, speedAlertsEnabled && overLimit && { color: '#FF9CA6' }]}>{speedKmh === null ? '—' : Math.round(speedKmh)}</Text><Text style={styles.unit}>km/h</Text></View>
      <Text style={ui.caption}>{speedKmh === null ? 'Enable GPS and wait for a measured speed reading.' : 'Measured by your phone’s GPS.'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Configure speed alerts" onPress={onSettings} style={styles.limitRow}><View style={{ flex: 1, gap: 4 }}><Text style={styles.rowTitle}>{speedAlertsEnabled ? `Speed alerts above ${limitKmh} km/h` : 'Speed alerts are off'}</Text><Text style={ui.caption}>Your phone and members sharing their speed</Text></View><Icon name="settings" size={18} color={colors.blueLight} /></Pressable>
      {!tracking && <Button secondary title="Enable GPS for speed" icon="navigate" onPress={onEnableGps} />}
    </View>
    <View style={styles.distanceCard}><View style={{ flex: 1, gap: 5 }}><Text style={styles.rowTitle}>Trip distance</Text><Text style={ui.caption}>{activeTrip ? 'Accumulated GPS distance for this trip' : 'Record a trip to measure distance in km'}</Text></View><Text style={styles.distance}>{activeTrip ? (tripDistanceMeters / 1000).toFixed(2) : '—'} km</Text></View>
    <Button secondary icon={activeTrip ? 'stop' : 'record'} title={activeTrip ? 'End and save trip' : 'Record a trip'} onPress={onRecord} />
    <Text style={ui.sectionLabel}>Emergency alerts</Text>
    {error && <View style={[ui.error, { gap: 12 }]}><Text style={ui.errorText}>{error}</Text><Button secondary title="Retry emergency alerts" onPress={onRetry} /></View>}
    {loading && <ActivityIndicator color={colors.blueLight} accessibilityLabel="Loading emergency alerts" />}
    {!hasSpace ? <EmptyState icon="people" title="Connect your space" detail="Join a space to send and receive emergency alerts."><Button secondary title="Create or join a space" onPress={onSpace} /></EmptyState>
      : !loading && !error && !alerts.length ? <EmptyState icon="shield" title="No emergency alerts" detail="Alerts sent to you or everyone in this space will appear here." /> : null}
    {alerts.map(alert => <View key={alert.id} style={styles.alertCard}>
      <View style={ui.row}><Icon name="alert" color="#FF929E" size={21} /><View style={{ flex: 1, gap: 4 }}><Text style={styles.rowTitle}>{alert.senderId === uid ? 'Your emergency alert' : `Emergency from ${alert.senderName}`}</Text><Text style={ui.caption}>{alert.audience === 'everyone' ? 'To everyone in the space' : 'Private · sender and space owner'}</Text></View></View>
      <Text style={ui.body}>{alert.text || 'I need help. Please check on me.'}</Text>
      <Text style={ui.caption}>{alert.pending ? 'Sending · waiting for server confirmation' : alert.createdAt ? `Sent ${new Date(alert.createdAt).toLocaleString()}` : 'Waiting for confirmation'}</Text>
      {alert.location ? <><Text style={ui.caption}>Location captured {new Date(alert.location.timestamp).toLocaleString()} · {age(alert.location.timestamp, now)}</Text><Pressable accessibilityRole="link" accessibilityLabel={`Open emergency location from ${alert.senderName}`} onPress={() => void Linking.openURL(`https://www.google.com/maps?q=${alert.location!.latitude},${alert.location!.longitude}`)} style={styles.location}><Icon name="pin" size={17} color={colors.blueLight} /><Text style={{ color: colors.blueLight, fontSize: 12 }}>{coordinates(alert.location)}</Text><Icon name="arrow" size={16} color={colors.blueLight} /></Pressable></> : <Text style={ui.caption}>No location included</Text>}
    </View>)}
    {alerts.length >= 100 && <Text style={ui.caption}>Showing the latest 100 alerts you can access.</Text>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  speedCard: { padding: 20, gap: 14, backgroundColor: '#0F243A', borderWidth: 1, borderColor: '#203D5B', borderRadius: 18 },
  label: { color: colors.blueLight, fontSize: 9, letterSpacing: 1, fontWeight: '600', flexShrink: 1 },
  speedReading: { flexDirection: 'row', gap: 12, alignItems: 'baseline' },
  speedValue: { color: colors.ink, fontSize: 62, fontWeight: '700', letterSpacing: -2 },
  unit: { color: colors.muted, fontSize: 16 },
  limitRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingTop: 14, borderTopWidth: 1, borderTopColor: '#294561', minHeight: 60 },
  rowTitle: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  distanceCard: { flexDirection: 'row', gap: 14, alignItems: 'center', padding: 16, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  distance: { color: colors.ink, fontSize: 18, fontWeight: '600', flexShrink: 1 },
  alertCard: { padding: 16, gap: 12, borderRadius: 16, backgroundColor: '#24171F', borderWidth: 1, borderColor: '#63313B' },
  location: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
});
