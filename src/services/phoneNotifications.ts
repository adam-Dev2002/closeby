import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { firebaseAuth, requireFirestore } from '../lib/firebase';
import { randomUuid } from '../lib/uuid';
import { phoneChannels, type PhoneAlertSettings } from '../lib/phoneNotifications';
import { notificationApi } from './notificationRuntime';

const installationKey = '@closeby/notification-installation/v1';
const enabledKey = (uid: string) => `@closeby/${encodeURIComponent(uid)}/phone-notifications/v1`;
let idPromise: Promise<string> | undefined;
let operation = 0;
function installationId() {
  return idPromise ??= (async () => { let id = await AsyncStorage.getItem(installationKey); if (!id) { id = randomUuid(); await AsyncStorage.setItem(installationKey, id); } return id; })();
}
export function phoneNotificationsSupported() { return Platform.OS === 'android' && Constants.executionEnvironment !== 'storeClient' && Constants.appOwnership !== 'expo'; }
function authenticated(uid: string) { if (firebaseAuth?.currentUser?.uid !== uid) throw new Error('Sign in again before enabling phone notifications.'); }
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Phone alert settings could not sync. Check your connection and retry.')), 15000); })]); }
  finally { clearTimeout(timer); }
}
export async function savedPhoneNotifications(uid: string) { return await AsyncStorage.getItem(enabledKey(uid)) === 'true'; }
export function watchPushDelivery(next: (ready: boolean) => void, fail: (cause: unknown) => void) {
  return onSnapshot(doc(requireFirestore(), 'appStatus', 'notifications'), snapshot => next(snapshot.data()?.enabled === true), fail);
}
export async function syncPhoneAlertSettings(uid: string, settings: PhoneAlertSettings) {
  authenticated(uid);
  await bounded(setDoc(doc(requireFirestore(), 'users', uid, 'notificationSettings', 'main'), { ...settings, updatedAt: serverTimestamp() }));
}
async function saveToken(uid: string, token: unknown, generation: number) {
  authenticated(uid);
  if (typeof token !== 'string' || !token || token.length > 4096) throw new Error('This phone did not return a notification address. Try enabling notifications again.');
  const id = await installationId();
  if (generation !== operation) return;
  await bounded(setDoc(doc(requireFirestore(), 'users', uid, 'pushDevices', id), { token, platform: 'android', updatedAt: serverTimestamp() }));
}
export async function registerPhoneNotifications(uid: string, requestPermission: boolean): Promise<() => void> {
  if (!phoneNotificationsSupported()) throw new Error('Phone push alerts need the updated Android app.');
  authenticated(uid);
  const generation = ++operation, api = await notificationApi();
  const channels = [
    [phoneChannels.emergency, 'Emergency alerts', 'closeby_alert.wav'], [phoneChannels.call, 'Calls and device requests', 'closeby_call.wav'],
    [phoneChannels.message, 'Space messages', 'default'], [phoneChannels.arrival, 'Arrivals and departures', 'default'], [phoneChannels.speed, 'Speed alerts', 'default'],
  ];
  for (const [id, name, sound] of channels) await api.setNotificationChannelAsync(id!, { name: name!, importance: api.AndroidImportance.HIGH, sound,
    enableVibrate: true, vibrationPattern: [0, 300, 150, 300], lockscreenVisibility: api.AndroidNotificationVisibility.PRIVATE, bypassDnd: false });
  const permission = requestPermission ? await api.requestPermissionsAsync() : await api.getPermissionsAsync();
  if (!permission.granted) throw new Error('Allow Closeby notifications in Android settings to receive phone alerts.');
  if (generation !== operation) return () => {};
  await saveToken(uid, (await api.getDevicePushTokenAsync()).data, generation);
  if (generation !== operation) return () => {};
  await AsyncStorage.setItem(enabledKey(uid), 'true');
  const subscription = api.addPushTokenListener(token => { if (generation === operation) void saveToken(uid, token.data, generation).catch(() => undefined); });
  return () => subscription.remove();
}
export async function disablePhoneNotifications(uid: string) {
  ++operation;
  authenticated(uid);
  try { await bounded(updateDoc(doc(requireFirestore(), 'users', uid, 'notificationSettings', 'main'), { enabled: false, zones: [], updatedAt: serverTimestamp() })); }
  catch (cause) { if ((cause as { code?: string }).code !== 'not-found') throw cause; }
  await bounded(deleteDoc(doc(requireFirestore(), 'users', uid, 'pushDevices', await installationId())));
  await AsyncStorage.setItem(enabledKey(uid), 'false');
  await AsyncStorage.setItem(`@closeby/${encodeURIComponent(uid)}/cloud-arrivals/v1`, 'false');
  if (phoneNotificationsSupported()) { const api = await notificationApi(); await api.dismissAllNotificationsAsync(); await api.unregisterForNotificationsAsync(); }
}
export async function detachPhoneNotifications(uid: string) {
  if (await savedPhoneNotifications(uid)) await disablePhoneNotifications(uid);
}
export async function watchPhoneNotificationTaps(receive: (data: unknown) => void) {
  if (!phoneNotificationsSupported()) return () => {};
  const api = await notificationApi(); let last = '';
  const onResponse = (response: import('expo-notifications').NotificationResponse | null) => {
    if (!response || last === response.notification.request.identifier) return;
    last = response.notification.request.identifier;
    receive(response.notification.request.content.data);
  };
  const subscription = api.addNotificationResponseReceivedListener(onResponse);
  onResponse(await api.getLastNotificationResponseAsync());
  return () => subscription.remove();
}
