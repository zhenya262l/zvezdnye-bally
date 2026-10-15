import { Platform } from 'react-native';

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

export function isIOS(): boolean {
  if (Platform.OS === 'ios') return true;
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  // iPadOS reports itself as a Mac with touch.
  return /iPad|iPhone|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return Platform.OS === 'android' || /Android/i.test(ua());
}

/** Opened from the Home Screen icon (or as a native app). */
export function isStandalone(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** Safari itself, not Chrome/Firefox/Edge or an in-app browser on iPhone. */
export function isIOSSafari(): boolean {
  return isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|GSA|FBAN|FBAV|Instagram|Telegram|Line\//.test(ua());
}

/** On iPhone every sign-in must happen inside the installed app (SPEC section 3). */
export function mustInstallFirst(): boolean {
  return Platform.OS === 'web' && isIOS() && !isStandalone();
}
