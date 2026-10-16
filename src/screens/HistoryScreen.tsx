import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivitySettings } from '../components/ActivitySettings';
import { Icon } from '../components/Icon';
import { LiveMap } from '../components/LiveMap';
import { RoutePreview } from '../components/RoutePreview';
import { Avatar, Button, EmptyState, RoundButton, ui } from '../components/Ui';
import type { useActivityHistory } from '../hooks/useActivityHistory';
import { activityTimeline, clock, dateKey, dayRange, duration, recentDays } from '../lib/activity';
import type { MapType } from '../lib/mapModel';
import { colors } from '../theme';
import type { ActivityEntry, DeviceProfile, LocationFix, RecordedTrip } from '../types';

type Props = {
  devices: DeviceProfile[]; selectedId: string; onSelect: (id: string) => void; ownId: string;
  day: string; onDay: (day: string) => void; activity: ReturnType<typeof useActivityHistory>; hasSpace: boolean;
  mapType: MapType; trips: RecordedTrip[]; activeTrip: boolean; route: LocationFix[];
  onRecord: () => void; onEnd: () => void; onViewTrip: (trip: RecordedTrip) => void; onClear: () => void;
};

function Calendar({ day, onDay, onClose }: { day: string; onDay: (day: string) => void; onClose: () => void }) {
  const [month, setMonth] = useState(() => { const date = new Date(dayRange(day).start); date.setDate(1); return date; });
  const allowed = new Set(recentDays()), today = new Date();
  const offset = month.getDay(), count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const earliest = new Date(dayRange([...allowed].at(-1)!).start);
  function change(delta: number) { setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1)); }
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}><View style={styles.modal}><Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Dismiss calendar" onPress={onClose} /><SafeAreaView style={styles.calendar} accessibilityViewIsModal>
    <View style={ui.between}><Text accessibilityRole="header" style={ui.title}>Select a date</Text><RoundButton small icon="close" label="Close calendar" onPress={onClose} /></View>
    <View style={ui.between}><RoundButton small icon="back" label="Previous month" disabled={month.getTime() <= new Date(earliest.getFullYear(), earliest.getMonth(), 1).getTime()} onPress={() => change(-1)} /><Text style={styles.heading}>{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</Text><RoundButton small icon="chevron" label="Next month" disabled={month.getTime() >= new Date(today.getFullYear(), today.getMonth(), 1).getTime()} onPress={() => change(1)} /></View>
    <View><View style={styles.calendarRow}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((name, i) => <View key={`week-${i}`} style={styles.cell}><Text style={ui.caption}>{name}</Text></View>)}</View>{Array.from({ length: Math.ceil((offset + count) / 7) }, (_, row) => <View key={row} style={styles.calendarRow}>{Array.from({ length: 7 }, (_, column) => {
      const index = row * 7 + column;
      if (index < offset || index >= offset + count) return <View key={`blank-${index}`} style={styles.cell} />;
      const date = new Date(month.getFullYear(), month.getMonth(), index - offset + 1), key = dateKey(date.getTime()), enabled = allowed.has(key);
      return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Select ${date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}`} accessibilityState={{ selected: day === key, disabled: !enabled }} disabled={!enabled} onPress={() => { onDay(key); onClose(); }} style={[styles.cell, day === key && styles.chosenCell, !enabled && { opacity: .25 }]}><Text style={styles.dateNumber}>{date.getDate()}</Text></Pressable>;
    })}</View>)}</View><Text style={ui.caption}>Browse the last 30 days. Dates without recorded locations stay empty.</Text>
  </SafeAreaView></View></Modal>;
}

export function HistoryScreen({ devices, selectedId, onSelect, ownId, day, onDay, activity, hasSpace, mapType, trips, activeTrip, route, onRecord, onEnd, onViewTrip, onClear }: Props) {
  const [calendar, setCalendar] = useState(false), [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const device = devices.find(item => item.id === selectedId) ?? devices[0]!;
  const own = device.id === ownId;
  const timeline = useMemo(() => activityTimeline(activity.samples), [activity.samples]);
  const chosen = timeline.entries.find(item => item.id === selectedEvent);
  const segments = chosen ? chosen.points.length ? [chosen.points] : [] : timeline.routes;
  const visibleTrips = own ? trips.filter(trip => trip.points.some(fix => dateKey(fix.timestamp) === day)) : [];
  function selectDay(value: string) { setSelectedEvent(null); onDay(value); }
  function label(entry: ActivityEntry) { return entry.kind === 'stop' ? entry.place ? `Stopped at ${entry.place}` : 'Stopped' : entry.kind === 'gap' ? 'Tracking gap' : entry.points.length < 2 ? 'Location recorded' : 'Moving'; }
  return <ScrollView style={ui.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={ui.between}><View style={{ gap: 5 }}><Text accessibilityRole="header" style={ui.title}>History & Activity</Text><Text style={ui.caption}>Routes, stops, and travel time.</Text></View><RoundButton small icon="calendar" label="Choose history date" onPress={() => setCalendar(true)} /></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{devices.map(member => <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`View ${member.name} activity`} accessibilityState={{ selected: member.id === device.id }} onPress={() => { setSelectedEvent(null); onSelect(member.id); }} style={[styles.memberChip, member.id === device.id && styles.selected]}><Avatar device={member} size={27} /><Text numberOfLines={1} style={styles.memberName}>{member.id === ownId ? 'My activity' : member.name}</Text></Pressable>)}</ScrollView>
    <View style={styles.week}>{recentDays().slice(0, 7).reverse().map(key => { const date = new Date(dayRange(key).start); return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`History for ${date.toLocaleDateString([], { month: 'long', day: 'numeric' })}`} accessibilityState={{ selected: key === day }} onPress={() => selectDay(key)} style={[styles.dayChip, key === day && styles.selected]}><Text style={styles.weekday}>{date.toLocaleDateString([], { weekday: 'short' })}</Text><Text style={styles.dateNumber}>{date.getDate()}</Text></Pressable>; })}</View>
    <View style={ui.between}><Text accessibilityRole="header" style={styles.heading}>{day === dateKey() ? 'Today' : new Date(dayRange(day).start).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}</Text><Text numberOfLines={1} style={[ui.caption, { flexShrink: 1 }]}>{device.name}</Text></View>
    {activity.error && <View style={ui.error}><Text accessibilityRole="alert" style={ui.errorText}>{activity.error}</Text></View>}
    {activity.loading ? <ActivityIndicator color={colors.blueLight} accessibilityLabel="Loading activity history" /> : !activity.canView ? <View style={ui.card}><EmptyState icon="lock" title="History is private" detail="This member can enable Share my activity in their settings. A current shared location does not grant access to past routes." /></View> : activity.samples.length ? <>
      <View style={styles.stats}>{[[`${(timeline.distanceMeters / 1000).toFixed(2)} km`, 'Observed distance'], [duration(timeline.observedMs), 'Recorded time'], [String(timeline.entries.filter(item => item.kind === 'stop').length), 'Stops']].map(([value, title]) => <View key={title} style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={[ui.caption, { fontSize: 10 }]}>{title}</Text></View>)}</View>
      <View style={styles.dayMap}><LiveMap key={`${device.id}-${day}-${chosen?.id ?? 'all'}`} style={{ height: '100%', minHeight: 0 }} devices={chosen?.kind === 'stop' ? [{ ...device, location: chosen.points[0]!, name: chosen.place ?? device.name }] : []} selectedId={device.id} onSelect={() => {}} location={null} route={[]} routeSegments={segments} zones={[]} mapType={mapType} /></View>
      <View style={ui.between}><Text style={styles.heading}>{chosen ? label(chosen) : 'Daily route'}</Text>{chosen && <Pressable accessibilityRole="button" accessibilityLabel="Show entire day route" onPress={() => setSelectedEvent(null)}><Text style={styles.link}>Entire day</Text></Pressable>}</View><Text style={ui.caption}>Tap an activity to inspect its recorded route. Gaps stay separate.</Text>
      {activity.truncated && <Text style={styles.notice}>This day reached the storage limit; earlier activity may be missing.</Text>}
      <Text accessibilityRole="header" style={styles.heading}>Activity timeline</Text><View style={{ gap: 8 }}>{timeline.entries.map(entry => <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={`${label(entry)} at ${clock(entry.startedAt)}`} onPress={() => setSelectedEvent(entry.id)} style={[styles.event, selectedEvent === entry.id && styles.selected]}><Icon name={entry.kind === 'stop' ? 'pin' : entry.kind === 'gap' ? 'pause' : 'navigate'} color="#93A7FF" size={20} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.eventTitle}>{label(entry)}</Text><Text style={ui.caption}>{clock(entry.startedAt)} – {clock(entry.endedAt)} · {duration(entry.endedAt - entry.startedAt)}{entry.kind === 'move' ? ` · ${(entry.distanceMeters / 1000).toFixed(2)} km` : ''}</Text>{entry.kind === 'stop' && <><Text style={styles.detail}>Arrival observed: {clock(entry.startedAt)}</Text><Text style={styles.detail}>{entry.departed ? `Departure observed: ${clock(entry.endedAt)}` : 'Departure not observed'}</Text>{!entry.place && <Text style={styles.detail}>{entry.points[0]!.latitude.toFixed(5)}, {entry.points[0]!.longitude.toFixed(5)}</Text>}</>}{entry.kind === 'gap' && <Text style={styles.detail}>No recorded locations during this interval.</Text>}</View><Icon name="chevron" size={14} color={colors.muted} /></Pressable>)}</View><Text style={styles.note}>Stops use at least two minutes of nearby GPS readings. Arrival and departure times are estimates. Unrecorded intervals are excluded from distance and duration.</Text>
    </> : <View style={ui.card}><EmptyState icon="history" title="No activity on this date" detail={own ? activity.enabled ? 'New GPS locations are saved automatically while recording is active.' : 'Enable Save my activity below to record routes and stops automatically.' : 'No shared locations were recorded on this date. History starts after this member chooses to share it.'} /></View>}
    {own && <><Text accessibilityRole="header" style={styles.heading}>Recording preferences</Text><ActivitySettings activity={activity} hasSpace={hasSpace} /><View style={ui.between}><Text accessibilityRole="header" style={styles.heading}>Recorded trips</Text>{trips.length > 0 && <RoundButton small icon="trash" label="Clear recorded trip history" onPress={onClear} />}</View>{activeTrip && <View style={styles.recording}><Text style={styles.eventTitle}>Recording a trip · {route.length} GPS points</Text><Button secondary title="End & save trip" icon="stop" onPress={onEnd} /></View>}{visibleTrips.map(trip => <Pressable key={trip.id} accessibilityRole="button" accessibilityLabel={`View recorded trip at ${clock(trip.startedAt)}`} onPress={() => onViewTrip(trip)} style={styles.event}><RoutePreview points={trip.points} width={65} height={65} /><View style={{ flex: 1, gap: 7 }}><Text style={styles.eventTitle}>{clock(trip.startedAt)} – {clock(trip.endedAt)}</Text><Text style={ui.caption}>{(trip.distanceMeters / 1000).toFixed(2)} km · {duration(trip.endedAt - trip.startedAt)}</Text></View><Icon name="chevron" size={15} /></Pressable>)}{!activeTrip && <Button title="Record a trip manually" icon="record" secondary onPress={onRecord} />}<Text style={styles.note}>Manual trips record while the app is open and stay on this phone. Shared activity contains only new locations recorded after history sharing is enabled.</Text></>}
    {calendar && <Calendar day={day} onDay={selectDay} onClose={() => setCalendar(false)} />}
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 30, gap: 17 }, heading: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  memberChip: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 9, paddingRight: 13, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, maxWidth: 190 }, selected: { backgroundColor: '#172D50', borderColor: '#6D8BDF' }, memberName: { color: colors.ink, fontSize: 11, flexShrink: 1 },
  week: { flexDirection: 'row', gap: 5 }, dayChip: { flex: 1, minWidth: 0, minHeight: 62, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }, weekday: { color: colors.muted, fontSize: 9 }, dateNumber: { color: colors.ink, fontSize: 15 },
  stats: { flexDirection: 'row', gap: 8 }, stat: { flex: 1, alignItems: 'center', gap: 6, padding: 12, paddingHorizontal: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 12 }, statValue: { color: colors.ink, fontSize: 14, fontWeight: '600' }, dayMap: { height: 290, borderWidth: 1, borderColor: colors.line, borderRadius: 17, overflow: 'hidden' }, link: { color: '#93A7FF', fontSize: 11 },
  event: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }, recording: { gap: 14, padding: 14, backgroundColor: colors.surface, borderRadius: 14 }, eventTitle: { color: colors.ink, fontSize: 13, fontWeight: '600' }, detail: { color: colors.muted, fontSize: 10, lineHeight: 16 }, note: { color: colors.muted, fontSize: 10, lineHeight: 17 }, notice: { color: '#E6C399', fontSize: 11, lineHeight: 17 },
  modal: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 18, backgroundColor: '#000A' }, calendar: { width: '100%', maxWidth: 420, backgroundColor: '#101A2C', padding: 17, borderRadius: 20, gap: 20, borderWidth: 1, borderColor: colors.line }, calendarRow: { flexDirection: 'row' }, cell: { flex: 1, minWidth: 0, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, chosenCell: { backgroundColor: '#345493' },
});
