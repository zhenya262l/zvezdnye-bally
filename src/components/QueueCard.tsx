import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { QueueItem } from '@/lib/api';
import { formatDayMonth, formatTime, prevDay } from '@/lib/dates';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { Avatar } from './art/Avatar';
import { Button } from './Button';
import { ButtonRow } from './ButtonRow';
import { Chip } from './Chip';
import { T } from './T';

type Props = {
  item: QueueItem;
  today: string;
  tz?: string;
  highlighted?: boolean;
  busy?: boolean;
  onDecide?: (approve: boolean) => void;
  /** One-tap praise for a credited task. */
  onPraise?: (text: string) => void;
};

/** One request in the parent's "Ждут подписи" list. */
export function QueueCard({ item, today, tz, highlighted, busy, onDecide, onPraise }: Props) {
  const p = usePalette();
  // Praise phrases open on demand, so a long list of credited tasks stays short.
  const [praiseOpen, setPraiseOpen] = useState(false);
  const dayLabel = item.is_today
    ? null
    : item.for_date === prevDay(today) || item.for_date === today
      ? t.approvals.yesterday
      : formatDayMonth(item.for_date);

  let decided: string | null = null;
  if (item.status !== 'pending' && item.decided_at) {
    const time = formatTime(item.decided_at, tz);
    if (item.auto_approved) decided = t.approvals.autoSigned(time);
    else if (item.status === 'approved')
      decided = t.approvals.signedBy(item.decided_by_name || t.common.formerParent, time);
    else decided = t.approvals.rejectedBy(item.decided_by_name || t.common.formerParent, time);
  }

  return (
    <View
      testID={`queue-${item.id}`}
      style={[
        styles.card,
        {
          backgroundColor: p.card,
          borderColor: highlighted ? brand.coral : item.child_color,
          borderWidth: highlighted ? 3 : 2,
          opacity: item.status === 'pending' ? 1 : 0.85,
        },
      ]}>
      <View style={styles.top}>
        <Avatar id={item.child_avatar} color={item.child_color} size={44} />
        <View style={styles.texts}>
          <T v="bodyBold">{`${item.icon} ${item.title}`}</T>
          <T v="small" muted>
            {[item.child_name, dayLabel, formatTime(item.created_at, tz)].filter(Boolean).join(' · ')}
          </T>
        </View>
        <View style={[styles.points, { backgroundColor: brand.sun }]}>
          <T v="bodyBold" color={brand.ocean}>
            {t.approvals.points(item.points)}
          </T>
        </View>
      </View>
      {item.status === 'pending' && onDecide ? (
        <ButtonRow>
          <Button testID={`sign-${item.id}`} title={t.approvals.sign} onPress={() => onDecide(true)} loading={busy} />
          <Button
            testID={`reject-${item.id}`}
            title={t.approvals.reject}
            variant="secondary"
            onPress={() => onDecide(false)}
            disabled={busy}
          />
        </ButtonRow>
      ) : decided ? (
        <T v="small" color={item.status === 'approved' ? p.successText : p.textMuted}>
          {decided}
        </T>
      ) : null}
      {item.status === 'approved' && item.praise ? (
        <T v="small" testID={`praised-${item.id}`}>
          {`💬 ${t.approvals.praised(item.praised_by_name || t.common.formerParent, item.praise)}`}
        </T>
      ) : item.status === 'approved' && onPraise && !praiseOpen ? (
        <View style={styles.praise}>
          <Chip
            testID={`praise-open-${item.id}`}
            label={`💬 ${t.approvals.praiseOpen}`}
            selected={false}
            onPress={() => setPraiseOpen(true)}
          />
        </View>
      ) : item.status === 'approved' && onPraise ? (
        <View style={styles.praise}>
          <T v="small" muted>
            {t.approvals.praise}
          </T>
          {t.approvals.praises.map((text) => (
            <Chip
              key={text}
              testID={`praise-${item.id}-${text}`}
              label={text}
              selected={false}
              onPress={() => {
                if (!busy) onPraise(text);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.m, padding: space.m, gap: space.s },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  texts: { flex: 1, gap: 2 },
  points: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 2 },
  praise: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s },
});
