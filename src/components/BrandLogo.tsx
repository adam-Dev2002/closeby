import { Image } from 'react-native';

/** The original artwork supplied for Closeby, shared across app branding. */
export function BrandLogo({ size = 56 }: { size?: number }) {
  return <Image source={require('../../assets/branding/closeby-logo.png')} accessibilityLabel="Closeby logo"
    resizeMode="contain" style={{ width: size, height: size, borderRadius: size * 0.2, backgroundColor: '#000000' }} />;
}
