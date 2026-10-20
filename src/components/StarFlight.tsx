import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import { StarIcon } from './art/Icons';
import { brand } from '@/theme';

export type Point = { x: number; y: number };

type Props = { from: Point; to: Point; onEnd: () => void };

/** A star that flies from a signed task to the balance (SPEC section 6). */
export function StarFlight({ from, to, onEnd }: Props) {
  const [v] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 900,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start(() => onEnd());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const size = 40;
  const left = v.interpolate({ inputRange: [0, 1], outputRange: [from.x - size / 2, to.x - size / 2] });
  const top = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [from.y - size / 2, Math.min(from.y, to.y) - 60, to.y - size / 2] });
  const scale = v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.6, 1.6, 0.8] });
  const opacity = v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });

  return (
    <Animated.View pointerEvents="none" style={[styles.star, { left, top, opacity, transform: [{ scale }] }]}>
      <StarIcon color={brand.sun} size={size} filled />
    </Animated.View>
  );
}

const styles = StyleSheet.create({ star: { position: 'absolute', zIndex: 50 } });
