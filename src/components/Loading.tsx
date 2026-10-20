import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { t } from '@/strings.ru';
import { space, usePalette } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { T } from './T';

export function Loading() {
  const p = usePalette();
  return (
    <View style={[styles.center, { backgroundColor: p.bg }]}>
      <ActivityIndicator size="large" color={p.primary} />
      <T muted>{t.common.loading}</T>
    </View>
  );
}

export function LoadError({ text, onRetry, kind }: { text: string; onRetry: () => void; kind?: 'error' | 'info' }) {
  const p = usePalette();
  return (
    <View style={[styles.center, { backgroundColor: p.bg }]}>
      <View style={styles.box}>
        <Banner text={text} kind={kind} />
        <Button title={t.common.retry} onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m, padding: space.xl },
  box: { width: '100%', maxWidth: 420, gap: space.m },
});
