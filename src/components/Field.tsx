import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { useTextScale } from '@/lib/textScale';
import { fonts, radius, space, TOUCH_MIN, usePalette } from '@/theme';
import { T } from './T';

type Props = TextInputProps & { label?: string; error?: string | null };

export const Field = forwardRef<TextInput, Props>(function Field({ label, error, style, ...rest }, ref) {
  const p = usePalette();
  const scale = useTextScale((s) => s.scale);
  return (
    <View style={styles.wrap}>
      {label ? <T v="label">{label}</T> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={p.textMuted}
        {...rest}
        style={[
          styles.input,
          {
            backgroundColor: p.inputBg,
            color: p.text,
            borderColor: error ? p.danger : p.border,
            fontSize: 18 * scale,
          },
          style,
        ]}
      />
      {error ? (
        <T v="small" color={p.danger}>
          {error}
        </T>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  input: {
    minHeight: TOUCH_MIN,
    borderWidth: 2,
    borderRadius: radius.m,
    paddingHorizontal: space.l,
    fontFamily: fonts.bodySemi,
  },
});
