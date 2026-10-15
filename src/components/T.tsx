import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { useTextScale } from '@/lib/textScale';
import { fonts, usePalette } from '@/theme';

const variants = {
  // Comfortaa only in capitals: its lowercase Cyrillic д, т, и, п look like g, m, u, n.
  hero: { fontFamily: fonts.title, fontSize: 28, lineHeight: 36, textTransform: 'uppercase', letterSpacing: 1 },
  band: { fontFamily: fonts.title, fontSize: 13, lineHeight: 18, textTransform: 'uppercase', letterSpacing: 1 },
  name: { fontFamily: fonts.bodyHeavy, fontSize: 32, lineHeight: 40 },
  title: { fontFamily: fonts.bodyHeavy, fontSize: 26, lineHeight: 32 },
  h2: { fontFamily: fonts.bodyHeavy, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24 },
  bodyBold: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 24 },
  big: { fontFamily: fonts.bodyHeavy, fontSize: 22, lineHeight: 28 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19 },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 18 },
  code: { fontFamily: fonts.bodyHeavy, fontSize: 44, lineHeight: 52, letterSpacing: 6 },
} satisfies Record<string, TextStyle>;

export type TVariant = keyof typeof variants;

type Props = TextProps & { v?: TVariant; color?: string; muted?: boolean; center?: boolean };

export function T({ v = 'body', color, muted, center, style, ...rest }: Props) {
  const p = usePalette();
  const scale = useTextScale((s) => s.scale);
  const base = variants[v];
  return (
    <Text
      {...rest}
      style={[
        base,
        { color: color ?? (muted ? p.textMuted : p.text) },
        scale !== 1 && { fontSize: base.fontSize * scale, lineHeight: base.lineHeight * scale },
        center && styles.center,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({ center: { textAlign: 'center' } });
