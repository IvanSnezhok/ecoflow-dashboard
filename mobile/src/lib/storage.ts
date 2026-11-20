import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// The panel address and session token live in the device keychain / keystore. The web
// build (used to check the app in a browser) has no keychain and falls back to localStorage.
const web = Platform.OS === 'web';

export async function readItem(key: string): Promise<string | null> {
  try {
    return web ? globalThis.localStorage?.getItem(key) ?? null : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function writeItem(key: string, value: string | null): Promise<void> {
  try {
    if (web) {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } else if (value === null) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  } catch {
    // Storage refused (locked keychain): the session then lasts until the app closes
  }
}
