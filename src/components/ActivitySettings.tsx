import { Switch, Text, View } from 'react-native';
import type { useActivityHistory } from '../hooks/useActivityHistory';
import { backgroundSupported } from '../services/backgroundTracking';
import { colors } from '../theme';
import { SettingRow, ui } from './Ui';

export function ActivitySettings({ activity, hasSpace }: { activity: ReturnType<typeof useActivityHistory>; hasSpace: boolean }) {
  const trackColor = { false: '#314259', true: colors.blue };
  return <View style={{ gap: 10 }}><View style={ui.card}>
    <SettingRow icon="history" title="Save my activity" subtitle="Automatically save routes and stops on this phone" trailing={<Switch accessibilityLabel="Save my activity" disabled={!activity.loaded || activity.busy} value={activity.enabled} onValueChange={value => void activity.setSaving(value)} trackColor={trackColor} thumbColor="#FFFFFF" />} />
    <SettingRow icon="phone" title="Background recording" subtitle={backgroundSupported() ? 'Continue when the phone is locked or the app is in the background' : 'Available in the installed Closeby app'} trailing={<Switch accessibilityLabel="Background recording" disabled={!backgroundSupported() || !activity.enabled || activity.busy} value={activity.background} onValueChange={value => void activity.setBackgroundRecording(value)} trackColor={trackColor} thumbColor="#FFFFFF" />} />
    <SettingRow icon="people" title="Share my activity" subtitle={hasSpace ? 'Share new history with current space members when location sharing is on' : 'Sign in and join a space to share activity history'} trailing={<Switch accessibilityLabel="Share my activity" disabled={!hasSpace || !activity.enabled || activity.busy} value={activity.sharingHistory} onValueChange={value => void activity.shareHistory(value)} trackColor={trackColor} thumbColor="#FFFFFF" />} />
  </View><Text style={[ui.caption, { fontSize: 10, lineHeight: 16 }]}>History sharing starts with new samples. Turn it off to hide shared history from space members. Pausing GPS stops new recording.</Text></View>;
}
