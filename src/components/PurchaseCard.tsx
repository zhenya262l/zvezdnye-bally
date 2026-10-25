import { StyleSheet, View } from 'react-native';

import type { PurchaseItem } from '@/lib/api';
import { formatTime } from '@/lib/dates';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { Avatar } from './art/Avatar';
import { Button } from './Button';
import { ButtonRow } from './ButtonRow';
import { T } from './T';

type Props = {
  item: PurchaseItem;
  tz?: string;
  highlighted?: boolean;
  busy?: boolean;
  onDecide?: (approve: boolean) => void;
};

/** One purchase request on the parent's «Подписи». */
export function PurchaseCard({ item, tz, highlighted, busy, onDecide }: Props) {
  const p = usePalette();
  const rejected = item.status === 'rejected';
  const name = item.decided_by_name || t.common.formerParent;
  const decided =
    item.status === 'approved' && item.decided_at
      ? t.shop.signedBy(name, formatTime(item.decided_at, tz))
      : rejected && item.decided_at
        ? t.shop.rejectedBy(name, formatTime(item.decided_at, tz))
        : null;

  return (
    <View
      testID={`purchase-${item.id}`}
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
        <View style={styles.texts}>
          <T v="bodyBold">{`${item.icon} ${item.title}`}</T>
          <T v="small" muted>
            {`${item.child_name} · ${formatTime(item.created_at, tz)}`}
          </T>
        </View>
        <View style={[styles.price, { backgroundColor: rejected ? p.cardAlt : brand.coral }]}>
          <T v="bodyBold" color={rejected ? p.textMuted : '#FFFFFF'} style={rejected ? styles.crossed : undefined}>
            {t.shop.cost(item.price)}
          </T>
        </View>
      </View>
      {item.status === 'pending' && onDecide ? (
        <>
          <T v="small" muted>
            {item.goal_id
              ? t.dreams.heldNote(item.child_name, item.available)
              : t.shop.canSpend(item.child_name, item.available)}
          </T>
          <ButtonRow>
            <Button
              testID={`purchase-sign-${item.id}`}
              title={t.shop.sign}
              onPress={() => onDecide(true)}
              loading={busy}
            />
            <Button
              testID={`purchase-reject-${item.id}`}
              title={t.shop.reject}
              variant="secondary"
              onPress={() => onDecide(false)}
              disabled={busy}
            />
          </ButtonRow>
        </>
      ) : decided ? (
        <T v={rejected ? 'label' : 'small'} color={rejected ? p.danger : p.successText}>
          {decided}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.m, padding: space.m, gap: space.s },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  texts: { flex: 1, gap: 2 },
  price: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 2 },
  crossed: { textDecorationLine: 'line-through' },
});
