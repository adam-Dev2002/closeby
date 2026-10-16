import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getBackgroundMedia, subscribeBackgroundMedia } from '../services/backgroundMedia';
import { ui } from './Ui';

export function BackgroundCallMedia({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState(getBackgroundMedia);
  useEffect(() => subscribeBackgroundMedia(() => setSnapshot(getBackgroundMedia())), []);
  if (!snapshot || snapshot.call.id !== id) return null;
  const { muted, cameraOff } = snapshot;
  const { RTCView } = require('react-native-webrtc') as typeof import('react-native-webrtc');
  return <View style={{ flex: 1, minHeight: 210, gap: 10 }}>
    {snapshot.call.mode === 'video' && snapshot.streamURL && !cameraOff
      ? <RTCView streamURL={snapshot.streamURL} mirror={snapshot.call.access === 'front'} objectFit="cover" style={styles.preview} />
      : <View style={[styles.preview, { alignItems: 'center', justifyContent: 'center' }]}><Text style={ui.body}>{!snapshot.streamURL ? 'Preparing approved background sharing...' : snapshot.call.mode === 'voice' ? muted ? 'Microphone muted' : 'Microphone sharing is active' : 'Camera paused'}</Text></View>}
    <Text style={ui.caption}>Background sharing is approved for this session. Use Stop sharing here or in the Android notification. Force stop ends sharing.</Text>
  </View>;
}
const styles = StyleSheet.create({ preview: { flex: 1, minHeight: 200, borderRadius: 16, overflow: 'hidden', backgroundColor: '#08131E' } });
