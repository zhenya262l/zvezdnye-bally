import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { ChildGoals, ChildShop } from '@/lib/api';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { Chip } from './Chip';
import { Field } from './Field';
import { Stepper } from './Stepper';
import { T } from './T';

export type Goal = ChildGoals['goals'][number];

const ICONS = ['🚲', '🛴', '🎮', '🧸', '🎨', '📚', '🐶', '🎡', '✈️', '⭐'];

/** How full a dream is. */
export function Progress({ held, price, color = brand.violet }: { held: number; price: number; color?: string }) {
  const p = usePalette();
  const share = Math.max(0, Math.min(1, price > 0 ? held / price : 0));
  return (
    <View
      style={[styles.track, { backgroundColor: p.cardAlt }]}
      accessibilityRole="progressbar"
      aria-valuemin={0}
      aria-valuemax={price}
      aria-valuenow={held}>
      <View style={[styles.fill, { width: `${Math.round(share * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

function Sheet({
  children,
  onClose,
  busy,
  testID,
}: {
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
  testID?: string;
}) {
  const p = usePalette();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose()} accessible={false}>
        <Pressable
          testID={testID}
          style={[styles.sheet, { backgroundColor: p.card }]}
          onPress={() => {}}
          accessible={false}>
          <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** «Отложить» or «Забрать»: how many points. */
export function AmountSheet({
  mode,
  goal,
  max,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  mode: 'put' | 'take';
  goal: Goal;
  max: number;
  busy: boolean;
  error: string | null;
  onSubmit: (n: number) => void;
  onCancel: () => void;
}) {
  // Any number from 1 to max: − / + by one, quick amounts, «Всё».
  const [n, setN] = useState(Math.min(1, max));
  const ok = Number.isInteger(n) && n >= 1 && n <= max;
  const quick = [5, 10, 20, 50, 100].filter((x) => x < max);
  return (
    <Sheet onClose={onCancel} busy={busy} testID="amount-sheet">
      <T v="h2">{mode === 'put' ? t.dreams.putTitle : t.dreams.takeTitle}</T>
      <T v="bodyBold">{`${goal.icon} ${goal.title}`}</T>
      <Stepper testID="amount" label={t.dreams.amount} value={n} onChange={setN} min={1} max={Math.max(1, max)} />
      <View style={styles.chips}>
        {quick.map((x) => (
          <Chip key={x} testID={`amount-${x}`} label={String(x)} selected={n === x} onPress={() => setN(x)} />
        ))}
        {max > 0 ? (
          <Chip testID="amount-all" label={`${t.dreams.all}: ${max}`} selected={n === max} onPress={() => setN(max)} />
        ) : null}
      </View>
      <T v="small" muted>
        {mode === 'put' ? t.dreams.putMax(max) : t.dreams.takeNote}
      </T>
      <Banner text={error} />
      <Button
        testID="amount-ok"
        title={mode === 'put' ? t.dreams.put : t.dreams.take}
        variant={mode === 'put' ? 'accent' : 'secondary'}
        onPress={() => ok && onSubmit(n)}
        disabled={!ok}
        loading={busy}
      />
      <Button title={t.common.cancel} variant="ghost" onPress={onCancel} disabled={busy} />
    </Sheet>
  );
}

/** A new dream: her own words and a picture, or a big item from the shop. */
export function NewDreamSheet({
  shopItems,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  shopItems: ChildShop['items'];
  busy: boolean;
  error: string | null;
  onSubmit: (d: { title: string | null; icon: string; shopItemId?: string }) => void;
  onCancel: () => void;
}) {
  const p = usePalette();
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState(ICONS[0]);
  const big = shopItems.filter((x) => x.kind === 'big');
  return (
    <Sheet onClose={onCancel} busy={busy} testID="dream-sheet">
      <T v="h2">{t.dreams.newTitle}</T>
      <Field
        testID="dream-title"
        label={t.dreams.titleField}
        placeholder={t.dreams.titlePlaceholder}
        value={title}
        onChangeText={setTitle}
        maxLength={60}
      />
      <T v="label">{t.dreams.iconField}</T>
      <View style={styles.chips}>
        {ICONS.map((x) => (
          <Chip key={x} testID={`dream-icon-${x}`} label={x} selected={icon === x} onPress={() => setIcon(x)} />
        ))}
      </View>
      <Banner text={error} />
      <Button
        testID="dream-send"
        title={t.dreams.send}
        variant="accent"
        onPress={() => onSubmit({ title: title.trim(), icon })}
        disabled={title.trim().length === 0}
        loading={busy}
      />
      {big.length > 0 ? (
        <>
          <T v="label">{t.dreams.fromShop}</T>
          {big.map((item) => (
            <Pressable
              key={item.id}
              testID={`dream-shop-${item.id}`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => onSubmit({ title: null, icon: item.icon, shopItemId: item.id })}
              style={({ pressed }) => [styles.shopRow, { borderColor: p.border, opacity: pressed ? 0.7 : 1 }]}>
              <T style={styles.icon}>{item.icon}</T>
              <T v="bodyBold" style={styles.flex}>
                {item.title}
              </T>
              <T v="small" muted>{`⭐ ${item.price}`}</T>
            </Pressable>
          ))}
        </>
      ) : null}
      <Button title={t.common.cancel} variant="ghost" onPress={onCancel} disabled={busy} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  track: { height: 14, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 24, 38, 0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    width: '100%',
    maxWidth: 560,
    maxHeight: '92%',
    alignSelf: 'center',
  },
  inner: { padding: space.l, paddingBottom: space.xl, gap: space.m },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  shopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: space.s,
    borderTopWidth: 1,
  },
  icon: { fontSize: 26, lineHeight: 34, width: 34, textAlign: 'center' },
  flex: { flex: 1 },
});
