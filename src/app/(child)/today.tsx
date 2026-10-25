import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Island } from '@/components/art/Island';
import { PhotoSheet } from '@/components/PhotoSheet';
import { Card } from '@/components/Card';
import { BirthdayCard } from '@/components/Birthday';
import { Formula } from '@/components/Formula';
import { GradesCard } from '@/components/Grades';
import { StreaksCard } from '@/components/Streaks';
import { LoadError, Loading } from '@/components/Loading';
import { PushPrompt } from '@/components/PushPrompt';
import { Screen } from '@/components/Screen';
import { StarFlight, type Point } from '@/components/StarFlight';
import { T } from '@/components/T';
import { TaskRow } from '@/components/TaskRow';
import { TaskSection, type SectionGroup } from '@/components/TaskSection';
import { api, errorText, type ChildDay, type DayTask } from '@/lib/api';
import { formatDayMonth } from '@/lib/dates';
import { readPref, writePref } from '@/lib/localPrefs';
import { useChildDay, useChildGoals, useChildren } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, radius, space, TOUCH_MIN } from '@/theme';

type Flight = { key: string; from: Point; to: Point };

// Floating balance shown at the top while a star flies, when the formula is
// scrolled out of sight.
const PILL_H = TOUCH_MIN;
const PILL_MS = 2600;
// Sections the child opened stay open on this phone.
const OPEN_KEY = 'zb.today.open';

function measure(v: View | null): Promise<Point | null> {
  return new Promise((resolve) => {
    if (!v) return resolve(null);
    v.measureInWindow((x, y, w, h) => resolve(w || h ? { x: x + w / 2, y: y + h / 2 } : null));
  });
}

export default function Today() {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const kids = useChildren();
  const day = useChildDay();
  const goals = useChildGoals();
  const focused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [busyId, setBusyId] = useState<string | null>(null);
  // A task with «Фото»: the sheet for the photo is open.
  const [photoTask, setPhotoTask] = useState<DayTask | null>(null);
  // The error is shown under the task the child tapped, where she is looking.
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pill, setPill] = useState<{ value: number; key: number } | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(readPref<string[]>(OPEN_KEY, [])));
  const [doneOpen, setDoneOpen] = useState<Set<string>>(() => new Set());
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  // Positions of task rows, for the flying star. Not used for rendering.
  const [rows] = useState(() => new Map<string, View | null>());
  const target = useRef<View>(null);
  const seen = useRef<Map<string, DayTask['status']> | null>(null);

  const mark = useMutation({
    mutationFn: ({ task, photo }: { task: DayTask; photo?: string }) => api.markDone(task.id, photo),
    onMutate: ({ task }) => {
      setBusyId(task.id);
      setError(null);
    },
    onSuccess: (r, { task }) => {
      setPhotoTask(null);
      // Without a check the points are credited at once: show them in the
      // formula right away, so the star and the badge show the new balance.
      const credited = r.status === 'approved' && !r.already && task.status !== 'approved' ? task.points : 0;
      qc.setQueryData<ChildDay>(['childDay', uid, 'me'], (old) =>
        old
          ? {
              ...old,
              formula: {
                ...old.formula,
                earned: old.formula.earned + credited,
                left: old.formula.left + credited,
              },
              tasks: old.tasks.map((x) =>
                x.id === task.id
                  ? {
                      ...x,
                      status: r.status,
                      completion_id: r.completion_id,
                      earned: credited ? task.points : x.earned,
                    }
                  : x,
              ),
            }
          : old,
      );
      void qc.invalidateQueries({ queryKey: ['childDay', uid] });
    },
    onError: (e, { task }) => {
      setError({ id: task.id, text: errorText(e) });
      // The task may have been switched off or its time may be over: refresh.
      void qc.invalidateQueries({ queryKey: ['childDay', uid] });
    },
    onSettled: () => setBusyId(null),
  });

  // A star flies to the balance when a task gets signed (not on first load).
  // While another tab is open nothing is marked as seen, so the star flies
  // when the child comes back to «Сегодня».
  useEffect(() => {
    const tasks = day.data?.tasks;
    if (!tasks || !focused) return;
    const prev = seen.current;
    seen.current = new Map(tasks.map((x) => [x.id, x.status]));
    if (!prev) return;
    const signed = tasks.filter((x) => x.status === 'approved' && prev.get(x.id) !== 'approved');
    if (signed.length === 0) return;
    const balance = day.data?.formula.left ?? 0;
    void (async () => {
      await new Promise((r) => setTimeout(r, 150)); // let the screen lay out after a tab switch
      const top = insets.top + space.s;
      const visible = (pt: Point | null) => !!pt && pt.y > top && pt.y < height - 90;
      let to = await measure(target.current);
      if (!visible(to)) {
        // The formula is scrolled away: fly to a balance badge at the top.
        to = { x: width / 2, y: top + PILL_H / 2 };
        setPill({ value: balance, key: Date.now() });
      }
      const fresh: Flight[] = [];
      for (const x of signed) {
        // A signed task folds into «Сделано» or sits in a closed section:
        // then the star starts from that line or from the section band.
        const from =
          (await measure(rows.get(x.id) ?? null)) ??
          (await measure(rows.get(`done-${x.section_id}`) ?? null)) ??
          (await measure(rows.get(`head-${x.section_id}`) ?? null));
        if (!from) continue;
        const start = visible(from) ? from : { x: from.x, y: Math.min(Math.max(from.y, top + 60), height - 120) };
        fresh.push({ key: `${x.id}-${Date.now()}`, from: start, to: to as Point });
      }
      if (fresh.length) setFlights((f) => [...f, ...fresh]);
      // Android only: iPhone web apps cannot vibrate (see DECISIONS.md).
      if (Platform.OS === 'web') (globalThis.navigator as Navigator | undefined)?.vibrate?.(40);
    })();
  }, [day.data, rows, focused, width, height, insets.top]);

  useEffect(() => {
    if (!pill) return;
    const timer = setTimeout(() => setPill(null), PILL_MS);
    return () => clearTimeout(timer);
  }, [pill]);

  if (day.isPending) return <Loading />;
  if (day.isError) return <LoadError text={errorText(day.error)} onRetry={() => day.refetch()} />;

  const me = kids.data?.[0];
  const sections: SectionGroup[] = [];
  for (const task of day.data.tasks) {
    let s = sections.find((x) => x.id === task.section_id);
    if (!s) {
      s = { id: task.section_id, name: task.section, color: task.color, tasks: [] };
      sections.push(s);
    }
    s.tasks.push(task);
  }

  const f = day.data.formula;
  return (
    <View style={styles.root}>
      <Screen inTabs>
        <T v="title">{me ? t.childPair.hello(me.name) : t.childTabs.today}</T>
        <T muted>{formatDayMonth(day.data.date)}</T>
        <PushPrompt role="child" />
        <BirthdayCard />
        <Formula was={f.was} earned={f.earned} spent={f.spent} corrected={f.corrected} left={f.left} leftRef={target} />
        {(goals.data?.held ?? 0) > 0 ? (
          <T v="small" muted center testID="today-piggy">
            {t.dreams.ofThemPiggy(goals.data?.held ?? 0)}
          </T>
        ) : null}
        {sections.length === 0 ? (
          <Card title={t.childTabs.today} accent={brand.sun}>
            <View style={[styles.scene, { backgroundColor: brand.ocean }]}>
              <Island width={260} />
            </View>
            <T center>{t.child.noTasksToday}</T>
          </Card>
        ) : (
          sections.map((s) => (
            <TaskSection
              key={s.id}
              section={s}
              open={open.has(s.id)}
              onToggle={() => {
                const next = toggle(open, s.id);
                setOpen(next);
                writePref(OPEN_KEY, [...next]);
              }}
              doneOpen={doneOpen.has(s.id)}
              onToggleDone={() => setDoneOpen(toggle(doneOpen, s.id))}
              headerRef={(v) => {
                rows.set(`head-${s.id}`, v);
              }}
              doneRef={(v) => {
                rows.set(`done-${s.id}`, v);
              }}
              renderTask={(task: DayTask) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  busy={busyId === task.id}
                  onDone={() => {
                    if (task.needs_photo) {
                      setError(null);
                      setPhotoTask(task);
                    } else mark.mutate({ task });
                  }}
                  error={error?.id === task.id ? error.text : null}
                  rowRef={(v) => {
                    rows.set(task.id, v);
                  }}
                />
              )}
            />
          ))
        )}
        <StreaksCard />
        <GradesCard />
      </Screen>
      {pill ? (
        <View
          key={pill.key}
          pointerEvents="none"
          testID="balance-pill"
          style={[styles.pill, { top: insets.top + space.s }]}>
          <T v="big" color={brand.ocean}>
            {t.child.balanceNow(day.data?.formula.left ?? pill.value)}
          </T>
        </View>
      ) : null}
      {photoTask ? (
        <PhotoSheet
          task={photoTask}
          sending={busyId === photoTask.id}
          error={error?.id === photoTask.id ? error.text : null}
          onSend={(photo) => mark.mutate({ task: photoTask, photo: photo.base64 })}
          onClose={() => setPhotoTask(null)}
        />
      ) : null}
      {flights.map((fl) => (
        <StarFlight
          key={fl.key}
          from={fl.from}
          to={fl.to}
          onEnd={() => setFlights((all) => all.filter((x) => x.key !== fl.key))}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scene: { borderRadius: radius.m, alignItems: 'center', paddingTop: space.m, overflow: 'hidden' },
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    minHeight: PILL_H,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: brand.sun,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 45,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
});
