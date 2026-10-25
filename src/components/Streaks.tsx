import { StyleSheet, View } from 'react-native';

import type { StreakItem } from '@/lib/api';
import { formatTime } from '@/lib/dates';
import { useChildStreaks } from '@/lib/queries';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { Avatar } from './art/Avatar';
import { Button } from './Button';
import { ButtonRow } from './ButtonRow';
import { Card } from './Card';
import { Progress } from './Dreams';
import { T } from './T';

/** Child, «Сегодня»: her series this week and how far each one is. */
export function StreaksCard() {
  const p = usePalette();
  const streaks = useChildStreaks();
  if (!streaks.data || streaks.data.length === 0) return null;
  return (
    <Card title={t.streaks.title} accent={brand.coral}>
      <T v="small" muted>
        {t.streaks.hint}
      </T>
      {streaks.data.map((s) => (
        <View key={s.task_id} style={[styles.row, { borderColor: p.border }]} testID={`streak-${s.task_id}`}>
          <View style={styles.top}>
            <T style={styles.icon}>{s.icon}</T>
            <T v="bodyBold" style={styles.flex}>
              {s.title}
            </T>
            <T v="label" color={s.status === 'approved' ? p.successText : brand.coral}>
              {t.streaks.bonus(s.bonus)}
            </T>
          </View>
          {s.status ? (
            <T
              v="small"
              color={s.status === 'approved' ? p.successText : s.status === 'pending' ? brand.ocean : p.textMuted}>
              {s.status === 'approved'
                ? t.streaks.approved(s.bonus)
                : s.status === 'pending'
                  ? t.streaks.pending
                  : t.streaks.rejected}
            </T>
          ) : (
            <>
              <Progress held={Math.min(s.run, s.days)} price={s.days} color={brand.coral} />
              <T v="small" testID={`streak-run-${s.task_id}`}>
                {t.streaks.progress(Math.min(s.run, s.days), s.days)}
              </T>
            </>
          )}
        </View>
      ))}
    </Card>
  );
}

/** Parent, «Подписи»: a proposed weekly bonus. */
export function StreakCard({
  item,
  tz,
  highlighted,
  busy,
  onDecide,
}: {
  item: StreakItem;
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
      ? t.streaks.signedBy(name, formatTime(item.decided_at, tz))
      : rejected && item.decided_at
        ? t.streaks.rejectedBy(name, formatTime(item.decided_at, tz))
        : null;
  return (
    <View
      testID={`streak-card-${item.id}`}
      style={[
        styles.card,
        {
          backgroundColor: p.card,
          borderColor: highlighted ? brand.coral : rejected ? p.danger : item.child_color,
          borderWidth: highlighted || rejected ? 3 : 2,
          opacity: item.status === 'approved' ? 0.85 : 1,
        },
      ]}>
      <View style={styles.top}>
        <Avatar id={item.child_avatar} color={item.child_color} size={44} />
        <View style={styles.flex}>
          <T v="bodyBold">{`🔥 ${item.icon} ${t.streaks.what(item.title, item.days)}`}</T>
          <T v="small" muted>
            {item.child_name}
          </T>
        </View>
        <View style={[styles.points, { backgroundColor: rejected ? p.cardAlt : brand.sun }]}>
          <T v="bodyBold" color={rejected ? p.textMuted : brand.ocean}>
            {t.streaks.bonus(item.points)}
          </T>
        </View>
      </View>
      {item.status === 'pending' && onDecide ? (
        <ButtonRow>
          <Button
            testID={`streak-sign-${item.id}`}
            title={t.streaks.sign}
            onPress={() => onDecide(true)}
            loading={busy}
          />
          <Button
            testID={`streak-reject-${item.id}`}
            title={t.streaks.reject}
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

const styles = StyleSheet.create({
  row: { gap: 4, paddingVertical: space.s, borderTopWidth: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  icon: { fontSize: 24, lineHeight: 32, width: 32, textAlign: 'center' },
  flex: { flex: 1, gap: 2 },
  card: { borderRadius: radius.m, padding: space.m, gap: space.s },
  points: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 2 },
});
