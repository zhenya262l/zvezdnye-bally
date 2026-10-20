import { Pressable, StyleSheet, View } from 'react-native';

import { radius, space, TOUCH_MIN, usePalette } from '@/theme';
import { T } from './T';

type Props = { checked: boolean; onChange: (v: boolean) => void; label: string; testID?: string };

/** A large checkbox with a label: the whole row is tappable. */
export function CheckRow({ checked, onChange, label, testID }: Props) {
  const p = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={styles.row}>
      <View
        style={[
          styles.box,
          { borderColor: checked ? p.primary : p.border, backgroundColor: checked ? p.primary : p.inputBg },
        ]}>
        {checked ? (
          <T v="bodyBold" color={p.onPrimary}>
            ✓
          </T>
        ) : null}
      </View>
      <T v="bodyBold" style={styles.flex}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: TOUCH_MIN },
  box: { width: 32, height: 32, borderRadius: radius.s, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
});
