# Refresh shared locations on the installed app

**Closeby 0.1.6** remembers GPS and sharing choices on this phone for each account. After enabling them once, reopening Closeby or returning from another app resumes foreground GPS and sharing using the existing permission. **Pause GPS** saves GPS and sharing as off. Turning off **Share my location** saves sharing as off while allowing private GPS. Leaving a space or signing out through Settings stops sharing. No saved coordinates are used to invent a current position.

Install `dist/android/Closeby-0.1.6.apk` over the existing app on both phones. On each phone, turn on **Share my location** on Map or in Spaces once. Enabling Android Location or tapping **Enable location** alone starts private GPS; it does not turn on sharing. If your partner shows **Not sharing**, they need to turn on the sharing switch on their own phone. Select them through **People** to center the map on their coordinates.

Existing location grants are checked before permission requests, including background history and arrival monitoring. Automatic foreground restoration never opens a permission prompt. If permission has expired or been revoked, Closeby explains the problem and an explicit enable action can request it again. Choose Android **While using the app** instead of **Only this time** for a lasting foreground grant. Android controls permission lifetime; see [one-time permissions](https://developer.android.com/training/permissions/requesting#one-time). Background access remains a separate setting.

Shared-location listeners reconnect after failures, when the app resumes, or with **Retry shared locations**. Connection errors appear on Map and in Spaces. Retry preserves the person's sharing choice and cannot enable GPS or sharing by itself.

Each phone must use its own account and join the same private space. The current app stores one device record per account, so using one account on both phones replaces that account's device record instead of creating two members.

To reconnect without installing another APK:

1. Open Closeby on both phones and keep it in the foreground while checking.
2. On Map, tap **Enable location** if GPS is paused, or the target button to center on this phone. Allow location access and wait for measured coordinates to appear. Android's Location service must be enabled; precise location improves accuracy.
3. Open **Spaces** and confirm the same space name and both members appear. Turn **Share my location** on on each phone. Wait about 10–20 seconds for a fresh GPS fix and the next upload.
4. In the member list, check that both members show **Live** and a recent update time. Use the pin button beside the other member to center the map on that phone. Nearby phones' map pins can overlap, and a zoomed-in map may show only the selected phone's area.

In 0.1.6, foreground sharing resumes after reopening if previously enabled. Leaving the foreground without an enabled background feature pauses location updates until you return; it preserves your saved choice. Background history and arrival monitoring have separate controls and Android background-permission requirements. Versions 0.1.5 and earlier start foreground sharing off after reopening and require explicitly enabling it again.

If this phone has no coordinates, check Android Location services and Closeby's location permission, and try an open area with a better GPS signal. If this phone has coordinates but the other member shows **Not sharing**, that member needs to enable sharing while keeping Closeby open. If the other member is missing entirely, check separate accounts and invitation-based space membership. An error in Spaces should be recorded with its exact text before changing cloud configuration.

The installed standalone APK cannot be remotely restarted or receive a client-code change through a Firebase refresh. Restarting and toggling sharing reconnect its existing code; a client-code fix still needs an APK update. Avoid clearing app data or uninstalling to perform this reconnect.

On October 16, 2026, a live production-backend check used temporary accounts and synthetic coordinates with the actual `createCircle`, `joinCircle`, `watchCircle`, `publishDevice`, `stopSharing`, and `beginCircleSession` services. Both members received each other's locations, pausing removed coordinates, and explicit resume delivered them again. Outsiders and unauthenticated users remained denied. All temporary accounts and generated documents were removed. No existing family account or real phone coordinates were read or changed. This establishes that backend sharing worked for those test accounts; it does not establish either physical phone's GPS, account, membership, or foreground state. No backend deployment or reset was needed.

See [Expo location behavior](https://docs.expo.dev/versions/latest/sdk/location/) and [Android location settings](https://support.google.com/android/answer/3467281).

## 0.1.6 verification

TypeScript and 148 app/service checks passed. `tests/location-sharing.cjs` exercises persisted GPS/sharing choices, automatic foreground resume, explicit pause, revoked grants without automatic prompts, account isolation, late callbacks, bounded listener recovery, and the first shared upload. Existing history, arrival, map, call, and consent checks also passed.

`tests/location-sharing-ui.cjs` passed against a development web export and isolated `demo-closeby` Auth/Firestore emulators, with two separate browser accounts and synthetic GPS. Both accounts received each other's coordinates after enabling the Map sharing switch; GPS and sharing survived reload, Pause GPS stayed off after reload, and the 320px layout had no horizontal overflow or page errors. These checks do not establish real-phone GPS accuracy or background behavior. No production account, location, or Firebase configuration was changed.
