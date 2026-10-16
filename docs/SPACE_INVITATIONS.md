# Invite someone to your Closeby space

Install **Closeby 0.1.7** on both phones. In **Spaces**, tap **Invite someone to your space**, then choose a person in your phone's share sheet. You can also open the space's plus button and choose **Share invitation link**.

The recipient taps the invitation link, signs in if needed, and chooses **Accept invitation & join**. The code is filled in automatically and survives signing in or reopening the app. Opening a link does not join a space or enable GPS, location sharing, camera, or microphone access.

New invitations use **12 characters**, displayed as `ABCD-2345-WXYZ`. If opening the link is inconvenient, enter that short code in **Spaces → Create or join a space → Invitation code**. You can paste the complete invitation link into that field too. Previous 32-character invitations remain supported by the new app and backend rules.

Links use `https://closeby-511018.web.app/j/CODE`. On updated Android installations, verified App Links open Closeby directly. If a messaging app keeps the link in its own browser, tap **Open in Closeby**. The invitation page also provides **Copy invitation code**. A person without Closeby should get the current Android APK from the inviter, install it, and return to the original invitation.

Invitations expire seven days after creation or renewal. The owner can choose **Renew invitation code** to invalidate the previous link and code while keeping existing members. This also replaces an existing long code with a short code. A person already in another space must explicitly leave that space before accepting a new invitation. Each phone still controls its own location-sharing choice.

## Implementation and release

`src/lib/invitations.ts` generates short codes from twelve secure random bytes using a 32-character alphabet without `0`, `1`, `I`, or `O` (60 random bits). Parsing accepts only the owned HTTPS host, the `closeby://join/CODE` fallback, or the current web app's origin. Links never trigger an automatic membership write. Firestore still requires authentication, invitation expiry checks, owner-controlled renewal, explicit membership creation, and private-space membership for location reads. Invitation collection listing remains denied.

`useInvitationLink` runs above the sign-in screens and saves a pending invitation locally until accepted or dismissed. Incoming URL events take precedence over stale initial URLs or saved data. Completing an older join cannot dismiss a newer incoming invitation. The browser URL is cleared when an invitation is consumed so a refresh does not open it again.

Android's `/j/` HTTPS intent filter and `web/invite/.well-known/assetlinks.json` associate the public host with `com.closeby.tracker` and the existing release signing certificate. The same custom scheme supports the explicit Open button. iPhone HTTPS Universal Links are not configured; an installed native iOS build can use the page's custom-scheme Open button. There is no distributed iPhone build in this workspace.

To prepare the dedicated Firebase Hosting site after building the current signed APK:

```powershell
node scripts/prepare-invites.cjs
node .verification/firebase/node_modules/firebase-tools/lib/bin/firebase.js deploy --project n8n-projects-511018 --config firebase.invites.json --only hosting
```

This publishes only the dedicated `closeby-511018` site. It serves the invitation page and Android association file. It does not host the authenticated tracker or read private space data. The default Firebase Hosting site is separate. Keep the release signing key unchanged and keep the association file in sync if its certificate changes.

Firebase rejected the initial APK upload because [Spark Hosting blocks executable files, including APKs](https://firebase.google.com/support/faq#hosting-exe-restrictions). Billing remains unchanged. The signed APK is distributed separately from `dist/android/Closeby-0.1.7.apk`; the public page provides installation instructions rather than a broken download link. `prepare-invites.cjs` removes only obsolete generated APK/metadata files from the hosting staging directory, and the hosting config excludes downloads.

The short-code format also needs the matching `firestore.rules` deployment. Existing 32-character clients remain compatible with those rules; a new APK is needed to generate short codes and handle invitation links. Review the rules change and run the emulator checks before deploying.

The platform behavior follows [React Native linking](https://reactnative.dev/docs/linking), [Android App Links](https://developer.android.com/training/app-links), and [Expo incoming links](https://docs.expo.dev/linking/into-your-app/).

## Verification on October 16, 2026

The invitation rules and dedicated Hosting site are deployed. Live checks returned the invitation page and the Android association JSON successfully, with the certificate matching the signed 0.1.7 APK. The default Hosting site and billing plan were preserved.

TypeScript, 156 app/service checks, and 62 isolated Firestore rules/service checks passed. A two-account browser test covered the native share payload, direct Invite button, short-code acceptance, clipboard, pending invitation through sign-in and reload, explicit joining, protection for an existing space, and a 320px viewport. It requested no GPS access and recorded no page errors. These tests used isolated emulators rather than production accounts or records.

On a separate Android 36 emulator with the signed release APK, Android reported `closeby-511018.web.app: verified`. Opening an implicit HTTPS invitation launched Closeby from a closed state and showed the invitation banner on the sign-in screen. A second invitation reached the running app. No Google account was used and no app crash was recorded. The new emulator initially showed Android system-UI startup errors; choosing Wait allowed the app check to complete. Both real phones still need the APK update, and browser behavior can vary by messaging app.

See [release verification](APK_RELEASE.md#release-verification) for the APK size and checksum.
