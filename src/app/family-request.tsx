import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ConsentBox } from '@/components/ConsentBox';
import { Field } from '@/components/Field';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { api, auth, errorText } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { useConsent, useFamilyAccess } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, space } from '@/theme';

/**
 * A new parent asks the owner to allow a new family. The consent to personal
 * data processing is part of the request: without the tick it cannot be sent.
 */
export default function FamilyRequest() {
  const qc = useQueryClient();
  const session = useSession((s) => s.session);
  const who = useWho();
  const access = useFamilyAccess();
  const consent = useConsent();
  const [role, setRole] = useState<'mom' | 'dad' | 'other'>('mom');
  const [otherName, setOtherName] = useState('');
  // The tick belongs to the text the parent read. If a new edition arrives
  // while the screen is open, the tick is cleared.
  const [agreedId, setAgreedId] = useState<number | null>(null);
  const agreed = !!consent.data && agreedId === consent.data.id;
  const setAgreed = (v: boolean) => setAgreedId(v && consent.data ? consent.data.id : null);
  const [busy, setBusy] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'info' } | null>(null);

  if (!session) return <Redirect href="/" />;
  if (who.isPending || access.isPending || consent.isPending) return <Loading />;
  if (who.data?.member || who.data?.is_anonymous) return <Redirect href="/" />;
  if (access.isError) return <LoadError text={errorText(access.error)} onRetry={() => access.refetch()} />;
  if (consent.isError) return <LoadError text={errorText(consent.error)} onRetry={() => consent.refetch()} />;
  if (access.data.is_admin || access.data.status === 'approved') return <Redirect href="/family-setup" />;

  const displayName = role === 'mom' ? t.setup.mom : role === 'dad' ? t.setup.dad : otherName.trim();

  async function send() {
    if (!consent.data) return;
    setMsg(null);
    if (!displayName) return setMsg({ text: t.errors.invalid_display_name, kind: 'error' });
    setBusy(true);
    try {
      await api.requestFamilyAccess(displayName, consent.data.id);
      await qc.invalidateQueries({ queryKey: ['access'] });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
      void consent.refetch();
      setAgreed(false);
    } finally {
      setBusy(false);
    }
  }

  async function checkAgain() {
    setMsg(null);
    const r = await access.refetch();
    if (r.isError) setMsg({ text: errorText(r.error), kind: 'error' });
    else if (r.data?.status === 'pending') setMsg({ text: t.access.stillPending, kind: 'info' });
  }

  async function signOut() {
    await auth.signOut();
    qc.clear();
    router.replace('/welcome');
  }

  async function withdraw() {
    setBusy(true);
    setWithdrawError(null);
    try {
      await api.withdrawFamilyRequest();
      setWithdrawOpen(false);
      setAgreedId(null);
      await qc.invalidateQueries({ queryKey: ['access'] });
    } catch (e) {
      setWithdrawError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const invite = (
    <Button
      testID="have-invite"
      title={t.setup.haveInvite}
      subtitle={t.setup.haveInviteHint}
      variant="secondary"
      onPress={() => router.push('/join-family')}
    />
  );

  const bottom = (
    <>
      <Banner text={msg?.text} kind={msg?.kind} />
      {access.data.status !== 'none' ? (
        <Button
          testID="access-withdraw"
          title={t.access.withdraw}
          variant="ghost"
          onPress={() => setWithdrawOpen(true)}
        />
      ) : null}
      <Button title={t.family.signOut} variant="ghost" onPress={signOut} />
      <ConfirmModal
        visible={withdrawOpen}
        title={t.access.withdrawTitle}
        text={t.access.withdrawText}
        confirmTitle={t.access.withdrawConfirm}
        danger
        busy={busy}
        error={withdrawError}
        onCancel={() => {
          setWithdrawOpen(false);
          setWithdrawError(null);
        }}
        onConfirm={withdraw}
      />
    </>
  );

  if (access.data.status === 'pending') {
    return (
      <Screen>
        <T v="title">{t.access.pendingTitle}</T>
        <T testID="access-pending">
          {t.access.pendingText(access.data.requested_at ? formatDateTime(access.data.requested_at) : '')}
        </T>
        <Button testID="access-check" title={t.access.checkAgain} onPress={checkAgain} />
        {invite}
        {bottom}
      </Screen>
    );
  }

  if (access.data.status === 'declined') {
    return (
      <Screen>
        <T v="title">{t.access.declinedTitle}</T>
        <T testID="access-declined">{t.access.declinedText}</T>
        {invite}
        {bottom}
      </Screen>
    );
  }

  return (
    <Screen>
      <T v="title">{t.access.title}</T>
      {invite}
      {!consent.data ? (
        <T testID="access-closed">{t.access.closed}</T>
      ) : (
        <>
          <T muted>{t.access.lead}</T>
          <Card title={t.setup.youAre} accent={brand.turquoise}>
            <View style={styles.chips}>
              <Chip label={t.setup.mom} selected={role === 'mom'} onPress={() => setRole('mom')} />
              <Chip label={t.setup.dad} selected={role === 'dad'} onPress={() => setRole('dad')} />
              <Chip label={t.setup.other} selected={role === 'other'} onPress={() => setRole('other')} />
            </View>
            {role === 'other' ? (
              <Field value={otherName} onChangeText={setOtherName} placeholder={t.setup.otherPlaceholder} maxLength={30} />
            ) : null}
          </Card>
          <ConsentBox consent={consent.data} checked={agreed} onChange={setAgreed} />
          <Button
            testID="access-send"
            title={t.access.send}
            variant="accent"
            onPress={send}
            loading={busy}
            disabled={!agreed}
          />
        </>
      )}
      {bottom}
    </Screen>
  );
}

const styles = StyleSheet.create({ chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s } });
