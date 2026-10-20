import { Redirect } from 'expo-router';

import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { errorText } from '@/lib/api';
import { mustInstallFirst } from '@/lib/platform';
import { retryRestore, useSession, useWho } from '@/lib/session';
import { isConfigured } from '@/lib/supabase';
import { t } from '@/strings.ru';

/** Decides where to go: install guide, sign-in, family setup, parent or child screens. */
export default function Gate() {
  const ready = useSession((s) => s.ready);
  const session = useSession((s) => s.session);
  const restoring = useSession((s) => s.restoring);
  const who = useWho();

  if (mustInstallFirst()) return <Redirect href="/install" />;
  if (!isConfigured) {
    return (
      <Screen>
        <T v="title">{t.gate.notConfiguredTitle}</T>
        <T muted>{t.gate.notConfiguredText}</T>
      </Screen>
    );
  }
  if (!ready) return <Loading />;
  if (!session && restoring)
    return <LoadError kind="info" text={t.gate.restoring} onRetry={() => void retryRestore()} />;
  if (!session) return <Redirect href="/welcome" />;
  if (who.isPending) return <Loading />;
  if (who.isError) return <LoadError text={errorText(who.error)} onRetry={() => who.refetch()} />;

  const m = who.data.member;
  if (!m) return <Redirect href={who.data.is_anonymous ? '/child-pair' : '/family-setup'} />;
  // A new edition of the consent text comes first (owner's decision 20.10.2026).
  if (m.role === 'parent' && who.data.needs_consent) return <Redirect href="/consent-update" />;
  return <Redirect href={m.role === 'parent' ? '/approvals' : '/today'} />;
}
