import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { CallMediaProps } from './CallMedia';
import { callMediaHtml, type MediaConfig } from '../lib/callMediaHtml';
import { parseMediaEvent } from '../lib/calls';
import { loadCallIce } from '../services/calls';
import { colors } from '../theme';

export function CallMedia(props: CallMediaProps) {
  const { call, uid, candidates, muted, cameraOff } = props;
  const frame = useRef<HTMLIFrameElement>(null), latest = useRef(props); latest.current = props;
  const [config, setConfig] = useState<MediaConfig | null>(null), [ready, setReady] = useState(false), [relay, setRelay] = useState(false);
  const liveState = useRef('connecting'), channel = `closeby-call:${call.id}:${uid}`;
  const html = useMemo(() => config ? callMediaHtml(config) : undefined, [config]);
  useEffect(() => {
    let live = true;
    if (call.status !== 'accepted') { latest.current.onError('Approve this request before starting device access.'); return; }
    if (!window.isSecureContext) { latest.current.onError('Browser calls require HTTPS or localhost. The LAN HTTP preview cannot use your microphone or camera. Open the rebuilt Closeby app on your phone.'); return; }
    void loadCallIce(uid).then(ice => { if (live) { setRelay(ice.relay); setConfig({ channel, role: call.callerId === uid ? 'caller' : 'callee', mode: call.mode, access: call.access, iceServers: ice.iceServers, parentOrigin: window.location.origin }); } })
      .catch(error => { if (live) latest.current.onError(error instanceof Error ? error.message : 'The call could not start.'); });
    return () => { live = false; frame.current?.contentWindow?.postMessage({ channel, type: 'stop' }, window.location.origin); };
  }, [call.id, uid, channel]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      const value = parseMediaEvent(event.data, channel);
      if (!value) return;
      if (value.type === 'ready') setReady(true);
      else if (value.type === 'state') { liveState.current = value.state; latest.current.onState(value.state); }
      else if (value.type === 'error') latest.current.onError(value.message);
      else latest.current.onSignal(value);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel]);
  useEffect(() => { if (ready) frame.current?.contentWindow?.postMessage({ channel, type: 'remote', description: call.callerId === uid ? call.answer : call.offer, candidates }, window.location.origin); }, [ready, call.offer?.sdp, call.answer?.sdp, candidates, channel, uid]);
  useEffect(() => { if (ready) frame.current?.contentWindow?.postMessage({ channel, type: 'controls', muted, cameraOff }, window.location.origin); }, [ready, muted, cameraOff, channel]);
  useEffect(() => { const timer = setTimeout(() => { if (liveState.current !== 'connected') latest.current.onError('The call could not connect. Check your internet connection. A relay server may be needed between these networks.'); }, 60000); return () => clearTimeout(timer); }, [call.id]);
  return <View style={styles.container}>
    {html ? createElement('iframe', { ref: frame, srcDoc: html, allow: 'camera; microphone; autoplay', sandbox: 'allow-scripts allow-same-origin', title: call.mode === 'video' ? 'Live video call and your camera preview' : 'Live voice call', style: { flex: 1, width: '100%', minHeight: '200px', border: 0, borderRadius: '16px', background: colors.surface } })
      : <View style={styles.loading}><ActivityIndicator color={colors.blueLight} /><Text style={styles.note}>Preparing your call…</Text></View>}
    {!relay && <Text style={styles.note}>No call relay is configured. Connections between different networks may fail.</Text>}
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1, minHeight: 210, gap: 8 }, loading: { flex: 1, minHeight: 200, justifyContent: 'center', alignItems: 'center', gap: 12 }, note: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' } });
