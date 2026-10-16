import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CallController } from '../hooks/useCall';
import { deviceAccessLabel } from '../lib/calls';
import { CallMedia } from './CallMedia';
import { BackgroundCallMedia } from './BackgroundCallMedia';
import { Button, RoundButton, ui } from './Ui';
import { Icon } from './Icon';
import { colors } from '../theme';

export function CallPanel({ call, embedded = false }: { call: CallController; embedded?: boolean }) {
  const [localMuted, setMuted] = useState(false), [localCameraOff, setCameraOff] = useState(false);
  const muted = call.nativeManaged ? call.backgroundControls?.muted ?? true : localMuted;
  const cameraOff = call.nativeManaged ? call.backgroundControls?.cameraOff ?? true : localCameraOff;
  const [allowBackground, setAllowBackground] = useState(false);
  useEffect(() => { setAllowBackground(false); }, [call.incoming?.id]);
  useEffect(() => { setMuted(false); setCameraOff(false); }, [call.active?.id]);
  const active = call.active, incoming = call.incoming;
  const request = active?.access ?? incoming?.access, receiving = Boolean(active?.access) && active?.callerId === call.uid;
  const close = () => { if (active || call.loading && !incoming) call.end(); else if (incoming) void call.decline(); else if (call.incomingError) call.retryIncoming(); else call.clearError(); };
  if (!active && !incoming && !call.error && !call.incomingError && !call.loading) return null;
  const content = <View style={styles.backdrop}><SafeAreaView style={[styles.panel, active?.status === 'accepted' && styles.livePanel]} accessibilityViewIsModal>
      <View style={ui.between}><View style={{ flex: 1, gap: 6 }}><Text accessibilityRole="header" style={ui.title}>{request ? active?.status === 'accepted' ? 'Live device sharing' : 'Device access request' : active ? active.mode === 'video' ? 'Video call' : 'Voice call' : incoming ? 'Incoming call' : call.loading ? 'Sending request...' : 'Session update'}</Text>
        {(active || incoming) && <Text style={ui.caption}>{active ? active.callerId === call.uid ? active.calleeName : active.callerName : incoming!.callerName}</Text>}</View>
        <RoundButton small icon="close" label={active?.access ? 'Stop sharing' : active ? 'End call' : incoming ? 'Decline request' : 'Close session update'} onPress={close} />
      </View>
      <ScrollView style={active?.status === 'accepted' ? { flex: 1 } : { flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ flexGrow: 1, gap: 17 }}>
      {call.error && <View style={ui.error}><Text accessibilityRole="alert" style={ui.errorText}>{call.error}</Text><Pressable accessibilityRole="button" onPress={call.clearError}><Text style={styles.link}>Dismiss message</Text></Pressable></View>}
      {call.incomingError && <View style={ui.error}><Text accessibilityRole="alert" style={ui.errorText}>{call.incomingError}</Text><Button secondary title="Retry incoming requests" onPress={call.retryIncoming} /></View>}
      {call.loading && !active && !incoming && <><Text style={styles.note}>Sending a request to the other person. Keep Closeby open.</Text><Button secondary title="Cancel" onPress={call.end} /></>}
      {incoming && !active && <><View style={styles.incoming}><Icon name="phone" size={44} color={colors.blueLight} /><Text style={styles.heading}>{incoming.access ? `${incoming.callerName} requests your ${deviceAccessLabel(incoming.access)}.` : `${incoming.callerName} wants a ${incoming.mode === 'video' ? 'video' : 'voice'} call.`}</Text>
        <Text style={styles.note}>{incoming.access ? `Approve once to share your ${deviceAccessLabel(incoming.access)} live with ${incoming.callerName}. Sharing stays visible. You can stop at any time; future requests need your approval again.` : `Accept to enable your ${incoming.mode === 'video' ? 'camera and microphone' : 'microphone'}. You can mute, turn your camera off, or end the call at any time.`}</Text></View>
        {incoming.access && call.backgroundSupported && <View style={ui.card}><View style={[ui.row, { padding: 12 }]}><View style={{ flex: 1, gap: 5 }}><Text style={ui.rowTitle}>Allow background sharing this time</Text><Text style={ui.caption}>Continues with the screen locked or after swiping Closeby away. A visible Android notification has a Stop sharing button. Force stop ends it.</Text></View><Switch accessibilityLabel="Allow background sharing for this session" value={allowBackground} disabled={call.loading} onValueChange={setAllowBackground} /></View></View>}
        <Button title={incoming.access ? `Approve ${incoming.access === 'microphone' ? 'microphone' : incoming.access === 'front' ? 'front camera + mic' : 'rear camera + mic'} once` : incoming.mode === 'video' ? 'Accept video call' : 'Accept voice call'} busy={call.loading} onPress={() => void call.accept(Boolean(incoming.access && call.backgroundSupported && allowBackground))} /><Button secondary danger title="Decline" busy={call.loading} onPress={() => void call.decline()} /></>}
      {active?.status === 'ringing' && <><View style={styles.incoming}><Icon name="phone" size={44} color={colors.blueLight} /><Text style={styles.heading}>Waiting for {active.calleeName} to {active.access ? 'approve' : 'accept'}...</Text><Text style={styles.note}>{active.access ? `Requested: ${deviceAccessLabel(active.access)}. Their device stays off until they approve. This request expires in two minutes.` : 'The other person must accept. Your camera and microphone start after acceptance.'}</Text></View><Button danger title="Cancel request" onPress={call.end} /></>}
      {active?.status === 'accepted' && call.uid && <><View style={styles.status}><View style={[styles.dot, call.phase === 'connected' && { backgroundColor: colors.green }]} /><Text accessibilityRole="alert" style={ui.caption}>{call.phase === 'connected' ? 'Connected · live' : 'Connecting…'}</Text></View>
        {active.access && <View style={ui.error}><Text accessibilityRole="alert" style={ui.errorText}>{receiving ? `Receiving ${active.calleeName}'s approved ${deviceAccessLabel(active.access)}.` : `Sharing your ${deviceAccessLabel(active.access)} with ${active.callerName}.`}{!receiving && muted ? ' Microphone muted.' : ''}{!receiving && active.mode === 'video' && cameraOff ? ' Camera paused.' : ''}</Text></View>}
        {call.nativeManaged ? <BackgroundCallMedia id={active.id} /> : <CallMedia key={active.id} call={active} uid={call.uid} candidates={call.candidates} muted={muted} cameraOff={cameraOff} onSignal={value => void call.signal(value)} onState={call.mediaState} onError={call.mediaError} />}
      </>}
      </ScrollView>
      {active?.status === 'accepted' && <>
        <View style={styles.controls}>{!receiving && <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Unmute microphone' : 'Mute microphone'} accessibilityState={{ selected: muted }} onPress={() => call.nativeManaged ? call.setBackgroundControls(!muted, cameraOff) : setMuted(value => !value)} style={[styles.control, muted && styles.disabledControl]}><Text style={styles.controlText}>{muted ? 'Unmute' : 'Mute'}</Text></Pressable>}
          {active.mode === 'video' && !receiving && <Pressable accessibilityRole="button" accessibilityLabel={cameraOff ? 'Turn camera on' : 'Turn camera off'} accessibilityState={{ selected: cameraOff }} onPress={() => call.nativeManaged ? call.setBackgroundControls(muted, !cameraOff) : setCameraOff(value => !value)} style={[styles.control, cameraOff && styles.disabledControl]}><Text style={styles.controlText}>{cameraOff ? 'Camera on' : 'Camera off'}</Text></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel={active.access ? 'Stop sharing' : 'End call'} onPress={call.end} style={[styles.control, styles.end]}><Text style={styles.controlText}>{active.access ? 'Stop sharing' : 'End'}</Text></Pressable></View>
        <Text style={styles.note}>{call.nativeManaged ? 'Sharing continues in the background with an Android notification. Closeby does not record sessions.' : 'Keep Closeby open. Leaving the app ends this session. Closeby does not record sessions.'}</Text></>}
    </SafeAreaView></View>;
  if (embedded) return content;
  return <Modal visible transparent animationType="fade" onRequestClose={close}>{content}</Modal>;
}
const styles = StyleSheet.create({ backdrop: { flex: 1, backgroundColor: '#000B', alignItems: 'center', justifyContent: 'center', padding: 16 }, panel: { width: '100%', maxWidth: 510, maxHeight: '96%', padding: 20, gap: 17, backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.line }, livePanel: { height: '92%' }, incoming: { alignItems: 'center', gap: 16, paddingVertical: 18 }, heading: { color: colors.ink, fontSize: 17, lineHeight: 24, fontWeight: '600', textAlign: 'center' }, note: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' }, controls: { flexDirection: 'row', gap: 8 }, control: { flex: 1, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: '#203D5B' }, disabledControl: { backgroundColor: '#4B4051' }, end: { backgroundColor: '#BE3444' }, controlText: { color: colors.ink, fontSize: 12, fontWeight: '600' }, status: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.blueLight }, link: { color: colors.blueLight, fontSize: 11, marginTop: 8 } });
