# Battery pins and arrival alerts

Profile pins show the device's measured battery percentage. Unknown readings show a dash; stale pins retain a dimmed last report. Selecting a person at one of your saved places shows the place name, arrival or first-seen time, and observed stay duration beside the photo.

## Place names and times

Create places in **Safe places** by tapping the map or a Google Maps place and saving a name such as Home, School, or Work. Add an optional description. Your selected pin defines the location; the optional arrival distance allows for GPS uncertainty around that pin.

The app confirms transitions with distinct, accurate GPS readings. It does not report an arrival on the first snapshot of somebody already at a place. Such a pin says **First seen** and **Here for at least…**. A confirmed arrival says **Arrived** and **Here for…**. Long gaps reset continuity, and stale GPS changes the label to **Last seen here**. These are observations, not a reconstruction of time when GPS was unavailable.

## Notifications on your phone

Version 0.1.5 also prepares FCM-based closed-app delivery for family arrivals and other alerts. Its trusted sender needs separate activation; see [phone notifications](PHONE_NOTIFICATIONS.md). The local monitor below remains available, and its Settings label is now **Background location monitoring**.

1. Install the updated Android app. The notification module needs a native update; reloading an older development build is insufficient.
2. Save at least one place with **Arrival & departure alerts** enabled.
3. In **Settings**, enable **Arrival notifications**, then **Background location monitoring** (called **Notify when app is closed** in earlier APKs).
4. Read the app's explanation, then grant Android notification permission and background location access (**Allow all the time**).

Android displays a persistent **Closeby arrival alerts are on** notification while monitoring is enabled. The service monitors your own saved places and checks your current space's shared device positions about once a minute. Arrivals and departures appear in the phone's notification tray with the observed time. Tapping a notification opens that person's map pin. In the foreground, Closeby uses its styled in-app arrival banner instead of duplicating the phone notification.

Family members must choose to share fresh GPS. To keep their position updating while their own phones are in the background, they also need background monitoring or the existing background recording feature. Receiving family notifications does not enable your own location sharing or history recording. Place definitions stay on this phone for the local monitor. Explicitly enabling the new **Phone notifications** setting privately synchronizes places for trusted server evaluation.

The local monitor uses existing authenticated Firebase space reads and local Android notifications. It does not require a new cloud function, push-token exchange, or a separate notification service. Failed family refreshes do not invent arrivals; own-place alerts can continue. Temporary notification delivery failures are retried with the same event identifier. Account changes, space changes, disabled places, and revoked sharing clear incompatible pending observations or deliveries.

Pause GPS, turn off phone arrival notifications, or sign out to stop the monitoring service. Android force-stop, device restarts, manufacturer power management, unavailable GPS, and loss of network access can delay or prevent alerts. Reopen Closeby after a restart and check that monitoring is enabled. Delivery is not guaranteed or an emergency service.

## Development and standalone builds

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-android.ps1 -Architecture phone-and-emulator
powershell -ExecutionPolicy Bypass -File .\scripts\build-android.ps1 -Architecture phone-and-emulator -Variant release
```

The debug APK supports the development server. A recreated JavaScript process needs that server to load its code. The standalone preview includes its JavaScript and runs without the development computer. Both use this workspace's existing development signing key and are for testing.

For subsequent JavaScript-only changes, add `-SkipPrebuild` to reuse the generated native project. Run the full command after changing native dependencies or app configuration.

Validation includes 64 related tests, TypeScript checks, responsive browser flows, and Android emulator checks. The standalone APK opened without Metro, enabled monitoring through the actual Settings dialog, delivered a saved-place arrival notification in the background, and opened the selected photo/avatar pin with its battery and stay time when that notification was tapped. Physical Samsung/other Android power-management behavior and end-to-end delivery between two physical phones still need device testing.
