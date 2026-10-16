import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { avatarBackgrounds, avatarFaces, isAvatarId, type AvatarId } from '../lib/avatars';
import { colors } from '../theme';
import { Avatar, Button, ui } from './Ui';

type Props = {
  value: string | null;
  photoURL?: string | null;
  name: string;
  onSave: (id: string | null) => Promise<void>;
  onCancel: () => void;
  saving?: boolean;
  error?: string | null;
};

export function AvatarEditor({ value, photoURL, name, onSave, onCancel, saving = false, error }: Props) {
  const [draft, setDraft] = useState<AvatarId>(isAvatarId(value) ? value : 'face-1-blue');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { setDraft(isAvatarId(value) ? value : 'face-1-blue'); setSaveError(null); }, [value]);
  const [, face, background] = draft.split('-');
  const disabled = saving || busy;

  async function save(id: string | null) {
    if (disabled) return;
    setBusy(true); setSaveError(null);
    try { await onSave(id); }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'Your avatar could not be saved. Please try again.'); }
    finally { setBusy(false); }
  }

  return <View style={styles.section}>
    <View style={styles.preview}><Avatar device={{ name, photoURL: photoURL ?? null, avatarId: draft }} size={108} /><Text style={styles.previewName}>{name}</Text><Text style={ui.caption}>Make it yours. Your avatar appears on your map and in your space.</Text></View>
    <Text style={ui.sectionLabel}>Choose a face</Text>
    <View style={styles.faces}>{avatarFaces.map(item => {
      const selected = String(item.id) === face;
      return <Pressable key={item.id} disabled={disabled} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected, disabled }} onPress={() => setDraft(`face-${item.id}-${background}` as AvatarId)} style={({ pressed }) => [styles.face, selected && styles.selected, pressed && ui.pressed]}>
        <Avatar device={{ name: item.label, photoURL: null, avatarId: `face-${item.id}-${background}` }} size={52} />
        <Text style={[styles.faceLabel, selected && { color: colors.blueLight }]}>{item.label}</Text>
      </Pressable>;
    })}</View>
    <Text style={ui.sectionLabel}>Background color</Text>
    <View style={styles.backgrounds}>{avatarBackgrounds.map(item => <Pressable key={item.id} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${item.label} background`} accessibilityState={{ selected: background === item.id, disabled }} onPress={() => setDraft(`face-${face}-${item.id}` as AvatarId)} style={({ pressed }) => [styles.swatchButton, background === item.id && styles.selected, pressed && ui.pressed]}><View style={[styles.swatch, { backgroundColor: item.color }]} /><Text style={styles.colorLabel}>{item.label}</Text></Pressable>)}</View>
    {(error || saveError) && <View style={ui.error}><Text style={ui.errorText}>{error || saveError}</Text></View>}
    <Button title="Save avatar" icon="check" busy={disabled} onPress={() => void save(draft)} />
    <Button secondary title={photoURL ? 'Use Google photo' : 'Reset avatar'} disabled={disabled} onPress={() => void save(null)} />
    <Button secondary title="Cancel" disabled={disabled} onPress={onCancel} />
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 15 },
  preview: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  previewName: { color: colors.ink, fontSize: 17, fontWeight: '600' },
  faces: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  face: { width: '23%', minWidth: 65, flexGrow: 1, alignItems: 'center', gap: 8, paddingHorizontal: 3, paddingVertical: 10, borderWidth: 2, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.surface },
  selected: { borderColor: colors.blueLight, backgroundColor: '#102C46' },
  faceLabel: { color: colors.muted, fontSize: 10, textAlign: 'center' },
  backgrounds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatchButton: { flexGrow: 1, alignItems: 'center', gap: 7, padding: 8, borderWidth: 2, borderColor: colors.line, borderRadius: 12 },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  colorLabel: { color: colors.muted, fontSize: 10 },
});
