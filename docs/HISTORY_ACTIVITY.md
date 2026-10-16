# History and activity

Open **History** to choose a member and a date. A 30-day calendar, daily route map, movement/stop timeline, observed distance, and recorded duration use captured GPS samples. Tap a movement or stop to inspect it, or choose **Entire day** to return to the full daily route. Member profiles link to the same history view.

Each person controls three options in History or Settings:

- **Save my activity:** automatically record this phone's locations, separately from manually recorded trips. It is off initially and starts GPS only after the person enables it.
- **Background recording:** continue recording with the app in the background or the phone locked. Requires the installed native app, foreground and background permissions, and an available native location task. Android displays a recording notification; iOS enables its background location indicator. It is off initially.
- **Share my activity:** share only new history with current members of the person's space, while ordinary location sharing is also on. Private past activity is never uploaded when this option is enabled. It is off initially.

Turning history sharing off revokes member access to shared history and blocks additional uploads. Enabling it again starts a new consent generation, so earlier shared history does not reappear for members. A person's own history remains available to that person. Leaving a space removes history consent along with membership and the shared live location. A removed recorder or viewer cannot access the other's shared history. Locations already received by another device cannot be remotely erased from its screenshots or copies.

**Pause GPS** stops foreground GPS, automatic capture, and the native background task. Sign-out does the same before signing out of Firebase. Disabling Save my activity also stops background history. Background callbacks check the persisted stop and account scope before saving locations.

## What is measured

Movement samples are retained at most once every 30 seconds; stationary samples at most once every minute. GPS uncertainty above 80 metres, invalid coordinates, stale foreground fixes, and implausible jumps are excluded from automatic activity. Native batched updates may retain older recorded fixes after the current session's consent time, within the 30-day window; only the newest fresh position updates the live device. Stops need at least two minutes of nearby fixes; arrival/departure times are observations inferred from those fixes, not exact gate-crossing times. A confirmed stop at the end does not invent a departure. Saved safe-zone names can label stops when the uncertainty is entirely within the zone; otherwise the view shows measured coordinates, not an invented address.

Sessions, missing updates over two minutes, and impossible jumps produce gaps. Map routes remain separate across gaps, and unobserved intervals are excluded from observed distance and duration. Activity says Moving or Stopped; it does not claim driving, walking, or crash detection. The operating system may stop location delivery after force quit, revoke access, or restrict the app for battery reasons. Reopen the app to inspect its state and restart recording when necessary. Background location is unavailable in Expo Go and browsers; see [Expo Location](https://docs.expo.dev/versions/v57.0.0/sdk/location/).

## Storage and Firebase

Automatic history uses separate local day records per account, up to 30 days and 3,000 samples per day. The native Android storage plugin configures a 64 MB AsyncStorage database. A day that reaches the point cap is marked partial. Recording failures surface as errors; available browser/device storage can impose additional limits. Manual trips retain their existing independent limit and remain private on the phone.

Shared samples live at `circles/{spaceId}/activity/{uid}/samples/{sampleId}`. Consent lives at `circles/{spaceId}/historyConsent/{uid}`. Each sample has an immutable ID, consent generation, capture time, GPS fix, optional zone label, and `expiresAt` set 30 days later. The included `firestore.rules` validate coordinates, authorship, consent, current membership, and bounded queries. `firestore.indexes.json` includes the generation/date query index and a TTL policy for `samples.expiresAt`. Deploy both rules and indexes to your configured Firebase project. [Firestore TTL](https://firebase.google.com/docs/firestore/ttl) deletion is asynchronous, so expiry does not promise immediate physical deletion.

The free Spark deployment uses `firebase.spark.json` after running `node scripts/prepare-firebase-spark.cjs`. It preserves query indexes and omits TTL because automatic TTL deletion requires billing. The app's 30-day display window does not physically delete server documents. Uploaded history remains stored until explicitly deleted; turning sharing off revokes member access but does not delete samples. Keep this distinction clear when enabling shared history. See [Firebase setup](FIREBASE_SETUP.md).

Shared writes require a server transaction. Offline captures remain local; samples that cannot sync are not silently backfilled later. Shared history can therefore have gaps during outages. No historical private trips are imported into the cloud. Real multi-phone sharing needs the Firebase project described in [FIREBASE_SETUP.md](FIREBASE_SETUP.md); local emulator tests use a `demo-` project and loopback hosts.

## Build and run

Prepare the portable JDK and Android SDK packages once:

```powershell
python scripts/bootstrap-native.py
```

Build and install an Android emulator development build:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1 -Install
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1 android
```

For a physical ARM64 Android phone, pass `-Architecture arm64-v8a` to the build script. Use `all` for all architectures. The native build must be recreated after app-config permission changes. An iPhone native build requires macOS with `npx expo run:ios` or the existing EAS development-build configuration. Android and iPhone development builds use Metro; production or preview builds must bundle their JavaScript.

## Verification

`tests/activity.cjs` covers stop inference, observed arrivals/departures, gaps, jitter, uncertain fixes, calendar boundaries, local persistence, headless reload, duplicate suppression, and persisted stops. `tests/background-activity.cjs` covers top-level task registration, visible background indicators, native availability, account mismatch, and shutdown. `tests/firebase-rules/activity-history.cjs` verifies cross-space restrictions, explicit consent, bounded generation queries, opt-out/re-opt-in, removed members, immutable records, owner deletion, idempotent publishing, and local upload pause against the local Firestore emulator.

Browser tests exercise real account creation and invitations, private automatic capture, shared stop/route fixtures in the emulator, date selection, revocation, outsiders, and responsive layouts. [History preview](activity-history-web.png) uses explicitly simulated GPS in a local test project.

The native Android development build was compiled, installed, and tested on the Android 36 emulator. Native GPS callbacks saved new samples while the app was on the home screen. Pause GPS cleared the persisted capture state, stopped active native recording, and prevented further samples after the simulated GPS position changed. An inactive bound Expo service object can remain after recording stops; its foreground notification and started state are removed. The [native history preview](activity-native-background.png) uses those test samples. The [native calendar](activity-calendar-android.png) was checked for seven aligned columns, empty-date selection, and return to recorded history. TypeScript, all 65 current core/history/rules checks, the browser flow, and Android/iOS/web JavaScript exports passed. Physical Android phones, native iOS background behavior, and live Firebase provisioning still need device/project verification. Test coordinates do not establish physical-phone accuracy.
