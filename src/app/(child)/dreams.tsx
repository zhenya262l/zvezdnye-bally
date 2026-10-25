import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChestIcon } from '@/components/art/Icons';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Card } from '@/components/Card';
import { ConfirmModal } from '@/components/ConfirmModal';
import { AmountSheet, NewDreamSheet, Progress, type Goal } from '@/components/Dreams';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { Toast, type ToastMsg } from '@/components/Toast';
import { api, errorText } from '@/lib/api';
import { useChildGoals, useChildShop } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';

type Ask =
  { kind: 'put' | 'take'; goal: Goal } | { kind: 'buy'; goal: Goal } | { kind: 'remove'; goal: Goal } | { kind: 'new' };

/** Child: the dream piggy bank. */
export default function Dreams() {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const goals = useChildGoals();
  const shop = useChildShop();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ToastMsg>(null);
  const hideInfo = useCallback(() => setInfo(null), []);

  if (goals.isPending) return <Loading />;
  if (goals.isError) return <LoadError text={errorText(goals.error)} onRetry={() => goals.refetch()} />;

  const g = goals.data;
  const open = g.goals.filter((x) => x.status === 'active' || x.status === 'proposed');
  const closed = g.goals.filter((x) => x.status !== 'active' && x.status !== 'proposed');

  const start = (a: Ask) => {
    setError(null);
    setAsk(a);
  };
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setAsk(null);
      setInfo({ text: done, kind: 'success' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ['goals', uid] }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['shop', uid] });
    }
  }

  return (
    <View style={styles.root}>
      <Screen inTabs>
        <T v="title">{t.childTabs.dreams}</T>
        <View style={[styles.sum, { backgroundColor: brand.sun }]}>
          <T v="big" color={brand.ocean} testID="piggy-held">
            {t.dreams.inPiggy(g.held)}
          </T>
          <T v="bodyBold" color={brand.ocean} testID="piggy-free">
            {t.dreams.canPut(g.free)}
          </T>
          {g.back_today > 0 ? (
            <T v="small" color={brand.ocean} center testID="piggy-back">
              {t.dreams.backTomorrow(g.back_today)}
            </T>
          ) : null}
        </View>

        {open.length < 5 ? (
          <Button
            testID="dream-new"
            title={`⭐ ${t.dreams.add}`}
            variant="accent"
            onPress={() => start({ kind: 'new' })}
          />
        ) : null}

        {g.goals.length === 0 ? (
          <Card accent={brand.violet}>
            <View style={styles.center}>
              <ChestIcon color={brand.violet} size={56} />
              <T center>{t.dreams.empty}</T>
            </View>
          </Card>
        ) : null}

        {open.map((goal) => {
          const full = goal.price != null && goal.held >= goal.price;
          const pending = !!goal.pending_purchase_id;
          return (
            <Card key={goal.id} accent={brand.violet}>
              <View style={styles.top} testID={`dream-${goal.id}`}>
                <T style={styles.icon}>{goal.icon}</T>
                <View style={styles.flex}>
                  <T v="bodyBold">{goal.title}</T>
                  {goal.status === 'proposed' ? (
                    <T v="small" muted>
                      {t.dreams.waitingPrice}
                    </T>
                  ) : goal.price != null ? (
                    <T v="small" testID={`dream-progress-${goal.id}`}>
                      {t.dreams.progress(goal.held, goal.price)}
                    </T>
                  ) : null}
                </View>
              </View>
              {goal.status === 'active' && goal.price != null ? (
                <>
                  <Progress held={goal.held} price={goal.price} />
                  <T v="label" color={full ? p.successText : p.textMuted}>
                    {pending ? t.dreams.waitingSign : full ? t.dreams.full : t.dreams.left(goal.price - goal.held)}
                  </T>
                  {full && !pending ? (
                    <Button
                      testID={`dream-buy-${goal.id}`}
                      title={`🌟 ${t.dreams.buy}`}
                      variant="accent"
                      onPress={() => start({ kind: 'buy', goal })}
                    />
                  ) : null}
                  {!pending ? (
                    <ButtonRow>
                      {!full ? (
                        <Button
                          testID={`dream-put-${goal.id}`}
                          title={t.dreams.put}
                          disabled={g.free <= 0}
                          onPress={() => start({ kind: 'put', goal })}
                        />
                      ) : null}
                      {goal.held > 0 ? (
                        <Button
                          testID={`dream-take-${goal.id}`}
                          title={t.dreams.take}
                          variant="secondary"
                          onPress={() => start({ kind: 'take', goal })}
                        />
                      ) : null}
                    </ButtonRow>
                  ) : null}
                </>
              ) : null}
              {goal.held === 0 && !pending ? (
                <Button
                  testID={`dream-remove-${goal.id}`}
                  title={t.dreams.remove}
                  variant="ghost"
                  onPress={() => start({ kind: 'remove', goal })}
                />
              ) : null}
            </Card>
          );
        })}

        {closed.length > 0 ? (
          <Card>
            {closed.map((goal) => (
              <View key={goal.id} style={[styles.row, { borderColor: p.border }]} testID={`dream-closed-${goal.id}`}>
                <T style={styles.icon}>{goal.icon}</T>
                <T v="bodyBold" style={styles.flex}>
                  {goal.title}
                </T>
                <T v="label" color={goal.status === 'bought' ? p.successText : p.textMuted}>
                  {goal.status === 'bought'
                    ? t.dreams.bought
                    : goal.status === 'rejected'
                      ? t.dreams.rejected
                      : t.dreams.cancelled}
                </T>
              </View>
            ))}
          </Card>
        ) : null}
      </Screen>

      {ask?.kind === 'new' ? (
        <NewDreamSheet
          shopItems={shop.data?.items ?? []}
          busy={busy}
          error={error}
          onCancel={() => setAsk(null)}
          onSubmit={(d) => void run(() => api.proposeGoal(d.title, d.icon, d.shopItemId), t.dreams.sent)}
        />
      ) : null}
      {ask?.kind === 'put' || ask?.kind === 'take' ? (
        <AmountSheet
          key={`${ask.kind}-${ask.goal.id}`}
          mode={ask.kind}
          goal={ask.goal}
          max={
            ask.kind === 'put' ? Math.max(0, Math.min(g.free, (ask.goal.price ?? 0) - ask.goal.held)) : ask.goal.held
          }
          busy={busy}
          error={error}
          onCancel={() => setAsk(null)}
          onSubmit={(n) => {
            const kind = ask.kind;
            void run(
              () => api.moveGoalPoints(ask.goal.id, kind === 'put' ? n : -n),
              kind === 'put' ? t.dreams.putDone(n) : t.dreams.takeDone(n),
            );
          }}
        />
      ) : null}
      <ConfirmModal
        visible={ask?.kind === 'buy' || ask?.kind === 'remove'}
        title={ask?.kind === 'buy' ? t.dreams.buyTitle : t.dreams.removeTitle}
        text={
          ask?.kind === 'buy'
            ? t.dreams.buyText(ask.goal.title, ask.goal.price ?? 0)
            : ask?.kind === 'remove'
              ? t.dreams.removeText(ask.goal.title)
              : ''
        }
        confirmTitle={ask?.kind === 'buy' ? t.dreams.buy : t.dreams.remove}
        danger={ask?.kind === 'remove'}
        busy={busy}
        error={error}
        onConfirm={() => {
          if (ask?.kind === 'buy') void run(() => api.buyGoal(ask.goal.id), t.dreams.buySent);
          else if (ask?.kind === 'remove') void run(() => api.cancelGoal(ask.goal.id), t.dreams.cancelled);
        }}
        onCancel={() => {
          if (!busy) setAsk(null);
        }}
      />
      <Toast msg={info} onHide={hideInfo} inTabs />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  sum: { borderRadius: radius.m, padding: space.m, gap: 2, alignItems: 'center' },
  center: { alignItems: 'center', gap: space.m, paddingVertical: space.l },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderTopWidth: 1 },
  icon: { fontSize: 30, lineHeight: 38, width: 38, textAlign: 'center' },
  flex: { flex: 1, gap: 2 },
});
