# Sharper satellite imagery with ArcGIS

ArcGIS is retained as an alternative renderer. The active app uses Google Maps and defaults to **Satellite + streets**. The saved ArcGIS key is preserved but unused by the active maps. See [Google Maps setup](GOOGLE_MAPS_SETUP.md).

The optional ArcGIS integration uses the authenticated World Imagery raster tile service in the existing MapLibre renderer. It works in Expo Go and development builds without Firebase or a native rebuild. Detail and acquisition dates vary by area. Keep the required Esri and data-source credits visible.

1. Create an [ArcGIS Location Platform account](https://location.arcgis.com/sign-up/), open its dashboard, and click **My portal**.
2. Go to **Content → My content → New item → Developer credentials → API key credentials**.
3. Choose **Public application** and **No item access**. Enable **Location services → Basemaps → Static basemap tiles**, as required by [Esri's World Imagery / MapLibre tutorial](https://developers.arcgis.com/maplibre-gl-js/maps/raster-tile-basemaps/display-multiple-basemap-layers/). Do not grant unrelated data or account permissions.
4. Choose a suitable expiration. For local testing, leave referrers empty: the current inline native WebView and sandboxed browser map do not send a normal website referrer. Domain restrictions require a deployment design with a matching referrer. See [credential settings](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/api-key-credentials/location-platform/).
5. Generate the API key and save the token in the project's `.env` file:

   ```dotenv
   EXPO_PUBLIC_ARCGIS_API_KEY=PASTE_YOUR_API_KEY_HERE
   ```

   This must be the API key token, not a portal item ID, OAuth client ID, or client secret. The `.env` file is ignored by Git. The `EXPO_PUBLIC_` token is bundled into the client app; scope it to basemaps and monitor its usage.

6. Stop the running Expo terminal with **Ctrl+C**, then restart in Expo Go mode:

   ```powershell
   .\.tools\node-v24.21.0-win-x64\npm.cmd start -- --go --lan --port 8084 --clear
   ```

7. Reload or scan the QR code in Expo Go, then choose **Satellite** or **Satellite + streets**. Their descriptions will mention ArcGIS when the key was loaded. Midnight, Streets, and Terrain keep their existing providers.

Without an ArcGIS key, the two satellite modes continue to use the historical free EOX mosaic. With a key, they use ArcGIS; a rejected/expired token or exhausted allowance produces an error and Retry rather than silently switching to blurry imagery. The map fetches current `copyrightText` from the service metadata before displaying ArcGIS tiles and renders it as text alongside **Powered by Esri**.

The service has a free allowance and optional usage-based billing. Check your account's billing settings and [current pricing](https://developers.arcgis.com/pricing/). Creating this integration does not enable paid billing or alter your ArcGIS account settings.
