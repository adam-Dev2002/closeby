import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme';
import { Button, Field, SettingRow, ui } from './Ui';

export type SpeedSettingsProps = {
  enabled: boolean;
  limitKmh: number;
  loading: boolean;
  onEnabledChange: (value: boolean) => void;
  onLimitChange: (value: number) => Promise<void>;
};

export function SpeedSettings({ enabled, limitKmh, loading, onEnabledChange, onLimitChange }: SpeedSettingsProps) {
  const [input, setInput] = useState(String(limitKmh));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setInput(String(limitKmh)); }, [limitKmh]);

  async function save() {
    if (saving || loading) return;
    const value = Number(input.trim());
    if (!input.trim() || !Number.isInteger(value) || value < 10 || value > 200) {
      setError('Enter a whole number from 10 to 200 km/h.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onLimitChange(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the speed limit. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const busy = loading || saving;
  return <View style={ui.card}>
    <SettingRow icon="speed" title="Speed alerts" subtitle="Alert when a tracked speed exceeds your limit."
      trailing={<Switch accessibilityLabel="Speed alerts" value={enabled} disabled={busy}
        onValueChange={onEnabledChange} trackColor={{ false: '#2A3F56', true: '#167CD8' }} thumbColor={colors.ink} />} />
    <View style={styles.content}>
      <Text style={ui.body}>While the app is open, check your GPS speed and the speeds members share in your space.</Text>
      <Field label="Speed limit (km/h)" value={input} onChangeText={value => { setInput(value); setError(null); }}
        placeholder="80" keyboardType="number-pad" inputMode="numeric" maxLength={3} editable={!busy}
        returnKeyType="done" onSubmitEditing={() => { void save(); }} />
      <Text style={ui.caption}>Choose 10–200 km/h. GPS readings can vary; use your vehicle’s speedometer when driving.</Text>
      {error && <View style={ui.error} accessibilityLiveRegion="polite"><Text style={ui.errorText}>{error}</Text></View>}
      <Button title={saving ? 'Saving speed limit…' : 'Save speed limit'} icon="check" secondary onPress={() => { void save(); }}
        busy={saving} disabled={loading || input.trim() === String(limitKmh)} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
});
