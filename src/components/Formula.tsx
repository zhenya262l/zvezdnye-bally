import { StyleSheet, View } from 'react-native';

import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { T } from './T';

type Props = { was: number; earned: number; spent: number };

/** "Было + Заработала − Потратила = Осталось", like the diary's formula of the day. */
export function Formula({ was, earned, spent }: Props) {
  const p = usePalette();
  const left = was + earned - spent;
  const cell = (label: string, value: number, color: string) => (
    <View style={[styles.cell, { backgroundColor: color }]}>
      <T v="big" color={brand.ocean} center>
        {value}
      </T>
      <T v="small" color={brand.ocean} center numberOfLines={1} style={styles.label}>
        {label}
      </T>
    </View>
  );
  const op = (s: string) => (
    <T v="big" color={p.text} style={styles.op}>
      {s}
    </T>
  );
  return (
    <View style={styles.row} accessibilityRole="summary">
      {cell(t.child.formula.was, was, '#FFF4DC')}
      {op('+')}
      {cell(t.child.formula.earned, earned, '#D9F3EA')}
      {op('−')}
      {cell(t.child.formula.spent, spent, '#FFE3E0')}
      {op('=')}
      {cell(t.child.formula.left, left, brand.sun)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cell: { flex: 1, borderRadius: radius.s, paddingVertical: space.s, paddingHorizontal: 2, minWidth: 0 },
  op: { width: 14, textAlign: 'center' },
  label: { fontSize: 12, lineHeight: 16 },
});
