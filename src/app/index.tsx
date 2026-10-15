import { Redirect } from 'expo-router';

import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { errorText } from '@/lib/api';
import { mustInstallFirst } from '@/lib/platform';
import { useSession, useWho } from '@/lib/session';
import { isConfigured } from '@/lib/supabase';

/** Decides where to go: install guide, sign-in, family setup, parent or child screens. */
export default function Gate() {
  const ready = useSession((s) => s.ready);
  const session = useSession((s) => s.session);
  const who = useWho();

  if (mustInstallFirst()) return <Redirect href="/install" />;
  if (!isConfigured) {
    return (
      <Screen>
        <T v="title">Приложение не настроено</T>
        <T muted>Не заданы адрес и ключ Supabase в настройках сборки.</T>
      </Screen>
    );
  }
  if (!ready) return <Loading />;
  if (!session) return <Redirect href="/welcome" />;
  if (who.isPending) return <Loading />;
  if (who.isError) return <LoadError text={errorText(who.error)} onRetry={() => who.refetch()} />;

  const m = who.data.member;
  if (!m) return <Redirect href={who.data.is_anonymous ? '/child-pair' : '/family-setup'} />;
  return <Redirect href={m.role === 'parent' ? '/kids' : '/today'} />;
}
