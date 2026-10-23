import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronIcon } from '@/components/art/Icons';
import { BackLink } from '@/components/BackLink';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { api, errorText } from '@/lib/api';
import { useShopItems } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { daysLabel } from '@/lib/tasks';
import { t } from '@/strings.ru';
import { brand, space, TOUCH_MIN, usePalette } from '@/theme';

/** Parent: the family shop — goods, prices, on/off. */
export default function ShopItems() {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const who = useWho();
  const items = useShopItems();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!uid) return <Redirect href="/" />;
  if (who.data && who.data.member?.role !== 'parent') return <Redirect href="/" />;
  if (items.isPending) return <Loading />;
  if (items.isError) return <LoadError text={errorText(items.error)} onRetry={() => items.refetch()} />;

  async function toggle(id: string, enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.setShopItemEnabled(id, enabled);
    } catch (e) {
      setError(errorText(e));
    } finally {
      await qc.invalidateQueries({ queryKey: ['shopItems', uid] });
      void qc.invalidateQueries({ queryKey: ['shop', uid] });
      setBusy(false);
    }
  }

  const groups = [
    { kind: 'small' as const, title: t.shop.small, color: brand.coral },
    { kind: 'big' as const, title: t.shop.big, color: brand.violet },
  ];

  return (
    <Screen>
      <BackLink fallback="/settings" />
      <T v="title">{t.shop.title}</T>
      <Button testID="shop-add" title={t.shop.add} onPress={() => router.push('/shop-item-edit')} />
      <Banner text={error} />
      {groups.map((g) => (
        <Card key={g.kind} title={g.title} accent={g.color}>
          {items.data
            .filter((x) => x.kind === g.kind)
            .map((item) => (
              <View key={item.id} style={[styles.item, { borderColor: p.border }]}>
                <Pressable
                  testID={`shop-item-${item.id}`}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/shop-item-edit', params: { id: item.id } })}
                  style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : item.enabled ? 1 : 0.6 }]}>
                  <T style={styles.icon}>{item.icon}</T>
                  <View style={styles.flex}>
                    <T v="bodyBold">{item.title}</T>
                    <T v="small" muted>
                      {[t.shop.price(item.price), daysLabel(item.days)].join(' · ')}
                    </T>
                  </View>
                  <ChevronIcon color={p.textMuted} />
                </Pressable>
                <View style={styles.chips}>
                  <Chip
                    multi
                    testID={`shop-enabled-${item.id}`}
                    label={item.enabled ? t.shop.shown : t.shop.hidden}
                    selected={item.enabled}
                    onPress={() => {
                      if (!busy) void toggle(item.id, !item.enabled);
                    }}
                  />
                </View>
              </View>
            ))}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { gap: space.s, paddingVertical: space.s, borderTopWidth: 1 },
  row: { minHeight: TOUCH_MIN, flexDirection: 'row', alignItems: 'center', gap: space.m },
  icon: { fontSize: 28, lineHeight: 36, width: 36, textAlign: 'center' },
  flex: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
});
