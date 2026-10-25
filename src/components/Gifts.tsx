import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, errorText, type ChildGifts, type GiftItem, type GiftStatus } from '@/lib/api';
import { formatDayMonth, formatPoints, formatTime } from '@/lib/dates';
import { useChildGifts } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { Avatar } from './art/Avatar';
import { Banner } from './Banner';
import { Button } from './Button';
import { ButtonRow } from './ButtonRow';
import { Card } from './Card';
import { Field } from './Field';
import { Stepper } from './Stepper';
import { T } from './T';

type Msg = { text: string; kind: 'error' | 'success' } | null;

/** Child, «Я»: give points to a sister, answer a gift, see what waits for a signature. */
export function GiftCard() {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const gifts = useChildGifts();
  const [n, setN] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const g: ChildGifts | undefined = gifts.data;
  if (!g) return null;
  const waiting = g.incoming.length + g.outgoing.length > 0;
  if (g.sisters.length === 0 && !waiting) return null;

  const max = Math.min(g.left, g.spendable);
  const amount = Math.max(1, Math.min(n, Math.max(max, 1)));

  async function run(key: string, action: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    setMsg(null);
    try {
      await action();
      if (ok) setMsg({ text: ok, kind: 'success' });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
    } finally {
      await qc.invalidateQueries({ queryKey: ['gifts', uid] }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['childDay', uid] });
      void qc.invalidateQueries({ queryKey: ['shop', uid] });
      void qc.invalidateQueries({ queryKey: ['goals', uid] });
      setBusy(null);
    }
  }

  const note = g.limit === 0 ? t.gifts.off : g.left === 0 ? t.gifts.limitDone : max < 1 ? t.gifts.noPoints : null;

  return (
    <Card title={t.gifts.title} accent={brand.pink}>
      <View testID="gift-card" style={styles.lines}>
        <T v="small" muted>
          {t.gifts.hint}
        </T>
        {g.limit > 0 ? (
          <T v="small" testID="gift-left">
            {t.gifts.left(g.left, g.limit)}
          </T>
        ) : null}
      </View>
      {g.sisters.length > 0 && max >= 1 ? (
        <>
          <Stepper testID="gift-amount" label={t.gifts.amount} value={amount} onChange={setN} min={1} max={max} />
          {g.sisters.map((s) => (
            <Button
              key={s.id}
              testID={`gift-give-${s.id}`}
              title={`${t.gifts.give(s.name)} · ${formatPoints(amount)}`}
              onPress={() => void run('give', () => api.offerGift(s.id, amount), t.gifts.sent)}
              loading={busy === 'give'}
            />
          ))}
        </>
      ) : note ? (
        <T v="small" color={p.textMuted} testID="gift-note">
          {note}
        </T>
      ) : null}
      <Banner kind={msg?.kind} text={msg?.text} />
      {g.incoming.length > 0 ? (
        <>
          <T v="h2">{t.gifts.incoming}</T>
          {g.incoming.map((x) => (
            <View key={x.id} testID={`gift-in-${x.id}`} style={[styles.row, { borderColor: p.border }]}>
              <T v="bodyBold">{t.gifts.incomingText(x.from_name, formatPoints(x.points))}</T>
              {x.status === 'offered' ? (
                <ButtonRow>
                  <Button
                    testID={`gift-accept-${x.id}`}
                    title={t.gifts.accept}
                    onPress={() => void run(`in-${x.id}`, () => api.answerGift(x.id, true))}
                    loading={busy === `in-${x.id}`}
                  />
                  <Button
                    testID={`gift-decline-${x.id}`}
                    title={t.gifts.decline}
                    variant="secondary"
                    onPress={() => void run(`in-${x.id}`, () => api.answerGift(x.id, false))}
                    disabled={busy === `in-${x.id}`}
                  />
                </ButtonRow>
              ) : (
                <T v="small" color={x.status === 'approved' ? p.successText : p.textMuted}>
                  {t.gifts.incomingStatus[x.status as 'accepted' | 'approved' | 'rejected']}
                </T>
              )}
            </View>
          ))}
        </>
      ) : null}
      {g.outgoing.length > 0 ? (
        <>
          <T v="h2">{t.gifts.outgoing}</T>
          {g.outgoing.map((x) => (
            <View key={x.id} testID={`gift-out-${x.id}`} style={[styles.row, { borderColor: p.border }]}>
              <T v="bodyBold">{t.gifts.outgoingText(x.to_name, formatPoints(x.points))}</T>
              <T v="small" color={statusColor(x.status, p)}>
                {t.gifts.status[x.status]}
              </T>
              {x.status === 'offered' || x.status === 'accepted' ? (
                <Button
                  testID={`gift-cancel-${x.id}`}
                  title={t.gifts.cancel}
                  variant="ghost"
                  onPress={() => void run(`out-${x.id}`, () => api.cancelGift(x.id))}
                  loading={busy === `out-${x.id}`}
                />
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </Card>
  );
}

function statusColor(s: GiftStatus, p: ReturnType<typeof usePalette>): string {
  if (s === 'approved') return p.successText;
  if (s === 'offered' || s === 'accepted') return brand.ocean;
  return p.textMuted;
}

/** Parent, «Подписи»: a gift the sister accepted. */
export function GiftApprovalCard({
  item,
  tz,
  highlighted,
  busy,
  onDecide,
}: {
  item: GiftItem;
  tz?: string;
  highlighted?: boolean;
  busy?: boolean;
  onDecide?: (approve: boolean) => void;
}) {
  const p = usePalette();
  const rejected = item.status === 'rejected';
  const name = item.decided_by_name || t.common.formerParent;
  const decided =
    item.status === 'approved' && item.decided_at
      ? t.gifts.signedBy(name, formatTime(item.decided_at, tz))
      : rejected && item.decided_at
        ? t.gifts.rejectedBy(name, formatTime(item.decided_at, tz))
        : null;
  return (
    <View
      testID={`gift-card-${item.id}`}
      style={[
        styles.card,
        {
          backgroundColor: p.card,
          borderColor: highlighted ? brand.pink : rejected ? p.danger : item.from_color,
          borderWidth: highlighted || rejected ? 3 : 2,
          opacity: item.status === 'approved' ? 0.85 : 1,
        },
      ]}>
      <View style={styles.top}>
        <Avatar id={item.from_avatar} color={item.from_color} size={44} />
        <View style={styles.flex}>
          <T v="bodyBold">{t.gifts.what(item.from_name, item.to_name)}</T>
        </View>
        <View style={[styles.points, { backgroundColor: rejected ? p.cardAlt : brand.sun }]}>
          <T v="bodyBold" color={rejected ? p.textMuted : brand.ocean}>
            {formatPoints(item.points)}
          </T>
        </View>
      </View>
      {item.status === 'pending' && onDecide ? (
        <ButtonRow>
          <Button testID={`gift-sign-${item.id}`} title={t.gifts.sign} onPress={() => onDecide(true)} loading={busy} />
          <Button
            testID={`gift-reject-${item.id}`}
            title={t.gifts.reject}
            variant="secondary"
            onPress={() => onDecide(false)}
            disabled={busy}
          />
        </ButtonRow>
      ) : decided ? (
        <T v={rejected ? 'label' : 'small'} color={rejected ? p.danger : p.successText}>
          {decided}
        </T>
      ) : null}
    </View>
  );
}

/** Parent, «Настройки»: how many points a day a daughter may give a sister. */
export function GiftLimitCard() {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const settings = useQuery({ queryKey: ['giftSettings', uid], queryFn: api.giftSettings, enabled: !!uid });
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  if (!settings.data) return null;
  const s = settings.data;
  const value = draft ?? String(s.next ?? s.today);

  async function save() {
    setMsg(null);
    const n = Number(value.trim());
    if (!value.trim() || !Number.isInteger(n) || n < 0 || n > 500) {
      return setMsg({ text: t.errors.invalid_gift_limit, kind: 'error' });
    }
    setBusy(true);
    try {
      const r = await api.saveGiftLimit(n);
      qc.setQueryData(['giftSettings', uid], r);
      void qc.invalidateQueries({ queryKey: ['gifts', uid] });
      setDraft(null);
      setMsg({ text: t.gifts.limitSaved, kind: 'success' });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t.gifts.limitTitle} accent={brand.pink}>
      <T v="small" muted>
        {t.gifts.limitHint}
      </T>
      <View style={styles.lines}>
        <T v="bodyBold" testID="gift-limit-today">
          {t.gifts.limitToday(s.today)}
        </T>
        {s.next != null && s.from ? (
          <T v="small" testID="gift-limit-next">
            {t.gifts.limitFrom(s.next, formatDayMonth(s.from))}
          </T>
        ) : null}
      </View>
      <Field
        testID="gift-limit-input"
        label={t.gifts.limitLabel}
        value={value}
        onChangeText={(x) => setDraft(x.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={3}
      />
      {msg ? <Banner kind={msg.kind} text={msg.text} /> : null}
      <Button testID="gift-limit-save" title={t.gifts.limitSave} variant="secondary" onPress={save} loading={busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  lines: { gap: 2 },
  row: { gap: 4, paddingVertical: space.s, borderTopWidth: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  flex: { flex: 1, gap: 2 },
  card: { borderRadius: radius.m, padding: space.m, gap: space.s },
  points: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 2 },
});
