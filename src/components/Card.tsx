import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { onColor, radius, space, usePalette } from '@/theme';
import { T } from './T';

type Props = { children: ReactNode; style?: ViewStyle; title?: string; accent?: string };

/** Rounded card; with `accent`, gets a coloured header band like the paper diary. */
export function Card({ children, style, title, accent }: Props) {
  const p = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: p.card, borderColor: accent ?? p.border }, style]}>
      {title ? (
        <View style={[styles.band, { backgroundColor: accent ?? p.cardAlt }]}>
          <T v="band" color={accent ? onColor(accent) : p.text}>
            {title}
          </T>
        </View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.m, borderWidth: 2, overflow: 'hidden' },
  band: { paddingHorizontal: space.l, paddingVertical: space.s },
  body: { padding: space.l, gap: space.m },
});
