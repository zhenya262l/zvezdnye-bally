import { StyleSheet, View } from 'react-native';

import { radius, space, usePalette } from '@/theme';
import { T } from './T';

export function Banner({ text, kind = 'error' }: { text?: string | null; kind?: 'error' | 'info' | 'success' }) {
  const p = usePalette();
  if (!text) return null;
  const color = kind === 'error' ? p.danger : kind === 'success' ? p.success : p.primary;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.box, { borderColor: color, backgroundColor: p.card }]}>
      <T v="body" color={color}>
        {text}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 2, borderRadius: radius.m, padding: space.m },
});
