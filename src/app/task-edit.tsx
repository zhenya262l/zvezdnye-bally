import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BackLink, NotFound } from '@/components/BackLink';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Field } from '@/components/Field';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { Stepper } from '@/components/Stepper';
import { SwitchRow } from '@/components/SwitchRow';
import { T } from '@/components/T';
import { TimeField } from '@/components/TimeField';
import { api, errorText, type TaskInput } from '@/lib/api';
import { useChildren, useSections, useTasks } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { ALL_DAYS, TASK_ICONS, WEEKDAYS, WEEKEND } from '@/lib/tasks';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/tasks'));

/** Parent: add a task (for one or several children) or edit one task. */
export default function TaskEdit() {
  const { id, child } = useLocalSearchParams<{ id?: string; child?: string }>();
  const uid = useSession((s) => s.session?.user.id);
  // A reload or a link opened directly: wait for the saved sign-in.
  const ready = useSession((s) => s.ready);
  const who = useWho();
  const kids = useChildren();
  const sections = useSections();
  const tasks = useTasks(child);

  if (!ready) return <Loading />;
  if (!uid) return <Redirect href="/" />;
  if (who.data && who.data.member?.role !== 'parent') return <Redirect href="/" />;
  if (id && !child) {
    // A broken link: the editor needs to know whose task it is.
    return (
      <Screen>
        <NotFound fallback="/tasks" />
      </Screen>
    );
  }
  if (kids.isPending || sections.isPending || (id && tasks.isPending)) return <Loading />;
  // Offline is not «nothing here»: offer to try again.
  const failed = kids.error ?? sections.error ?? (id ? tasks.error : null);
  if (failed) {
    return (
      <LoadError
        text={errorText(failed)}
        onRetry={() => {
          void kids.refetch();
          void sections.refetch();
          if (id) void tasks.refetch();
        }}
      />
    );
  }

  const firstSection = sections.data?.[0]?.id ?? '';
  if (!id) {
    return (
      <TaskForm
        initial={{
          id: null,
          childIds: child ? [child] : (kids.data ?? []).slice(0, 1).map((c) => c.id),
          sectionId: firstSection,
          title: '',
          icon: '⭐',
          points: 2,
          days: ALL_DAYS,
          windowStart: null,
          windowEnd: null,
          needsApproval: false,
          needsPhoto: false,
          enabled: true,
        }}
      />
    );
  }
  const task = tasks.data?.find((x) => x.id === id);
  if (!task) {
    return (
      <Screen>
        <NotFound fallback={{ pathname: '/tasks', params: { child } }} />
      </Screen>
    );
  }
  return (
    <TaskForm
      key={task.id}
      initial={{
        id: task.id,
        childIds: [task.child_id],
        sectionId: task.section_id,
        title: task.title,
        icon: task.icon,
        points: task.points,
        days: task.days,
        windowStart: task.window_start,
        windowEnd: task.window_end,
        needsApproval: task.needs_approval,
        needsPhoto: task.needs_photo,
        enabled: task.enabled,
      }}
    />
  );
}

function TaskForm({ initial }: { initial: TaskInput }) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const kids = useChildren();
  const sections = useSections();
  const [v, setV] = useState<TaskInput>(initial);
  const [windowOn, setWindowOn] = useState(!!initial.windowStart);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isNew = !initial.id;
  const set = (patch: Partial<TaskInput>) => setV((x) => ({ ...x, ...patch }));

  const toggleDay = (d: number) =>
    set({ days: v.days.includes(d) ? v.days.filter((x) => x !== d) : [...v.days, d].sort((a, b) => a - b) });
  const toggleChild = (cid: string) =>
    set({ childIds: v.childIds.includes(cid) ? v.childIds.filter((x) => x !== cid) : [...v.childIds, cid] });

  const done = () => {
    void qc.invalidateQueries({ queryKey: ['tasks', uid] });
    void qc.invalidateQueries({ queryKey: ['childDay', uid] });
    goBack();
  };

  async function save() {
    setError(null);
    if (!v.title.trim()) return setError(t.errors.invalid_task_title);
    if (v.days.length === 0) return setError(t.errors.invalid_days);
    if (isNew && v.childIds.length === 0) return setError(t.errors.pick_child);
    const start = windowOn ? v.windowStart || null : null;
    const end = windowOn ? v.windowEnd || null : null;
    // On iPhone the time wheel has «Сбросить»: an empty time is not saved silently.
    if (windowOn && (!start || !end)) return setError(t.errors.invalid_window_time);
    if (start && end && start >= end) return setError(t.errors.invalid_window);
    setBusy(true);
    try {
      await api.saveTask({ ...v, windowStart: start, windowEnd: end });
      done();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteTask(initial.id as string);
      setConfirmDelete(false);
      done();
    } catch (e) {
      setError(errorText(e));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BackLink fallback={{ pathname: '/tasks', params: { child: initial.childIds[0] } }} />
      <T v="title">{isNew ? t.taskEdit.titleNew : t.taskEdit.titleEdit}</T>
      <Field
        testID="task-title"
        label={t.taskEdit.name}
        placeholder={t.taskEdit.namePlaceholder}
        value={v.title}
        onChangeText={(title) => set({ title })}
        maxLength={60}
      />

      <T v="label">{t.taskEdit.icon}</T>
      <View style={styles.icons}>
        {TASK_ICONS.map((icon) => {
          const selected = v.icon === icon;
          return (
            <Pressable
              key={icon}
              accessibilityRole="radio"
              aria-checked={selected}
              onPress={() => set({ icon })}
              style={[styles.iconCell, { borderColor: selected ? p.primary : 'transparent', backgroundColor: p.card }]}>
              <T style={styles.iconText}>{icon}</T>
            </Pressable>
          );
        })}
      </View>

      <T v="label">{t.taskEdit.section}</T>
      <View style={styles.chips}>
        {(sections.data ?? []).map((s) => (
          <Chip key={s.id} label={s.name} color={s.color} selected={v.sectionId === s.id} onPress={() => set({ sectionId: s.id })} />
        ))}
      </View>

      <Stepper testID="task-points" label={t.taskEdit.points} value={v.points} onChange={(points) => set({ points })} />
      {!isNew ? (
        <T v="small" muted>
          {t.taskEdit.pointsNote}
        </T>
      ) : null}

      {isNew ? (
        <>
          <T v="label">{t.taskEdit.forWhom}</T>
          <View style={styles.chips}>
            {(kids.data ?? []).map((c) => (
              <Chip key={c.id} multi label={c.name} color={c.color} selected={v.childIds.includes(c.id)} onPress={() => toggleChild(c.id)} />
            ))}
          </View>
        </>
      ) : null}

      <T v="label">{t.taskEdit.days}</T>
      <View style={styles.chips}>
        {t.weekdays.map((name, i) => (
          <Chip key={name} multi label={name} selected={v.days.includes(i + 1)} onPress={() => toggleDay(i + 1)} />
        ))}
      </View>
      <View style={styles.chips}>
        <Chip label={t.taskEdit.everyDay} selected={false} color={brand.violet} onPress={() => set({ days: ALL_DAYS })} />
        <Chip label={t.taskEdit.weekdays} selected={false} color={brand.violet} onPress={() => set({ days: WEEKDAYS })} />
        <Chip label={t.taskEdit.weekend} selected={false} color={brand.violet} onPress={() => set({ days: WEEKEND })} />
      </View>

      <Card>
        <SwitchRow
          label={t.taskEdit.window}
          value={windowOn}
          onChange={(on) => {
            setWindowOn(on);
            if (on && !v.windowStart && !v.windowEnd) set({ windowStart: '07:00', windowEnd: '08:00' });
          }}
        />
        {windowOn ? (
          <View style={styles.times}>
            <TimeField label={t.taskEdit.windowFrom} value={v.windowStart ?? ''} onChange={(windowStart) => set({ windowStart })} />
            <TimeField label={t.taskEdit.windowTo} value={v.windowEnd ?? ''} onChange={(windowEnd) => set({ windowEnd })} />
          </View>
        ) : null}
        <SwitchRow
          label={t.taskEdit.needsApproval}
          hint={v.needsPhoto ? t.taskEdit.needsApprovalPhotoHint : t.taskEdit.needsApprovalHint}
          value={v.needsApproval}
          // No check means nobody looks at a photo: «Фото» goes off too.
          onChange={(needsApproval) => set(needsApproval ? { needsApproval } : { needsApproval, needsPhoto: false })}
        />
        <SwitchRow
          testID="task-photo"
          label={t.taskEdit.needsPhoto}
          hint={t.taskEdit.needsPhotoHint}
          value={v.needsPhoto}
          onChange={(needsPhoto) => set(needsPhoto ? { needsPhoto, needsApproval: true } : { needsPhoto })}
        />
        <SwitchRow label={t.taskEdit.enabled} value={v.enabled} onChange={(enabled) => set({ enabled })} />
      </Card>

      <Banner text={error} />
      <Button testID="task-save" title={t.common.save} onPress={save} loading={busy} />
      {!isNew ? <Button title={t.taskEdit.delete} variant="danger" onPress={() => setConfirmDelete(true)} /> : null}
      <Button title={t.common.cancel} variant="ghost" onPress={goBack} />

      <ConfirmModal
        visible={confirmDelete}
        title={t.taskEdit.deleteTitle}
        text={t.taskEdit.deleteText}
        confirmTitle={t.taskEdit.delete}
        danger
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  iconCell: { width: 48, height: 48, borderWidth: 3, borderRadius: radius.s, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 26, lineHeight: 32 },
  times: { flexDirection: 'row', gap: space.m },
});
