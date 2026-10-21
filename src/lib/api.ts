import { AuthError } from '@supabase/supabase-js';

import { t } from '@/strings.ru';
import { supabase } from './supabase';

export type Member = {
  id: string;
  role: 'parent' | 'child';
  family_id: string;
  family_name: string;
  timezone: string;
  child_id: string | null;
  display_name: string | null;
};

export type Who = {
  user_id: string;
  is_anonymous: boolean;
  email: string | null;
  member: Member | null;
  /** A parent has to accept a newer edition of the consent text first. */
  needs_consent?: boolean;
};

export type Child = {
  id: string;
  family_id: string;
  name: string;
  birth_date: string;
  avatar: string;
  color: string;
  sort_order: number;
};

export type MemberRow = {
  id: string;
  user_id: string;
  role: 'parent' | 'child';
  child_id: string | null;
  display_name: string | null;
  created_at: string;
};

export type NewChild = { name: string; birth_date: string; avatar: string; color: string };

/** was + earned − spent + corrected = left (corrected: a parent's corrections today). */
export type Formula = { was: number; earned: number; spent: number; corrected: number; left: number };

export type DayTask = {
  id: string;
  title: string;
  icon: string;
  points: number;
  needs_approval: boolean;
  /** «Сделала» needs a photo of the result. */
  needs_photo: boolean;
  section_id: string;
  section: string;
  color: string;
  window_start: string | null;
  window_end: string | null;
  window: 'open' | 'before' | 'after';
  completion_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | null;
  /** The request has a photo (kept 7 days after the parent's decision). */
  has_photo: boolean;
  earned: number | null;
  praise: string | null;
  praised_by_name: string | null;
};

export type ChildDay = { child_id: string; date: string; time: string; formula: Formula; tasks: DayTask[] };

export type QueueItem = {
  id: string;
  child_id: string;
  child_name: string;
  child_color: string;
  child_avatar: string;
  title: string;
  icon: string;
  for_date: string;
  /** For the family's "today" on the server (Europe/Minsk), not the phone's clock. */
  is_today: boolean;
  created_at: string;
  status: 'pending' | 'approved' | 'rejected';
  points: number;
  auto_approved: boolean;
  decided_at: string | null;
  decided_by_name: string | null;
  decided_by_me: boolean | null;
  praise: string | null;
  praised_by_name: string | null;
  has_photo: boolean;
};

export type Section = { id: string; name: string; color: string; sort_order: number };

export type TaskTemplate = {
  id: string;
  child_id: string;
  section_id: string;
  title: string;
  icon: string;
  points: number;
  days: number[];
  window_start: string | null;
  window_end: string | null;
  needs_approval: boolean;
  needs_photo: boolean;
  enabled: boolean;
  sort_order: number;
};

export type TaskInput = {
  id: string | null;
  childIds: string[];
  sectionId: string;
  title: string;
  icon: string;
  points: number;
  days: number[];
  windowStart: string | null;
  windowEnd: string | null;
  needsApproval: boolean;
  needsPhoto: boolean;
  enabled: boolean;
};

export type LedgerRow = {
  id: number;
  child_id: string;
  kind: string;
  delta: number;
  for_date: string;
  title: string;
  comment: string | null;
  created_at: string;
  /** The task request behind this entry: praise and photo, if any. */
  completion: { id: string; praise: string | null; has_photo: boolean } | null;
};

export type FamilyAccess = {
  is_admin: boolean;
  member: boolean;
  status: 'none' | 'pending' | 'approved' | 'declined';
  requested_at: string | null;
};

export type Consent = { id: number; body: string; created_at: string } | null;

/** Notification settings of the signed-in person (times are HH:MM, family time). */
export type PushSettings = {
  ready: boolean;
  subscriptions: number;
  summary_at: string;
  quiet_from: string;
  quiet_to: string;
} | null;

export type FamilyRequest = {
  id: string;
  email: string;
  display_name: string;
  consent_version: number;
  consent_at: string;
  status: 'pending' | 'approved' | 'declined';
  decided_at: string | null;
  created_at: string;
};

/** Error with a key from t.errors, so screens can show a friendly message. */
export class ApiError extends Error {
  constructor(public key: string, message?: string) {
    super(message ?? key);
  }
}

function isNetworkFailure(message: string) {
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed/i.test(message);
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const err = e as { message?: string; code?: string; status?: number } | null;
  const message = err?.message ?? String(e);
  if (e instanceof AuthError || err?.code) {
    switch (err?.code) {
      case 'over_email_send_rate_limit':
        return new ApiError('emailRateLimit', message);
      // Also returned for anonymous sign-in (child's phone) and code checks.
      case 'over_request_rate_limit':
        return new ApiError('requestRateLimit', message);
      case 'email_address_not_authorized':
        return new ApiError('emailNotAuthorized', message);
      case 'email_address_invalid':
      case 'validation_failed':
        return new ApiError('emailInvalid', message);
      case 'otp_expired':
      case 'otp_disabled':
        return new ApiError('codeInvalid', message);
    }
  }
  if (/not authorized/i.test(message) && /email/i.test(message)) return new ApiError('emailNotAuthorized', message);
  if (isNetworkFailure(message) || err?.status === 0) return new ApiError('noConnection', message);
  const key = Object.keys(t.errors).find((k) => message === k || message.includes(k));
  return new ApiError(key ?? 'generic', message);
}

export function errorText(e: unknown): string {
  const key = toApiError(e).key;
  return t.errors[key] ?? t.errors.generic;
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw toApiError(error);
  return data as T;
}

export const api = {
  whoami: () => rpc<Who>('whoami'),

  createFamily: (displayName: string, children: NewChild[]) =>
    rpc<string>('create_family', { p_display_name: displayName, p_children: children }),

  saveChild: (c: { id: string | null } & NewChild) =>
    rpc<string>('save_child', {
      p_child_id: c.id,
      p_name: c.name,
      p_birth_date: c.birth_date,
      p_avatar: c.avatar,
      p_color: c.color,
    }),

  createPairingCode: (childId: string) =>
    rpc<{ code: string; expires_at: string }>('create_pairing_code', { p_child_id: childId }),

  pairDevice: async (code: string) => {
    const r = await rpc<{ ok: boolean; error?: string; child_name?: string }>('pair_device', { p_code: code });
    if (!r.ok) throw new ApiError(r.error ?? 'generic');
    return r;
  },

  unlinkDevice: (memberId: string) => rpc<null>('unlink_device', { p_member_id: memberId }),

  deleteFamily: () => rpc<null>('delete_family'),

  pushPublicKey: () => rpc<string | null>('push_public_key'),

  savePushSubscription: (k: { endpoint: string; p256dh: string; auth: string }) =>
    rpc<null>('save_push_subscription', {
      p_endpoint: k.endpoint,
      p_p256dh: k.p256dh,
      p_auth: k.auth,
      p_user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 300),
    }),

  deletePushSubscription: (endpoint: string) => rpc<null>('delete_push_subscription', { p_endpoint: endpoint }),

  myPushSettings: () => rpc<PushSettings>('my_push_settings'),

  savePushSettings: (summaryAt: string, quietFrom: string, quietTo: string) =>
    rpc<null>('save_push_settings', { p_summary_at: summaryAt, p_quiet_from: quietFrom, p_quiet_to: quietTo }),

  sendTestPush: () => rpc<number>('send_test_push'),

  /** A parent leaves the family while the other parent stays. */
  leaveFamily: () => rpc<null>('leave_family'),

  acceptConsent: (version: number) => rpc<null>('accept_consent', { p_version: version }),

  listChildren: async (): Promise<Child[]> => {
    const { data, error } = await supabase.from('children').select('*').order('sort_order').order('created_at');
    if (error) throw toApiError(error);
    return data as Child[];
  },

  // Stage 2: tasks, requests, signatures, ledger

  childDay: (childId?: string) => rpc<ChildDay>('child_day', childId ? { p_child_id: childId } : {}),

  /** «Сделала». `photo`: a JPEG as base64, for a task with «Фото». */
  markDone: (taskId: string, photo?: string) =>
    rpc<{ completion_id: string; status: DayTask['status']; already: boolean }>(
      'mark_done',
      photo ? { p_task_id: taskId, p_photo: photo } : { p_task_id: taskId },
    ),

  /** The photo of a request, as a JPEG data URL. */
  taskPhoto: async (completionId: string) => {
    const r = await rpc<{ image: string; created_at: string }>('task_photo', { p_completion_id: completionId });
    return `data:image/jpeg;base64,${r.image}`;
  },

  parentQueue: () => rpc<QueueItem[]>('parent_queue'),

  approveRequest: (id: string, approve: boolean) =>
    rpc<{
      changed: boolean;
      status: string;
      points?: number;
      decided_by_name?: string | null;
      decided_at?: string | null;
      decided_by_me?: boolean;
    }>('approve_request', {
      p_request_id: id,
      p_approve: approve,
    }),

  approveAllToday: () => rpc<{ count: number; points: number }>('approve_all_today'),

  giveBonus: (childId: string, points: number, comment: string) =>
    rpc<number>('give_bonus', { p_child_id: childId, p_points: points, p_comment: comment.trim() || null }),

  addCorrection: (childId: string, delta: number, comment: string) =>
    rpc<number>('add_correction', { p_child_id: childId, p_delta: delta, p_comment: comment }),

  listSections: async (): Promise<Section[]> => {
    const { data, error } = await supabase.from('task_sections').select('id,name,color,sort_order').order('sort_order');
    if (error) throw toApiError(error);
    return data as Section[];
  },

  listTasks: async (childId: string): Promise<TaskTemplate[]> => {
    const { data, error } = await supabase
      .from('task_templates')
      .select(
        'id,child_id,section_id,title,icon,points,days,window_start,window_end,needs_approval,needs_photo,enabled,sort_order',
      )
      .eq('child_id', childId)
      .is('deleted_at', null)
      .order('sort_order')
      .order('created_at');
    if (error) throw toApiError(error);
    return (data as TaskTemplate[]).map((x) => ({
      ...x,
      window_start: x.window_start ? x.window_start.slice(0, 5) : null,
      window_end: x.window_end ? x.window_end.slice(0, 5) : null,
    }));
  },

  saveTask: (v: TaskInput) =>
    rpc<string[]>('save_task', {
      p_task_id: v.id,
      p_child_ids: v.childIds,
      p_section_id: v.sectionId,
      p_title: v.title.trim(),
      p_icon: v.icon,
      p_points: v.points,
      p_days: v.days,
      p_window_start: v.windowStart,
      p_window_end: v.windowEnd,
      p_needs_approval: v.needsApproval,
      p_enabled: v.enabled,
      p_needs_photo: v.needsPhoto,
    }),

  setTaskEnabled: (id: string, enabled: boolean) => rpc<null>('set_task_enabled', { p_task_id: id, p_enabled: enabled }),

  /** Parent's check for one task: true = points only after the parent signs. */
  setTaskApproval: (id: string, needs: boolean) => rpc<null>('set_task_approval', { p_task_id: id, p_needs: needs }),

  /** «Фото» for one task (turns the parent's check on as well). */
  setTaskPhoto: (id: string, needs: boolean) => rpc<null>('set_task_photo', { p_task_id: id, p_needs: needs }),

  /** The same check for all tasks of one child. Returns how many tasks changed. */
  setChildTasksApproval: (childId: string, needs: boolean) =>
    rpc<number>('set_child_tasks_approval', { p_child_id: childId, p_needs: needs }),

  praiseRequest: (id: string, praise: string) =>
    rpc<{ ok: boolean; praise: string }>('praise_request', { p_request_id: id, p_praise: praise }),

  deleteTask: (id: string) => rpc<null>('delete_task', { p_task_id: id }),

  reorderTasks: (ids: string[]) => rpc<null>('reorder_tasks', { p_task_ids: ids }),

  copyTasks: (fromChild: string, toChild: string) =>
    rpc<number>('copy_tasks', { p_from_child: fromChild, p_to_child: toChild }),

  saveSection: (id: string | null, name: string, color: string | null) =>
    rpc<string>('save_section', { p_section_id: id, p_name: name.trim(), p_color: color }),

  listLedger: async (childId: string): Promise<LedgerRow[]> => {
    const { data, error } = await supabase
      .from('ledger')
      .select('id,child_id,kind,delta,for_date,title,comment,created_at,completion:task_completions(id,praise,has_photo)')
      .eq('child_id', childId)
      .order('id', { ascending: false })
      .limit(200);
    if (error) throw toApiError(error);
    return data as unknown as LedgerRow[]; // "completion" is one row (many-to-one)
  },

  createParentInvite: () => rpc<{ code: string; expires_at: string }>('create_parent_invite'),

  myFamilyAccess: () => rpc<FamilyAccess>('my_family_access'),

  currentConsent: () => rpc<Consent>('current_consent'),

  withdrawFamilyRequest: () => rpc<void>('withdraw_family_request'),

  requestFamilyAccess: (displayName: string, consentVersion: number) =>
    rpc<{ status: FamilyAccess['status'] }>('request_family_access', {
      p_display_name: displayName,
      p_consent_version: consentVersion,
    }),

  listFamilyRequests: () => rpc<FamilyRequest[]>('list_family_requests'),

  decideFamilyRequest: (id: string, approve: boolean) =>
    rpc<{ status: string }>('decide_family_request', { p_request_id: id, p_approve: approve }),

  saveConsentVersion: (body: string) => rpc<number>('save_consent_version', { p_body: body }),

  joinFamily: async (code: string, displayName: string, consentVersion: number) => {
    const r = await rpc<{ ok: boolean; error?: string }>('join_family', {
      p_code: code,
      p_display_name: displayName,
      p_consent_version: consentVersion,
    });
    if (!r.ok) throw new ApiError(r.error ?? 'generic');
    return r;
  },

  listMembers: async (): Promise<MemberRow[]> => {
    const { data, error } = await supabase
      .from('members')
      .select('id,user_id,role,child_id,display_name,created_at')
      .order('created_at');
    if (error) throw toApiError(error);
    return data as MemberRow[];
  },
};

export const auth = {
  sendEmailCode: async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw toApiError(error);
  },
  verifyEmailCode: async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw toApiError(error);
  },
  signInChildDevice: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw toApiError(error);
  },
  signOut: async () => {
    await supabase.auth.signOut();
  },
  /** After the account was deleted on the server: forget it on this phone only. */
  forgetAccount: async () => {
    await supabase.auth.signOut({ scope: 'local' });
  },
};
