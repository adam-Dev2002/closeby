import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { AuthUser } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Avatar, Button, EmptyState, RoundButton, ui } from '../components/Ui';
import { useSpaceMessages } from '../hooks/useSpaceMessages';
import { age, battery, coordinates, deviceStatus } from '../lib/format';
import { backendError } from '../lib/firebase';
import type { Circle } from '../services/circles';
import { MAX_MESSAGE_LENGTH, sendMessage } from '../services/messages';
import { colors } from '../theme';
import type { DeviceProfile, SpaceMember } from '../types';

type Props = {
  user: AuthUser | null; circle: Circle | null; roster: SpaceMember[];
  devices: DeviceProfile[]; ownDevice: DeviceProfile; sharing: boolean;
  loading: boolean; error: string | null; now: number;
  onManage: () => void; onAccount: () => void; onSharing: (value: boolean) => void;
  onEmergency: () => void; onRetry: () => void; onInvite?: () => void;
  notificationChatKey?: string;
  onProfile: (device: DeviceProfile) => void; onMap: (device: DeviceProfile) => void;
};

export function SpaceScreen({ user, circle, roster, devices, ownDevice, sharing, loading, error, now, onManage, onAccount, onSharing, onRetry, onInvite, onEmergency, onProfile, onMap, notificationChatKey }: Props) {
  const [section, setSection] = useState<'members' | 'chat'>('members');
  useEffect(() => { if (notificationChatKey) setSection('chat'); }, [notificationChatKey]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const chat = useSpaceMessages(circle?.id, user?.uid);
  const messageList = useRef<ScrollView>(null);
  const mounted = useRef(true);
  const nearBottom = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const members = useMemo(() => roster.map(member => ({
    member,
    device: devices.find(device => device.id === member.uid) ?? {
      id: member.uid, ownerId: member.uid, name: member.name, photoURL: member.photoURL,
      platform: '', batteryLevel: null, location: null, sharing: false, lastSeen: 0,
    },
  })), [roster, devices]);

  async function send() {
    if (!circle || sending || !draft.trim()) return;
    const text = draft;
    setSending(true); setSendError(null); nearBottom.current = true;
    try {
      await sendMessage(circle.id, text);
      if (mounted.current) setDraft('');
    } catch (cause) {
      if (mounted.current) setSendError(backendError(cause));
    } finally { if (mounted.current) setSending(false); }
  }

  if (!circle) return <ScrollView contentContainerStyle={ui.content}>
    <Text accessibilityRole="header" style={ui.title}>Your space</Text>
    <View style={styles.banner}><View style={styles.bannerIcon}><Icon name="people" size={30} color={colors.blueLight} /></View>
      <Text style={styles.heading}>The people who matter.</Text><Text style={ui.body}>One private space to share locations and stay in touch.</Text>
    </View>
    {loading ? <ActivityIndicator color={colors.blueLight} accessibilityLabel="Loading your space" /> : <EmptyState icon="people" title="Stay close, together" detail="Create a space for family or friends, or accept an invitation to join theirs.">
      <Button title={user ? 'Create or join a space' : 'Sign in to create or join'} icon="plus" onPress={user ? onManage : onAccount} />
    </EmptyState>}
    <View style={styles.note}><Icon name="shield" size={19} color={colors.blueLight} /><Text style={[ui.caption, { flex: 1 }]}>Members accept an invitation and choose when to share their location. Group messages are private to space members.</Text></View>
    <Text style={ui.sectionLabel}>This device</Text><Pressable accessibilityRole="button" onPress={() => onProfile(ownDevice)} style={styles.memberRow}><Avatar device={ownDevice} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.name}>{ownDevice.name}</Text><Text style={ui.caption}>{coordinates(ownDevice.location)}</Text></View><Icon name="chevron" size={16} /></Pressable>
    {error && <View style={ui.error}><Text style={ui.errorText}>{error}</Text><Button secondary title="Retry shared locations" onPress={onRetry} /></View>}
  </ScrollView>;

  const liveCount = members.filter(({ device }) => device.id === ownDevice.id ? sharing && device.location && now - device.location.timestamp < 45000 : device.sharing && device.location && now - device.location.timestamp < 45000).length;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}><View style={{ flex: 1, gap: 5 }}><Text style={styles.eyebrow}>YOUR SPACE</Text><Text accessibilityRole="header" style={ui.title}>{circle.name}</Text><Text style={ui.caption}>{roster.length} {roster.length === 1 ? 'member' : 'members'} · {liveCount} sharing live</Text></View><View style={ui.row}><RoundButton small icon="alert" label="Send emergency alert" onPress={onEmergency} /><RoundButton small icon="plus" label="Manage space and invitations" onPress={onManage} /></View></View>
    <View accessibilityRole="tablist" style={styles.segments}>{(['members', 'chat'] as const).map(item => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: section === item }} onPress={() => setSection(item)} style={[styles.segment, section === item && styles.segmentActive]}><Icon name={item === 'members' ? 'people' : 'chat'} size={17} color={section === item ? colors.blueLight : colors.muted} /><Text style={[styles.segmentText, section === item && { color: colors.ink }]}>{item === 'members' ? 'Members' : 'Messages'}</Text></Pressable>)}</View>
    {error && <View style={[ui.error, styles.inlineError]}><Text style={ui.errorText}>{error}</Text><Button secondary title="Retry shared locations" onPress={onRetry} /></View>}
    {section === 'members' ? <ScrollView contentContainerStyle={ui.content}>
      <View style={styles.sharingCard}><View style={ui.between}><View style={{ flex: 1, gap: 6 }}><Text style={styles.name}>Share my location</Text><Text style={ui.caption}>{sharing ? 'Visible to this space while the app is open' : 'Turn on to appear on your space’s map'}</Text></View><Switch accessibilityLabel="Share my location with this space" value={sharing} onValueChange={onSharing} trackColor={{ false: '#314259', true: colors.blue }} thumbColor="#FFFFFF" /></View></View>
      <View style={ui.between}><Text style={ui.sectionLabel}>In your space</Text><Text style={ui.caption}>{roster.length} {roster.length === 1 ? 'member' : 'members'}</Text></View>
      {members.map(({ member, device }) => {
        const own = member.uid === user?.uid;
        const profile = { ...device, name: own ? 'You' : member.name === 'Member' ? device.name : member.name, photoURL: member.photoURL ?? device.photoURL };
        return <View key={member.uid} style={styles.memberRow}><Pressable accessibilityRole="button" accessibilityLabel={`View ${profile.name}`} onPress={() => onProfile(device)} style={styles.memberInfo}><Avatar device={profile} size={44} /><View style={{ flex: 1, gap: 6 }}><View style={ui.row}><Text style={styles.name}>{profile.name}</Text>{member.uid === circle.ownerId && <Text style={styles.owner}>OWNER</Text>}</View><Text style={[ui.caption, { color: device.location && (!own || sharing) && now - device.location.timestamp < 45000 ? colors.green : colors.muted }]}>{own && !sharing ? 'Location sharing paused' : deviceStatus(device, now)}</Text>{device.location && (!own || sharing) && <Text style={ui.caption}>{age(device.location.timestamp, now)} · {battery(device.batteryLevel)} battery</Text>}</View></Pressable><RoundButton small icon="pin" label={`View ${profile.name} on the map`} onPress={() => onMap(device)} /></View>;
      })}
      <Button title="Invite someone to your space" icon="plus" onPress={onInvite ?? onManage} />
      <View style={styles.note}><Icon name="shield" size={19} color={colors.blueLight} /><Text style={[ui.caption, { flex: 1 }]}>Each person must turn on Share my location on their own phone. Enabling phone location or GPS alone does not share it. Keep Closeby open while checking.</Text></View>
    </ScrollView> : <View style={{ flex: 1 }}>
      <ScrollView ref={messageList} style={{ flex: 1 }} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent }) => { nearBottom.current = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y < 100; }} scrollEventThrottle={100} onContentSizeChange={() => { if (nearBottom.current) messageList.current?.scrollToEnd({ animated: true }); }}>
        <Text style={[ui.caption, { textAlign: 'center' }]}>Only space members can read and send messages.</Text>
        {chat.loading && <ActivityIndicator color={colors.blueLight} accessibilityLabel="Loading messages" />}
        {chat.error && <View style={[ui.error, { gap: 12 }]}><Text style={ui.errorText}>{chat.error}</Text><Button title="Retry loading messages" secondary onPress={chat.retry} /></View>}
        {!chat.loading && !chat.error && !chat.messages.length && <EmptyState icon="chat" title="Start the conversation" detail="Send a hello, arrange a meetup, or let everyone know you’ve arrived." />}
        {chat.messages.map(message => {
          const own = message.senderId === user?.uid;
          const sender = roster.find(member => member.uid === message.senderId);
          const senderName = sender?.name && sender.name !== 'Member' ? sender.name : message.senderName;
          return <View key={message.id} style={[styles.message, own ? styles.ownMessage : styles.otherMessage]}><Text style={styles.sender}>{own ? 'You' : senderName}</Text><Text selectable style={styles.messageText}>{message.text}</Text><Text style={styles.messageTime}>{message.pending ? 'Sending · waiting for connection' : message.createdAt ? new Date(message.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Waiting for confirmation'}</Text></View>;
        })}
        {chat.messages.length >= 100 && <Text style={[ui.caption, { textAlign: 'center' }]}>Showing the latest 100 messages.</Text>}
      </ScrollView>
      {sendError && <View style={[ui.error, styles.inlineError]}><Text style={ui.errorText}>{sendError} Your message is still in the composer; try sending again.</Text></View>}
      <View style={styles.composer}><TextInput accessibilityLabel="Message your space" value={draft} onChangeText={setDraft} editable={!sending} multiline maxLength={MAX_MESSAGE_LENGTH} placeholder="Message your space…" placeholderTextColor={colors.muted} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={!draft.trim() || sending || Boolean(chat.error)} onPress={() => void send()} style={[styles.sendButton, (!draft.trim() || sending || Boolean(chat.error)) && ui.disabled]}>{sending ? <ActivityIndicator size="small" color={colors.ink} /> : <Icon name="navigate" size={20} />}</Pressable></View>
      {draft.length > MAX_MESSAGE_LENGTH - 200 && <Text style={[ui.caption, { textAlign: 'right', paddingHorizontal: 18, paddingBottom: 6 }]}>{draft.length}/{MAX_MESSAGE_LENGTH}</Text>}
    </View>}
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  banner: { padding: 24, gap: 14, borderRadius: 20, backgroundColor: '#0F243A', borderWidth: 1, borderColor: '#203D5B' },
  bannerIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#143454', justifyContent: 'center', alignItems: 'center' },
  heading: { color: colors.ink, fontSize: 25, fontWeight: '700', letterSpacing: -0.7 },
  header: { padding: 18, flexDirection: 'row', gap: 14, alignItems: 'center' },
  eyebrow: { color: colors.blueLight, fontSize: 9, fontWeight: '600', letterSpacing: 1.8 },
  segments: { flexDirection: 'row', gap: 5, padding: 5, marginHorizontal: 18, marginBottom: 6, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  segment: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 42, borderRadius: 10 },
  segmentActive: { backgroundColor: '#153654' },
  segmentText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  sharingCard: { padding: 16, backgroundColor: '#0F243A', borderWidth: 1, borderColor: '#203D5B', borderRadius: 16 },
  memberRow: { padding: 15, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { color: colors.ink, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  owner: { fontSize: 8, color: colors.blueLight, letterSpacing: 0.7, backgroundColor: '#163654', padding: 4, borderRadius: 5 },
  note: { padding: 14, flexDirection: 'row', gap: 10, borderRadius: 14, backgroundColor: '#0C1D2F' },
  inlineError: { marginHorizontal: 18, marginVertical: 8 },
  messages: { padding: 18, gap: 14, flexGrow: 1 },
  message: { maxWidth: '88%', padding: 13, gap: 6, borderWidth: 1, borderRadius: 16 },
  ownMessage: { alignSelf: 'flex-end', backgroundColor: '#123859', borderColor: '#23537C', borderBottomRightRadius: 5 },
  otherMessage: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderColor: colors.line, borderBottomLeftRadius: 5 },
  sender: { fontSize: 11, fontWeight: '600', color: colors.blueLight },
  messageText: { color: colors.ink, fontSize: 14, lineHeight: 21 },
  messageTime: { color: colors.muted, fontSize: 9, lineHeight: 14 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.background },
  input: { flex: 1, minHeight: 46, maxHeight: 120, padding: 13, borderRadius: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: '#2A3F56', color: colors.ink, fontSize: 14, textAlignVertical: 'top' },
  sendButton: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
});
