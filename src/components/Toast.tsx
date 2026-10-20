import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, usePalette } from '@/theme';
import { T } from './T';

export type ToastMsg = { text: string; kind: 'error' | 'info' | 'success' } | null;

type Props = { msg: ToastMsg; onHide: () => void; inTabs?: boolean };

/**
 * Message pinned to the bottom of the screen, so it is seen even when the
 * button that caused it is far down a long list. Hides itself after 5 seconds.
 */
export function Toast({ msg, onHide, inTabs }: Props) {
  const p = usePalette();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!msg) return;
    const timer = setTimeout(onHide, 5000);
    return () => clearTimeout(timer);
  }, [msg, onHide]);

  if (!msg) return null;
  const color = msg.kind === 'error' ? p.danger : msg.kind === 'success' ? p.successText : p.link;
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: (inTabs ? 0 : insets.bottom) + space.l }]}>
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.box, { borderColor: color, backgroundColor: p.card }]}>
        <T v="bodyBold" color={color}>
          {msg.text}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.l, right: space.l, alignItems: 'center', zIndex: 40 },
  box: {
    width: '100%',
    maxWidth: 528,
    borderWidth: 2,
    borderRadius: radius.m,
    padding: space.m,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
