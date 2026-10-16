# Phone notifications while Closeby is closed

The 0.1.5 Android build adds native Firebase Cloud Messaging registration, sound channels, and notification taps. The accompanying server sends emergencies, voice/video calls, camera/microphone requests, private-space messages, observed arrivals/departures, and enabled speed alerts. It uses FCM notification payloads, which Android can display while Closeby is minimized, locked, or no longer running. It does not rely on a JavaScript listener remaining alive on the receiving phone.

**Activation is pending.** The existing project is on Spark with billing disabled. The server is prepared and tested locally, but Firebase requires a billing-linked Blaze project to deploy Cloud Functions. No billing upgrade is performed by the build or activation scripts. The existing APKs cannot gain this native setup through a refresh. FCM itself is a no-cost service; compute, database operations and scheduled cleanup are subject to their service pricing and quotas. A separately hosted trusted sender is another option, but it must remain online. See [Firebase Functions deployment requirements](https://firebase.google.com/docs/functions/get-started) and [Firebase pricing](https://firebase.google.com/pricing).

After server activation, install 0.1.5 over the existing app on both phones. Each person opens **Settings → Phone notifications**, reads the explanation and enables notifications. Android permission and the individual sound channels must be allowed. The setting shows **delivery is awaiting activation** while the backend is not enabled; opting in alone does not mean remote delivery is operating.

Enabling phone alerts privately synchronizes up to 20 saved places and the account's arrival/speed settings for server evaluation. Other members cannot read these places, push tokens or preferences. Receiving a remote alert does not enable GPS, share location, or start a camera/microphone session. Incoming calls and device requests open the existing approval flow; a notification never accepts a request automatically. A message opens space chat, an emergency opens Safety, and arrival/speed notifications open the observed person's map pin. Notification targets are checked against the signed-in account, current space and expiration.

Emergency notifications use the bundled 10-second alert sound; calls/requests use the bundled 8-second ring. Messages, arrivals and speed alerts use the phone's default notification tone. All channels enable vibration and respect system volume, disabled channels and Do Not Disturb. The foreground emergency banner retains its existing repeating ring. A single notification does not keep ringing until someone answers.

Arrivals and speed alerts still require fresh shared GPS from the observed phone. That phone must explicitly enable background monitoring/recording if it should continue publishing while closed. The receiving phone needs notification permission and network access, without needing its own GPS to run. Own-device places without location sharing continue to use the existing local background monitor. While cloud arrivals are active, that monitor suppresses duplicate remote/actively-shared own arrival notifications.

Android Force stop in Settings prevents messaging until the app is reopened. Notification permission, network availability, battery restrictions and manufacturer behavior can prevent or delay delivery; push cannot provide an absolute guarantee. See [FCM background delivery](https://firebase.google.com/docs/cloud-messaging/android/receive-messages), [FCM prerequisites](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages), and [Expo notifications for SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/).

## Server and release setup

The Android build expects the existing Firebase Android SDK configuration at `.private/firebase/google-services.json`, matching `com.closeby.tracker`. Download it from the existing Firebase Android app's settings on another build machine. It contains client identifiers, not an FCM sender credential. Server credentials never enter the APK. `scripts/generate-emergency-ring.py` regenerates the notification sound assets.

The server source is in `functions/`. Build its shared arrival/speed evaluators with `node scripts/build-notification-functions.cjs`; install dependencies with `npm --prefix functions ci`. The functions run in `asia-southeast1` alongside the existing Firestore database, with no minimum instances and a maximum of two instances per function. Runtime service identity needs Firestore access and FCM send permission; use the platform identity rather than embedding a private key.

When billing-linked deployment is authorized and configured:

```powershell
node .verification/firebase/node_modules/firebase-tools/lib/bin/firebase.js deploy --project n8n-projects-511018 --config firebase.notifications.json --only 'functions,firestore:rules'
node scripts/activate-notifications.cjs
node scripts/activate-notifications.cjs --activate
```

`--activate` refuses to set the readiness flag unless billing is enabled and all six functions are ACTIVE. It never changes billing itself. `--disable` pauses new dispatch. The checker uses the existing Firebase CLI login under `.verification/firebase`; set `FIREBASE_TOOLS_LIB` to another CLI installation's `lib` directory when needed. Activation is a separate step from making an APK or deploying the private registration rules.

The server rechecks membership, private emergency audience, device-request authorization, enabled preferences and call expiry at send time. A private outbox deduplicates event creation and retries provider failures. Invalid FCM addresses are removed without deleting a newly rotated token. Successful addresses are remembered across partial retries. Android notification tags reduce duplicate tray entries; FCM delivery and the final provider-send/ack boundary are not exactly-once. Call pushes expire after at most two minutes; stale location observations do not invent arrivals or speed. Daily cleanup removes up to 400 outbox records older than seven days per run; this is bounded cleanup, not a paid Firestore TTL policy.

Turning phone alerts off erases synchronized places, disables the account's remote settings, removes this installation's address and unregisters native push. Sign-out performs that cleanup before signing out. Ordinary screen unmount does not unregister the address, so closing the app preserves opted-in reception.

## Verification

`node --test tests/phone-notifications.cjs` checks sound/permission ordering, denied permission, token rotation, account boundaries, opt-out during registration, tap validation and saved-place sanitizing. Existing arrival, speed, call and emergency checks also run.

Run rules and trusted-server tests only against the isolated demo project:

```powershell
node scripts/build-notification-functions.cjs
node .verification/firebase/node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --only firestore --project demo-closeby --config firebase.notifications.json "node --test --test-concurrency=1 tests/firebase-rules/phone-notifications.cjs tests/push-server.cjs"
```

The server tests use real Firestore transactions with a captured FCM adapter; they send no notification to a physical phone. They verify recipients, privacy, opt-out and role revocation, call expiry, duplicate events, persisted arrival/speed evaluation, sharing loss, invalid tokens and provider retries. Cloud-function activation and physical-phone delivery require separate confirmation; a successful unit/emulator run is not evidence that the hosted notification sender is live.
