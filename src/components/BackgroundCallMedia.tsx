import { Text } from 'react-native';
import { ui } from './Ui';
export function BackgroundCallMedia({ id: _id }: { id: string }) {
  return <Text style={ui.caption}>Background sharing requires the updated Android app.</Text>;
}
