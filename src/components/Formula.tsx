import type { Ref } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { useTextScale } from '@/lib/textScale';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { T } from './T';

type Props = {
  was: number;
  earned: number;
  spent: number;
  /** A parent's corrections today; shown on its own line, never as spending. */
  corrected?: number;
  left?: number;
  leftRef?: Ref<View>;
};

// Colours of the paper diary's formula cells. Text on them is always navy.
const CELL = { was: '#FFF4DC', earned: '#D9F3EA', spent: '#FFE3E0', corrected: '#ECE6FA' } as const;

/**
 * "Было + Заработала − Потратила = Осталось", like the diary's formula of the
 * day. One row on a wide screen with normal text. A column, like a sum in an
 * exercise book, on narrow iPhones, with larger iOS text or when there is a
 * correction today: then nothing gets cut off.
 */
export function Formula({ was, earned, spent, corrected = 0, left, leftRef }: Props) {
  const p = usePalette();
  const { width } = useWindowDimensions();
  const scale = useTextScale((s) => s.scale);
  const result = left ?? was + earned - spent + corrected;
  const row = width >= 390 && scale <= 1.05 && corrected === 0;
  const f = t.child.formula;
  const summary = `${f.was} ${was} + ${f.earned} ${earned} − ${f.spent} ${spent}${
    corrected ? ` ${corrected > 0 ? '+' : '−'} ${f.corrected} ${Math.abs(corrected)}` : ''
  } = ${f.left} ${result}`;

  if (row) {
    const cell = (label: string, value: number, bg: string, ref?: Ref<View>, testID?: string) => (
      <View ref={ref} style={[styles.cell, { backgroundColor: bg }]}>
        <T v="big" color={brand.ocean} center testID={testID}>
          {value}
        </T>
        <T v="small" color={brand.ocean} center numberOfLines={1} style={styles.cellLabel}>
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
      <View style={styles.row} accessible accessibilityRole="summary" accessibilityLabel={summary}>
        {cell(f.was, was, CELL.was)}
        {op('+')}
        {cell(f.earned, earned, CELL.earned)}
        {op('−')}
        {cell(f.spent, spent, CELL.spent)}
        {op('=')}
        {cell(f.left, result, brand.sun, leftRef, 'formula-left')}
      </View>
    );
  }

  const line = (sign: string, label: string, value: number, bg: string) => (
    <View style={[styles.line, { backgroundColor: bg }]}>
      <T v="bodyBold" color={brand.ocean} style={styles.sign}>
        {sign}
      </T>
      <T v="bodyBold" color={brand.ocean} style={styles.flex}>
        {label}
      </T>
      <T v="big" color={brand.ocean}>
        {value}
      </T>
    </View>
  );
  return (
    <View style={styles.column} accessible accessibilityRole="summary" accessibilityLabel={summary}>
      {line('', f.was, was, CELL.was)}
      {line('+', f.earned, earned, CELL.earned)}
      {line('−', f.spent, spent, CELL.spent)}
      {corrected !== 0 ? line(corrected > 0 ? '+' : '−', f.corrected, Math.abs(corrected), CELL.corrected) : null}
      <View ref={leftRef} style={[styles.line, styles.total, { backgroundColor: brand.sun }]}>
        <T v="bodyBold" color={brand.ocean} style={styles.sign}>
          =
        </T>
        <T v="bodyBold" color={brand.ocean} style={styles.flex}>
          {f.left}
        </T>
        <T v="big" color={brand.ocean} testID="formula-left">
          {result}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cell: { flex: 1, borderRadius: radius.s, paddingVertical: space.s, paddingHorizontal: 2, minWidth: 0 },
  cellLabel: { fontSize: 12, lineHeight: 16 },
  op: { width: 14, textAlign: 'center' },
  column: { gap: 4 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    borderRadius: radius.s,
    paddingHorizontal: space.m,
    paddingVertical: 4,
  },
  total: { marginTop: 2 },
  sign: { width: 18, textAlign: 'center' },
  flex: { flex: 1 },
});
