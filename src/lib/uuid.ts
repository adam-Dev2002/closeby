import { getRandomValues } from 'expo-crypto';
import { Platform } from 'react-native';

// Browser randomUUID requires HTTPS, but secure random bytes also work on LAN HTTP.
export function randomUuid(): string {
  const bytes = new Uint8Array(16);
  if (Platform.OS === 'web') {
    const browserCrypto = globalThis.crypto;
    if (typeof browserCrypto?.getRandomValues !== 'function') {
      throw new Error('Secure random IDs are unavailable in this browser. Use a current browser or the Closeby development app.');
    }
    browserCrypto.getRandomValues(bytes);
  } else {
    // Unlike getRandomBytes, this Expo API never substitutes Math.random in development.
    if (typeof getRandomValues !== 'function') {
      throw new Error('Secure random IDs are unavailable on this device. Open the Closeby development app.');
    }
    getRandomValues(bytes);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
