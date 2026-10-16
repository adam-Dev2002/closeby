import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme';
import type { LocationFix } from '../types';
import { Icon } from './Icon';
import { Button, EmptyState, Field, ui } from './Ui';

export type EmergencyComposerProps = {
  ownerName: string;
  isOwner: boolean;
  hasSpace: boolean;
  location: LocationFix | null;
  sending: boolean;
  error: string | null;
  onSend: (audience: 'owner' | 'everyone', note: string, includeLocation: boolean) => void;
  onAccount?: () => void;
  onDraftChange?: () => void;
};

function locationAge(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function EmergencyComposer({ ownerName, isOwner, hasSpace, location, sending, error, onSend, onAccount, onDraftChange }: EmergencyComposerProps) {
  const [audience, setAudience] = useState<'owner' | 'everyone'>(isOwner ? 'everyone' : 'owner');
  const [note, setNote] = useState('');
  const [includeLocation, setIncludeLocation] = useState(Boolean(location));
  const [, refreshAge] = useState(0);
  useEffect(() => { if (isOwner) setAudience('everyone'); }, [isOwner]);
  useEffect(() => { if (!location) setIncludeLocation(false); }, [location]);
  useEffect(() => {
    if (!location) return;
    const timer = setInterval(() => refreshAge(value => value + 1), 15000);
    return () => clearInterval(timer);
  }, [location]);

  if (!hasSpace) return <EmptyState icon="alert" title="Emergency alerts need a space"
    detail="Sign in and create or join a space to send an emergency alert to its owner or everyone in it.">
    {onAccount && <Button title="Create or join a space" icon="people" onPress={onAccount} />}
  </EmptyState>;

  const recipient = audience === 'owner' ? (ownerName || 'Space owner') : 'Everyone in this space';
  const oldLocation = location && Date.now() - location.timestamp > 120000;
  return <View style={styles.content}>
    <Text style={ui.body}>Choose who should receive your emergency alert.</Text>
    <View style={styles.audiences}>
      {(['owner', 'everyone'] as const).map(option => {
        const selected = audience === option;
        const disabled = sending || (option === 'owner' && isOwner);
        return <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }}
          accessibilityLabel={option === 'owner' ? 'Send to space owner' : 'Send to everyone in this space'} disabled={disabled}
          onPress={() => { setAudience(option); onDraftChange?.(); }} style={({ pressed }) => [styles.audience, selected && styles.selected,
            option === 'owner' && isOwner && styles.disabled, pressed && ui.pressed]}>
          <Icon name={option === 'owner' ? 'user' : 'people'} size={23} color={selected ? colors.blueLight : colors.muted} />
          <Text style={styles.audienceTitle}>{option === 'owner' ? 'Space owner' : 'Everyone'}</Text>
          <Text style={styles.audienceDetail}>{option === 'owner' ? (isOwner ? 'You own this space' : ownerName || 'Owner only') : 'All space members'}</Text>
        </Pressable>;
      })}
    </View>
    <Field label="Message (optional)" placeholder="Tell them what help you need…" value={note}
      onChangeText={value => { setNote(value); onDraftChange?.(); }} maxLength={500} multiline numberOfLines={3} editable={!sending}
      style={styles.note} textAlignVertical="top" />
    <Text style={[ui.caption, styles.count]}>{note.length}/500</Text>
    <View style={[ui.card, styles.locationCard]}>
      <View style={ui.between}>
        <View style={styles.locationTitle}>
          <Icon name="pin" color={colors.blueLight} size={21} />
          <Text style={[ui.rowTitle, styles.flexText]}>Include my GPS location</Text>
        </View>
        <Switch accessibilityLabel="Include my GPS location with this emergency alert" value={Boolean(location) && includeLocation}
          onValueChange={value => { setIncludeLocation(value); onDraftChange?.(); }} disabled={sending || !location}
          trackColor={{ false: '#2A3F56', true: '#167CD8' }} thumbColor={colors.ink} />
      </View>
      {location ? <>
        <Text style={ui.caption}>GPS fix {locationAge(location.timestamp)} · {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</Text>
        {oldLocation && <Text style={styles.locationWarning}>This is an older GPS position. Open the map to get a fresh fix.</Text>}
        <Text style={ui.body}>{includeLocation
          ? 'Your coordinates will be sent with this alert, even if normal location sharing is paused.'
          : 'This alert will be sent without your coordinates.'}</Text>
      </> : <Text style={ui.body}>No GPS position available. You can still send an alert. Enable GPS on the map if you want to include your location.</Text>}
    </View>
    <Text style={ui.body}>Recipient: <Text style={styles.recipient}>{recipient}</Text></Text>
    {error && <View style={ui.error} accessibilityLiveRegion="polite"><Text style={ui.errorText}>{error}</Text></View>}
    <Button title={sending ? 'Waiting for connection…' : 'Send emergency alert'} icon="alert" danger busy={sending}
      onPress={() => { if (!sending) onSend(isOwner ? 'everyone' : audience, note.trim(), Boolean(location) && includeLocation); }} />
    <Text style={ui.caption}>Recipients hear a ring and feel a vibration while Closeby is open. Opening or dismissing the alert stops the ring. This does not contact emergency services.</Text>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 14 },
  audiences: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  audience: { flex: 1, minWidth: 0, minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 12 },
  selected: { backgroundColor: '#102B45', borderColor: colors.blue },
  disabled: { opacity: 0.5 },
  audienceTitle: { color: colors.ink, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  audienceDetail: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  note: { minHeight: 96 },
  count: { textAlign: 'right', marginTop: -9 },
  locationCard: { padding: 14, gap: 10 },
  locationTitle: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 9, minWidth: 0 },
  flexText: { flex: 1 },
  locationWarning: { color: '#F8CF92', fontSize: 12, lineHeight: 19 },
  recipient: { color: colors.ink, fontWeight: '600' },
});
