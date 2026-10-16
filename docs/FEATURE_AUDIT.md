# Closeby feature audit

Audit date: 2026-10-15 (Asia/Manila). This records the implementation **before the requested photo-marker, avatar-editor, and People-panel changes**. It compares the readable items in the supplied GPS-tracker screenshot with source code. "Implemented" describes code support; it does not imply that every physical phone, account, or network was tested. Only account/location configuration was visible in the screenshot's cropped Settings section.

| Screenshot feature | Status | Evidence and limits |
| --- | --- | --- |
| Interactive map and live user GPS | Implemented | [TrackingApp](../src/screens/TrackingApp.tsx), [native Google renderer](../src/components/GoogleTrackingMap.tsx), [useCircle](../src/hooks/useCircle.ts). Members must join a Space, grant GPS access, and enable their own sharing. Remote updates are throttled to about ten seconds. |
| Face/avatar markers on pinned locations | Missing | Native Google uses plain pins; Google web uses name labels; the Open map uses dots. Photos already appear in profile/member cards through [Avatar](../src/components/Ui.tsx). |
| Create an avatar without Google login | Missing | [Email signup](../src/auth/AuthProvider.tsx) sets a display name. Accounts without a photo use a generic user icon; there is no avatar editor yet. |
| Current street address | Missing | [Map/device views](../src/screens/DeviceProfileScreen.tsx) display measured coordinates. There is no reverse geocoding service. Saved local safe-zone names can label history stops. |
| Speed and battery percentage | Implemented | [useTracking](../src/hooks/useTracking.ts) reads device APIs; [device profile](../src/screens/DeviceProfileScreen.tsx) shows measured values. Unavailable values remain unknown; browser battery is not fabricated. |
| Last update and online/offline status | Partial | [format](../src/lib/format.ts) shows fix age and Live/Last known/Not sharing/Waiting for GPS. This is GPS freshness, not a network presence service. |
| Recenter, zoom, and map layers | Implemented | Map gestures, recenter control, and five [map styles](../src/lib/mapModel.ts). Network maps require functioning provider configuration. |
| Directions | Partial | Open position in Google Maps launches a coordinate search. There is no in-app route planner or directions-specific request. |
| People bottom sheet | Missing | The map has one selected-device card and device search. The full roster is on the separate [Spaces screen](../src/screens/SpaceScreen.tsx). |
| Create and join Circles | Implemented | [Circle service](../src/services/circles.ts) creates and joins private groups named Spaces in the UI. |
| Invite by code or link | Partial | Complete 32-character codes, share sheet, owner renewal, and seven-day expiry. No join-by-link/deep-link flow. |
| View members and their current status | Implemented | [Spaces](../src/screens/SpaceScreen.tsx) includes accepted members even while sharing is paused, last-update age, and available battery/status. |
| Toggle own location sharing | Implemented | Each person controls sharing. [Circle service](../src/services/circles.ts) clears remote coordinates on confirmed pause; offline deletion cannot be immediate. |
| Manage member permissions | Missing | Owner can renew invitations. There is no owner removal, role editor, or member-permission UI; [rules](../firestore.rules) deny member updates. |
| Switch between multiple Circles | Missing | One current Circle per account. Creating/joining another requires leaving the current Circle; [Circle service](../src/services/circles.ts) and [rules](../firestore.rules) enforce it. |
| Save Home, Work, School, and custom places | Implemented | [Geofence editor](../src/screens/GeofenceScreen.tsx) accepts custom names and a map-selected center. Up to 20 zones remain local to the device/account. |
| Set place radius | Implemented | Editor slider supports 50–1,000 metres plus color. [Tracking](../src/hooks/useTracking.ts) validates saved zones. |
| Arrival/departure notifications | Partial | Local entry/exit alerts use this phone's GPS while the app is open. No background push delivery for zones. |
| Choose Circle members for place alerts | Missing | Zones have no member list or cloud sharing model. They monitor this phone only. |
| Edit/remove saved locations | Implemented | [Geofence editor](../src/screens/GeofenceScreen.tsx) updates names, coordinates, radius/color, and deletes local zones. |
| Daily location history | Implemented | Opt-in [activity capture](../src/services/activityCapture.ts), member selection, and private/shared views. Shared history requires separate consent. |
| Previous routes on a map | Implemented | [History](../src/screens/HistoryScreen.tsx) plots recorded segments; gaps remain separate. Manual trips remain private to the device. |
| Stops and movements timeline | Implemented | [Activity logic](../src/lib/activity.ts) infers stops after at least two minutes of nearby valid readings. |
| Arrival/departure records | Partial | Observed stop arrival/departure times are estimates from captured GPS, not exact boundary crossings. Missing departure observations stay unknown. |
| Distance and trip duration | Implemented | [History](../src/screens/HistoryScreen.tsx) shows observed distance/time; unrecorded gaps are excluded. Manual trip totals preserve accumulated accepted distance. |
| Calendar for historical dates | Implemented | Calendar selects the last 30 days. Empty dates remain empty. Automatic history allows at most 3,000 samples per day. |
| Settings/profile account and location controls | Implemented | [Settings](../src/screens/TrackingApp.tsx) provides account access, own sharing, recording/history consent, optional background GPS, permissions, and deletion. Profile is mostly measured device details, with no general profile editor yet. |

Background GPS/history is an explicit installed-app option, with an Android recording notification. Expo Go and browsers remain foreground-only. The [history guide](HISTORY_ACTIVITY.md) documents sampling, retention, consent, and physical-device limits. No camera/microphone control exists in this audit baseline; the requested interaction needs clarification before implementation.

## Checks performed

The following existing tests ran locally without production cloud writes:

```powershell
node --test tests/activity.cjs tests/background-activity.cjs tests/speed-alerts.cjs tests/firebase-init.cjs tests/google-map.cjs tests/open-map.cjs
node --test tests/firebase-rules/sharing-consent.cjs
```

Sixty checks passed: seven activity, eight background, twenty-two speed/preference/distance, ten Firebase initialization, ten Open map, and three sharing-consent tests. The Google map suite failed during setup with `Unexpected dependency: expo`: its old mock supplies `expo-constants`, while the renderer now imports `isRunningInExpoGo` from `expo`. This is a test-harness incompatibility; the suite did not exercise map behavior. Update the mock and rerun when changing the markers.

The Firestore activity-history suite was attempted without `FIRESTORE_EMULATOR_HOST` and failed during setup, so its rules checks were not exercised. It requires an isolated Firebase emulator; no cloud writes occurred. Existing documents describe older emulator/browser/native checks, which were not reproduced by this audit.

This source review and these checks do not establish two-physical-phone sharing, actual phone GPS accuracy, native iOS background behavior, separate-network availability, or every screenshot feature. Native/browser interaction tests and configured emulator rule tests remain necessary for the new UI work.
