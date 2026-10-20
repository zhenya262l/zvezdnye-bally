import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { useSession } from './session';

// Screens that show signatures refresh every 3 seconds while the app is open,
// so points appear on the child's phone within 5 seconds of signing.
export const LIVE_REFRESH_MS = 3000;

export function useChildren() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({ queryKey: ['children', uid], queryFn: api.listChildren, enabled: !!uid });
}

export function useMembers() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({ queryKey: ['members', uid], queryFn: api.listMembers, enabled: !!uid });
}

/** Without childId: the signed-in child's own day. `enabled: false` skips the request. */
export function useChildDay(childId?: string, opts: { enabled?: boolean } = {}) {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['childDay', uid, childId ?? 'me'],
    queryFn: () => api.childDay(childId),
    enabled: !!uid && (opts.enabled ?? true),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useParentQueue() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['queue', uid],
    queryFn: api.parentQueue,
    enabled: !!uid,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useSections() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({ queryKey: ['sections', uid], queryFn: api.listSections, enabled: !!uid });
}

export function useTasks(childId: string | undefined) {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['tasks', uid, childId],
    queryFn: () => api.listTasks(childId as string),
    enabled: !!uid && !!childId,
  });
}

export function useLedger(childId: string | undefined) {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['ledger', uid, childId],
    queryFn: () => api.listLedger(childId as string),
    enabled: !!uid && !!childId,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useFamilyAccess() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({ queryKey: ['access', uid], queryFn: api.myFamilyAccess, enabled: !!uid });
}

export function useConsent() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({ queryKey: ['consent', uid], queryFn: api.currentConsent, enabled: !!uid });
}

/** Admin only: requests from new families, refreshed every 30 seconds. */
export function useFamilyRequests(enabled: boolean) {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['familyRequests', uid],
    queryFn: api.listFamilyRequests,
    enabled: !!uid && enabled,
    refetchInterval: 30000,
  });
}
