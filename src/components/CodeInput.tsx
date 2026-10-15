import { useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { fonts, radius, space, usePalette } from '@/theme';
import { T } from './T';

type Props = {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  autoFocus?: boolean;
  onComplete?: (v: string) => void;
  testID?: string;
  accessibilityLabel?: string;
};

/** Big digit boxes over one invisible input (keeps iOS code autofill working). */
export function CodeInput({ value, onChange, length = 6, autoFocus, onComplete, testID, accessibilityLabel }: Props) {
  const p = usePalette();
  const ref = useRef<TextInput>(null);
  const digits = value.split('');

  return (
    <Pressable onPress={() => ref.current?.focus()} style={styles.wrap} accessible={false}>
      <View style={styles.row} pointerEvents="none">
        {Array.from({ length }).map((_, i) => {
          const active = i === Math.min(value.length, length - 1);
          return (
            <View
              key={i}
              style={[
                styles.box,
                { backgroundColor: p.inputBg, borderColor: active ? p.primary : p.border },
              ]}>
              <T v="big" style={styles.digit}>
                {digits[i] ?? ''}
              </T>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={(txt) => {
          const clean = txt.replace(/\D/g, '').slice(0, length);
          onChange(clean);
          if (clean.length === length) onComplete?.(clean);
        }}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={length}
        caretHidden
        style={[styles.hidden, { fontFamily: fonts.body }]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', alignSelf: 'center' },
  row: { flexDirection: 'row', gap: space.s },
  box: {
    width: 46,
    height: 60,
    borderWidth: 2,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: { fontSize: 28, lineHeight: 34 },
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.012,
    fontSize: 18,
    color: 'transparent',
  },
});
