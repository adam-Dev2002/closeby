import { googleMapsWebKey } from './mapModel';

type GoogleWindow = Window & {
  google?: typeof google;
  gm_authFailure?: () => void;
  __closebyGoogleMapsReady?: () => void;
};
export type GoogleMapLibraries = { maps: typeof google.maps; markers: google.maps.MarkerLibrary };
let loading: Promise<GoogleMapLibraries> | undefined;
let authenticationFailed = false;
let authenticationHookInstalled = false;
const authListeners = new Set<() => void>();

export function onGoogleMapsAuthFailure(listener: () => void): () => void {
  authListeners.add(listener);
  if (authenticationFailed) listener();
  return () => { authListeners.delete(listener); };
}

/** Load Google's supported JavaScript SDK from the page's real referrer origin. */
export function loadGoogleMaps(): Promise<GoogleMapLibraries> {
  if (!googleMapsWebKey) return Promise.reject(new Error('Set EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY to enable Google Maps in this browser. See docs/GOOGLE_MAPS_SETUP.md.'));
  if (loading) return loading;
  const host = window as GoogleWindow;
  if (!authenticationHookInstalled) {
    const previous = host.gm_authFailure;
    host.gm_authFailure = () => { authenticationFailed = true; authListeners.forEach(listener => listener()); previous?.(); };
    authenticationHookInstalled = true;
  }
  loading = (async () => {
    if (!host.google?.maps?.importLibrary) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        const cleanup = () => { clearTimeout(timer); delete host.__closebyGoogleMapsReady; };
        const failed = () => { cleanup(); script.remove(); reject(new Error('Google Maps could not load. Check your internet connection and retry.')); };
        const timer = setTimeout(failed, 20000);
        host.__closebyGoogleMapsReady = () => { cleanup(); resolve(); };
        const url = new URL('https://maps.googleapis.com/maps/api/js');
        url.searchParams.set('key', googleMapsWebKey);
        url.searchParams.set('v', 'weekly');
        url.searchParams.set('loading', 'async');
        url.searchParams.set('callback', '__closebyGoogleMapsReady');
        script.id = 'closeby-google-maps-sdk';
        script.src = url.toString(); script.async = true; script.onerror = failed;
        script.referrerPolicy = 'strict-origin-when-cross-origin';
        document.head.appendChild(script);
      });
    }
    const maps = host.google!.maps;
    const [, markers] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker')]);
    if (authenticationFailed) throw new Error('Google Maps rejected this key. Check Maps API access, billing, and website restrictions, then refresh the page.');
    return { maps, markers: markers as google.maps.MarkerLibrary };
  })().catch(cause => { loading = undefined; throw cause; });
  return loading;
}
