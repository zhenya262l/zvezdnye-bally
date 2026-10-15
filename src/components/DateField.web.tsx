import { StyleSheet, View } from 'react-native';

import { todayISO } from '@/lib/dates';
import { useTextScale } from '@/lib/textScale';
import { radius, space, TOUCH_MIN, usePalette } from '@/theme';
import { T } from './T';

type Props = { label: string; value: string; onChange: (iso: string) => void; error?: string | null; testID?: string };

/** Native date picker of the browser (wheel picker on iPhone). Value: YYYY-MM-DD. */
export function DateField({ label, value, onChange, error, testID }: Props) {
  const p = usePalette();
  const scale = useTextScale((s) => s.scale);
  return (
    <View style={styles.wrap}>
      <T v="label">{label}</T>
      <input
        type="date"
        data-testid={testID}
        aria-label={label}
        value={value}
        min="2000-01-01"
        max={todayISO()}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={{
          minHeight: TOUCH_MIN,
          boxSizing: 'border-box',
          width: '100%',
          border: `2px solid ${error ? p.danger : p.border}`,
          borderRadius: radius.m,
          padding: `0 ${space.l}px`,
          fontFamily: 'Nunito_600SemiBold, system-ui, sans-serif',
          fontSize: 18 * scale,
          color: p.text,
          background: p.inputBg,
          WebkitAppearance: 'none',
          appearance: 'none',
          display: 'block',
          textAlign: 'left',
        }}
      />
      {error ? (
        <T v="small" color={p.danger}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: space.xs } });
