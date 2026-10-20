import type { ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { DayTask } from '@/lib/api';
import { t } from '@/strings.ru';
import { onColor, radius, space, TOUCH_MIN, usePalette } from '@/theme';
import { T } from './T';

export type SectionGroup = { id: string; name: string; color: string; tasks: DayTask[] };

const finished = (x: DayTask) => x.status === 'approved' || x.status === 'rejected';

// What the child can do right now comes first, then what waits for a parent,
// then what comes later today, then what is over.
function rank(x: DayTask): number {
  if (x.status === 'pending') return 1;
  if (x.window === 'before') return 2;
  if (x.window === 'after') return 3;
  return 0;
}

export function splitTasks(tasks: DayTask[]) {
  const active = tasks.filter((x) => !finished(x)).sort((a, b) => rank(a) - rank(b));
  const done = tasks.filter(finished);
  return { active, done };
}

type Props = {
  section: SectionGroup;
  open: boolean;
  onToggle: () => void;
  doneOpen: boolean;
  onToggleDone: () => void;
  renderTask: (task: DayTask) => ReactNode;
  headerRef?: Ref<View>;
  doneRef?: Ref<View>;
};

/**
 * A diary section on the child's «Сегодня». Closed: only the coloured band
 * with progress. Open: tasks to do now first, finished ones folded into
 * «Сделано: N».
 */
export function TaskSection({ section, open, onToggle, doneOpen, onToggleDone, renderTask, headerRef, doneRef }: Props) {
  const p = usePalette();
  const { active, done } = splitTasks(section.tasks);
  const fg = onColor(section.color);
  // Progress counts only credited tasks: «не засчитано» is not «сделано».
  const credited = done.filter((x) => x.status === 'approved').length;
  const rejected = done.length - credited;
  const allDone = active.length === 0 && rejected === 0 && credited > 0;
  const progress = allDone ? `✓ ${t.child.sectionAllDone}` : t.child.sectionProgress(credited, section.tasks.length);
  const doneLabel = t.child.doneGroup(credited, rejected);

  return (
    <View style={[styles.card, { borderColor: section.color, backgroundColor: p.card }]}>
      <Pressable
        ref={headerRef}
        testID={`section-${section.id}`}
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel={`${section.name}. ${progress}. ${open ? t.child.hideTasks : t.child.showTasks}`}
        onPress={onToggle}
        style={({ pressed }) => [styles.band, { backgroundColor: section.color, opacity: pressed ? 0.85 : 1 }]}>
        <T v="band" color={fg} style={styles.flex}>
          {section.name}
        </T>
        <T v="bodyBold" color={fg}>
          {progress}
        </T>
        <T v="big" color={fg} style={styles.chevron}>
          {open ? '▾' : '▸'}
        </T>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {active.map((task) => renderTask(task))}
          {done.length > 0 ? (
            <>
              <Pressable
                ref={doneRef}
                testID={`done-group-${section.id}`}
                accessibilityRole="button"
                aria-expanded={doneOpen}
                accessibilityLabel={doneLabel}
                onPress={onToggleDone}
                style={[styles.doneLine, { borderColor: p.border }]}>
                <T v="bodyBold" color={credited ? p.successText : p.textMuted} style={styles.flex}>
                  {credited ? `✓ ${doneLabel}` : doneLabel}
                </T>
                <T v="big" color={p.textMuted}>
                  {doneOpen ? '▾' : '▸'}
                </T>
              </Pressable>
              {doneOpen ? done.map((task) => renderTask(task)) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.m, borderWidth: 2, overflow: 'hidden' },
  band: {
    minHeight: TOUCH_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingHorizontal: space.l,
  },
  chevron: { width: 22, textAlign: 'center' },
  flex: { flex: 1 },
  body: { padding: space.l, paddingTop: space.s, gap: space.s },
  doneLine: {
    minHeight: TOUCH_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    borderTopWidth: 1,
  },
});
