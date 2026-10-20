import { useContext, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { onColor, radius, space, TOUCH_MIN, usePalette } from '@/theme';
import { CompactButtons } from './ButtonRow';
import { T } from './T';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  subtitle?: string;
  testID?: string;
};

export function Button({ title, onPress, variant = 'primary', disabled, loading, icon, subtitle, testID }: Props) {
  const p = usePalette();
  const compact = useContext(CompactButtons);
  const bg = {
    primary: p.primary,
    accent: p.accent,
    secondary: p.card,
    ghost: 'transparent',
    danger: p.card,
  }[variant];
  const fg = {
    primary: p.onPrimary,
    accent: onColor(p.accent),
    secondary: p.text,
    ghost: p.link,
    danger: p.danger,
  }[variant];
  const inactive = disabled || loading;
  // Not available yet: a calm grey button with readable text in both themes
  // (a faded colour button had dark text on dark red in the dark theme).
  const off = !!disabled && !loading;
  const bgNow = off ? (variant === 'ghost' ? 'transparent' : p.cardAlt) : bg;
  const fgNow = off ? p.textMuted : fg;
  const bordered = !off && (variant === 'secondary' || variant === 'danger');

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      aria-disabled={!!inactive}
      aria-busy={!!loading}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: bgNow, opacity: loading ? 0.7 : pressed ? 0.85 : 1 },
        bordered && { borderWidth: 2, borderColor: variant === 'danger' ? p.danger : p.border },
        pressed && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={fgNow} />
      ) : (
        <View style={styles.row}>
          {icon}
          <View style={styles.texts}>
            <T v="bodyBold" color={fgNow} center={!icon}>
              {title}
            </T>
            {subtitle ? (
              <T v="small" color={fgNow} center={!icon} style={styles.sub}>
                {subtitle}
              </T>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH_MIN,
    borderRadius: radius.l,
    paddingHorizontal: space.xl,
    paddingVertical: space.m,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  compact: { paddingHorizontal: space.m },
  pressed: { transform: [{ scale: 0.98 }] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.m },
  texts: { flexShrink: 1 },
  sub: { opacity: 0.85 },
});
