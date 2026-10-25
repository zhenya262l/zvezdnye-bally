import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, errorText, type GoalProposal } from '@/lib/api';
import { useChildGoals } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { Avatar } from './art/Avatar';
import { Banner } from './Banner';
import { Button } from './Button';
import { ButtonRow } from './ButtonRow';
import { ConfirmModal } from './ConfirmModal';
import { Progress, type Goal } from './Dreams';
import { Field } from './Field';
import { T } from './T';

/** Parent: a new dream, its price and the answer. */
export function GoalProposalCard({
  item,
  highlighted,
  onDone,
}: {
  item: GoalProposal;
  highlighted?: boolean;
  onDone: (text: string, kind: 'success' | 'info') => void;
}) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const [price, setPrice] = useState(item.suggested_price != null ? String(item.suggested_price) : '');
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = Number(price);
  const ok = price !== '' && Number.isInteger(n) && n >= 1 && n <= 10000;

  async function decide(approve: boolean) {
    if (approve && !ok) return setError(t.errors.invalid_price);
    setBusy(approve ? 'yes' : 'no');
    setError(null);
    try {
      const r = await api.decideGoal(item.id, approve, approve ? n : undefined);
      if (!r.changed && !r.decided_by_me) onDone(t.dreams.alreadyDecided, 'info');
      else onDone(approve ? t.dreams.approved : t.dreams.rejectedDone, 'success');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ['goalProposals', uid] });
      void qc.invalidateQueries({ queryKey: ['goals', uid] });
    }
  }

  return (
    <View
      testID={`goal-${item.id}`}
      style={[
        styles.card,
        {
          backgroundColor: p.card,
          borderColor: highlighted ? brand.coral : item.child_color,
          borderWidth: highlighted ? 3 : 2,
        },
      ]}>
      <View style={styles.top}>
        <Avatar id={item.child_avatar} color={item.child_color} size={44} />
        <View style={styles.flex}>
          <T v="bodyBold">{`${item.icon} ${item.title}`}</T>
          <T v="small" muted>
            {item.child_name}
          </T>
        </View>
      </View>
      <Field
        testID={`goal-price-${item.id}`}
        label={t.dreams.priceField}
        value={price}
        onChangeText={(x) => setPrice(x.replace(/[^0-9]/g, '').slice(0, 5))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={5}
      />
      <T v="small" muted>
        {item.suggested_price != null
          ? `${t.dreams.suggested(item.suggested_price)}. ${t.dreams.priceHint}`
          : t.dreams.priceHint}
      </T>
      <Banner text={error} />
      <ButtonRow>
        <Button
          testID={`goal-approve-${item.id}`}
          title={t.dreams.approve}
          onPress={() => void decide(true)}
          loading={busy === 'yes'}
          disabled={busy !== null || !ok}
        />
        <Button
          testID={`goal-reject-${item.id}`}
          title={t.dreams.reject}
          variant="secondary"
          onPress={() => void decide(false)}
          loading={busy === 'no'}
          disabled={busy !== null}
        />
      </ButtonRow>
    </View>
  );
}

/** Parent, «Дети»: a child's dreams, how full they are, «Отменить мечту». */
export function KidDreams({ childId }: { childId: string }) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const goals = useChildGoals(childId);
  const [cancel, setCancel] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!goals.data) return null;
  const open = goals.data.goals.filter((g) => g.status === 'active' || g.status === 'proposed');

  async function doCancel() {
    if (!cancel) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelGoal(cancel.id);
      setCancel(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['goals', uid] });
      void qc.invalidateQueries({ queryKey: ['goalProposals', uid] });
    }
  }

  return (
    <View style={styles.kid} testID={`kid-dreams-${childId}`}>
      <T v="label">{`${t.dreams.kidTitle} · ${t.dreams.inPiggy(goals.data.held)}`}</T>
      {open.length === 0 ? (
        <T v="small" muted>
          {t.dreams.kidNone}
        </T>
      ) : (
        open.map((g) => (
          <View key={g.id} style={[styles.goal, { borderColor: p.border }]}>
            <T v="bodyBold">{`${g.icon} ${g.title}`}</T>
            {g.status === 'proposed' || g.price == null ? (
              <T v="small" muted>
                {t.dreams.waitingPrice}
              </T>
            ) : (
              <>
                <T v="small">{t.dreams.progress(g.held, g.price)}</T>
                <Progress held={g.held} price={g.price} />
              </>
            )}
            {g.status === 'active' && !g.pending_purchase_id ? (
              <Button
                testID={`goal-cancel-${g.id}`}
                title={t.dreams.cancel}
                variant="ghost"
                onPress={() => {
                  setError(null);
                  setCancel(g);
                }}
              />
            ) : null}
          </View>
        ))
      )}
      <ConfirmModal
        visible={!!cancel}
        title={t.dreams.cancelTitle}
        text={cancel ? t.dreams.cancelText(cancel.title, cancel.held) : ''}
        confirmTitle={t.dreams.cancel}
        danger
        busy={busy}
        error={error}
        onConfirm={() => void doCancel()}
        onCancel={() => {
          if (!busy) setCancel(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.m, padding: space.m, gap: space.s },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  flex: { flex: 1, gap: 2 },
  kid: { gap: space.s },
  goal: { gap: 4, paddingTop: space.s, borderTopWidth: 1 },
});
