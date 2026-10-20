import type { Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { DayTask } from '@/lib/api';
import { t } from '@/strings.ru';
import { brand, onColor, radius, space, TOUCH_MIN, usePalette } from '@/theme';
import { T } from './T';

// Dark green on the light green badge (contrast 4.5:1 in both themes).
const APPROVED_TEXT = '#1E7A4E';

type Props = { task: DayTask; busy: boolean; onDone: () => void; rowRef?: Ref<View>; error?: string | null };

/** One task on the child's "Сегодня" screen: icon, name, points and the big "Сделала" button. */
export function TaskRow({ task, busy, onDone, rowRef, error }: Props) {
  const p = usePalette();

  let action: React.ReactNode;
  if (task.status === 'approved') {
    action = (
      <View style={[styles.badge, { backgroundColor: '#D9F3EA' }]}>
        <T v="bodyBold" color={APPROVED_TEXT} center>
          {`✓ ${t.child.approved(task.earned ?? task.points)}`}
        </T>
      </View>
    );
  } else if (task.status === 'pending') {
    action = (
      <View style={[styles.badge, { backgroundColor: '#FFF4DC' }]}>
        <T v="bodyBold" color={brand.ocean} center>
          {`⏳ ${t.child.pending}`}
        </T>
      </View>
    );
  } else if (task.status === 'rejected') {
    action = (
      <View style={[styles.badge, { backgroundColor: p.cardAlt }]}>
        <T v="body" muted center>
          {t.child.rejected}
        </T>
      </View>
    );
  } else if (task.window !== 'open') {
    action = (
      <View style={[styles.badge, { backgroundColor: p.cardAlt }]}>
        <T v="bodyBold" muted center>
          {task.window === 'before' ? t.child.before(task.window_start ?? '') : t.child.after}
        </T>
      </View>
    );
  } else {
    action = (
      <Pressable
        testID={`done-${task.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${t.child.done}: ${task.title}`}
        disabled={busy}
        onPress={onDone}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: brand.coral, opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
          pressed && { transform: [{ scale: 0.97 }] },
        ]}>
        {busy ? (
          <ActivityIndicator color={onColor(brand.coral)} />
        ) : (
          <T v="bodyBold" color={onColor(brand.coral)} center>
            {t.child.done}
          </T>
        )}
      </Pressable>
    );
  }

  return (
    <View ref={rowRef} style={[styles.row, { borderColor: p.border }]} testID={`task-${task.id}`}>
      <View style={styles.top}>
        <T style={styles.icon}>{task.icon}</T>
        <T v="bodyBold" style={styles.title}>
          {task.title}
        </T>
        <View style={[styles.points, { backgroundColor: brand.sun }]}>
          {/* Once credited: what she got, even if the parent changed the points later. */}
          <T
            v="bodyBold"
            color={brand.ocean}>{`+${task.status === 'approved' ? (task.earned ?? task.points) : task.points}`}</T>
        </View>
      </View>
      {action}
      {task.praise ? (
        <T v="bodyBold" color={p.text} testID={`praise-${task.id}`}>
          {`💬 ${t.child.praiseFrom(task.praised_by_name ?? '', task.praise)}`}
        </T>
      ) : null}
      {error ? (
        <T v="bodyBold" color={p.danger} accessibilityRole="alert">
          {error}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.s, paddingVertical: space.s, borderTopWidth: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  icon: { fontSize: 30, lineHeight: 38, width: 38, textAlign: 'center' },
  title: { flex: 1 },
  points: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 2 },
  button: {
    minHeight: TOUCH_MIN,
    borderRadius: radius.l,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.l,
  },
  badge: {
    minHeight: TOUCH_MIN,
    borderRadius: radius.l,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.l,
  },
});
