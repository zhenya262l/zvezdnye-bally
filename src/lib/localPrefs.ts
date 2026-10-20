import { Platform } from 'react-native';

// Small per-phone preferences (for example, which sections are open).
// Browser storage can be missing or blocked: then defaults are used.
export function readPref<T>(key: string, fallback: T): T {
  if (Platform.OS !== 'web') return fallback;
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  if (Platform.OS !== 'web') return;
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is full or blocked: the preference is simply not remembered.
  }
}
