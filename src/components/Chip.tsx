import { Pressable, StyleSheet } from 'react-native';

import { onColor, radius, space, usePalette } from '@/theme';
import { T } from './T';

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  color?: string;
  testID?: string;
  multi?: boolean;
};

/** Pill-shaped choice button (single or multiple choice). */
export function Chip({ label, selected, onPress, color, testID, multi }: Props) {
  const p = usePalette();
  const accent = color ?? p.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? accent : p.border,
          backgroundColor: selected ? accent : p.card,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <T v="bodyBold" color={selected ? onColor(accent) : p.text}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space.m,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
