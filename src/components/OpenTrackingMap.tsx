import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useOpenMap } from '../hooks/useOpenMap';
import { attributionUrl, mapJson } from '../lib/openMap';
import type { LiveMapProps } from '../lib/mapModel';
import { MapUnavailable } from './MapUnavailable';

export function OpenTrackingMap(props: LiveMapProps) {
  const view = useRef<WebView>(null);
  const scene = useOpenMap(props);
  const source = useMemo(() => ({ html: scene.html }), [scene.html]);
  useEffect(() => {
    if (scene.ready) view.current?.injectJavaScript(`window.closebyUpdate(${mapJson(scene.state)});true;`);
  }, [scene.ready, scene.state]);
  function openAttribution(url: string) {
    if (attributionUrl(url)) void Linking.openURL(url).catch(() => undefined);
  }
  return <View style={[styles.container, props.style]}>
    <WebView ref={view} key={scene.channel} source={source} style={styles.webview} originWhitelist={['*']}
      javaScriptEnabled domStorageEnabled scrollEnabled={false} bounces={false} setSupportMultipleWindows
      mixedContentMode="never" allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      geolocationEnabled={false} cacheEnabled webviewDebuggingEnabled={__DEV__}
      onMessage={event => scene.receive(event.nativeEvent.data)}
      onError={() => scene.receive({ channel: scene.channel, type: 'error', message: 'The map could not load. Check your internet connection and try again.' })}
      onShouldStartLoadWithRequest={request => {
        if (request.url === 'about:blank' || request.url.startsWith('about:srcdoc')) return true;
        openAttribution(request.url); return false;
      }}
      onOpenWindow={event => openAttribution(event.nativeEvent.targetUrl)}
      accessibilityLabel="Map showing measured GPS locations" />
    {scene.error ? <View style={styles.overlay}><MapUnavailable title="Map unavailable" message={scene.error} location={scene.state.location} onRetry={scene.retry} /></View>
      : !scene.ready && <View pointerEvents="none" style={[styles.overlay, styles.loading]}><ActivityIndicator color="#8295FF" /><Text style={styles.caption}>Loading map…</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 360, minHeight: 220, overflow: 'hidden', backgroundColor: '#101625' },
  webview: { flex: 1, backgroundColor: '#101625' },
  overlay: { position: 'absolute', inset: 0 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#101625' },
  caption: { color: '#A7B8DC', fontSize: 12 },
});
