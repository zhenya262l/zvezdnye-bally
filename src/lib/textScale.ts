import { create } from 'zustand';
import { Platform } from 'react-native';

// Larger Text support. On iOS the web view follows the system text size only
// through the "-apple-system-body" font; index.html sets it on <html>, and we
// read the resulting size to scale our own fonts.
const BASE_BODY_PX = 17;

type State = { scale: number; refresh: () => void };

function measure(): number {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return 1;
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize || '');
  if (!Number.isFinite(px) || px <= 0) return 1;
  return Math.min(1.6, Math.max(1, px / BASE_BODY_PX));
}

export const useTextScale = create<State>((set) => ({
  scale: measure(),
  refresh: () => set({ scale: measure() }),
}));

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('focus', () => useTextScale.getState().refresh());
  document.addEventListener('visibilitychange', () => useTextScale.getState().refresh());
}
