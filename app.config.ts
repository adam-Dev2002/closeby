import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  const androidMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY?.trim();
  const iosMapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY?.trim();
  const plugins: NonNullable<ExpoConfig['plugins']> = [
    ['expo-splash-screen', { image: './assets/branding/closeby-logo.png', imageWidth: 180, resizeMode: 'contain', backgroundColor: '#000000' }],
    'expo-asset',
    ['expo-audio', { enableBackgroundPlayback: false, enableBackgroundRecording: false, recordAudioAndroid: false,
      microphonePermission: 'Closeby uses your microphone only during an accepted call or a device sharing request you approve. You can mute or stop sharing at any time.' }],
    ['expo-notifications', { color: '#1186FF', defaultChannel: 'closeby-messages-v1', sounds: ['./assets/sounds/closeby_alert.wav', './assets/sounds/closeby_call.wav'] }],
    './plugins/with-history-storage',
    './plugins/with-media-session',
    ['expo-location', {
      locationWhenInUsePermission: 'Closeby uses your location to show your phone on the map and share it only when you choose.',
      locationAlwaysAndWhenInUsePermission: 'Closeby records your location history while in the background only when you enable background history. Shared history is a separate choice.',
      isIosBackgroundLocationEnabled: true,
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true,
    }],
  ];
  plugins.push(['react-native-maps', {
    ...(androidMapsKey ? { androidGoogleMapsApiKey: androidMapsKey } : {}),
    ...(iosMapsKey ? { iosGoogleMapsApiKey: iosMapsKey } : {}),
  }]);
  if (iosClientId?.endsWith('.apps.googleusercontent.com')) {
    const identifier = iosClientId.slice(0, -'.apps.googleusercontent.com'.length);
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: `com.googleusercontent.apps.${identifier}` }]);
  }
  return {
    ...config,
    name: 'Closeby', slug: 'closeby-phone-tracker', scheme: 'closeby',
    userInterfaceStyle: 'dark', backgroundColor: '#060D14',
    ios: { ...config.ios, bundleIdentifier: 'com.closeby.tracker', supportsTablet: true,
      infoPlist: { ...config.ios?.infoPlist,
        NSCameraUsageDescription: 'Closeby uses your camera only during an accepted video call or a camera sharing request you approve. Sharing stays visible and you can stop at any time.',
        NSMicrophoneUsageDescription: 'Closeby uses your microphone only during an accepted call or a device sharing request you approve. You can mute or stop sharing at any time.',
      },
    },
    android: {
      ...config.android, package: 'com.closeby.tracker', versionCode: 8, googleServicesFile: './.private/firebase/google-services.json',
      intentFilters: [...(config.android?.intentFilters ?? []), {
        action: 'VIEW', autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'closeby-511018.web.app', pathPrefix: '/j/' }],
      }],
      permissions: [...(config.android?.permissions ?? []), 'android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
      blockedPermissions: [],
    },
    plugins,
  };
};
