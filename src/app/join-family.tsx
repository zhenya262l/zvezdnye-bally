import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { CodeInput } from '@/components/CodeInput';
import { ConsentBox } from '@/components/ConsentBox';
import { Field } from '@/components/Field';
import { Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { api, errorText, toApiError } from '@/lib/api';
import { useConsent } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, space } from '@/theme';

/** Second parent: joins the family created on the other parent's phone. */
export default function JoinFamily() {
  const qc = useQueryClient();
  const session = useSession((s) => s.session);
  const who = useWho();
  const consent = useConsent();
  const [role, setRole] = useState<'mom' | 'dad' | 'other'>('dad');
  const [agreed, setAgreed] = useState(false);
  const [otherName, setOtherName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) return <Redirect href="/" />;
  if (who.isPending || consent.isPending) return <Loading />;
  if (who.data?.member || who.data?.is_anonymous) return <Redirect href="/" />;

  const displayName = role === 'mom' ? t.setup.mom : role === 'dad' ? t.setup.dad : otherName.trim();

  async function join() {
    setError(null);
    if (!displayName) return setError(t.errors.invalid_display_name);
    if (code.length < 6) return setError(t.errors.invalid_code);
    if (!consent.data) return setError(t.errors.consent_not_configured);
    if (!agreed) return setError(t.errors.consent_required);
    setBusy(true);
    try {
      await api.joinFamily(code, displayName, consent.data.id);
      await qc.invalidateQueries({ queryKey: ['whoami'] });
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
      setCode('');
      if (toApiError(e).key.startsWith('consent')) {
        setAgreed(false);
        void consent.refetch();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <T v="title">{t.join.title}</T>
      <T muted>{t.join.lead}</T>
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
      <CodeInput testID="join-code" accessibilityLabel={t.join.title} value={code} onChange={setCode} />
      {consent.data ? (
        <ConsentBox consent={consent.data} checked={agreed} onChange={setAgreed} />
      ) : (
        <T>{t.access.closed}</T>
      )}
      <Banner text={error} />
      <Button
        testID="join-submit"
        title={t.join.join}
        variant="accent"
        onPress={join}
        loading={busy}
        disabled={code.length < 6 || !agreed || !consent.data}
      />
      <Button title={t.common.back} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </Screen>
  );
}

const styles = StyleSheet.create({ chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s } });
