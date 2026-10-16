# Closeby artwork

`closeby-logo.png` is the original 1254 × 1254 PNG supplied for Closeby and copied from the user-selected `elv.png` file. The artwork is preserved exactly.

SHA-256: `7a018b4abcb6656ee7701f0e871ece3327e0bf97010f6135304243af547d2c11`.

The same source is used for the Android/iOS app icon, browser favicon, native splash screen, and the shared `BrandLogo` component on sign-in, account loading, and Settings. Expo generates the platform-specific sizes during export/prebuild. The splash screen contains the artwork on black.

To replace it later, update this file and rebuild the native APK; an already installed app keeps its existing launcher icon until updated. Closeby 0.1.3 uses Android version code 4 and the existing release signing key.
