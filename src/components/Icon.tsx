import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../theme';

export type IconName = 'pin' | 'people' | 'settings' | 'arrow' | 'plus' | 'close' | 'shield' | 'battery' | 'chevron' | 'pause' | 'info' | 'home' | 'phone' | 'history' | 'search' | 'layers' | 'target' | 'navigate' | 'back' | 'bell' | 'map' | 'moon' | 'lock' | 'user' | 'speed' | 'signal' | 'clock' | 'calendar' | 'logout' | 'alert' | 'record' | 'stop' | 'eye' | 'mail' | 'check' | 'trash' | 'chat';

export function Icon({ name, size = 22, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {name === 'pin' && <><Path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><Circle cx="12" cy="10" r="2.5" /></>}
      {name === 'people' && <><Circle cx="9" cy="8" r="3" /><Path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5v1" /></>}
      {name === 'settings' && <><Path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><Circle cx="12" cy="12" r="6" /><Circle cx="12" cy="12" r="2" /></>}
      {name === 'arrow' && <Path d="M5 12h14M13 6l6 6-6 6" />}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" />}
      {name === 'close' && <Path d="m6 6 12 12M6 18 18 6" />}
      {name === 'shield' && <><Path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><Path d="m8 12 3 3 5-5" /></>}
      {name === 'battery' && <><Rect x="2" y="6" width="17" height="12" rx="2" /><Path d="M22 10v4M6 10v4M10 10v4M14 10v4" /></>}
      {name === 'chevron' && <Path d="m9 5 7 7-7 7" />}
      {name === 'pause' && <><Path d="M9 7v10M15 7v10" /><Circle cx="12" cy="12" r="10" /></>}
      {name === 'info' && <><Circle cx="12" cy="12" r="9" /><Path d="M12 11v6M12 7h.01" /></>}
      {name === 'home' && <><Path d="m3 10 9-7 9 7v10H3V10Z" /><Path d="M9 20v-7h6v7" /></>}
      {name === 'phone' && <><Rect x="6" y="2" width="12" height="20" rx="2" /><Path d="M10 19h4" /></>}
      {name === 'history' && <><Path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l3 2" /></>}
      {name === 'search' && <><Circle cx="10.5" cy="10.5" r="6.5" /><Path d="m16 16 5 5" /></>}
      {name === 'layers' && <><Path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></>}
      {name === 'target' && <><Circle cx="12" cy="12" r="7" /><Circle cx="12" cy="12" r="2" /><Path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>}
      {name === 'navigate' && <Path d="m21 3-7 18-3-8-8-3 18-7Z" />}
      {name === 'back' && <Path d="m15 5-7 7 7 7" />}
      {name === 'bell' && <><Path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>}
      {name === 'map' && <><Path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5ZM9 3v16M15 5v16" /></>}
      {name === 'moon' && <Path d="M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z" />}
      {name === 'lock' && <><Rect x="4" y="10" width="16" height="11" rx="2" /><Path d="M7 10V7a5 5 0 0 1 10 0v3M12 14v3" /></>}
      {name === 'user' && <><Circle cx="12" cy="7" r="4" /><Path d="M4 22v-2a8 8 0 0 1 16 0v2H4Z" /></>}
      {name === 'speed' && <><Path d="M3 18a10 10 0 1 1 18 0M12 13l5-5" /><Circle cx="12" cy="14" r="2" /></>}
      {name === 'signal' && <><Path d="M4 20v-4M9 20v-8M14 20V8M19 20V3" /></>}
      {name === 'clock' && <><Circle cx="12" cy="12" r="9" /><Path d="M12 6v6l4 2" /></>}
      {name === 'calendar' && <><Rect x="3" y="5" width="18" height="17" rx="2" /><Path d="M7 2v6M17 2v6M3 11h18M8 15h1M15 15h1M8 18h1" /></>}
      {name === 'logout' && <><Path d="M9 4H4v16h5M9 12h12M17 8l4 4-4 4" /></>}
      {name === 'alert' && <><Path d="m12 3 10 18H2L12 3Z" /><Path d="M12 9v5M12 17h.01" /></>}
      {name === 'record' && <Circle cx="12" cy="12" r="8" />}
      {name === 'stop' && <Rect x="5" y="5" width="14" height="14" rx="2" />}
      {name === 'eye' && <><Path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><Circle cx="12" cy="12" r="3" /></>}
      {name === 'mail' && <><Rect x="3" y="5" width="18" height="14" rx="2" /><Path d="m3 6 9 7 9-7" /></>}
      {name === 'chat' && <><Path d="M21 11a8 8 0 0 1-8 8H7l-4 3V5a2 2 0 0 1 2-2h8a8 8 0 0 1 8 8Z" /><Path d="M7 9h10M7 13h6" /></>}
      {name === 'check' && <Path d="m5 12 5 5L20 7" />}
      {name === 'trash' && <><Path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>}
    </Svg>
  );
}
