import { StyleSheet, Text, View } from 'react-native';
import { batteryPercent } from '../lib/placePresence';
import { colors } from '../theme';

export function BatteryBadge({ level, fresh = true }: { level: number | null; fresh?: boolean }) {
  const percent = batteryPercent(level);
  const color = percent === null ? colors.muted : percent <= 20 ? colors.red : colors.green;
  return <View accessible accessibilityLabel={`${fresh ? '' : 'Last reported '}battery ${percent === null ? 'unavailable' : `${percent}%`}`} style={styles.badge}>
    <View style={styles.battery}><View style={[styles.fill, { width: percent === null ? 0 : 9 * percent / 100, backgroundColor: color }]} /><View style={styles.cap} /></View>
    <Text style={[styles.text, { color }]}>{percent === null ? '—' : `${percent}%`}</Text>
  </View>;
}
const styles = StyleSheet.create({
  badge: { minWidth: 40, height: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 4, borderRadius: 7, backgroundColor: '#0B1521', borderColor: '#DDE9F8', borderWidth: 1 },
  battery: { width: 13, height: 8, borderWidth: 1, borderColor: '#DDE9F8', borderRadius: 2, justifyContent: 'center', paddingLeft: 1 },
  fill: { height: 4, borderRadius: 1 },
  cap: { position: 'absolute', width: 2, height: 4, right: -3, top: 1, borderRadius: 1, backgroundColor: '#DDE9F8' },
  text: { fontSize: 9, fontWeight: '700' },
});
