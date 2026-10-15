import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space, usePalette } from '@/theme';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  /** Inside a tab navigator the tab bar already handles the bottom inset. */
  inTabs?: boolean;
  style?: ViewStyle;
  bg?: string;
};

/** Page container: theme background, notch-safe padding, readable width. */
export function Screen({ children, scroll = true, inTabs, style, bg }: Props) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + space.l,
    paddingBottom: (inTabs ? 0 : insets.bottom) + space.xl,
    paddingLeft: insets.left + space.l,
    paddingRight: insets.right + space.l,
  };
  const inner = <View style={[styles.inner, style]}>{children}</View>;
  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: bg ?? p.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.grow, padding]}
          keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        <View style={[styles.flex, padding]}>{inner}</View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  inner: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', gap: space.l },
});
