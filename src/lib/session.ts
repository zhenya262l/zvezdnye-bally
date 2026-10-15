import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { api, type Who } from './api';
import { supabase } from './supabase';

type SessionState = {
  ready: boolean;
  session: Session | null;
};

export const useSession = create<SessionState>(() => ({ ready: false, session: null }));

let started = false;

/** Subscribes to auth changes once. INITIAL_SESSION marks the store as ready. */
export function startSession() {
  if (started) return;
  started = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    useSession.setState({ ready: true, session });
  });
  // Fallback in case storage is unavailable and no event arrives.
  setTimeout(() => {
    if (!useSession.getState().ready) useSession.setState({ ready: true });
  }, 4000);
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
