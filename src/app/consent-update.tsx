import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';

import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ConsentBox } from '@/components/ConsentBox';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { api, auth, errorText, toApiError } from '@/lib/api';
import { useConsent, useMembers } from '@/lib/queries';
import { forgetPush } from '@/lib/pushState';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';

/**
 * The owner saved a new edition of the consent text: a parent already in a
 * family reads it and accepts it before anything else (owner's decision
 * 20.10.2026). Who does not agree leaves the family or deletes it.
 */
export default function ConsentUpdate() {
  const qc = useQueryClient();
  const ready = useSession((s) => s.ready);
  const session = useSession((s) => s.session);
  const who = useWho();
  const consent = useConsent();
  const members = useMembers();
  // The tick belongs to the edition the parent read (see family-request.tsx).
  const [agreedId, setAgreedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'leave' | 'delete' | null>(null);

  if (!ready) return <Loading />;
  if (!session) return <Redirect href="/" />;
  if (who.isPending || consent.isPending) return <Loading />;
  if (who.isError) return <LoadError text={errorText(who.error)} onRetry={() => who.refetch()} />;
  if (!who.data.needs_consent || who.data.member?.role !== 'parent') return <Redirect href="/" />;
  if (consent.isError) return <LoadError text={errorText(consent.error)} onRetry={() => consent.refetch()} />;
  if (!consent.data) return <Redirect href="/" />;

  const current = consent.data;
  const agreed = agreedId === current.id;
  const parents = (members.data ?? []).filter((m) => m.role === 'parent').length;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.acceptConsent(current.id);
      await qc.invalidateQueries({ queryKey: ['whoami'] });
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
      if (toApiError(e).key === 'consent_outdated') {
        setAgreedId(null);
        void consent.refetch();
      }
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      // The account is deleted on the server: forget it on this phone.
      await forgetPush(false);
      await auth.forgetAccount();
      qc.clear();
      router.replace('/welcome');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <T v="title">{t.consentUpdate.title}</T>
      <T muted>{t.consentUpdate.lead}</T>
      <ConsentBox consent={current} checked={agreed} onChange={(v) => setAgreedId(v ? current.id : null)} />
      <Banner text={dialog ? null : error} />
      <Button
        testID="consent-accept"
        title={t.consentUpdate.accept}
        variant="accent"
        onPress={accept}
        loading={busy && !dialog}
        disabled={!agreed}
      />
      {members.isSuccess ? (
        <Button
          testID="consent-disagree"
          title={parents >= 2 ? t.consentUpdate.disagreeLeave : t.consentUpdate.disagreeDelete}
          variant="ghost"
          onPress={() => setDialog(parents >= 2 ? 'leave' : 'delete')}
        />
      ) : null}
      <ConfirmModal
        visible={dialog === 'leave'}
        title={t.family.leaveTitle}
        text={t.family.leaveText}
        confirmTitle={t.family.leaveConfirm}
        danger
        busy={busy}
        error={error}
        onCancel={() => {
          setDialog(null);
          setError(null);
        }}
        onConfirm={() => void withdraw(api.leaveFamily)}
      />
      <ConfirmModal
        visible={dialog === 'delete'}
        title={t.family.deleteTitle}
        text={t.family.deleteText}
        confirmTitle={t.family.deleteConfirm}
        typeToConfirm={t.family.deleteWord}
        danger
        busy={busy}
        error={error}
        onCancel={() => {
          setDialog(null);
          setError(null);
        }}
        onConfirm={() => void withdraw(api.deleteFamily)}
      />
    </Screen>
  );
}
