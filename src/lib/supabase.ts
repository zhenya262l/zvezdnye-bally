import { createClient, type SupportedStorage } from '@supabase/supabase-js';

// Filled in at build time from the build settings (GitHub repository variables).
// The publishable key is meant to be public: access is guarded by Row Level Security.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const isConfigured = Boolean(url && key);

// localStorage of the installed web app. On iPhone it is separate from Safari's,
// which is why every sign-in happens inside the installed app.
const storage: SupportedStorage = {
  getItem: (k) => {
    try {
      return globalThis.localStorage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      globalThis.localStorage?.setItem(k, v);
    } catch {}
  },
  removeItem: (k) => {
    try {
      globalThis.localStorage?.removeItem(k);
    } catch {}
  },
};

export const supabase = createClient(url ?? 'https://not-configured.invalid', key ?? 'not-configured', {
  auth: {
    storage,
    storageKey: 'zb-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
