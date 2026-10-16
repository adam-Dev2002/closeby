import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { randomUuid } from '../lib/uuid';
import { LiveMap } from '../components/LiveMap';
import type { MapType } from '../lib/mapModel';
import { Icon } from '../components/Icon';
import { Button, Field, RoundButton, ui } from '../components/Ui';
import { useAppDialog } from '../components/AppDialog';
import { colors } from '../theme';
import type { Coordinate, DeviceProfile, SafeZone } from '../types';

const zoneColors = ['#1186FF', '#43CF78', '#9561E8', '#ED4E55'];
const point = (value: Coordinate): Coordinate => ({ latitude: value.latitude, longitude: value.longitude });

export function GeofenceScreen({ device, zones, mapType, onBack, onSave, onDelete, onEnable }: {
  device: DeviceProfile; zones: SafeZone[]; mapType?: MapType; onBack: () => void;
  onSave: (zone: SafeZone) => Promise<void>; onDelete: (id: string) => Promise<void>; onEnable: () => void;
}) {
  const dialog = useAppDialog();
  const [id, setId] = useState<string | null>(zones[0]?.id ?? null);
  const [name, setName] = useState(zones[0]?.name ?? '');
  const [description, setDescription] = useState(zones[0]?.description ?? '');
  const [radius, setRadius] = useState(zones[0]?.radius ?? 200);
  const [color, setColor] = useState(zones[0]?.color ?? zoneColors[0]!);
  const [enabled, setEnabled] = useState(zones[0]?.enabled ?? true);
  const [coordinate, setCoordinate] = useState<Coordinate | null>(zones[0]?.coordinate ?? (device.location ? point(device.location) : null));
  const [advanced, setAdvanced] = useState(false);
  const [recenterKey, setRecenterKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const mutation = useRef(false);

  // Adopt the first available GPS fix only. A chosen pin stays where it was placed.
  useEffect(() => { if (!coordinate && device.location) setCoordinate(point(device.location)); }, [coordinate, device.location]);
  const draft: SafeZone | null = coordinate ? { id: id ?? 'new-zone', name: name.trim() || 'Choose a name', description: description.trim(), coordinate, radius, color, enabled } : null;
  function chooseLocation(value: Coordinate, placeName?: string) {
    if (mutation.current) return;
    setCoordinate(point(value));
    if (placeName && !name.trim()) setName(placeName.slice(0, 60));
    setRecenterKey(value => value + 1);
  }
  function select(zone: SafeZone) {
    if (mutation.current) return;
    setId(zone.id); setName(zone.name); setDescription(zone.description ?? ''); setRadius(zone.radius);
    setColor(zone.color); setEnabled(zone.enabled); setCoordinate(point(zone.coordinate)); setRecenterKey(value => value + 1);
  }
  function create() {
    if (mutation.current) return;
    setId(null); setName(''); setDescription(''); setRadius(200); setColor(zoneColors[0]!); setEnabled(true); setAdvanced(false);
    setCoordinate(device.location ? point(device.location) : coordinate); setRecenterKey(value => value + 1);
  }
  async function save() {
    if (mutation.current) return;
    if (!coordinate || !name.trim()) {
      dialog.alert('Name your pinned place', 'Tap a location on the map and give it a name, such as Home, School, or Work. GPS is optional when choosing a place on the map.');
      return;
    }
    mutation.current = true; setSaving(true);
    const zone: SafeZone = { id: id ?? randomUuid(), name: name.trim(), description: description.trim(), coordinate: point(coordinate), radius, color, enabled };
    try {
      await onSave(zone); setId(zone.id);
      dialog.alert(`${zone.name} saved`, `${zone.description ? zone.description + '\n\n' : ''}Your safe zone is pinned at the selected location.${enabled ? ' Keep GPS active for arrival and departure alerts. Enable phone alerts in Settings to receive them in the background.' : ' Alerts for this place are paused.'}`);
    } catch (error) { dialog.alert('Could not save zone', error instanceof Error ? error.message : 'Please try again.'); }
    finally { mutation.current = false; setSaving(false); }
  }
  function remove() {
    if (!id || mutation.current) return;
    const deletingId = id, deletingName = name.trim() || 'this safe zone';
    dialog.alert(`Delete ${deletingName}?`, 'This removes the pinned place and its alerts from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete safe zone', style: 'destructive', onPress: async () => {
        mutation.current = true; setSaving(true);
        try { await onDelete(deletingId); mutation.current = false; create(); }
        catch (error) { dialog.alert('Could not delete zone', error instanceof Error ? error.message : 'Please try again.'); }
        finally { mutation.current = false; setSaving(false); }
      } },
    ]);
  }

  return <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}><RoundButton small disabled={saving} icon="back" label="Back from geofence" onPress={onBack} /><Text style={styles.headerTitle}>Safe places</Text><RoundButton small disabled={saving} icon="plus" label="New safe zone" onPress={create} /></View>
    <View style={styles.map}>
      <LiveMap style={{ flex: 1, height: '100%', minHeight: 0 }} devices={[]} selectedId="" onSelect={() => {}}
        location={device.location} focusCoordinate={coordinate} recenterKey={recenterKey} route={[]} mapType={mapType}
        zones={[...zones.filter(zone => zone.id !== id), ...(draft ? [draft] : [])]} showZoneBoundaries={advanced && enabled}
        onMapPress={chooseLocation} onPlacePress={chooseLocation} onZoneSelect={zoneId => { const zone = zones.find(item => item.id === zoneId); if (zone) select(zone); }} />
      <View pointerEvents="none" style={styles.mapHint}><Text style={styles.hintText}>Tap a spot or a place on the map to pin your safe zone</Text></View>
    </View>
    <ScrollView style={styles.editor} contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {zones.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{zones.map(zone => <Pressable key={zone.id} disabled={saving} accessibilityRole="button" accessibilityLabel={`Edit ${zone.name}`} accessibilityState={{ selected: id === zone.id }} onPress={() => select(zone)} style={[styles.zoneChip, id === zone.id && { borderColor: zone.color }]}><Icon name="pin" size={14} color={zone.color} /><Text style={styles.chipText}>{zone.name}</Text></Pressable>)}</ScrollView>}
      <View style={ui.between}><Text style={styles.editorTitle}>{id ? 'Edit pinned place' : 'Name this place'}</Text>{id && <RoundButton small disabled={saving} icon="trash" label="Delete safe zone" onPress={remove} />}</View>
      <View style={styles.locationCard}><Icon name="pin" size={22} color={color} /><View style={{ flex: 1, gap: 4 }}><Text style={styles.locationTitle}>{coordinate ? name.trim() || 'Pinned location' : 'Choose a location on the map'}</Text><Text style={ui.caption}>{coordinate ? `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}` : 'Pan and zoom to find any place. No GPS required.'}</Text></View></View>
      <Field label="Zone name" value={name} editable={!saving} onChangeText={setName} placeholder="Home, school, work…" maxLength={60} />
      <Field label="Description (optional)" value={description} editable={!saving} onChangeText={setDescription} placeholder="My home, parents’ house, school entrance…" maxLength={240} multiline style={{ minHeight: 72, textAlignVertical: 'top' }} />
      <Button secondary title="Use my current location" icon="target" disabled={saving} onPress={() => device.location ? chooseLocation(device.location) : onEnable()} />
      <View style={ui.between}><View style={{ flex: 1, gap: 4 }}><Text style={styles.locationTitle}>Arrival & departure alerts</Text><Text style={ui.caption}>Use this pinned place for entry and exit updates.</Text></View><Switch disabled={saving} accessibilityLabel="Arrival and departure alerts" value={enabled} onValueChange={setEnabled} trackColor={{ false: '#314259', true: colors.blue }} thumbColor="#FFFFFF" /></View>
      {enabled && <Pressable disabled={saving} accessibilityRole="button" accessibilityLabel="Adjust arrival alert distance" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(value => !value)} style={ui.between}><Text style={styles.link}>Adjust arrival alert distance</Text><Icon name={advanced ? 'close' : 'chevron'} size={14} color={colors.blueLight} /></Pressable>}
      {advanced && enabled && <View style={styles.distanceCard}><Text style={styles.locationTitle}>Within {radius} m of the pin</Text><Text style={ui.caption}>This distance allows for GPS uncertainty when detecting arrivals. Your selected pin stays in the same place.</Text><Slider disabled={saving} accessibilityLabel="Arrival alert distance" minimumValue={25} maximumValue={Math.max(1000, zones.find(zone => zone.id === id)?.radius ?? 1000)} step={25} value={radius} onValueChange={setRadius} minimumTrackTintColor={color} maximumTrackTintColor="#26384D" thumbTintColor={color} /></View>}
      <View style={styles.colorRow}>{zoneColors.map(item => <Pressable key={item} disabled={saving} onPress={() => setColor(item)} accessibilityRole="button" accessibilityLabel={`Zone color ${item}`} accessibilityState={{ selected: item === color }} style={[styles.colorButton, { backgroundColor: item }, item === color && styles.selectedColor]}>{item === color && <Icon name="check" size={15} />}</Pressable>)}</View>
    </ScrollView>
    <View style={styles.footer}><Button title={id ? 'Save changes' : 'Save safe zone'} busy={saving} onPress={() => void save()} /><Text style={[ui.caption, { textAlign: 'center', fontSize: 10 }]}>Safe places stay on this device. Enable background arrival alerts in Settings.</Text></View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  header: { padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  map: { flex: 1, minHeight: 150 },
  editor: { maxHeight: '50%', backgroundColor: '#0A141E', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: colors.line },
  editorContent: { padding: 18, gap: 16, paddingBottom: 28 },
  footer: { paddingHorizontal: 18, paddingVertical: 12, gap: 8, backgroundColor: '#0A141E', borderTopWidth: 1, borderColor: colors.line },
  editorTitle: { color: colors.ink, fontSize: 17, fontWeight: '600' },
  locationCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.surface, padding: 12 },
  locationTitle: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  link: { color: colors.blueLight, fontSize: 12, paddingVertical: 5 },
  distanceCard: { padding: 13, gap: 8, backgroundColor: colors.surface, borderRadius: 14 },
  colorRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 3 },
  colorButton: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: '#FFFFFF50', alignItems: 'center', justifyContent: 'center' },
  selectedColor: { borderWidth: 2, borderColor: '#CAE6FF' },
  zoneChip: { paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 15, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { color: colors.ink, fontSize: 11 },
  mapHint: { position: 'absolute', top: 10, left: 15, right: 15, alignItems: 'center' },
  hintText: { backgroundColor: '#0D1928E8', padding: 9, borderRadius: 15, color: '#B9CEE8', fontSize: 11, textAlign: 'center' },
});
