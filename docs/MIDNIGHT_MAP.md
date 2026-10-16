# Midnight tracking map

This describes the retained MapLibre renderer. The active app uses Google Maps with **Satellite + streets** as the default and **Google Dark** available in the style menu. See [Google Maps setup](GOOGLE_MAPS_SETUP.md).

**Midnight** uses a custom MapLibre vector style with OpenFreeMap's OpenMapTiles/OpenStreetMap data: navy land, dark water, subdued street labels, blue member pins, a white selected pin, and white recorded GPS trails. The same renderer runs in Android/iOS WebView and a sandboxed browser iframe. It does not require a Google Maps key.

Pins appear only for measured device locations. Selecting a device or using Recenter resumes camera following; dragging or zooming lets you explore. Small position changes animate between received fixes. The white trail joins recorded GPS points and is not a driving-directions route or a prediction. Endpoints mark the actual start and latest recorded point. Safe zones and GPS uncertainty use distances in metres. Missing locations do not create sample pins.

The attribution links **© OpenMapTiles · © OpenStreetMap** remain visible above the device card. This view contains no Google map content or logo. [OpenFreeMap's attribution guidance](https://openfreemap.org/) describes the map data requirements.

All five basemaps use MapLibre without a Google Maps key or Google branding. An optional ArcGIS key enables sharper satellite imagery; see [ArcGIS setup](ARCGIS_SETUP.md).

- **Midnight**: the original dark OpenStreetMap vector style.
- **Streets**: a light OpenStreetMap vector style.
- **Satellite**: ArcGIS World Imagery when `EXPO_PUBLIC_ARCGIS_API_KEY` is set. Without a key, EOX Sentinel-2 cloudless imagery from 2016–17 is used, with approximately 10-metre detail. Close zoom enlarges existing imagery rather than requesting missing tiles. These are recorded images, not live satellite photos.
- **Satellite + streets**: the selected satellite provider with OpenStreetMap road and place labels.
- **Terrain**: EOX shaded relief with OpenStreetMap road and place labels.

The satellite layer deliberately uses the original 2016–17 mosaic, released under [CC BY 4.0](https://eox.at/2017/08/sentinel-2-global-cloudless-mosaic/), rather than newer mosaics with different licensing terms. Its EOX/Copernicus credit and license link remain visible. Terrain retains EOX and source-data credits. [EOX::Maps](https://maps.eox.at/) offers these demo services as-is with rate limits and no availability guarantee. They are suitable for initial testing, not an unlimited hosting commitment.

Map style changes reload the basemap while retaining the selected device, measured GPS routes, safe zones, and GPS accuracy overlays. The selected style persists across app restarts. Live traffic and street-level photos are not included; the unavailable traffic switch has been removed. The external map button opens the measured position in OpenStreetMap.

Maps require network access to `tiles.openfreemap.org` for vector tiles and fonts, `tiles.maps.eox.at` for satellite/terrain imagery, and `cdn.jsdelivr.net` for the pinned MapLibre GL JS 5.24.0 renderer and CSS. The map document restricts its resource origins with a content security policy; device names are treated as text and bridge messages validate their channel, device IDs, and coordinates. Failed loads offer Retry. Requested tile areas are visible to the tile service. Offline map downloads are unavailable. Opt-in background recording is described in [HISTORY_ACTIVITY.md](HISTORY_ACTIVITY.md).

Screenshots use browser/emulator test GPS, not the computer's physical location: [Android](midnight-map-android.png), [Android trail](midnight-trail-android.png), [browser](midnight-map-web.png), [browser trail](midnight-trail-web.png).

Verification: `node --test tests/open-map.cjs` checks invalid/missing coordinates, map data boundaries, antimeridian route bounds, HTML/script escaping, bridge message rejection, and attribution URLs. TypeScript and browser/Android checks cover live updates, recording, provider switching, and visible attribution. Physical iOS and Android device behavior still needs device verification.
