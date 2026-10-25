import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BackLink, NotFound } from '@/components/BackLink';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Field } from '@/components/Field';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { SwitchRow } from '@/components/SwitchRow';
import { T } from '@/components/T';
import { api, errorText, type ShopItemInput } from '@/lib/api';
import { useShopItems } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { ALL_DAYS, WEEKDAYS, WEEKEND } from '@/lib/tasks';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';

// Icons for goods: the child recognises them without reading.
const SHOP_ICONS = [
  '🎁',
  '🍦',
  '🍬',
  '🍫',
  '🍕',
  '🍝',
  '🍿',
  '☕',
  '📺',
  '🎬',
  '📱',
  '🎮',
  '🧸',
  '🎨',
  '📚',
  '⚽',
  '👭',
  '🎉',
  '🌙',
  '👑',
  '🎢',
  '🏊',
  '🚲',
  '🌟',
];

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/shop-items'));

/** Parent: add a good or edit one. */
export default function ShopItemEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const uid = useSession((s) => s.session?.user.id);
  const who = useWho();
  const items = useShopItems();

  if (!uid) return <Redirect href="/" />;
  if (who.data && who.data.member?.role !== 'parent') return <Redirect href="/" />;
  if (!id) {
    return (
      <ItemForm
        initial={{
          id: null,
          title: '',
          icon: '🎁',
          price: 20,
          kind: 'small',
          days: ALL_DAYS,
          enabled: true,
          screenMinutes: 0,
        }}
      />
    );
  }
  if (items.isPending) return <Loading />;
  if (items.isError) return <LoadError text={errorText(items.error)} onRetry={() => items.refetch()} />;
  const item = items.data.find((x) => x.id === id);
  if (!item) {
    return (
      <Screen>
        <NotFound fallback="/shop-items" />
      </Screen>
    );
  }
  return (
    <ItemForm
      key={item.id}
      initial={{
        id: item.id,
        title: item.title,
        icon: item.icon,
        price: item.price,
        kind: item.kind,
        days: item.days,
        enabled: item.enabled,
        screenMinutes: item.screen_minutes ?? 0,
      }}
    />
  );
}

function ItemForm({ initial }: { initial: ShopItemInput }) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const [v, setV] = useState<ShopItemInput>(initial);
  const [price, setPrice] = useState(String(initial.price));
  const [minutes, setMinutes] = useState(initial.screenMinutes ? String(initial.screenMinutes) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isNew = !initial.id;
  const set = (patch: Partial<ShopItemInput>) => setV((x) => ({ ...x, ...patch }));
  const toggleDay = (d: number) =>
    set({ days: v.days.includes(d) ? v.days.filter((x) => x !== d) : [...v.days, d].sort((a, b) => a - b) });

  const done = () => {
    void qc.invalidateQueries({ queryKey: ['shopItems', uid] });
    void qc.invalidateQueries({ queryKey: ['shop', uid] });
    goBack();
  };

  async function save() {
    setError(null);
    const n = Number(price.trim());
    if (!v.title.trim()) return setError(t.errors.invalid_item_title);
    if (!Number.isInteger(n) || n < 1 || n > 10000) return setError(t.errors.invalid_price);
    const m = minutes.trim() ? Number(minutes.trim()) : 0;
    if (!Number.isInteger(m) || m < 0 || m > 240) return setError(t.errors.invalid_minutes);
    if (v.days.length === 0) return setError(t.errors.invalid_days);
    setBusy(true);
    try {
      await api.saveShopItem({ ...v, price: n, screenMinutes: m });
      done();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteShopItem(initial.id as string);
      setConfirmDelete(false);
      done();
    } catch (e) {
      setError(errorText(e));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BackLink fallback="/shop-items" />
      <T v="title">{isNew ? t.shop.newTitle : t.shop.editTitle}</T>
      <Field
        testID="shop-title"
        label={t.shop.name}
        placeholder={t.shop.namePlaceholder}
        value={v.title}
        onChangeText={(title) => set({ title })}
        maxLength={60}
      />
      <T v="label">{t.shop.icon}</T>
      <View style={styles.icons}>
        {SHOP_ICONS.map((icon) => {
          const selected = v.icon === icon;
          return (
            <Pressable
              key={icon}
              accessibilityRole="radio"
              aria-checked={selected}
              onPress={() => set({ icon })}
              style={[styles.iconCell, { borderColor: selected ? p.primary : 'transparent', backgroundColor: p.card }]}>
              <T style={styles.iconText}>{icon}</T>
            </Pressable>
          );
        })}
      </View>
      <Field
        testID="shop-price"
        label={t.shop.priceLabel}
        value={price}
        onChangeText={(x) => setPrice(x.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={5}
      />
      {!isNew ? (
        <T v="small" muted>
          {t.shop.priceNote}
        </T>
      ) : null}
      <Field
        testID="shop-minutes"
        label={t.shop.minutesLabel}
        value={minutes}
        onChangeText={(x) => setMinutes(x.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={3}
      />
      <T v="small" muted>
        {t.shop.minutesHint}
      </T>
      <T v="label">{t.shop.kind}</T>
      <View style={styles.chips}>
        <Chip
          label={t.shop.kindSmall}
          color={brand.coral}
          selected={v.kind === 'small'}
          onPress={() => set({ kind: 'small' })}
        />
        <Chip
          label={t.shop.kindBig}
          color={brand.violet}
          selected={v.kind === 'big'}
          onPress={() => set({ kind: 'big' })}
        />
      </View>
      <T v="label">{t.shop.days}</T>
      <View style={styles.chips}>
        {t.weekdays.map((name, i) => (
          <Chip key={name} multi label={name} selected={v.days.includes(i + 1)} onPress={() => toggleDay(i + 1)} />
        ))}
      </View>
      <View style={styles.chips}>
        <Chip
          label={t.taskEdit.everyDay}
          selected={false}
          color={brand.violet}
          onPress={() => set({ days: ALL_DAYS })}
        />
        <Chip
          label={t.taskEdit.weekdays}
          selected={false}
          color={brand.violet}
          onPress={() => set({ days: WEEKDAYS })}
        />
        <Chip label={t.taskEdit.weekend} selected={false} color={brand.violet} onPress={() => set({ days: WEEKEND })} />
      </View>
      <Card>
        <SwitchRow
          testID="shop-enabled"
          label={t.shop.enabled}
          hint={t.shop.enabledHint}
          value={v.enabled}
          onChange={(enabled) => set({ enabled })}
        />
      </Card>
      <Banner text={error} />
      <Button testID="shop-save" title={t.common.save} onPress={save} loading={busy} />
      {!isNew ? <Button title={t.shop.delete} variant="danger" onPress={() => setConfirmDelete(true)} /> : null}
      <Button title={t.common.cancel} variant="ghost" onPress={goBack} />
      <ConfirmModal
        visible={confirmDelete}
        title={t.shop.deleteTitle}
        text={t.shop.deleteText}
        confirmTitle={t.shop.delete}
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  iconCell: {
    width: 52,
    height: 52,
    borderRadius: radius.m,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 28, lineHeight: 34 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
});
