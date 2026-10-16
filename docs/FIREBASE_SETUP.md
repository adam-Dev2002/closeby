# Connect Closeby to your Firebase project

The app includes Firebase email/password authentication, native Google sign-in support, and realtime circle/device syncing. Connection settings belong in the local `.env` file. With empty configuration, the app opens in local-device mode for GPS and local tracking; account features need Firebase. Local mode does not simulate a successful login or upload locations. See [this workspace's connection status](FIREBASE_CONNECTION.md) for the configured development project.

## 1. Create or select your project

Open the [Firebase console](https://console.firebase.google.com/), choose **Create a project**, and give it a name such as `Closeby development`. Google Analytics is optional for this app.

If the console says you have reached the project limit, this is the Google account's project-creation quota, not a full database. Check your [existing Google Cloud projects](https://console.cloud.google.com/cloud-resource-manager) with the same account. Prefer an unused project you own that can be dedicated to Closeby. From the Firebase create-project screen, use **Add Firebase to Google Cloud project** (or the existing-project option), select that project, and complete the setup. If it already has Firebase, open it directly. See [Firebase's project quota FAQ](https://firebase.google.com/support/faq) and [existing-project setup](https://firebase.google.com/docs/web/setup).

Check whether an existing project has billing linked before using it; adding Firebase to a billed Google Cloud project uses that project's billing configuration. Do not deploy Closeby's rules into a project serving another app without reviewing and merging its existing rules and indexes. Deployment replaces the configured rules and can affect existing data access. If no suitable project is available, request a project-quota increase through the console. A different backend requires changing the authentication and shared-data implementation; local-device mode remains available while setup is pending.

If `projects:addfirebase` returns `403 PERMISSION_DENIED` despite the account having Owner access and the required permissions, open [Firebase's terms acceptance check](https://console.firebase.google.com/?forceCheckTos=true) in that same account. Review and accept the Firebase Terms if you agree. Google requires this account-level step in the Firebase Console; it cannot be completed through the CLI. See [Google's troubleshooting guide](https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project).

You can start with the **Spark** plan for development. Firebase services have quotas and plan limits; review [Firebase pricing](https://firebase.google.com/pricing) as usage grows. This version does not need Cloud Functions or Cloud Storage.

## 2. Enable authentication

In **Build → Authentication → Get started → Sign-in method**:

- Enable **Email/Password**.
- Enable **Google** if you want Google sign-in, and choose a project support email.
- For browser testing, add `localhost` under **Settings → Authorized domains** if it is absent. Add your deployed website domain later.

Email registration sets the display name and sends a verification email. Password reset sends Firebase's reset email. These messages use the templates in your Firebase console. See [Firebase Authentication setup](https://firebase.google.com/docs/auth/web/start).

## 3. Create the Firestore database

In **Build → Firestore Database**, create the **Standard edition**, default database. Choose a location near your users and start in **production mode**. Deploy the included rules in step 5 before trying circles; do not enable public database access.

## 4. Add the public app configuration

In **Project settings → General → Your apps**, register a **Web app** using the `</>` button. The mobile app uses Firebase's JavaScript SDK, so this Web app configuration is also used on Android and iOS. Firebase Hosting is optional.

Use the existing `.env` in the project root and preserve its ArcGIS key and other values. Only create the file if it does not already exist:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
  Copy-Item -LiteralPath .env.example -Destination .env
}
```

Copy the values from Firebase's configuration object into `.env`:

| Firebase config field | Environment variable |
| --- | --- |
| `apiKey` | `EXPO_PUBLIC_FIREBASE_API_KEY` |
| `authDomain` | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `EXPO_PUBLIC_FIREBASE_PROJECT_ID` |
| `storageBucket` | `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `EXPO_PUBLIC_FIREBASE_APP_ID` |

Restart Expo after editing `.env`. These `EXPO_PUBLIC_` values are bundled into the app and are public identifiers. Keep service-account JSON files, private keys, OAuth client secrets, and Admin SDK credentials out of the app. Access to shared locations is enforced by the Firestore rules, not by hiding the public configuration.

## 5. Deploy this project's access rules

With Node installed, run these commands from the project folder. Replace `YOUR_PROJECT_ID` with the exact Firebase project ID from step 4:

```powershell
npx firebase-tools@15.33.0 login
node scripts/prepare-firebase-spark.cjs
npx firebase-tools@15.33.0 deploy --only "firestore:rules,firestore:indexes" --config firebase.spark.json --project YOUR_PROJECT_ID
```

The free-plan deployment uses `firebase.spark.json`, `firestore.rules`, and generated indexes under `.verification`. The preparation script preserves the four query indexes and field exemptions from `firestore.indexes.json` but omits its TTL policy. Emergency alert queries require three composite indexes; shared activity uses the generation/capture-time index. Wait until indexes are ready in the Firestore console before testing. You do not need to run `firebase init`. This command changes the rules on the project you name. See the [Firebase CLI reference](https://firebase.google.com/docs/cli) and [history setup](HISTORY_ACTIVITY.md).

**Spark retention limitation:** automatic TTL deletion requires billing. On Spark, the app displays only its 30-day history window, but uploaded documents remain in Firestore until explicitly deleted. Turning history sharing off revokes space-member access; it does not physically delete uploaded samples. History sharing is off initially. Use the Firebase console or a trusted cleanup process for deletion. Do not promise automatic 30-day server deletion with this setup. Projects that intentionally use billing can deploy the original `firebase.json` configuration with its TTL policy; this guide does not enable billing. See [Firestore's billing requirements](https://firebase.google.com/docs/firestore/pricing).

Now start Closeby, create an email account, and create a circle. On another phone, sign in with a different account and explicitly enter the invitation code to join. Grant location access and turn sharing on to publish that phone's actual location. A second installation using the same account replaces the account's current device record.

## 6. Configure native Google sign-in

Email/password works in Expo Go after the Firebase configuration is supplied. Native Google sign-in uses custom native code and requires a **development build**; it cannot run in Expo Go. See the [Google sign-in library's Expo setup](https://react-native-google-signin.github.io/docs/setting-up/expo).

1. In the same Firebase project, register Android and iOS apps with the exact package/bundle ID from `app.config.ts`: currently `com.closeby.tracker`.
2. For Android, register the signing certificate's **SHA-1 and SHA-256** in the Firebase Android app settings. Use the certificate for the build you install: development and release certificates can differ. The Android OAuth client in the linked Google Cloud project must match that package and certificate. For EAS builds, use `npx eas-cli credentials -p android` to inspect your configured credentials.
3. In the linked Google Cloud project's **APIs & Services → Credentials**, find or create an OAuth client of type **Web application**. Put its client ID in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. The Web client ID is the ID-token audience on both Android and iOS; an Android client ID is not a substitute.
4. For iOS, create the OAuth client for the exact iOS bundle ID and put its client ID in `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. The app config derives the reversed iOS URL scheme and adds the native plugin when this value is present. Rebuild after changing native configuration.
5. Configure the Google OAuth consent screen and any required test users. For Android testing, use a phone with Google Play services or the prepared `Closeby_Phone_Google_API_36` emulator. The older basic AOSP image does not include Google Play services.

This project passes Google's ID token to Firebase using `signInWithCredential`. It uses the Firebase JavaScript SDK rather than a native Firebase SDK; public Firebase config and OAuth client IDs are the inputs to this implementation. Follow [Firebase's Google authentication guide](https://firebase.google.com/docs/auth/web/google-signin) for provider configuration.

To create an Android development build with EAS:

```powershell
npx expo install expo-dev-client
npx eas-cli build:configure
npx eas-cli build --platform android --profile development
npx expo start --dev-client
```

These build commands require an Expo account and may have service quotas or plan limits. Confirm the build profile uses `developmentClient: true` in `eas.json`. Install the resulting build on your phone or a compatible emulator. An Android emulator build may need a profile configured for an APK. For iOS devices, follow Expo's signing/device registration flow; a local iOS simulator requires macOS.

## How circle access works

- One active circle and one current device record per account are supported.
- A 32-character random invitation code represents 128 bits of cryptographic randomness and expires after seven days. Codes are bearer invitations: share them only with intended members. Joining with a code is the explicit invitation acceptance action.
- Signed-out users cannot read circle data. A member can read profiles and locations only within their circle. Each person can write only their own device record.
- A paused device has `location: null`; rules reject coordinates when `sharing` is false. Sharing updates are throttled to about one write per ten seconds while the app is running. Pause bypasses that throttle.
- Leaving deletes the current location and membership together, then removes future access to circle data. Listeners clear their displayed circle when membership changes.
- Sign-out first stops uploads and waits for the shared location to be cleared. If the network cannot confirm this, the app reports the failure. Pausing while offline can only remove the last remote location when the pending write reaches Firebase.
- Firestore uses an in-memory cache here. It does not persist shared coordinates to disk. Previously received information cannot be taken back from another person's device.

The app calls circles **Spaces**. Owners can renew invitations from the space's plus button; renewal atomically deletes the old invitation, creates a fresh seven-day code, and keeps existing members. Redeploy rules and indexes after updating this app: membership documents now allow names/photos, and the new `circles/{circleId}/messages/{messageId}` collection permits member-only chat. Existing membership documents remain compatible.

Messages use server timestamps and authenticated sender IDs. Current members can read the conversation and create messages of up to 2,000 characters. Messages cannot be edited or deleted by clients. The UI displays the latest 100 messages; older messages remain stored in Firestore. Leaving removes access to chat and locations, but retains previously sent messages. Chat works even when GPS or sharing is off.

Emergency records use `circles/{circleId}/alerts/{alertId}`. Rules restrict private owner alerts to the sender and owner, and space-wide alerts to current members. Each record stores the authenticated sender ID, audience, validated owner ID, server time, message, and optional coordinates. Direct owner alerts require that the owner is still a member. Leaving revokes access. Alert records cannot be edited or deleted by clients; use a trusted backend for retention. A stable ID and transaction make retries idempotent. Sending needs a server connection, and server acceptance does not establish a recipient read receipt.

Foreground speed warnings use measured GPS speed and do not automatically post a shared alert. In 0.1.5, explicitly enabling phone notifications privately synchronizes arrival/speed preferences for server evaluation. Native background history can include measured speed in shared device updates. Closed-app notifications are prepared but require separate server activation; see [Phone notifications](PHONE_NOTIFICATIONS.md).

This starter does not implement an admin dashboard, owner removal of members, automatic message retention, or server cleanup of stale/offline locations. Use a trusted backend for administrative removal, retention limits, and account deletion before a public release.

## Run the local rule tests

The included tests use only the **demo-closeby** local emulator project, so no Firebase account or cloud project is needed. Install [Java 21 or later](https://adoptium.net/temurin/releases/?version=21) and Node, then run:

```powershell
npm install --prefix .verification/firebase --no-audit --no-fund firebase-tools@15.33.0 @firebase/rules-unit-testing@6.0.0 firebase@13.0.0
.\.verification\firebase\node_modules\.bin\firebase.cmd emulators:exec --only firestore --project demo-closeby "node --test --test-concurrency=1 scripts/test-firestore-rules.cjs tests/firebase-rules/sharing-consent.cjs tests/firebase-rules/activity-history.cjs"
```

Tests cover unauthenticated and cross-circle denial, valid/expired/mismatched invitation codes, atomic circle creation and leaving, self-only location writes, profile pointer validation, and removal of coordinates when paused, including realtime location and message listeners. Tests also cover member profiles without GPS, private chat access, message validation, sender impersonation denial, post-leave access denial, and invitation renewal. Additional service tests check that an older asynchronous pause cannot erase newer sharing consent and that sharing resumes after a stop. See the [Firestore emulator guide](https://firebase.google.com/docs/emulator-suite/connect_firestore) and [rules testing guide](https://firebase.google.com/docs/firestore/security/test-rules-emulator).

Cloud email delivery, Google OAuth, multi-phone syncing against a live project, native development builds, and physical iOS behavior need testing after your project and signing credentials are configured. Local rule tests do not create or deploy cloud resources.

## Local development with test accounts

A development-only Firebase emulator option is available for isolated UI verification. Set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1` with a `demo-` project ID (for example `demo-closeby`), a dummy API key, `localhost` auth domain, and a test app ID. Start local Auth (9099) and Firestore (8080) emulators, then start Expo in development mode. The option rejects production builds, non-demo projects, and non-loopback hosts. Clear the emulator variable before building or connecting a real project. For Android with `127.0.0.1`, reverse both ports with `adb reverse tcp:9099 tcp:9099` and `adb reverse tcp:8080 tcp:8080`.

Local emulator tests cannot confirm live index provisioning, physical-phone GPS accuracy, or background delivery. Shared emergency production verification requires your own Firebase project, deployed rules/indexes, and separate member devices.
