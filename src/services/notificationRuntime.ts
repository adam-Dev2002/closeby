import { AppState } from 'react-native';

let api: typeof import('expo-notifications') | null = null;
export async function notificationApi() {
  if (!api) {
    api = await import('expo-notifications');
    api.setNotificationHandler({ handleNotification: async notification => {
      const data = notification.request.content.data;
      const inApp = AppState.currentState === 'active' && (data?.type === 'arrival' || (data?.type === 'closeby' && ['emergency', 'arrival', 'departure', 'speed'].includes(String(data.kind))));
      return { shouldShowBanner: !inApp, shouldShowList: true, shouldPlaySound: !inApp, shouldSetBadge: false };
    } });
  }
  return api;
}
