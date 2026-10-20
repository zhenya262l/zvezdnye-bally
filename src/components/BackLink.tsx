import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { t } from '@/strings.ru';
import { space, usePalette } from '@/theme';
import { T } from './T';

/**
 * "‹ Назад" at the top of a screen. An app opened from the Home Screen has no
 * browser back button, and long pages hide the bottom one.
 */
export function BackLink({ fallback }: { fallback: Href }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.common.back}
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
      style={styles.link}>
      <T v="bodyBold" color={p.link}>{`‹ ${t.common.back}`}</T>
    </Pressable>
  );
}

/** Shown when a screen is opened without the data it needs (a broken link). */
export function NotFound({ fallback }: { fallback: Href }) {
  return (
    <>
      <BackLink fallback={fallback} />
      <T muted>{t.common.notFound}</T>
    </>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingRight: space.l },
});
