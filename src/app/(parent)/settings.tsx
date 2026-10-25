import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/art/Avatar';
import { ChevronIcon } from '@/components/art/Icons';
import { Card } from '@/components/Card';
import { NotificationsCard } from '@/components/NotificationsCard';
import { PinCard, ScreenLimitCard } from '@/components/ShopRulesCards';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { formatAge } from '@/lib/dates';
import { useChildren } from '@/lib/queries';
import { t } from '@/strings.ru';
import { brand, radius, space, TOUCH_MIN, usePalette } from '@/theme';

export default function Settings() {
  const p = usePalette();
  const kids = useChildren();
  return (
    <Screen inTabs>
      <T v="title">{t.settings.title}</T>
      <Pressable
        testID="settings-tasks"
        accessibilityRole="button"
        onPress={() => router.push('/tasks')}
        style={({ pressed }) => [
          styles.bigRow,
          { backgroundColor: p.card, borderColor: brand.sun, opacity: pressed ? 0.8 : 1 },
        ]}>
        <T style={styles.emoji}>⭐</T>
        <View style={styles.flex}>
          <T v="bodyBold">{t.settings.tasks}</T>
          <T v="small" muted>
            {t.settings.tasksHint}
          </T>
        </View>
        <ChevronIcon color={p.textMuted} />
      </Pressable>
      <Pressable
        testID="settings-shop"
        accessibilityRole="button"
        onPress={() => router.push('/shop-items')}
        style={({ pressed }) => [
          styles.bigRow,
          { backgroundColor: p.card, borderColor: brand.coral, opacity: pressed ? 0.8 : 1 },
        ]}>
        <T style={styles.emoji}>🛍️</T>
        <View style={styles.flex}>
          <T v="bodyBold">{t.settings.shop}</T>
          <T v="small" muted>
            {t.settings.shopHint}
          </T>
        </View>
        <ChevronIcon color={p.textMuted} />
      </Pressable>
      <Pressable
        testID="settings-motivation"
        accessibilityRole="button"
        onPress={() => router.push('/motivation')}
        style={({ pressed }) => [
          styles.bigRow,
          { backgroundColor: p.card, borderColor: brand.turquoise, opacity: pressed ? 0.8 : 1 },
        ]}>
        <T style={styles.emoji}>🏆</T>
        <View style={styles.flex}>
          <T v="bodyBold">{t.levels.settings}</T>
          <T v="small" muted>
            {t.levels.settingsHint}
          </T>
        </View>
        <ChevronIcon color={p.textMuted} />
      </Pressable>
      <ScreenLimitCard />
      <PinCard />
      <NotificationsCard role="parent" />
      <Card title={t.settings.profiles} accent={brand.violet}>
        <T v="small" muted>
          {t.settings.profilesHint}
        </T>
        {(kids.data ?? []).map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/child-edit', params: { id: c.id } })}
            style={({ pressed }) => [styles.row, { borderColor: p.border, opacity: pressed ? 0.7 : 1 }]}>
            <Avatar id={c.avatar} color={c.color} size={44} />
            <View style={styles.flex}>
              <T v="bodyBold">{c.name}</T>
              <T v="small" muted>
                {formatAge(c.birth_date)}
              </T>
            </View>
            <ChevronIcon color={p.textMuted} />
          </Pressable>
        ))}
      </Card>
      <T v="small" muted>
        {t.settings.later}
      </T>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: TOUCH_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    borderTopWidth: 1,
    paddingTop: space.s,
  },
  flex: { flex: 1 },
  bigRow: {
    minHeight: TOUCH_MIN + 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    borderWidth: 2,
    borderRadius: radius.m,
    padding: space.l,
  },
  emoji: { fontSize: 28, lineHeight: 34 },
});
