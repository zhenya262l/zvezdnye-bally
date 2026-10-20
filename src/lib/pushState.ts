import { useQuery, useQueryClient } from '@tanstack/react-query';

import { push, warmUpPush } from '@/platform/push';
import { api, ApiError } from './api';
import { useSession } from './session';

/**
 * What the notifications card shows on this phone:
 * - unsupported: no Web Push here (not the Home Screen app, or iOS < 16.4),
 * - denied: the person said «Запретить»; only iPhone Settings can change it,
 * - off: can be switched on with a tap,
 * - on: this phone is subscribed and the server knows it.
 */
export type PushView = 'loading' | 'unsupported' | 'denied' | 'off' | 'on';

export function usePushState() {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const settings = useQuery({ queryKey: ['pushSettings', uid], queryFn: api.myPushSettings, enabled: !!uid });
  // Loaded ahead of the tap: on iPhone the tap must lead straight to subscribe.
  const key = useQuery({ queryKey: ['pushKey'], queryFn: api.pushPublicKey, enabled: !!uid, staleTime: 3600_000 });
  // Is this phone subscribed right now (asked from the browser, not the server).
  const localQuery = useQuery({
    queryKey: ['pushLocal'],
    queryFn: async () => {
      warmUpPush();
      try {
        return !!(await push.current());
      } catch {
        return false;
      }
    },
  });
  const local = localQuery.data ?? null;
  const refreshLocal = () => qc.invalidateQueries({ queryKey: ['pushLocal'] });

  let view: PushView;
  const permission = push.permission();
  if (permission === 'unsupported') view = 'unsupported';
  else if (permission === 'denied') view = 'denied';
  else if (local === null || settings.isPending) view = 'loading';
  else if (permission === 'granted' && local && (settings.data?.subscriptions ?? 0) > 0) view = 'on';
  else view = 'off';

  /** Call right in the tap handler. */
  async function enable() {
    const publicKey = key.data ?? (await api.pushPublicKey());
    if (!publicKey) throw new ApiError('pushNotReady');
    let keys;
    try {
      keys = await push.subscribe(publicKey);
    } catch (e) {
      await refreshLocal();
      // «Запретить» on iPhone ends here: the card then shows how to allow it.
      if (push.permission() === 'denied') return;
      throw new ApiError('pushFailed', String(e));
    }
    await api.savePushSubscription(keys);
    await refreshLocal();
    await qc.invalidateQueries({ queryKey: ['pushSettings', uid] });
  }

  async function disable() {
    const endpoint = await push.unsubscribe();
    if (endpoint) await api.deletePushSubscription(endpoint).catch(() => undefined);
    await refreshLocal();
    await qc.invalidateQueries({ queryKey: ['pushSettings', uid] });
  }

  return { view, settings, enable, disable };
}

/**
 * At start: a phone that already allowed notifications tells the server its
 * subscription again (after reinstalling or when another account used it).
 */
export async function resyncPush() {
  try {
    if (push.permission() !== 'granted') return;
    const keys = await push.current();
    if (keys) await api.savePushSubscription(keys);
  } catch {
    // Not important enough to bother anyone: the card offers to switch on.
  }
}

/** Before signing out: this phone stops getting this account's notifications. */
export async function forgetPush(alsoOnServer: boolean) {
  try {
    const endpoint = await push.unsubscribe();
    if (endpoint && alsoOnServer) await api.deletePushSubscription(endpoint);
  } catch {
    // Signing out must not fail because of notifications.
  }
}
