import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { space, TOUCH_MIN, usePalette } from '@/theme';
import { T } from './T';

type Props = { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; testID?: string };

export function SwitchRow({ label, hint, value, onChange, testID }: Props) {
  const p = usePalette();
  return (
    <Pressable accessibilityRole="switch" aria-checked={value} onPress={() => onChange(!value)} style={styles.row}>
      <View style={styles.texts}>
        <T v="bodyBold">{label}</T>
        {hint ? (
          <T v="small" muted>
            {hint}
          </T>
        ) : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: p.primary, false: p.border }}
        thumbColor="#FFFFFF"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: TOUCH_MIN, flexDirection: 'row', alignItems: 'center', gap: space.m },
  texts: { flex: 1, gap: 2 },
});
