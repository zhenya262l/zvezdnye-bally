import { StyleSheet, View } from 'react-native';

import { useTextScale } from '@/lib/textScale';
import { radius, space, TOUCH_MIN, usePalette } from '@/theme';
import { T } from './T';

type Props = { label: string; value: string; onChange: (hhmm: string) => void; testID?: string };

/** Browser time picker (wheel on iPhone). Value: HH:MM. */
export function TimeField({ label, value, onChange, testID }: Props) {
  const p = usePalette();
  const scale = useTextScale((s) => s.scale);
  return (
    <View style={styles.wrap}>
      <T v="label">{label}</T>
      <input
        type="time"
        data-testid={testID}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={{
          minHeight: TOUCH_MIN,
          boxSizing: 'border-box',
          width: '100%',
          border: `2px solid ${p.border}`,
          borderRadius: radius.m,
          padding: `0 ${space.m}px`,
          fontFamily: 'Nunito_600SemiBold, system-ui, sans-serif',
          fontSize: 18 * scale,
          color: p.text,
          background: p.inputBg,
          WebkitAppearance: 'none',
          appearance: 'none',
          display: 'block',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flex: 1, gap: space.xs } });
