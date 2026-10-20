import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { api, type Who } from './api';
import { supabase } from './supabase';

type SessionState = {
  ready: boolean;
  session: Session | null;
  /**
   * A saved sign-in exists on this phone, but it could not be checked yet:
   * no internet, or the server answers slowly. The app waits for it instead
   * of showing «Кто ты?», so nobody has to sign in again.
   */
  restoring: boolean;
};

export const useSession = create<SessionState>(() => ({ ready: false, session: null, restoring: false }));

// Same key as storageKey in supabase.ts.
function hasSavedSession(): boolean {
  try {
    return !!globalThis.localStorage?.getItem('zb-auth');
  } catch {
    return false;
  }
}

let started = false;

/** Subscribes to auth changes once. INITIAL_SESSION marks the store as ready. */
export function startSession() {
  if (started) return;
  started = true;
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) useSession.setState({ ready: true, session, restoring: false });
    // An expired sign-in that could not be refreshed offline stays in storage;
    // the library refreshes it by itself once the internet is back.
    else if (event === 'INITIAL_SESSION')
      useSession.setState({ ready: true, session: null, restoring: hasSavedSession() });
    else useSession.setState({ ready: true, session: null, restoring: false });
  });
  // Fallback in case storage is unavailable or the server is slow.
  setTimeout(() => {
    if (!useSession.getState().ready) useSession.setState({ ready: true, restoring: hasSavedSession() });
  }, 4000);
}

/** «Повторить» while restoring: asks the library to refresh the saved sign-in now. */
export async function retryRestore() {
  const { data } = await supabase.auth.getSession();
  if (data.session) useSession.setState({ ready: true, session: data.session, restoring: false });
  else useSession.setState({ restoring: hasSavedSession() });
}

export const whoKey = (userId: string | undefined) => ['whoami', userId ?? 'none'] as const;

export function useWho() {
  const session = useSession((s) => s.session);
  return useQuery<Who>({
    queryKey: whoKey(session?.user.id),
    queryFn: api.whoami,
    enabled: !!session,
    staleTime: 60_000,
  });
}
