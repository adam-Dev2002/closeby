import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Icon, type IconName } from './Icon';
import { avatarSvg, isAvatarId } from '../lib/avatars';
import { colors } from '../theme';
import type { DeviceProfile } from '../types';

export function Button({ title, onPress, icon, secondary, danger, disabled, busy }: {
  title: string; onPress: () => void; icon?: IconName; secondary?: boolean; danger?: boolean; disabled?: boolean; busy?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [ui.button, secondary && ui.secondary, danger && ui.danger, (disabled || busy) && ui.disabled, pressed && ui.pressed]}>
    {busy ? <ActivityIndicator color={colors.ink} size="small" /> : icon ? <Icon name={icon} size={19} color={secondary ? colors.blueLight : colors.ink} /> : null}
    <Text style={[ui.buttonText, secondary && { color: colors.blueLight }]}>{title}</Text>
  </Pressable>;
}

export function RoundButton({ icon, onPress, label, active, small, disabled }: { icon: IconName; onPress: () => void; label: string; active?: boolean; small?: boolean; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    style={({ pressed }) => [ui.round, small && { width: 36, height: 36 }, active && { backgroundColor: '#0B3055', borderColor: colors.blue }, disabled && { opacity: .3 }, pressed && ui.pressed]}>
    <Icon name={icon} color={active ? colors.blueLight : colors.ink} size={small ? 18 : 21} />
  </Pressable>;
}

export function Avatar({ device, size = 42, onLoadEnd }: { device: Pick<DeviceProfile, 'photoURL' | 'name' | 'avatarId'>; size?: number; onLoadEnd?: () => void }) {
  const avatarId = isAvatarId(device.avatarId) ? device.avatarId : null;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const ready = useRef(onLoadEnd); ready.current = onLoadEnd;
  const photoURL = !avatarId && typeof device.photoURL === 'string' && /^https?:\/\//i.test(device.photoURL) ? device.photoURL : null;
  const photoFailed = Boolean(photoURL && failedPhoto === photoURL);
  useEffect(() => { if (avatarId || !photoURL || photoFailed) ready.current?.(); }, [avatarId, photoURL, photoFailed]);
  // The SVG already clips its portrait to a circle. A second native overflow
  // clip can hide the SVG when Android draws it into a map marker bitmap.
  if (avatarId) return <View collapsable={onLoadEnd ? false : undefined} onLayout={onLoadEnd ? () => ready.current?.() : undefined} style={{ width: size, height: size }} accessibilityLabel={`${device.name} avatar`}><SvgXml xml={avatarSvg(avatarId)} width={size} height={size} /></View>;
  return <View collapsable={onLoadEnd ? false : undefined} onLayout={onLoadEnd ? () => ready.current?.() : undefined} style={[ui.avatar, { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }]} accessibilityLabel={`${device.name || 'Member'} avatar`}>
    <Icon name="user" size={size * 0.48} color="#BCD0E8" />
    {photoURL && !photoFailed && <Image source={{ uri: photoURL }} accessibilityLabel={`${device.name} photo`} fadeDuration={0} onError={() => setFailedPhoto(photoURL)} onLoadEnd={() => ready.current?.()} style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2 }} />}
  </View>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 8 }}><Text style={ui.fieldLabel}>{label}</Text><TextInput {...props} accessibilityLabel={label}
    placeholderTextColor="#617891" style={[ui.field, props.style]} /></View>;
}

export function SettingRow({ icon, title, subtitle, onPress, trailing, color }: { icon: IconName; title: string; subtitle?: string; onPress?: () => void; trailing?: ReactNode; color?: string }) {
  const content = <>
    <Icon name={icon} size={22} color={color ?? '#C5D6EE'} />
    <View style={{ flex: 1, gap: 4 }}><Text style={[ui.rowTitle, color ? { color } : undefined]}>{title}</Text>{subtitle && <Text style={ui.caption}>{subtitle}</Text>}</View>
    {trailing ?? (onPress ? <Icon name="chevron" size={16} color={colors.muted} /> : null)}
  </>;
  if (!onPress) return <View style={ui.settingRow}>{content}</View>;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
    style={({ pressed }) => [ui.settingRow, pressed && ui.pressed]}>{content}</Pressable>;
}

export function EmptyState({ icon, title, detail, children }: { icon: IconName; title: string; detail: string; children?: ReactNode }) {
  return <View style={ui.empty}><View style={ui.emptyIcon}><Icon name={icon} size={28} color={colors.blueLight} /></View>
    <Text style={ui.emptyTitle}>{title}</Text><Text style={[ui.body, { textAlign: 'center' }]}>{detail}</Text>{children}</View>;
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 28, gap: 18 },
  title: { color: colors.ink, fontSize: 21, fontWeight: '700', letterSpacing: -0.5 },
  body: { fontSize: 13, lineHeight: 21, color: colors.muted },
  caption: { fontSize: 11, lineHeight: 17, color: colors.muted },
  sectionLabel: { fontSize: 13, fontWeight: '500', color: '#AEC4E0', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  button: { minHeight: 49, padding: 13, borderRadius: 13, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  secondary: { backgroundColor: '#10253B', borderWidth: 1, borderColor: '#23466A' },
  danger: { backgroundColor: '#CE3543' },
  buttonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.68 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#344A63', backgroundColor: '#0C1824ED', alignItems: 'center', justifyContent: 'center' },
  avatar: { backgroundColor: '#25394F', borderColor: '#4A6483', borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontSize: 12, fontWeight: '500', color: '#B9CDE6' },
  field: { backgroundColor: '#0D1A27', borderWidth: 1, borderColor: '#2A3F56', borderRadius: 12, minHeight: 49, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink, fontSize: 14 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 16, minHeight: 67, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A3A4E' },
  rowTitle: { color: colors.ink, fontSize: 13, fontWeight: '500' },
  empty: { alignItems: 'center', padding: 24, gap: 14 },
  emptyIcon: { width: 66, height: 66, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0E263E', marginBottom: 3 },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  error: { backgroundColor: '#321920', borderColor: '#66303C', borderWidth: 1, padding: 13, borderRadius: 12 },
  errorText: { color: '#FFB8BD', fontSize: 12, lineHeight: 19 },
});
