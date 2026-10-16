# Google Maps setup

Google Maps is the active provider. **Satellite + streets** is the default and displays satellite imagery with roads and place labels. App controls remain dark. **Google Dark** is available for dark street maps. The Android key is configured in the local `.env`; using that key requires an installed Closeby development build. Expo Go uses its own embedded key. The saved ArcGIS key is preserved for the retained renderer.

The configured Android key belongs to `n8n-projects-511018`. Maps SDK for Android is enabled, and the key is restricted to `com.closeby.tracker` with the local debug certificate listed below. The Cloud Billing API currently reports billing disabled. On October 14, 2026, the Closeby development build successfully rendered Google satellite imagery in the Android emulator with this key. No billing changes were made. A loading timeout alone does not identify a billing problem; check the installed app, native authorization errors, key restrictions, and the project's Google Maps configuration.

Native maps use `react-native-maps`; browsers use the supported Google Maps JavaScript API. Layer choices apply to the main map, device profiles, recorded trips, and safe zones, and stay on this device. There is no live traffic control in this version. The external map button opens Google Maps at the measured position.

Google's logo and copyright remain visible in the SDK map area above the device card, without cropping, masking, CSS filters, or overlays over the attribution. [Google's attribution rules](https://developers.google.com/maps/documentation/android-sdk/policies) prohibit hiding or obscuring these credits.

## Try it before creating keys

Android Expo Go includes the native map module, so you can test its Google map in the prepared Android Google APIs emulator without supplying your own map key. This does not configure a standalone Android app, iPhone development build, or the web preview. The browser shows a clear setup message until its key is configured; GPS remains usable independently. If Google's iOS native module is unavailable in Expo Go, use a development build with your iOS key.

Official Expo instructions: [react-native-maps for SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/map-view/).

### If Google Maps stays blank in Expo Go

The app's loading timeout does not identify the cause by itself. Check connectivity, update Expo Go and Google Play services, and reopen the project. In this workspace's emulator, Android logs specifically reported `Google Maps Android API: Authorization failure` and `Error requesting API token`. These logs refer to Expo Go's installed native app, not the Firebase or ArcGIS configuration.

Expo Go normally needs no additional map setup, but its embedded Google Maps credentials cannot be replaced by editing this project's `.env`. To use your own Android Maps key, configure it and create a Closeby development build. This does not require Firebase. A Google Cloud project with billing configured and **Maps SDK for Android** enabled is required; billing is managed in your Google account and is not enabled by any local script.

For the current local debug build, restrict the Google key to **Android apps**, with:

- Package: `com.closeby.tracker`
- SHA-1: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
- API restriction: **Maps SDK for Android**

The fingerprint above was read from `android/app/debug.keystore`. Re-read it if the keystore changes. EAS and release signing keys can have different fingerprints; do not use this value for those builds unless the actual certificate matches.

The October 16 standalone APK uses the private release key described in [APK_RELEASE.md](APK_RELEASE.md). Its SHA-1 (`51:36:4A:76:F0:F5:DA:E8:8D:54:7B:5D:20:62:83:E0:49:74:83:35`) was added to the existing Maps key's allowed Android applications alongside the development certificate, retaining the Maps SDK for Android API restriction. No billing setting was changed.

Save the API key token in `.env` as `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY=...`. Keep the ArcGIS key separate. Then build an APK for a typical physical Android phone:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-android.ps1 -Architecture arm64-v8a
```

The output is `android/app/build/outputs/apk/debug/app-debug.apk`. Install it on the phone to use the embedded key. A native rebuild is necessary after key changes; clearing Metro alone does not update the Android manifest. Start Metro in development-client mode for that installation, rather than opening the project in Expo Go.

## Create your Google Cloud project and keys

1. In [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/overview), create or select your project and connect a billing account. Review Google's current [Maps pricing and usage](https://developers.google.com/maps/billing-and-pricing/overview); no billing account or cloud project has been created by this app change.
2. Enable **Maps SDK for Android**, **Maps SDK for iOS**, and/or **Maps JavaScript API**, according to the platforms you will run. You do not need Places, Routes, or a geocoding API for these map features.
3. Create a separate API key for each platform. Set both its application restrictions and API restrictions as described below. These are client keys bundled into the app; platform restrictions control their use. Never use service account credentials or OAuth client secrets.
4. Copy `.env.example` to `.env` in the project root and fill in the corresponding values. Preserve any existing Firebase values:

   ```dotenv
   EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY=YOUR_ANDROID_MAPS_KEY
   EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY=YOUR_IOS_MAPS_KEY
   EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY=YOUR_BROWSER_MAPS_KEY
   EXPO_PUBLIC_GOOGLE_MAPS_WEB_MAP_ID=YOUR_WEB_MAP_ID
   ```

Google's [API security guidance](https://developers.google.com/maps/api-security-best-practices) covers key restrictions and usage monitoring.

## Android

- Restrict the Android key to **Android apps**: package **`com.closeby.tracker`** and the **SHA-1 certificate fingerprint of the actual build**. A local debug build, an EAS build, and a Play App Signing distribution can use different signing certificates. Add the correct package/fingerprint pair for each authorized build.
- Restrict its API access to **Maps SDK for Android**.
- `app.config.ts` passes `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY` into the `react-native-maps` config plugin. Rebuild and reinstall the native app after adding or changing this key. Restarting Metro alone does not change the native manifest.
- Use an emulator with working Google Play services or the provided Google APIs image.

Follow [Google's Android key setup](https://developers.google.com/maps/documentation/android-sdk/get-api-key) and [Expo's deployment instructions](https://docs.expo.dev/versions/v57.0.0/sdk/map-view/#deploy-app-with-google-maps).

## iPhone

- Restrict the iOS key to **iOS apps**, bundle identifier **`com.closeby.tracker`**.
- Restrict its API access to **Maps SDK for iOS**.
- `app.config.ts` passes `EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY` to the native map plugin. Create a development or production build with this key so the Google iOS SDK is included. Rebuild after key changes. The app explicitly requests the Google provider.
- Windows can serve the JavaScript app to a physical iPhone or use EAS for a native build; an iOS simulator requires macOS.

See [Google's iOS key setup](https://developers.google.com/maps/documentation/ios-sdk/get-api-key). Native development-build instructions are also in [FIREBASE_SETUP.md](FIREBASE_SETUP.md).

## Browser

- Restrict the web key to **Websites / HTTP referrers**. Authorize the actual development origins you use, for example `http://localhost:8081/*` and `http://127.0.0.1:8081/*`, plus the exact HTTPS origin of your deployed site. Add your computer's LAN origin only when previewing from another device.
- Restrict API access to **Maps JavaScript API**. The SDK loads on the real page origin, with Google's normal copyright and logo, so referrer restrictions work without an opaque iframe.
- The map uses Advanced Markers. A web map ID is required; `DEMO_MAP_ID` is the default for development. Create your own **JavaScript map ID** for deployment and set `EXPO_PUBLIC_GOOGLE_MAPS_WEB_MAP_ID`. See [Google's map ID setup](https://developers.google.com/maps/documentation/javascript/map-ids/mapid-over).
- Stop and restart Expo after changing `.env`:

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1 web
  ```

- Re-export/redeploy the web app after changing its embedded key. A missing key, failed network load, or rejected authentication shows a setup/error panel instead of substituting another provider. Check Google's console errors for disabled API, billing, or referrer restriction issues.

References: [JavaScript SDK loading](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [Advanced Markers](https://developers.google.com/maps/documentation/javascript/advanced-markers/overview), and [troubleshooting](https://developers.google.com/maps/documentation/javascript/troubleshooting).

## What “live” means

Pins are driven by measured, permission-granted device coordinates. Google supplies the basemap and imagery; it does not locate a space member. Members must accept the invitation and turn on sharing. Shared foreground updates publish about every ten seconds, and actual delivery also depends on connectivity. GPS stops when the app leaves the foreground.

An uncertainty circle uses the phone's reported accuracy in metres. The card shows accuracy and fix age. A pin becomes muted after 45 seconds and is described as the last known position. Missing/invalid coordinates never become a seeded location. Selecting a member or recentering resumes camera following; dragging the map lets you explore without being pulled back by later fixes.

Google satellite, aerial, and Street View images are recorded imagery, not a live view of the person or property. Changing the map provider cannot guarantee GPS accuracy; use a physical phone with precise location enabled, inspect its reported uncertainty and update time, and test under real conditions. Emulator GPS coordinates describe the virtual device.

See [how Google collects imagery](https://support.google.com/earth/answer/6327779/how-images-are-collected?hl=en), [map types](https://developers.google.com/maps/documentation/javascript/maptypes), [traffic](https://developers.google.com/maps/documentation/javascript/trafficlayer), and [Street View/map URLs](https://developers.google.com/maps/documentation/urls/get-started).

