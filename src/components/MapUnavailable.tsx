import { Linking, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { Button, ui } from './Ui';
import { googleMapsUrl } from '../lib/mapModel';
import { colors } from '../theme';
import type { Coordinate } from '../types';

export function MapUnavailable({ message, location, onRetry, title = 'Google Maps unavailable' }: { message: string; location: Coordinate | null; onRetry?: () => void; title?: string }) {
  const url = location ? googleMapsUrl(location) : null;
  return <View style={styles.panel}>
    <Icon name="map" size={26} color={colors.blueLight} />
    <Text accessibilityRole="alert" style={styles.title}>{title}</Text>
    <Text style={[ui.body, { textAlign: 'center' }]}>{message}</Text>
    {onRetry && <Button secondary title={title === 'Google Maps unavailable' ? 'Retry Google Maps' : 'Retry map'} onPress={onRetry} />}
    {url && <Button secondary title="Open GPS position in Google Maps" onPress={() => void Linking.openURL(url)} />}
  </View>;
}

const styles = StyleSheet.create({
  panel: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, gap: 12, backgroundColor: '#080F17' },
  title: { color: colors.ink, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
