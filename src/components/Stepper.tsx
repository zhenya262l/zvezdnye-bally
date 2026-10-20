import { Pressable, StyleSheet, View } from 'react-native';

import { radius, space, TOUCH_MIN, usePalette } from '@/theme';
import { T } from './T';

type Props = {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
  testID?: string;
};

/** Big − / + buttons around a number. */
export function Stepper({ value, onChange, min = 1, max = 50, label, testID }: Props) {
  const p = usePalette();
  const btn = (sign: -1 | 1) => {
    const next = value + sign;
    const disabled = next < min || next > max;
    return (
      <Pressable
        testID={testID ? `${testID}-${sign > 0 ? 'plus' : 'minus'}` : undefined}
        accessibilityRole="button"
        accessibilityLabel={sign > 0 ? '+1' : '−1'}
        disabled={disabled}
        onPress={() => onChange(next)}
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: p.cardAlt, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        ]}>
        <T v="big">{sign > 0 ? '+' : '−'}</T>
      </Pressable>
    );
  };
  return (
    <View style={styles.wrap}>
      {label ? <T v="label">{label}</T> : null}
      <View style={styles.row}>
        {btn(-1)}
        <T v="big" testID={testID ? `${testID}-value` : undefined} style={styles.value} center>
          {value}
        </T>
        {btn(1)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  btn: {
    width: TOUCH_MIN,
    height: TOUCH_MIN,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: { minWidth: 48 },
});
