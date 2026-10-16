import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthScreen } from './screens/AuthScreen';
import { TrackingApp } from './screens/TrackingApp';
import { colors } from './theme';
import { AppDialogProvider } from './components/AppDialog';
import { BrandLogo } from './components/BrandLogo';
import { useInvitationLink } from './hooks/useInvitationLink';

function Session() {
  const auth = useAuth();
  const invitation = useInvitationLink();
  const [localMode, setLocalMode] = useState(() => !auth.isConfigured);
  return <View style={styles.canvas}><SafeAreaView style={styles.app} edges={['top', 'bottom']}>
    <StatusBar style="light" />
    {auth.initializing && !auth.user && !localMode ? <View style={styles.loading}><BrandLogo size={112} /><ActivityIndicator color={colors.blue} size="large" /></View>
      : auth.user || localMode ? <TrackingApp key={auth.user?.uid ?? 'local-device'} onAccount={() => setLocalMode(false)} pendingInvitation={invitation.pending} invitationError={invitation.error} onDismissInvitation={invitation.dismiss} />
        : <AuthScreen onLocal={() => setLocalMode(true)} invitationCode={invitation.pending?.code} />}
  </SafeAreaView></View>;
}

export default function ClosebyApp() {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><AuthProvider><AppDialogProvider><Session /></AppDialogProvider></AuthProvider></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: '#03080D', alignItems: 'center' },
  app: { flex: 1, width: '100%', maxWidth: 600, backgroundColor: colors.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20 },
});
