import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/art/Avatar';
import { BackLink, NotFound } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Formula } from '@/components/Formula';
import { LedgerList } from '@/components/LedgerList';
import { Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { Stepper } from '@/components/Stepper';
import { T } from '@/components/T';
import { Toast, type ToastMsg } from '@/components/Toast';
import { api, errorText } from '@/lib/api';
import { useChildDay, useChildren, useLedger } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, space } from '@/theme';

/** Parent: a child's points history and corrections of mistakes. */
export default function History() {
  const { child: childId } = useLocalSearchParams<{ child?: string }>();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const who = useWho();
  const kids = useChildren();
  const ledger = useLedger(childId);
  const day = useChildDay(childId, { enabled: !!childId });
  const [fixOpen, setFixOpen] = useState(false);
  const [sign, setSign] = useState<-1 | 1>(-1);
  const [amount, setAmount] = useState(1);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ToastMsg>(null);
  const hideMsg = useCallback(() => setMsg(null), []);

  if (!uid) return <Redirect href="/" />;
  if (who.data && who.data.member?.role !== 'parent') return <Redirect href="/" />;
  if (kids.isPending) return <Loading />;
  const child = kids.data?.find((c) => c.id === childId);
  if (!child) {
    return (
      <Screen>
        <NotFound fallback="/kids" />
      </Screen>
    );
  }

  async function saveFix() {
    setBusy(true);
    setMsg(null);
    try {
      await api.addCorrection(child!.id, sign * amount, comment.trim());
      setFixOpen(false);
      setComment('');
      setMsg({ text: t.common.done, kind: 'success' });
      void qc.invalidateQueries({ queryKey: ['ledger', uid] });
      void qc.invalidateQueries({ queryKey: ['childDay', uid] });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const f = day.data?.formula;
  return (
    <View style={styles.root}>
      <Screen>
        <BackLink fallback="/kids" />
        <View style={styles.head}>
          <Avatar id={child.avatar} color={child.color} size={56} />
          <T v="title" style={styles.flex}>
            {t.history.title(child.name)}
          </T>
        </View>
        {f ? <Formula was={f.was} earned={f.earned} spent={f.spent} corrected={f.corrected} left={f.left} /> : null}
        <Card title={t.kids.history} accent={brand.sun}>
          <LedgerList rows={ledger.data ?? []} loading={ledger.isPending} failed={ledger.isError} />
        </Card>
        {fixOpen ? (
          <Card title={t.history.correctionTitle} accent={brand.violet}>
            <T v="small" muted>
              {t.history.correctionLead}
            </T>
            <View style={styles.chips}>
              <Chip label={t.history.correctionMinus} selected={sign === -1} onPress={() => setSign(-1)} />
              <Chip label={t.history.correctionPlus} selected={sign === 1} onPress={() => setSign(1)} />
            </View>
            <Stepper label={t.history.correctionAmount} value={amount} onChange={setAmount} min={1} max={500} />
            <Field label={t.history.correctionComment} value={comment} onChangeText={setComment} maxLength={120} />
            <Button title={t.history.correctionSave} onPress={saveFix} loading={busy} />
            <Button title={t.common.cancel} variant="ghost" onPress={() => setFixOpen(false)} />
          </Card>
        ) : (
          <Button title={t.history.correction} variant="secondary" onPress={() => setFixOpen(true)} />
        )}
        <Button
          title={t.common.back}
          variant="ghost"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/kids'))}
        />
      </Screen>
      <Toast msg={msg} onHide={hideMsg} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', gap: space.s },
});
