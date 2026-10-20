import { Children, createContext, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTextScale } from '@/lib/textScale';
import { space } from '@/theme';

/** Buttons inside a row use smaller side padding, so their words fit. */
export const CompactButtons = createContext(false);

// With larger iPhone text two buttons no longer fit side by side without
// breaking words in the middle («Подписа-ть»): then they stand one under another.
const STACK_FROM_SCALE = 1.15;

/** Two or three buttons side by side; one under another with larger text. */
export function ButtonRow({ children }: { children: ReactNode }) {
  const scale = useTextScale((s) => s.scale);
  const stacked = scale >= STACK_FROM_SCALE;
  return (
    <CompactButtons.Provider value>
      <View style={[styles.row, stacked && styles.column]}>
        {Children.map(children, (child) => (child ? <View style={stacked ? null : styles.cell}>{child}</View> : null))}
      </View>
    </CompactButtons.Provider>
  );
}

/** A label with a button on the right; the button moves below with larger text. */
export function ActionLine({ children, action }: { children: ReactNode; action: ReactNode }) {
  const scale = useTextScale((s) => s.scale);
  const stacked = scale >= STACK_FROM_SCALE;
  return (
    <View style={[styles.line, stacked && styles.lineColumn]}>
      <View style={stacked ? null : styles.cell}>{children}</View>
      <CompactButtons.Provider value>
        <View style={stacked ? null : styles.action}>{action}</View>
      </CompactButtons.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.s },
  column: { flexDirection: 'column' },
  cell: { flex: 1, minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  lineColumn: { flexDirection: 'column', alignItems: 'stretch', gap: space.s },
  action: { flexShrink: 0 },
});
