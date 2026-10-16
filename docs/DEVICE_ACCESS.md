# Camera and microphone requests

For missing shared map positions, see [refresh shared locations](LOCATION_SHARING.md).
For short space codes and links that open Closeby, see [space invitations](SPACE_INVITATIONS.md).
Closeby **0.1.6** remembers GPS and location-sharing choices, reuses existing location grants, and adds a sharing switch directly on Map. **Not sharing** means the member must enable **Share my location** on their own phone; enabling GPS alone does not publish it.
For call/device-request notifications while the Android app is closed, see [phone notifications and pending server activation](PHONE_NOTIFICATIONS.md). Notifications open the approval flow and never start capture automatically.

## Keep an approved camera or microphone session running in the background

This is already included in **Closeby 0.1.5**. On the member's phone, open the incoming device request, turn on **Allow background sharing this time**, and then choose **Approve ... once**. Allow the requested Android camera/microphone and notification permissions. Wait for the live sharing screen and the ongoing **Closeby: live device sharing** notification before minimizing or locking the phone. Use **Stop sharing** in Closeby or the notification to end it.

An approved device-sharing session can continue in the background; starting a new session still requires the member to open Closeby and approve. The requester keeps Closeby open. Ordinary two-way voice/video calls use the foreground call flow. This background device-sharing feature does not need a Firebase billing upgrade. The cloud notification sender remains inactive, so both people should keep Closeby open while sending and approving a new request.

If 0.1.5 is already installed, another download is unnecessary for this feature. Older installations can install `dist/android/Closeby-0.1.5.apk` over the existing app without uninstalling.

## Send and approve a request

Open **Settings → Camera & microphone requests**, or **People → Camera & microphone requests**.

1. Each person signs in with their own account and joins the same private space using its invitation code.
2. The space owner can send device requests and authorize specific existing members using the switches beside their names. This grants permission to send a request, not permission to access another device.
3. Choose **Request microphone**, **Request front camera + mic**, or **Request rear camera + mic** beside another member. Both people keep Closeby open until approval. Requests expire after two minutes.
4. The receiving person sees who is requesting access and exactly which camera and microphone will be shared. They must choose **Approve … once** and allow any operating system permissions. Declining or ignoring a request starts no capture.
5. During an approved session, the receiving phone shows a live sharing indicator, its camera preview when applicable, local mute/camera controls, and **Stop sharing**. The requester receives media without enabling their own camera or microphone.
6. In the updated Android app, the receiving person can enable **Allow background sharing this time** before approving. It starts a camera/microphone foreground service with an ongoing **Closeby: live device sharing** notification and **Stop sharing** action. Once started, that session continues when the receiving phone is locked, minimized, or swiped out of Recent apps. The requester must keep Closeby open.

Either participant can stop. Without the per-session Android background choice, leaving the app or hiding the browser tab stops local media. Signing out, losing space access, revoking requester permission, stopping the notification, disabling sharing notifications, or reaching the two-hour session limit ends background capture too. Android's Force stop and Active apps Stop controls terminate the process. A killed process or restarted phone never restarts or restores media capture. The owner must open the app and approve a new request to start again. Device makers can also terminate services under their own battery restrictions; physical-phone testing is required.

The foreground Headless JS task and native WebRTC tracks own background sessions independently of React screens. Removing a screen subscription does not close approved media. The Android service also tracks native camera/microphone resources so the notification Stop action can release them directly without waiting for JavaScript or a network write. Reopening Closeby attaches to the same live session and preserves its mute/camera settings. No background consent is saved for later requests.

Requester permission changes are observed through live membership listeners and end sessions when received; the server also denies further approval and signaling after revocation. An offline device cannot receive a role change until its connection returns. Each new request and each camera change needs a new approval. Closeby does not record these streams.

The approved camera is immutable for the session. Camera requests require exact front/rear selection and a matching reported camera setting; unavailable or unconfirmed cameras fail with an error rather than silently selecting another camera. See the browser API references for [camera facing constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode) and [receive-only WebRTC transceivers](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTransceiver).

## Setup and release

- Install **Closeby 0.1.5** on both phones for the current native background-sharing support, request-listener recovery, shared approval modal, and Android call-message fix. A failed incoming listener reconnects automatically, on app resume, or with **Retry incoming requests**. The approval panel uses the same app modal as Settings/People, so an already open sheet cannot cover it. Keep both apps open when sending a new request.

- To create and share a standalone Android APK, follow [APK_RELEASE.md](APK_RELEASE.md). Signing and cloud certificate registration are separate from deploying the current Firestore rules.
- Deploy the updated `firestore.rules` and the existing call index in `firestore.indexes.json` with your normal Firebase release process. The rules enforce owner-managed requester roles, recipient-only approval, immutable camera choice, participant privacy, and signaling only after acceptance.
- Rebuild Android with `react-native-webrtc` and `plugins/with-media-session.js`. The plugin adds the camera/microphone foreground service, notification permissions, and native package. This is required; an older installed binary cannot enable background sharing. iOS and web continue to use foreground-only WebView/browser sessions.
- Browser capture needs HTTPS or localhost. Native device testing should use an installed Closeby build, not assume Expo Go has the required native configuration.
- Configure `EXPO_PUBLIC_CALLS_TURN_CREDENTIALS_URL` if calls must work across networks that need a relay. It must be an HTTPS endpoint that verifies a Firebase ID token and returns short-lived `iceServers` credentials. Without TURN, some network pairs cannot connect.
- Verify front/rear selection, permission denial, notification Stop, screen lock, swipe-away, force-stop, and reconnect behavior on physical phones before releasing. Unit and browser tests use mocked/fake devices; the isolated Android integration test uses only the emulator's virtual camera/microphone, never a physical device or real Firebase accounts.

Android background behavior follows [camera/microphone foreground service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types), [foreground start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), and [user-initiated stopping](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping). It cannot remotely start a new session while the app is closed.

## Stuck on Connecting

Closeby 0.1.4 fixes an Android call-message filter. The WebView's current Android bridge reports a message's source as `https://closeby.local`, while older bridges report the full document URL. The app previously accepted only the document URL with a slash after the host. As a result it could ignore readiness, SDP/ICE, connection-state, and media-error messages even when Android permissions were allowed. The filter now accepts the exact owned origin as well as its document URLs, while still rejecting other origins and other call channels.

To reconnect without reinstalling, end the current request on both phones, use Android **Settings → Apps → Closeby → Force stop**, then open both apps and send a fresh request. This ends any live sharing session; it does not erase app data. Check that Android's separate **Camera access** and **Microphone access** Quick Settings switches are enabled as well as Closeby's app permissions. Close other camera/recording apps before retrying. See [Android's camera and microphone controls](https://support.google.com/android/answer/13532937).

For an ordinary video call, each phone should show its own preview after acceptance. For a camera access request, only the approving phone shows its own camera; the requester intentionally captures no camera or microphone and sees the approved remote stream instead. Missing local capture on the approving phone needs media-startup diagnosis before attributing it to a relay or Firebase. Sharing the same Wi-Fi does not guarantee that a guest network or access-point isolation allows direct connections. No TURN endpoint is configured in this project, so networks that block direct media still require a properly authenticated relay.

The current APK, including 0.1.4, contains its JavaScript in the APK and has remote updates disabled (`expo-updates` is not installed). Restarting reconnects its existing code; deploying Firebase rules or refreshing a web preview cannot replace it. Install 0.1.4 over the existing app on both phones to receive this fix. Future remote code updates would require configuring an update service and shipping an update-capable native build once; they cannot be enabled remotely in an already installed APK. See [Expo's update build configuration](https://docs.expo.dev/versions/latest/sdk/updates/).

The call-message regression checks exercise the native component with Android origin-only events, including offer, state, error, untrusted-origin and wrong-channel handling. Browser integration checks exchange actual WebRTC packets and synthetic video frames for microphone/front/rear requests. Live Firebase checks still pass for request delivery, acceptance, SDP/ICE and ending. These checks do not establish that either physical phone's camera starts; a local foreground emulator attempt could not provide a reliable end-to-end result.

## Local verification

Run `node --test tests/background-media.cjs tests/calls.cjs tests/call-inbox.cjs` for approval, signaling, role/permission loss, headless lifetime, late permissions, and cleanup checks. The native integration test requires the rebuilt debug APK on `emulator-5554`, virtual front/rear cameras, no host audio input, and Metro at port 8084. Run `node tests/native-background.cjs`; its dedicated `tests/native-background-fixture.tsx` entry and loopback server use no real users or Firebase writes. It checks RTP/video after removing the app task, notification Stop, force-stop, camera selection, and native cleanup errors. The fixture is never imported by the product entry.

`tests/firebase-rules/calls.cjs` also exercises the actual call service against the isolated Firestore emulator, including incoming delivery, recipient acceptance, SDP/ICE signaling, and larger membership batches. For the approval UI check, export the web app with `--dev` and the `demo-closeby` emulator configuration into `.verification/call-fix-web-dev`, then run `node tests/call-ui.cjs` through `firebase emulators:exec --only auth,firestore --project demo-closeby`. The UI check uses separate local accounts and verifies all three approval choices over an already open Settings sheet without approving media capture.

On October 16, 2026, live checks with temporary accounts verified voice/video calls and microphone/front/rear requests using the app services: creation, both participants' call listeners, recipient incoming delivery, acceptance, signaling, and ending. All temporary accounts and documents were removed. The deployed rules already matched the local rules and did not need another deployment. The reported immediate permission error was not reproduced with those accounts; the app changes address failed listeners remaining disconnected and overlapping approval dialogs. Physical-phone confirmation with the updated APK is still required.

No developer account bypasses device approval. Grant an existing member the requester role instead of creating or sharing another person's credentials.
