import { useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { api, errorText, type Consent } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { useConsent, useFamilyAccess } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';

/** Owner only: the consent text new parents accept. Each save is a new version. */
export default function ConsentAdmin() {
  const uid = useSession((s) => s.session?.user.id);
  const access = useFamilyAccess();
  const consent = useConsent();

  if (!uid) return <Redirect href="/" />;
  if (access.isPending || consent.isPending) return <Loading />;
  if (!access.data?.is_admin) return <Redirect href="/" />;
  return <Editor key={consent.data?.id ?? 0} current={consent.data ?? null} />;
}

function Editor({ current }: { current: Consent }) {
  const qc = useQueryClient();
  const [body, setBody] = useState(current?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'success' } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const id = await api.saveConsentVersion(body);
      setMsg({ text: t.admin.saved(id), kind: 'success' });
      await qc.invalidateQueries({ queryKey: ['consent'] });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BackLink fallback="/family" />
      <T v="title">{t.admin.consentTitle}</T>
      <T muted>{t.admin.consentLead}</T>
      <T v="bodyBold">
        {current ? t.admin.current(current.id, formatDate(current.created_at.slice(0, 10))) : t.admin.noConsent}
      </T>
      <Field
        testID="consent-body"
        value={body}
        onChangeText={setBody}
        multiline
        textAlignVertical="top"
        style={styles.body}
        maxLength={20000}
      />
      <Banner text={msg?.text} kind={msg?.kind} />
      <Button testID="consent-save" title={t.admin.save} onPress={save} loading={busy} disabled={body.trim().length < 50} />
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { minHeight: 320, paddingTop: 12, paddingBottom: 12 } });
