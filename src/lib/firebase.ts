import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { Platform } from 'react-native';

// Expo replaces these direct property accesses when bundling. These are public
// app identifiers, never a service-account key or an OAuth client secret.
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim(),
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim(),
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim(),
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID?.trim(),
};

export const isFirebaseConfigured = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId,
);
export const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
export const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST?.trim();

let app: FirebaseApp | null = null;
let auth: FirebaseAuth.Auth | null = null;
let database: Firestore | null = null;
let initializationError: string | null = null;

if (isFirebaseConfigured) {
  try {
    if (emulatorHost && (!__DEV__ || !config.projectId?.startsWith('demo-') || !['127.0.0.1', 'localhost', '10.0.2.2'].includes(emulatorHost))) {
      throw new Error('Local Firebase testing requires a development build, a demo- project, and a loopback emulator host.');
    }
    app = getApps().length ? getApp() : initializeApp(config);
    if (Platform.OS === 'web') {
      auth = FirebaseAuth.getAuth(app);
    } else {
      // Firebase's React Native entry exports this API, but its common web
      // declarations omit it. Metro resolves the native entry at runtime.
      const nativeAuth = FirebaseAuth as typeof FirebaseAuth & {
        getReactNativePersistence(storage: typeof AsyncStorage): FirebaseAuth.Persistence;
      };
      try {
        auth = FirebaseAuth.initializeAuth(app, {
          persistence: nativeAuth.getReactNativePersistence(AsyncStorage),
        });
      } catch (cause) {
        if ((cause as { code?: string }).code !== 'auth/already-initialized') throw cause;
        auth = FirebaseAuth.getAuth(app);
      }
    }
    // Memory-only Firestore cache: shared coordinates are not persisted to disk.
    database = getFirestore(app);
    if (emulatorHost) {
      FirebaseAuth.connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
      connectFirestoreEmulator(database, emulatorHost, 8080);
    }
  } catch (cause) {
    auth = null; database = null; app = null;
    initializationError = cause instanceof Error ? cause.message : 'Firebase could not initialize.';
  }
}

export const firebaseApp = app;
export const firebaseAuth = auth;
export const firestore = database;
export const firebaseInitializationError = initializationError;

export function requireFirebaseAuth(): FirebaseAuth.Auth {
  if (!auth) {
    throw new Error(initializationError || 'Connect your Firebase project first. Follow docs/FIREBASE_SETUP.md.');
  }
  return auth;
}

export function requireFirestore(): Firestore {
  if (!database) {
    throw new Error(initializationError || 'Connect your Firebase project first. Follow docs/FIREBASE_SETUP.md.');
  }
  return database;
}

export function backendError(cause: unknown): string {
  const code = (cause as { code?: string })?.code;
  const messages: Record<string, string> = {
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/user-not-found': 'The email or password is incorrect.',
    'auth/wrong-password': 'The email or password is incorrect.',
    'auth/email-already-in-use': 'An account already uses this email. Try signing in.',
    'auth/weak-password': 'Choose a stronger password with at least 6 characters.',
    'auth/network-request-failed': 'Check your internet connection and try again.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/operation-not-allowed': 'Enable this sign-in provider in your Firebase console first.',
    'auth/unauthorized-domain': 'Add this website domain to Firebase Authentication authorized domains.',
    'auth/popup-blocked': 'Allow the sign-in popup in your browser and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/account-exists-with-different-credential': 'This email uses another sign-in method. Sign in with that method first.',
    'permission-denied': 'Firebase denied access. Check your circle membership and deploy firestore.rules.',
    unavailable: 'Firebase is unavailable. Check your connection and try again.',
    'resource-exhausted': 'The Firebase project reached a usage limit. Check the Firebase console.',
    PLAY_SERVICES_NOT_AVAILABLE: 'Google Play services are required. Use a compatible Android phone or a Google Play emulator image.',
    DEVELOPER_ERROR: 'Google OAuth is not configured for this app and signing certificate. Check docs/FIREBASE_SETUP.md.',
    '10': 'Google OAuth is not configured for this app and signing certificate. Check docs/FIREBASE_SETUP.md.',
  };
  return (code && messages[code]) || (cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
}
