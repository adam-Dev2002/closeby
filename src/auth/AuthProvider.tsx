import { isRunningInExpoGo } from 'expo';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform, TurboModuleRegistry } from 'react-native';
import {
  backendError,
  firebaseAuth,
  firebaseInitializationError,
  googleIosClientId,
  googleWebClientId,
  isFirebaseConfigured,
  requireFirebaseAuth,
} from '../lib/firebase';
import { stopSharing } from '../services/circles';
import { stopAllActivity } from '../services/backgroundTracking';
import { stopArrivalMonitor } from '../services/arrivalMonitoring';
import { stopBackgroundMedia } from '../services/backgroundMedia';
import { profileIdentity } from '../lib/profileIdentity';
import { detachPhoneNotifications } from '../services/phoneNotifications';

export type AuthUser = Pick<User, 'uid' | 'email' | 'displayName' | 'photoURL' | 'emailVerified'>;
type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  initializing: boolean;
  error: string | null;
  isConfigured: boolean;
  googleAvailable: boolean;
  googleUnavailableReason: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  clearError(): void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
type GoogleModule = typeof import('@react-native-google-signin/google-signin');
let loadedGoogleModule: GoogleModule | null = null;

function getGoogleUnavailableReason(): string | null {
  if (Platform.OS === 'web') return null;
  if (isRunningInExpoGo()) {
    return 'Google sign-in is unavailable in Expo Go. Open the Closeby development app or sign in with email.';
  }
  if (!googleWebClientId) {
    return 'Google sign-in has not been configured for Closeby yet. You can sign in with email.';
  }
  if (Platform.OS === 'ios' && !googleIosClientId) {
    return 'Google sign-in has not been configured for iPhone yet. You can sign in with email.';
  }
  const missingModule = 'This Closeby build does not include Google sign-in. Install an updated development build or sign in with email.';
  try {
    return TurboModuleRegistry.get('RNGoogleSignin') ? null : missingModule;
  } catch {
    return missingModule;
  }
}

function publicUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    ...profileIdentity(user),
    emailVerified: user.emailVerified,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(Boolean(firebaseAuth));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(firebaseInitializationError);

  useEffect(() => {
    if (!firebaseAuth) {
      setInitializing(false);
      return;
    }
    return onIdTokenChanged(firebaseAuth, (nextUser) => {
      setUser(publicUser(nextUser));
      setInitializing(false);
    }, (cause) => {
      setError(backendError(cause));
      setInitializing(false);
    });
  }, []);

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      const message = backendError(cause);
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }

  const googleUnavailableReason = getGoogleUnavailableReason();
  const value: AuthContextValue = {
    user,
    loading: initializing || busy,
    initializing,
    error,
    isConfigured: isFirebaseConfigured,
    googleAvailable: isFirebaseConfigured && googleUnavailableReason === null,
    googleUnavailableReason,
    clearError: () => setError(null),
    signIn: (email, password) => run(async () => {
      await signInWithEmailAndPassword(requireFirebaseAuth(), email.trim(), password);
    }),
    signUp: (name, email, password) => run(async () => {
      if (!name.trim()) throw new Error('Enter your name.');
      const credential = await createUserWithEmailAndPassword(requireFirebaseAuth(), email.trim(), password);
      await updateProfile(credential.user, { displayName: name.trim() });
      setUser(publicUser(credential.user));
      try {
        await sendEmailVerification(credential.user);
      } catch (cause) {
        throw new Error(`Your account was created, but the verification email could not be sent. ${backendError(cause)}`);
      }
    }),
    resetPassword: (email) => run(async () => {
      if (!email.trim()) throw new Error('Enter your email address first.');
      await sendPasswordResetEmail(requireFirebaseAuth(), email.trim());
    }),
    signInWithGoogle: () => run(async () => {
      const auth = requireFirebaseAuth();
      if (Platform.OS === 'web') {
        await signInWithPopup(auth, new GoogleAuthProvider());
        return;
      }
      if (googleUnavailableReason) throw new Error(googleUnavailableReason);
      // Never evaluate the native Google module at startup or inside Expo Go.
      loadedGoogleModule ??= require('@react-native-google-signin/google-signin') as GoogleModule;
      const { GoogleSignin } = loadedGoogleModule;
      GoogleSignin.configure({ webClientId: googleWebClientId, iosClientId: googleIosClientId });
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (response.type !== 'success') return;
      const token = response.data.idToken;
      if (!token) throw new Error('Google returned no ID token. Check the Web OAuth client ID and native signing configuration.');
      await signInWithCredential(auth, GoogleAuthProvider.credential(token));
    }),
    signOut: () => run(async () => {
      stopBackgroundMedia();
      const auth = requireFirebaseAuth();
      await stopArrivalMonitor();
      await stopAllActivity();
      if (auth.currentUser) await detachPhoneNotifications(auth.currentUser.uid);
      if (auth.currentUser && !(await stopSharing(auth.currentUser.uid))) {
        throw new Error('Sharing was resumed while signing out. Try signing out again.');
      }
      await firebaseSignOut(auth);
      if (loadedGoogleModule) {
        // Firebase is already signed out; clearing Google's account picker cache
        // is best effort and does not control circle access.
        await loadedGoogleModule.GoogleSignin.signOut().catch(() => undefined);
      }
    }),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
