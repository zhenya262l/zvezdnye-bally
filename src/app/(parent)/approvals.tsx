import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PenIcon } from '@/components/art/Icons';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { LoadError, Loading } from '@/components/Loading';
import { QueueCard } from '@/components/QueueCard';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { Toast, type ToastMsg } from '@/components/Toast';
import { api, errorText, type QueueItem } from '@/lib/api';
import { formatTime, todayISO } from '@/lib/dates';
import { useParentQueue } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { space, usePalette } from '@/theme';

export default function Approvals() {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const who = useWho();
  const queue = useParentQueue();
  const { id: highlightId } = useLocalSearchParams<{ id?: string }>();
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<ToastMsg>(null);
  const hideInfo = useCallback(() => setInfo(null), []);

  if (queue.isPending) return <Loading />;
  if (queue.isError) return <LoadError text={errorText(queue.error)} onRetry={() => queue.refetch()} />;

  const tz = who.data?.member?.timezone;
  const today = todayISO(tz);
  const pending = queue.data.filter((x) => x.status === 'pending');
  // "Today" comes from the server, so the button is right just after midnight.
  const pendingToday = pending.filter((x) => x.is_today);
  // Latest decision first: the most recent signature is what parents check.
  const decided = queue.data
    .filter((x) => x.status !== 'pending')
    .sort((a, b) => Date.parse(b.decided_at ?? '') - Date.parse(a.decided_at ?? ''));

  // Waits for the new list, so a signed card does not flash its buttons again.
  const refresh = async () => {
    void qc.invalidateQueries({ queryKey: ['childDay', uid] });
    void qc.invalidateQueries({ queryKey: ['ledger', uid] });
    await qc.invalidateQueries({ queryKey: ['queue', uid] }).catch(() => undefined);
  };

  async function decide(item: QueueItem, approve: boolean) {
    setBusy(item.id);
    setInfo(null);
    try {
      const r = await api.approveRequest(item.id, approve);
      if (!r.changed && !r.decided_by_me) {
        // The other parent was faster: say who decided, what and when.
        const time = r.decided_at ? formatTime(r.decided_at, tz) : '';
        const name = r.decided_by_name || t.common.formerParent;
        setInfo({
          text:
            r.status === 'rejected' ? t.approvals.alreadyRejected(name, time) : t.approvals.alreadySigned(name, time),
          kind: 'info',
        });
      }
    } catch (e) {
      setInfo({ text: errorText(e), kind: 'error' });
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  async function praise(item: QueueItem, text: string) {
    setBusy(`praise-${item.id}`);
    try {
      await api.praiseRequest(item.id, text);
    } catch (e) {
      setInfo({ text: errorText(e), kind: 'error' });
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  async function signAll() {
    setBusy('all');
    setInfo(null);
    try {
      const r = await api.approveAllToday();
      setInfo({
        text: t.approvals.signAllDone(r.count, r.points),
        kind: 'success',
      });
    } catch (e) {
      setInfo({ text: errorText(e), kind: 'error' });
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  return (
    <View style={styles.root}>
      <Screen inTabs>
        <T v="title">{t.approvals.title}</T>
        {pendingToday.length > 0 ? (
          <Button
            testID="sign-all"
            title={t.approvals.signAll(pendingToday.length)}
            variant="accent"
            onPress={signAll}
            loading={busy === 'all'}
          />
        ) : null}
        {pending.length === 0 ? (
          <Card>
            <View style={styles.empty}>
              <PenIcon color={p.primary} size={44} />
              <T v="bodyBold" center>
                {t.approvals.empty}
              </T>
              <T muted center>
                {t.approvals.emptyHint}
              </T>
            </View>
          </Card>
        ) : (
          pending.map((item) => (
            <QueueCard
              key={item.id}
              item={item}
              today={today}
              tz={tz}
              highlighted={item.id === highlightId}
              busy={busy === item.id}
              onDecide={(approve) => decide(item, approve)}
            />
          ))
        )}
        {decided.length > 0 ? (
          <>
            <T v="h2" style={styles.section}>
              {t.approvals.decidedToday}
            </T>
            {decided.map((item) => (
              <QueueCard
                key={item.id}
                item={item}
                today={today}
                tz={tz}
                highlighted={item.id === highlightId}
                busy={busy === `praise-${item.id}`}
                onPraise={(text) => praise(item, text)}
              />
            ))}
          </>
        ) : null}
      </Screen>
      <Toast msg={info} onHide={hideInfo} inTabs />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  empty: { alignItems: 'center', gap: space.s, paddingVertical: space.l },
  section: { marginTop: space.s },
});
