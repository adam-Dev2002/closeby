import { registerRootComponent } from 'expo';
import { AppRegistry, Platform } from 'react-native';
import { runBackgroundMediaTask } from './src/services/backgroundMedia';
import './src/services/backgroundTracking';
import './src/services/arrivalMonitoring';
import App from './App';

registerRootComponent(App);
if (Platform.OS === 'android') AppRegistry.registerHeadlessTask('ClosebyMediaSession', () => runBackgroundMediaTask);
