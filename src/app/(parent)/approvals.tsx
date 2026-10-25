import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PenIcon } from '@/components/art/Icons';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { LoadError, Loading } from '@/components/Loading';
import { PinModal, pinErrorText } from '@/components/PinModal';
import { PurchaseCard } from '@/components/PurchaseCard';
import { PushPrompt } from '@/components/PushPrompt';
import { QueueCard } from '@/components/QueueCard';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { Toast, type ToastMsg } from '@/components/Toast';
import { api, errorText, type PurchaseItem, type QueueItem } from '@/lib/api';
import { formatTime, todayISO } from '@/lib/dates';
import { useParentQueue, usePurchaseQueue } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { space, usePalette } from '@/theme';

export default function Approvals() {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const who = useWho();
  const queue = useParentQueue();
  const purchases = usePurchaseQueue();
  const { id: highlightId, purchase: highlightPurchase } = useLocalSearchParams<{ id?: string; purchase?: string }>();
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<ToastMsg>(null);
  // Signing a purchase: the PIN dialog for this request.
  const [pinFor, setPinFor] = useState<PurchaseItem | null>(null);
  const [pinMode, setPinMode] = useState<'enter' | 'create'>('enter');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const pinState = useQuery({ queryKey: ['pin', uid], queryFn: api.myPin, enabled: !!uid });
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
  const buyPending = (purchases.data ?? []).filter((x) => x.status === 'pending');
  const buyDecided = (purchases.data ?? [])
    .filter((x) => x.status !== 'pending')
    .sort((a, b) => Date.parse(b.decided_at ?? '') - Date.parse(a.decided_at ?? ''));

  // Waits for the new list, so a signed card does not flash its buttons again.
  const refresh = async () => {
    void qc.invalidateQueries({ queryKey: ['childDay', uid] });
    void qc.invalidateQueries({ queryKey: ['ledger', uid] });
    void qc.invalidateQueries({ queryKey: ['purchases', uid] });
    await qc.invalidateQueries({ queryKey: ['queue', uid] }).catch(() => undefined);
  };

  function askPin(item: PurchaseItem) {
    setInfo(null);
    setPinError(null);
    setPinMode(pinState.data?.set === false ? 'create' : 'enter');
    setPinFor(item);
  }

  async function signWithPin(pin: string) {
    if (!pinFor) return;
    setPinBusy(true);
    setPinError(null);
    try {
      if (pinMode === 'create') {
        const made = await api.setParentPin(pin);
        if (!made.ok) {
          setPinError(pinErrorText(made.error ?? 'generic'));
          return;
        }
        void qc.invalidateQueries({ queryKey: ['pin', uid] });
        setPinMode('enter');
      }
      const r = await api.decidePurchase(pinFor.id, true, pin);
      if (r.error) {
        if (r.error === 'pin_not_set') setPinMode('create');
        setPinError(pinErrorText(r.error, r.tries_left));
        return;
      }
      setPinFor(null);
      if (!r.changed && !r.decided_by_me) {
        const time = r.decided_at ? formatTime(r.decided_at, tz) : '';
        const name = r.decided_by_name || t.common.formerParent;
        setInfo({
          text: r.status === 'rejected' ? t.shop.rejectedBy(name, time) : t.shop.signedBy(name, time),
          kind: 'info',
        });
      }
    } catch (e) {
      setPinError(errorText(e));
    } finally {
      setPinBusy(false);
      void qc.invalidateQueries({ queryKey: ['purchases', uid] });
      void qc.invalidateQueries({ queryKey: ['ledger', uid] });
      void qc.invalidateQueries({ queryKey: ['childDay', uid] });
    }
  }

  async function decidePurchase(item: PurchaseItem, approve: boolean) {
    if (approve) return askPin(item);
    setBusy(`buy-${item.id}`);
    setInfo(null);
    try {
      const r = await api.decidePurchase(item.id, false);
      if (!r.changed && !r.decided_by_me) {
        const time = r.decided_at ? formatTime(r.decided_at, tz) : '';
        const name = r.decided_by_name || t.common.formerParent;
        setInfo({
          text: r.status === 'rejected' ? t.shop.rejectedBy(name, time) : t.shop.signedBy(name, time),
          kind: 'info',
        });
      }
    } catch (e) {
      setInfo({ text: errorText(e), kind: 'error' });
    } finally {
      await qc.invalidateQueries({ queryKey: ['purchases', uid] }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['ledger', uid] });
      void qc.invalidateQueries({ queryKey: ['childDay', uid] });
      setBusy(null);
    }
  }

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
        <PushPrompt role="parent" />
        {pendingToday.length > 0 ? (
          <Button
            testID="sign-all"
            title={t.approvals.signAll(pendingToday.length)}
            variant="accent"
            onPress={signAll}
            loading={busy === 'all'}
          />
        ) : null}
        {buyPending.length > 0 ? (
          <>
            <T v="h2">{t.shop.purchases}</T>
            {buyPending.map((item) => (
              <PurchaseCard
                key={item.id}
                item={item}
                tz={tz}
                highlighted={item.id === highlightPurchase}
                busy={busy === `buy-${item.id}`}
                onDecide={(approve) => decidePurchase(item, approve)}
              />
            ))}
            {pending.length > 0 ? <T v="h2">{t.approvals.tasksHeading}</T> : null}
          </>
        ) : null}
        {pending.length === 0 && buyPending.length > 0 ? null : pending.length === 0 ? (
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
        {decided.length > 0 || buyDecided.length > 0 ? (
          <>
            <T v="h2" style={styles.section}>
              {t.approvals.decidedToday}
            </T>
            {buyDecided.map((item) => (
              <PurchaseCard key={item.id} item={item} tz={tz} highlighted={item.id === highlightPurchase} />
            ))}
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
      {pinFor ? (
        <PinModal
          mode={pinMode}
          title={`${pinFor.icon} ${pinFor.title} · ${t.shop.cost(pinFor.price)}`}
          busy={pinBusy}
          error={pinError}
          onSubmit={(pin) => void signWithPin(pin)}
          onCancel={() => setPinFor(null)}
        />
      ) : null}
      <Toast msg={info} onHide={hideInfo} inTabs />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  empty: { alignItems: 'center', gap: space.s, paddingVertical: space.l },
  section: { marginTop: space.s },
});
