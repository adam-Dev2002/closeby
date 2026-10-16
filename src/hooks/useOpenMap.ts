import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { openMapState, readMapMessage } from '../lib/openMap';
import { openMapHtml } from '../lib/openMapHtml';
import { defaultMapType, type LiveMapProps } from '../lib/mapModel';

export function useOpenMap(props: LiveMapProps) {
  const id = useId();
  const [reloadKey, setReloadKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channel = `closeby-map-${id}-${reloadKey}-${props.mapType ?? defaultMapType}`;
  const state = useMemo(() => openMapState(props), [props.devices, props.selectedId, props.location, props.route, props.routeSegments, props.zones, props.recenterKey, props.bottomInset, props.mapType, props.focusCoordinate, props.showZoneBoundaries, props.presence]);
  const latest = useRef({ props, state });
  latest.current = { props, state };
  // GPS updates use the bridge; Retry and a basemap change reload the document.
  const html = useMemo(() => openMapHtml(channel, latest.current.state), [channel]);

  useEffect(() => { setReady(false); setError(null); }, [channel]);

  useEffect(() => {
    if (ready || error) return;
    const timer = setTimeout(() => setError('The map is taking too long to load. Check your connection, retry, or choose Streets.'), 45000);
    return () => clearTimeout(timer);
  }, [ready, error, channel]);

  const receive = useCallback((data: unknown) => {
    const message = readMapMessage(data, channel, latest.current.state);
    if (message?.type === 'ready') { setReady(true); setError(null); }
    if (message?.type === 'error') setError(message.message);
    if (message?.type === 'select') latest.current.props.onSelect(message.id);
    if (message?.type === 'selectZone') latest.current.props.onZoneSelect?.(message.id);
    if (message?.type === 'press') latest.current.props.onMapPress?.(message.coordinate);
  }, [channel]);
  const retry = useCallback(() => { setReady(false); setError(null); setReloadKey(value => value + 1); }, []);
  return { channel, state, html, ready, error, receive, retry };
}
