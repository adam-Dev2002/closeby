import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { Icon } from './Icon';
import { Button, RoundButton, ui } from './Ui';

type DialogButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void | Promise<void> };
type Dialog = { title: string; message: string; buttons: DialogButton[] };
type DialogApi = { alert: (title: string, message?: string, buttons?: DialogButton[]) => void };
const DialogContext = createContext<DialogApi | null>(null);

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Dialog[]>([]);
  const alert = useCallback<DialogApi['alert']>((title, message = '', buttons = [{ text: 'Got it' }]) => {
    setQueue(previous => [...previous, { title, message, buttons: buttons.length ? buttons : [{ text: 'Got it' }] }]);
  }, []);
  const api = useMemo(() => ({ alert }), [alert]);
  const dialog = queue[0];
  const handled = useRef<Dialog | null>(null);
  const close = () => setQueue(previous => previous.slice(1));
  function choose(button?: DialogButton) {
    if (!dialog || handled.current === dialog) return;
    handled.current = dialog;
    close();
    if (button?.onPress) {
      try {
        Promise.resolve(button.onPress()).catch(error => alert('Could not complete that', error instanceof Error ? error.message : 'Please try again.'));
      } catch (error) { alert('Could not complete that', error instanceof Error ? error.message : 'Please try again.'); }
    }
  }
  const dismiss = () => choose(dialog?.buttons.find(button => button.style === 'cancel'));
  return <DialogContext.Provider value={api}>{children}
    <Modal visible={Boolean(dialog)} transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={dismiss} />
        <SafeAreaView edges={['bottom']} style={styles.sheet} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={ui.between}><View style={styles.badge}><Icon name={dialog?.buttons.some(button => button.style === 'destructive') ? 'alert' : 'shield'} color={colors.blueLight} size={24} /></View><RoundButton small icon="close" label="Close message" onPress={dismiss} /></View>
            <Text accessibilityRole="header" style={ui.title}>{dialog?.title}</Text>
            {Boolean(dialog?.message) && <Text style={ui.body}>{dialog?.message}</Text>}
            <View style={{ gap: 10 }}>{dialog?.buttons.map((button, index) => <Button key={index} title={button.text} danger={button.style === 'destructive'} secondary={button.style === 'cancel'} onPress={() => choose(button)} />)}</View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  </DialogContext.Provider>;
}

export function useAppDialog() {
  const api = useContext(DialogContext);
  if (!api) throw new Error('App dialogs require AppDialogProvider.');
  return api;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: '#000000B0' },
  sheet: { width: '100%', maxWidth: 600, maxHeight: '85%', backgroundColor: '#0B1521', borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, borderColor: '#263A52', overflow: 'hidden' },
  content: { padding: 22, gap: 19 },
  badge: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#102C46', alignItems: 'center', justifyContent: 'center' },
});
