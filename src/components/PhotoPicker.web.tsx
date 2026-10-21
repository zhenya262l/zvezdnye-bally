import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { onColor, radius, space, TOUCH_MIN, usePalette } from '@/theme';
import { T } from './T';

type Props = {
  title: string;
  onPicked: (file: File) => void;
  variant?: 'accent' | 'secondary';
  disabled?: boolean;
  testID?: string;
};

/**
 * A button that opens the phone camera. The file input lies over the whole
 * button, so the tap lands right on it: iPhone opens the camera only from a
 * direct tap.
 */
export function PhotoPicker({ title, onPicked, variant = 'accent', disabled, testID }: Props) {
  const p = usePalette();
  // The input is invisible: show keyboard focus on the button itself.
  const [focused, setFocused] = useState(false);
  const bg = variant === 'accent' ? p.accent : p.card;
  const fg = variant === 'accent' ? onColor(p.accent) : p.text;
  return (
    <View
      style={[
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.6 : 1 },
        variant === 'secondary' && { borderWidth: 2, borderColor: p.border },
        focused && { borderWidth: 3, borderColor: p.link },
      ]}>
      {/* Read out once, by the input's label. */}
      <T v="bodyBold" color={fg} center aria-hidden>
        {title}
      </T>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={title}
        data-testid={testID}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          // Cleared, so the same photo can be chosen again after an error.
          e.currentTarget.value = '';
          if (file) onPicked(file);
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: disabled ? 'default' : 'pointer',
          fontSize: 0,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: TOUCH_MIN,
    borderRadius: radius.l,
    paddingHorizontal: space.xl,
    paddingVertical: space.m,
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
});
