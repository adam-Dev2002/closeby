import { useAppDialog } from '../components/AppDialog';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { BrandLogo } from '../components/BrandLogo';
import { Button, Field, ui } from '../components/Ui';
import { colors } from '../theme';

export function AuthScreen({ onLocal, invitationCode }: { onLocal: () => void; invitationCode?: string }) {
  const auth = useAuth();
  const dialog = useAppDialog();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(google = false) {
    auth.clearError();
    if (!auth.isConfigured) { dialog.alert('Accounts are not connected yet', 'Create your Firebase project using the setup guide. You can use GPS on this device now.'); return; }
    if (!google && (!email.trim() || password.length < 6 || (mode === 'signup' && !name.trim()))) {
      dialog.alert('Check your details', 'Enter your email and a password of at least 6 characters. New accounts also need a name.'); return;
    }
    setBusy(true);
    try {
      if (google) await auth.signInWithGoogle();
      else if (mode === 'signup') await auth.signUp(name.trim(), email.trim(), password);
      else await auth.signIn(email.trim(), password);
    } catch { /* AuthProvider displays the specific error. */ }
    finally { setBusy(false); }
  }
  async function reset() {
    if (!email.trim()) { dialog.alert('Enter your email', 'Enter your account email above, then tap Forgot password.'); return; }
    setBusy(true);
    try { await auth.resetPassword(email.trim()); dialog.alert('Check your inbox', 'If an account exists, a password reset email will be sent.'); }
    catch { /* Display provider error. */ }
    finally { setBusy(false); }
  }
  return <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={styles.wordmark}><BrandLogo /><Text style={styles.brand}>closeby</Text></View>
      {invitationCode && <View style={styles.setupNote}><Icon name="people" size={21} color={colors.blueLight} /><Text style={[ui.body, { flex: 1 }]}>Your space invitation is ready. Sign in or create an account to accept it.</Text></View>}
      <View style={{ gap: 12, marginBottom: 10 }}>
        <Text style={styles.eyebrow}>YOUR PEOPLE. YOUR PEACE OF MIND.</Text>
        <Text accessibilityRole="header" style={styles.hero}>Stay close to{ '\n' }what <Text style={{ color: colors.blue }}>matters.</Text></Text>
        <Text style={ui.body}>Live location, safe zones, and a little more peace of mind. Shared on your terms.</Text>
      </View>
      <View style={styles.modeBar}>{(['login', 'signup'] as const).map(item => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: mode === item }} onPress={() => { setMode(item); auth.clearError(); }} style={[styles.mode, mode === item && styles.modeActive]}><Text style={[styles.modeText, mode === item && { color: colors.ink }]}>{item === 'login' ? 'Log in' : 'Sign up free'}</Text></Pressable>)}</View>
      <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Continue with Google" onPress={() => void submit(true)} style={({ pressed }) => [styles.googleButton, pressed && ui.pressed]}><Text style={styles.googleG}>G</Text><Text style={styles.googleText}>Continue with Google</Text></Pressable>
      {auth.isConfigured && auth.googleUnavailableReason && <Text style={ui.caption}>{auth.googleUnavailableReason}</Text>}
      <View style={styles.divider}><View style={styles.dividerLine} /><Text style={ui.caption}>or continue with email</Text><View style={styles.dividerLine} /></View>
      {mode === 'signup' && <Field label="Your name" placeholder="Full name" value={name} onChangeText={setName} autoComplete="name" />}
      <Field label="Email address" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />
      <View style={{ gap: 8 }}><Field label="Password" placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'} value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /><Pressable onPress={() => setShowPassword(!showPassword)} accessibilityRole="button" style={styles.showPassword}><Text style={styles.link}>{showPassword ? 'Hide' : 'Show'} password</Text></Pressable></View>
      {auth.error && <View style={ui.error}><Text style={ui.errorText}>{auth.error}</Text></View>}
      <Button title={mode === 'signup' ? 'Create free account' : 'Log in'} busy={busy} disabled={!auth.isConfigured} onPress={() => void submit()} />
      {mode === 'login' && <Pressable disabled={!auth.isConfigured || busy} onPress={() => void reset()} style={styles.centerLink}><Text style={styles.link}>Forgot password?</Text></Pressable>}
      {!auth.isConfigured && <View style={styles.setupNote}><Icon name="info" size={19} color={colors.blueLight} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.setupTitle}>Account setup is pending</Text><Text style={ui.caption}>Connect your Firebase project to enable Google login, free email signup, and family sharing.</Text><Pressable onPress={() => void Linking.openURL('https://console.firebase.google.com/')}><Text style={styles.link}>Open Firebase Console</Text></Pressable></View></View>}
      <Button title="Use this device’s GPS" icon="navigate" secondary onPress={onLocal} />
      <View style={styles.footer}><Icon name="lock" size={14} color={colors.muted} /><Text style={ui.caption}>Location sharing is off until you choose to enable it.</Text></View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  content: { padding: 26, paddingTop: 32, paddingBottom: 35, gap: 19 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  brand: { fontSize: 26, fontWeight: '700', letterSpacing: -1, color: colors.ink },
  eyebrow: { fontSize: 9, color: colors.blueLight, letterSpacing: 1.8, fontWeight: '600' },
  hero: { color: colors.ink, fontSize: 36, lineHeight: 43, fontWeight: '700', letterSpacing: -1.3 },
  modeBar: { backgroundColor: '#0C1723', padding: 4, borderRadius: 13, borderColor: colors.line, borderWidth: 1, flexDirection: 'row' },
  mode: { flex: 1, padding: 11, alignItems: 'center', borderRadius: 9 },
  modeActive: { backgroundColor: '#1A2B40' },
  modeText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  googleButton: { minHeight: 49, backgroundColor: '#F3F6FC', borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 14 },
  googleText: { color: '#182434', fontSize: 14, fontWeight: '600' },
  googleG: { color: '#4285F4', fontSize: 23, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 2 },
  dividerLine: { height: 1, flex: 1, backgroundColor: colors.line },
  showPassword: { alignSelf: 'flex-end', paddingVertical: 2 },
  link: { fontSize: 12, color: colors.blueLight, lineHeight: 20 },
  centerLink: { alignSelf: 'center', padding: 5 },
  setupNote: { backgroundColor: '#0D2136', borderColor: '#183B61', borderWidth: 1, padding: 13, borderRadius: 13, flexDirection: 'row', gap: 10 },
  setupTitle: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  footer: { flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center' },
});
