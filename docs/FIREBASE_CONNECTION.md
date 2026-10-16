# Closeby development Firebase connection

Configured October 14, 2026, using the existing **N8N PROJECTS** Google Cloud project:

- Project ID: `n8n-projects-511018`
- [Firebase Console](https://console.firebase.google.com/project/n8n-projects-511018/overview)
- Plan: Spark; Cloud Billing is disabled.
- Web app registration: **Closeby**, used by the Firebase JavaScript SDK on Android, iOS, and web.
- Authentication: email/password and Google providers enabled. Google sign-in is configured for the installed Closeby Android development build.
- Android app: **Closeby Android**, package `com.closeby.tracker`, registered October 15, 2026 with the APK's SHA-1 and SHA-256 signing fingerprints. The matching Android OAuth client was generated, and the existing Google provider's Web OAuth client ID is saved in `.env`.
- Standalone APK signing: on October 16, the separate private release certificate's SHA-1/SHA-256 were added to that Android app. Its SDK configuration now includes Android OAuth clients for both development and release certificates. See [APK release instructions](APK_RELEASE.md) for the release fingerprint and signing backup.
- Firestore: Standard edition, native mode, `(default)` database in `asia-southeast1` (Singapore), using the free tier.
- Access rules and five composite query indexes deployed through `firebase.spark.json`; all five indexes are confirmed `READY`. The October 16 update includes private avatar profiles, the APK's member/device fields, calls, and owner-managed device request roles with recipient-only approval.
- Connection values saved in the ignored local `.env`; the ArcGIS key was preserved. The emulator-host setting is empty, so Closeby uses the live project.

On October 16, 2026, the user approved a fresh reset of Closeby data and both Firebase Google sign-in users. All **53 Firestore documents** (including nested call candidates) and **2 Firebase Authentication users** were removed. A separate post-reset inventory confirmed **0 documents, 0 root collections, and 0 authentication users**. A private recovery backup is retained under `.private/data-reset/`. The actual Google accounts, app registrations, Google sign-in configuration, security rules, indexes, and release APK were unchanged. Sign in again and create a new private space to test the fresh app.

Verified live registration, app login, own-profile access, and rejection of unauthenticated/cross-account profile reads. The temporary test account was deleted. The Android Expo Go login screen loads with Firebase configured. All 37 local security/consent tests passed.

On October 16, the current rules passed 55 local privacy/consent checks and were deployed to the live project. A further live check used the actual app services with separate temporary owner/family/outsider accounts: space creation, invitation acceptance, profile and device writes, requester roles, and the incoming-request query passed. Nonmembers and unauthenticated users remained denied. All generated documents and temporary accounts were removed. The existing standalone APK picks up this backend fix after reopening; a replacement APK is not required.

Reload the project and choose **Sign up free** to create your own email/password account. In the installed Closeby development app, **Continue with Google** opens Google's sign-in flow. Enter credentials only in the app or Google's sign-in screen. Location and history sharing remain off until you enable them. Expo Go supports email/password; Google sign-in requires the installed Closeby development build.

The Spark configuration omits automatic TTL deletion because it requires billing. The app shows a 30-day history window, but uploaded history remains in Firestore until explicitly deleted. Turning sharing off revokes member access; it does not delete those samples. See [setup and deployment instructions](FIREBASE_SETUP.md).
