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
      case 'over_request_rate_limit':
        return new ApiError('emailRateLimit', message);
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

  listChildren: async (): Promise<Child[]> => {
    const { data, error } = await supabase.from('children').select('*').order('sort_order').order('created_at');
    if (error) throw toApiError(error);
    return data as Child[];
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
};
