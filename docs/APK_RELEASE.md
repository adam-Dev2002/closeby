# Share Closeby with your family

Closeby can be distributed as a standalone Android APK. The release APK contains its JavaScript and assets, so it opens from the phone's app icon without Metro, Expo Go, a QR code, or your computer. Internet access is still needed for accounts, maps, shared locations, and calls. This APK does not install on iPhones.

## Build on this Windows computer

Run from the project directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Architecture phone-and-emulator -Variant release
```

The output for the current version is **`dist/android/Closeby-0.1.7.apk`**. It supports ARM64 phones and x86_64 emulators, with Android 7 or newer. For a smaller APK containing only ARM64 phone libraries, use `-Architecture arm64-v8a`. Older 32-bit-only phones need a separate compatible build; do not assume the ARM64 APK will install on them.

The script generates a private signing key once, reuses it for later releases, bundles the app, verifies the APK's signature against that key, and exports a SHA-256 checksum. Release signing uses `scripts/release-signing.gradle`; the default debug signing inside the generated Android project is not used by this command. A local build does not require a paid build service or a Play Store account. See [Expo's local release guide](https://docs.expo.dev/guides/local-app-production/) and [Android signing documentation](https://developer.android.com/studio/publish/app-signing).

## Keep your signing backup private

Back up the entire **`.private/android-release`** folder to secure storage that only you control. It includes `closeby-release.p12` and `credentials.json`; both are necessary for future APK updates. The build protects the directory with Windows file permissions and excludes `.private/` from source control. It refuses to silently replace an incomplete key setup.

Never send the signing folder, `.env`, service account files, or the project source to family members. Share the APK only. Keep the original signing key: losing it prevents normal updates to installed copies. The public fingerprints in `dist/android/signing-certificate.json` are safe to share with API providers.

## Finish the live app configuration

The release package is **`com.closeby.tracker`**. The new release certificate must be registered alongside the development certificate:

1. In [Firebase project settings](https://console.firebase.google.com/project/n8n-projects-511018/settings/general), open **Closeby Android** and add its SHA-1 and SHA-256 from `dist/android/signing-certificate.json`. Confirm the Google sign-in Android OAuth client exists for that package and SHA-1.
2. In the existing Android Maps API key's application restrictions, add another allowed Android application with package `com.closeby.tracker` and the release SHA-1. Keep existing entries and the **Maps SDK for Android** API restriction.
3. Deploy the current `firestore.rules` and query indexes to the existing Firebase project. The APK includes profile avatars, calls, owner-managed request permissions, and recipient-only camera/microphone approval. Older live rules can reject those operations. Back up/review the deployed rules and run the rule tests first. This is a live backend change, separate from creating the APK.
4. Stay on the existing Spark plan unless you deliberately choose otherwise. `scripts/prepare-firebase-spark.cjs` preserves query indexes while removing the paid TTL setting from the deployable index specification. Do not enable billing just to distribute an APK.
5. For calls across restrictive mobile/Wi-Fi networks, configure the authenticated TURN credentials endpoint described in [DEVICE_ACCESS.md](DEVICE_ACCESS.md). Without a relay, some network combinations cannot connect.

If using the locally available Firebase CLI after review:

```powershell
node scripts/prepare-firebase-spark.cjs
node .verification/firebase/node_modules/firebase-tools/lib/bin/firebase.js deploy --project n8n-projects-511018 --config firebase.spark.json --only 'firestore:rules,firestore:indexes'
```

`.verification/firebase` is local tooling, not part of the distributed app. On another computer, install the official Firebase CLI first. This document is a procedure, not evidence that a cloud deployment has happened; see the release verification section below for the completed checks.

## Install and share

1. Install the APK on your own Android phone first. Open it from the app icon with the computer disconnected. Check login, map, private space creation/joining, and location-sharing consent.
2. Upload **`dist/android/Closeby-0.1.7.apk`** to a file host you control and share its link, or send the APK file directly to family members. The [invitation hosting site](SPACE_INVITATIONS.md) opens installed apps; Spark Hosting does not permit APK downloads. The local file path on this computer is not a public download URL.
3. On each Android phone, download the APK and tap it. When Android asks, allow **Install unknown apps** for the browser/file manager used to open it, then choose **Install**. Keep Play Protect enabled. See [Android's direct distribution instructions](https://developer.android.com/distribute/marketing-tools/alternative-distribution).
4. Open **Closeby**, create a personal account, and join the same private space with the invitation code. Location sharing is a choice on each phone. Camera/microphone access requires the receiving member's explicit approval for each session; approved background sharing keeps its visible notification and Stop action.
5. If updating an earlier development copy fails because the signing certificates differ, save or export any local-only history before removing that old copy. Uninstalling clears its local data. Do not uninstall a phone's existing app automatically. Once a phone has this release certificate, future APKs signed with the same key can update it.

APK distribution can be free. Cloud services still have quotas and their own pricing; [Firestore's free quotas](https://firebase.google.com/docs/firestore/pricing) are not unlimited. Android's [free limited-distribution account](https://developer.android.com/developer-verification/guides/limited-distribution) supports up to 20 explicitly authorized devices and is intended for sharing with family/friends. Registration requirements depend on the destination region and Android rollout; check that guide if installation requests developer registration.

## Updates

Keep the same package name and signing key. Increase `expo.version` in `app.json` and set a higher `android.versionCode` in `app.config.ts` for each distributed update. Re-run the release command and send the new APK link. There is no automatic updater configured in this project.

## Release verification

Version **0.1.7**, Android version code **8**, adds twelve-character space codes, sharing a full invitation link from Spaces, Android verified HTTPS App Links, a pending join form that survives sign-in, and a browser fallback with an Open button, copyable code, and installation instructions. Joining remains explicit, and previous invitation codes remain valid until expiry or renewal. See [space invitations](SPACE_INVITATIONS.md).

Built on October 16, 2026: **91,259,668 bytes**, SHA-256 `c0d6a663f5738a1f653a14502d35e9abc8424d76a0b235ad870b840446d9724b`. Signature verification passed against the existing release key. APK inspection confirmed version 0.1.7/code 8, ARM64/x86_64 libraries, the invitation changes and HTTPS intent filter, production Firebase configuration, and no private signing files. TypeScript, all 156 app/service checks, and 62 isolated Firestore rules/service checks passed. The two-account browser test verified sharing, clipboard, invitation persistence through sign-in/reload, explicit acceptance, existing-space protection, and the 320px layout without GPS requests or page errors.

The invitation rules and dedicated `closeby-511018` Hosting site were deployed and checked live. On an isolated Android 36 emulator, Android verified the public domain against the release certificate, an implicit HTTPS link opened the signed app from a closed state and showed the pending invitation before sign-in, and another link reached the running app. No Google accounts were used, no app crashes occurred, and the checks did not repopulate production accounts or spaces. Physical-phone link handling still needs confirmation because messaging apps can retain links in their own browsers; use **Open in Closeby** there.

Version **0.1.6**, Android version code **7**, remembers per-account GPS and live-sharing preferences on this phone, restores foreground GPS without prompting on reopen/resume, reuses existing foreground/background location grants, adds a Map sharing switch and partner guidance, and recovers failed shared-location subscriptions automatically or through Retry. Pause GPS, sharing off, leaving a space, and signing out retain their stop controls. Android's one-time permissions and revoked grants still require an explicit new grant. See [location sharing](LOCATION_SHARING.md).

Built on October 16, 2026: **91,250,396 bytes**, SHA-256 `7cc0ac6cb0f365489f02bca09a8f958af61fc8582ee7c9b2db736d13006e7f22`. Signature verification passed against the existing release key. APK inspection confirmed version 0.1.6/code 7, ARM64/x86_64 libraries, the packaged GPS/sharing fixes, production Firebase configuration, and no private signing files. TypeScript and all 148 app/service checks passed. The two-account browser check passed with isolated Auth/Firestore emulators and synthetic GPS, including mutual location delivery, saved choices after reload, persistent pause, and the 320px layout. Physical-phone confirmation remains required; no production backend deployment was needed.

Version **0.1.5**, Android version code **6**, adds native Android push registration, private account/installation records, emergency/call notification sounds, token rotation and sign-out cleanup, and notification taps for calls, Safety, space chat and map pins. The trusted notification server is included under `functions/`. **Hosted delivery is not active:** the project remains on Spark, billing is disabled, and the server requires an approved hosting/deployment step. The private registration rules were deployed after tests; this does not deploy the sender or enable push delivery. See [phone notifications](PHONE_NOTIFICATIONS.md).

Built on October 16, 2026: **91,241,484 bytes**, SHA-256 `63ab3ed980954d6388076ef29708da319700dc2525cc4c995aee57e54209fffb`. Signature verification passed against the existing release key. APK inspection confirmed version/code, ARM64/x86_64 support, the phone-notification and chat-tap code, production Firebase identifiers, and both bundled native sounds by content hash. No private signing files are packaged. TypeScript, 90 app checks and 71 isolated Firestore/server checks passed. Server tests capture the FCM adapter and do not prove hosted delivery or physical-phone sound.

Version **0.1.4**, Android version code **5**, corrects the native call-message origin filter. Android WebView origin-only events now reach readiness, connection-state, error, and SDP/ICE handlers. Other origins and other call channels remain rejected. All 36 call/background/inbox tests, TypeScript, and browser synthetic-media packet/frame checks for microphone/front/rear requests passed. Live temporary-account Firebase signaling checks passed and cleaned up all generated data. The local foreground emulator attempt did not produce a reliable end-to-end result; physical-phone camera startup and connectivity still require confirmation. See [Connecting troubleshooting](DEVICE_ACCESS.md#stuck-on-connecting).

Built on October 16, 2026: **90,419,492 bytes**, SHA-256 `acba4abac56cfdcf0e17e008aa5d59542ddc2b1ae74e6868bf353c224d3e59aa`. Signature verification passed against the existing release key. APK inspection confirmed version 0.1.4/code 5, ARM64 and x86_64 libraries, the origin fix in the bundled code, production Firebase configuration, and no local test configuration or private signing files. It can update previous releases signed with this key; it does not enable remote code updates.

Version **0.1.3**, Android version code **4**, uses the supplied artwork for the launcher icon, splash screen, browser favicon, sign-in, loading screen, and Settings branding. The source image is preserved unchanged in `assets/branding/closeby-logo.png`. TypeScript and web export passed; browser checks verified the logo on sign-in and Settings, with no page errors or horizontal overflow at 320px. The generated Android launcher and splash images were visually inspected.

Built on October 16, 2026: **90,419,320 bytes**, SHA-256 `b41c59db08c6ca14b34115e37d1ebb74c1e67e9bed979b6fbe63d920c5b6d28c`. Signature verification passed against the existing release key. The APK contains the new native splash module and logo resources, with ARM64 and x86_64 support.

Version **0.1.2**, Android version code **3**, adds a repeating emergency ring alongside vibration. It stops on acknowledgment, after 30 seconds, or when the app leaves the foreground. Recipients need the updated APK because playback uses a native audio module. See [emergency alert sound](EMERGENCY_ALERTS.md) for behavior and checks.

Built on October 16, 2026: **85,449,958 bytes**, SHA-256 `0c278f112791ff72463b439471be2cdf6a87ac6497b3aded134ce9cc13f15eb3`. The APK signature matches the existing release key; ARM64 and x86_64 libraries, the native audio module, bundled ringtone, and production Firebase configuration were verified in the APK. TypeScript, 33 ring/call/inbox tests, real browser audio playback, and recipient-only emergency UI playback passed. Physical-phone sound output still requires checking. Expo's dependency check reports the existing `expo@57.0.28` patch is behind its recommended `~57.0.30`; the installed Expo patch was retained for this release.

Version **0.1.1**, Android version code **2**, adds incoming-call listener recovery and displays approval inside the same modal as Settings/People. Install the update on both participants' phones. The existing production rules passed live call-service checks without another deployment; see [DEVICE_ACCESS.md](DEVICE_ACCESS.md) for verification details. The original 0.1.0 build record below is retained for reference.

The October 16, 2026 update APK is 81,982,015 bytes with SHA-256 `ddd391dac61f646542a70f7ac5b331783792afea49e60029d5f7bed3a2cfe8c9`. Its signature was verified against the existing release key. Verification passed TypeScript, 34 call/background/inbox tests, 15 Firestore call tests, all three member approval popups over an open Settings sheet, browser media tests, and temporary-account live request/signaling checks. Its bundled Firebase configuration points to the production project, with no emulator test key or private signing files packaged. This update has not been tested on the affected physical phones.

Built locally on October 16, 2026:

- APK: `dist/android/Closeby-0.1.0.apk`, 81,980,375 bytes; package `com.closeby.tracker`, version `0.1.0`, Android version code `1`.
- Architectures: ARM64 and x86_64; minimum Android API 24 (Android 7). The APK contains its 3,424,540-byte app bundle and no private signing files.
- SHA-256: `8db81b067758a2c379c72b57781590feb98bb3f7ed8fa7b71dd12cfebbc06a0d`.
- APK signature verified against the private RSA-3072 release key. Re-running key setup preserved the same certificate.
- Release SHA-1: `51:36:4A:76:F0:F5:DA:E8:8D:54:7B:5D:20:62:83:E0:49:74:83:35`. Its SHA-1/SHA-256 are registered with the existing Firebase Android app; the generated SDK configuration contains an Android OAuth client for this certificate. The Maps key allows both the existing development certificate and the new release certificate while retaining its Maps-only API restriction.
- TypeScript check and all 55 Firebase rules/service tests passed.
- Clean installation and direct app-icon startup passed on a separate Android 36 emulator, with no Metro reverse connection and Android confirming the package is not debuggable. The login screen, foreground location permission, Google satellite map, and local GPS updates worked using only synthetic emulator coordinates. No personal account was used for this check.
- On October 16, the matching Firestore rules and Spark-compatible indexes were deployed to `n8n-projects-511018`. The live rules match `firestore.rules`; all five composite indexes are READY. A live check using the actual app services verified private space creation, a separate family account accepting the invitation, avatar/profile/device writes, owner-only requester permission changes, and the incoming-request query. Unauthenticated users, nonmembers, and cross-account private-profile reads stayed denied. Temporary accounts and generated test documents were removed.

Physical-phone checks are still required before wider family use. This emulator check does not establish real-phone GPS accuracy, Google sign-in completion, or background camera/microphone behavior on a particular phone manufacturer. The October 16 Firebase fix applies to the existing APK without reinstalling it; close and reopen Closeby so failed listeners reconnect, then sign in with each person's own account and enter the invitation code in **Spaces**.
