import { createElement, useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useOpenMap } from '../hooks/useOpenMap';
import type { LiveMapProps } from '../lib/mapModel';
import { MapUnavailable } from './MapUnavailable';

export function OpenTrackingMap(props: LiveMapProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const scene = useOpenMap(props);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow) scene.receive(event.data);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [scene.receive]);
  useEffect(() => {
    if (scene.ready) frame.current?.contentWindow?.postMessage({ channel: scene.channel, type: 'update', state: scene.state }, '*');
  }, [scene.ready, scene.channel, scene.state]);
  return <View style={[styles.container, props.style]}>
    {createElement('iframe', {
      ref: frame, key: scene.channel, srcDoc: scene.html, title: 'Map showing measured GPS locations',
      sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox', referrerPolicy: 'no-referrer',
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: '#101625' },
    })}
    {scene.error ? <View style={styles.overlay}><MapUnavailable title="Map unavailable" message={scene.error} location={scene.state.location} onRetry={scene.retry} /></View>
      : !scene.ready && <View pointerEvents="none" style={[styles.overlay, styles.loading]}><ActivityIndicator color="#8295FF" /><Text style={styles.caption}>Loading map…</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 360, minHeight: 220, overflow: 'hidden', backgroundColor: '#101625' },
  overlay: { position: 'absolute', inset: 0 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#101625' },
  caption: { color: '#A7B8DC', fontSize: 12 },
});
