import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { callMediaHtml, callMediaOrigin, isCallMediaSource, type MediaConfig } from '../lib/callMediaHtml';
import { mediaJson, parseMediaEvent, type CallCandidate, type CallSignal, type SpaceCall } from '../lib/calls';
import { loadCallIce } from '../services/calls';
import { colors } from '../theme';

export type CallMediaProps = { call: SpaceCall; uid: string; candidates: CallCandidate[]; muted: boolean; cameraOff: boolean;
  onSignal: (value: CallSignal) => void; onState: (value: 'connecting' | 'connected' | 'closed') => void; onError: (message: string) => void };
const origin = callMediaOrigin;
export function CallMedia(props: CallMediaProps) {
  const { call, uid, candidates, muted, cameraOff } = props;
  const view = useRef<WebView>(null), latest = useRef(props); latest.current = props;
  const [config, setConfig] = useState<MediaConfig | null>(null), [ready, setReady] = useState(false), [relay, setRelay] = useState(false);
  const channel = `closeby-call:${call.id}:${uid}`;
  const source = useMemo(() => config ? { html: callMediaHtml(config), baseUrl: `${origin}/call/` } : null, [config]);
  useEffect(() => {
    let live = true;
    void (async () => {
      if (call.status !== 'accepted') throw new Error('Approve this request before starting device access.');
      if (Platform.OS === 'android' && (!call.access || call.calleeId === uid)) {
        const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(call.mode === 'video' ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
        const granted = await PermissionsAndroid.requestMultiple(permissions);
        if (!permissions.every(permission => granted[permission] === PermissionsAndroid.RESULTS.GRANTED)) throw new Error('Camera or microphone permission was denied. Allow it in Android settings and call again.');
      }
      if (!live) return;
      const ice = await loadCallIce(uid);
      if (live) { setRelay(ice.relay); setConfig({ channel, role: call.callerId === uid ? 'caller' : 'callee', mode: call.mode, access: call.access, iceServers: ice.iceServers }); }
    })().catch(error => { if (live) latest.current.onError(error instanceof Error ? error.message : 'The call could not start.'); });
    return () => { live = false; view.current?.injectJavaScript(`window.closebyCallUpdate&&window.closebyCallUpdate(${mediaJson({ channel, type: 'stop' })});true;`); };
  }, [call.id, uid, channel]);
  useEffect(() => {
    if (!ready) return;
    const command = { channel, type: 'remote', description: call.callerId === uid ? call.answer : call.offer, candidates };
    view.current?.injectJavaScript(`window.closebyCallUpdate(${mediaJson(command)});true;`);
  }, [ready, call.offer?.sdp, call.answer?.sdp, candidates, channel, uid]);
  useEffect(() => { if (ready) view.current?.injectJavaScript(`window.closebyCallUpdate(${mediaJson({ channel, type: 'controls', muted, cameraOff })});true;`); }, [ready, muted, cameraOff, channel]);
  useEffect(() => {
    const timer = setTimeout(() => { if (liveState.current !== 'connected') latest.current.onError('The call could not connect. Check your internet connection. A relay server may be needed between your networks.'); }, 60000);
    return () => clearTimeout(timer);
  }, [call.id]);
  const liveState = useRef('connecting');
  return <View style={styles.container}>
    {source ? <WebView ref={view} source={source} style={styles.webview} originWhitelist={[origin, 'about:blank']}
      javaScriptEnabled domStorageEnabled={false} scrollEnabled={false} bounces={false} mixedContentMode="never"
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} geolocationEnabled={false}
      allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} mediaCapturePermissionGrantType="prompt" setSupportMultipleWindows
      onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url === `${origin}/call/`}
      onOpenWindow={() => latest.current.onError('Navigation is disabled during a call.')}
      onError={() => latest.current.onError('The call screen could not load. Restart the call in the rebuilt Closeby app.')}
      onMessage={event => {
        if (!isCallMediaSource(event.nativeEvent.url)) return;
        const value = parseMediaEvent(event.nativeEvent.data, channel);
        if (!value) return;
        if (value.type === 'ready') setReady(true);
        else if (value.type === 'state') { liveState.current = value.state; latest.current.onState(value.state); }
        else if (value.type === 'error') latest.current.onError(value.message);
        else latest.current.onSignal(value);
      }} accessibilityLabel={call.mode === 'video' ? 'Live video call with your camera preview' : 'Live voice call'} />
      : <View style={styles.loading}><ActivityIndicator color={colors.blueLight} /><Text style={styles.note}>{call.access && call.callerId === uid ? 'Preparing the approved stream...' : 'Preparing your approved camera or microphone...'}</Text></View>}
    {!relay && <Text style={styles.note}>No call relay is configured. Connections between different networks may fail.</Text>}
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1, minHeight: 210, gap: 8 }, webview: { flex: 1, backgroundColor: colors.surface, minHeight: 200 }, loading: { flex: 1, minHeight: 200, justifyContent: 'center', alignItems: 'center', gap: 12 }, note: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' } });
