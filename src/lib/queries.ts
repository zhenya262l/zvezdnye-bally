import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { api } from './api';
import { useSession } from './session';

// Screens that show signatures refresh every 3 seconds while the app is open,
// so points appear on the child's phone within 5 seconds of signing.
export const LIVE_REFRESH_MS = 3000;
// Phones paired or unlinked by the other parent show up within this time.
const MEMBERS_REFRESH_MS = 15000;

/** Polls only while the screen is in front: tabs and screens below stay mounted. */
function useLive(ms: number): number | false {
  return useIsFocused() ? ms : false;
}

export function useChildren() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({ queryKey: ['children', uid], queryFn: api.listChildren, enabled: !!uid });
}

export function useMembers() {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(MEMBERS_REFRESH_MS);
  return useQuery({ queryKey: ['members', uid], queryFn: api.listMembers, enabled: !!uid, refetchInterval: live });
}

/** Without childId: the signed-in child's own day. `enabled: false` skips the request. */
export function useChildDay(childId?: string, opts: { enabled?: boolean } = {}) {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({
    queryKey: ['childDay', uid, childId ?? 'me'],
    queryFn: () => api.childDay(childId),
    enabled: !!uid && (opts.enabled ?? true),
    refetchInterval: live,
  });
}

export function useParentQueue() {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({
    queryKey: ['queue', uid],
    queryFn: api.parentQueue,
    enabled: !!uid,
    refetchInterval: live,
  });
}

export function useChildShop() {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({ queryKey: ['shop', uid], queryFn: api.childShop, enabled: !!uid, refetchInterval: live });
}

export function usePurchaseQueue() {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({ queryKey: ['purchases', uid], queryFn: api.purchaseQueue, enabled: !!uid, refetchInterval: live });
}

/** Without childId: the signed-in child's own level. */
export function useChildLevel(childId?: string) {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({
    queryKey: ['level', uid, childId ?? 'me'],
    queryFn: () => api.childLevel(childId),
    enabled: !!uid,
    refetchInterval: live,
  });
}

export function useChildStreaks() {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({ queryKey: ['streaks', uid], queryFn: api.childStreaks, enabled: !!uid, refetchInterval: live });
}

export function useStreakQueue() {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({ queryKey: ['streakQueue', uid], queryFn: api.streakQueue, enabled: !!uid, refetchInterval: live });
}

export function useChildGrades() {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({ queryKey: ['grades', uid], queryFn: api.childGrades, enabled: !!uid, refetchInterval: live });
}

export function useGradeQueue() {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({ queryKey: ['gradeQueue', uid], queryFn: api.gradeQueue, enabled: !!uid, refetchInterval: live });
}

export function useMotivationSettings() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({ queryKey: ['motivation', uid], queryFn: api.motivationSettings, enabled: !!uid });
}

/** Without childId: the signed-in child's own piggy bank. */
export function useChildGoals(childId?: string) {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({
    queryKey: ['goals', uid, childId ?? 'me'],
    queryFn: () => api.childGoals(childId),
    enabled: !!uid,
    refetchInterval: live,
  });
}

export function useGoalProposals() {
  const uid = useSession((s) => s.session?.user.id);
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({
    queryKey: ['goalProposals', uid],
    queryFn: api.goalProposals,
    enabled: !!uid,
    refetchInterval: live,
  });
}

export function useShopItems() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({ queryKey: ['shopItems', uid], queryFn: api.listShopItems, enabled: !!uid });
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
  const live = useLive(LIVE_REFRESH_MS);
  return useQuery({
    queryKey: ['ledger', uid, childId],
    queryFn: () => api.listLedger(childId as string),
    enabled: !!uid && !!childId,
    refetchInterval: live,
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
