import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BackLink, NotFound } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ConfirmModal } from '@/components/ConfirmModal';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { Toast, type ToastMsg } from '@/components/Toast';
import { api, errorText, type Child, type TaskTemplate } from '@/lib/api';
import { useChildren, useSections, useTasks } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { daysLabel } from '@/lib/tasks';
import { t } from '@/strings.ru';
import { brand, radius, space, TOUCH_MIN, usePalette } from '@/theme';

/** Parent: tasks and points for each child, grouped by diary section. */
export default function Tasks() {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  // A reload or a link opened directly: wait for the saved sign-in.
  const ready = useSession((s) => s.ready);
  const who = useWho();
  const params = useLocalSearchParams<{ child?: string }>();
  const kids = useChildren();
  const sections = useSections();
  const [picked, setPicked] = useState<string | undefined>(params.child);
  const childId = picked ?? kids.data?.[0]?.id;
  const tasks = useTasks(childId);
  const [copyTo, setCopyTo] = useState<Child | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ToastMsg>(null);
  const hideMsg = useCallback(() => setMsg(null), []);

  if (!ready) return <Loading />;
  if (!uid) return <Redirect href="/" />;
  if (who.data && who.data.member?.role !== 'parent') return <Redirect href="/" />;
  if (kids.isPending || sections.isPending) return <Loading />;
  if (kids.isError) return <LoadError text={errorText(kids.error)} onRetry={() => kids.refetch()} />;
  if (sections.isError) return <LoadError text={errorText(sections.error)} onRetry={() => sections.refetch()} />;
  if (!childId) {
    return (
      <Screen>
        <NotFound fallback="/settings" />
      </Screen>
    );
  }

  const child = kids.data?.find((c) => c.id === childId);
  const list = tasks.data ?? [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['tasks', uid] });
    void qc.invalidateQueries({ queryKey: ['childDay', uid] });
  };

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      if (success) setMsg({ text: success, kind: 'success' });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  function move(sectionTasks: TaskTemplate[], index: number, dir: -1 | 1) {
    const ids = sectionTasks.map((x) => x.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    void run(() => api.reorderTasks(ids));
  }

  return (
    <View style={styles.root}>
      <Screen>
        <BackLink fallback="/settings" />
        <T v="title">{t.tasks.title}</T>
        <View style={styles.chips}>
          {(kids.data ?? []).map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              color={c.color}
              selected={c.id === childId}
              onPress={() => setPicked(c.id)}
            />
          ))}
        </View>
        <Button
          testID="task-add"
          title={t.tasks.add}
          onPress={() => router.push({ pathname: '/task-edit', params: { child: childId } })}
        />
        <Card>
          <T v="bodyBold">{t.tasks.checkAll}</T>
          <T v="small" muted>
            {t.tasks.checkAllHint}
          </T>
          <ButtonRow>
            {([true, false] as const).map((on) => (
              <Button
                key={String(on)}
                testID={on ? 'check-all-on' : 'check-all-off'}
                title={on ? t.tasks.checkAllOn : t.tasks.checkAllOff}
                variant="secondary"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    const n = await api.setChildTasksApproval(childId, on);
                    setMsg({ text: t.tasks.checkAllDone(on, n), kind: 'success' });
                  })
                }
              />
            ))}
          </ButtonRow>
        </Card>

        {tasks.isError ? <LoadError text={errorText(tasks.error)} onRetry={() => tasks.refetch()} /> : null}
        {tasks.isPending ? <Loading /> : null}
        {(tasks.isSuccess ? (sections.data ?? []) : []).map((s) => {
          const inSection = list.filter((x) => x.section_id === s.id);
          return (
            <Card key={s.id} title={s.name} accent={s.color}>
              {inSection.length === 0 ? <T muted>—</T> : null}
              {inSection.map((task, i) => (
                <View key={task.id} testID={`row-${task.id}`} style={[styles.row, { borderColor: p.border }]}>
                  <View style={styles.top}>
                    <Pressable
                      testID={`edit-${task.id}`}
                      accessibilityRole="button"
                      style={[styles.main, { opacity: task.enabled ? 1 : 0.55 }]}
                      onPress={() => router.push({ pathname: '/task-edit', params: { id: task.id, child: childId } })}>
                      <T style={styles.icon}>{task.icon}</T>
                      <View style={styles.texts}>
                        <T v="bodyBold">{task.title}</T>
                        <T v="small" muted>
                          {[
                            t.tasks.pointsShort(task.points),
                            daysLabel(task.days),
                            task.window_start && task.window_end
                              ? t.tasks.windowShort(task.window_start, task.window_end)
                              : null,
                            task.enabled ? null : t.tasks.off,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </T>
                      </View>
                    </Pressable>
                    <View style={styles.arrows}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t.tasks.up(task.title)}
                        disabled={i === 0 || busy}
                        onPress={() => move(inSection, i, -1)}
                        style={[styles.arrow, { backgroundColor: p.cardAlt, opacity: i === 0 ? 0.3 : 1 }]}>
                        <T v="bodyBold">↑</T>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t.tasks.down(task.title)}
                        disabled={i === inSection.length - 1 || busy}
                        onPress={() => move(inSection, i, 1)}
                        style={[
                          styles.arrow,
                          { backgroundColor: p.cardAlt, opacity: i === inSection.length - 1 ? 0.3 : 1 },
                        ]}>
                        <T v="bodyBold">↓</T>
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.toggles}>
                    <Chip
                      multi
                      testID={`enabled-${task.id}`}
                      label={task.enabled ? t.tasks.enabledOn : t.tasks.enabledOff}
                      selected={task.enabled}
                      onPress={() => void run(() => api.setTaskEnabled(task.id, !task.enabled))}
                    />
                    <Chip
                      multi
                      testID={`check-${task.id}`}
                      label={task.needs_approval ? t.tasks.checkOn : t.tasks.checkOff}
                      color={brand.violet}
                      selected={task.needs_approval}
                      onPress={() => void run(() => api.setTaskApproval(task.id, !task.needs_approval))}
                    />
                    <Chip
                      multi
                      testID={`photo-${task.id}`}
                      label={task.needs_photo ? t.tasks.photoOn : t.tasks.photoOff}
                      color={brand.violet}
                      selected={task.needs_photo}
                      onPress={() => void run(() => api.setTaskPhoto(task.id, !task.needs_photo))}
                    />
                  </View>
                </View>
              ))}
            </Card>
          );
        })}

        <Button title={t.tasks.sections} variant="secondary" onPress={() => router.push('/sections')} />
        {child
          ? (kids.data ?? [])
              .filter((c) => c.id !== child.id)
              .map((other) => (
                <Button
                  key={other.id}
                  testID={`copy-to-${other.id}`}
                  title={t.tasks.copy(child.name, other.name)}
                  variant="secondary"
                  onPress={() => setCopyTo(other)}
                />
              ))
          : null}
        <Button
          title={t.common.back}
          variant="ghost"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
        />

        <ConfirmModal
          visible={!!copyTo}
          title={t.tasks.copyTitle}
          text={copyTo && child ? t.tasks.copyText(child.name, copyTo.name) : ''}
          confirmTitle={t.common.next}
          busy={busy}
          onCancel={() => setCopyTo(null)}
          onConfirm={() => {
            const to = copyTo;
            setCopyTo(null);
            if (to && child)
              void run(async () => {
                const n = await api.copyTasks(child.id, to.id);
                setMsg({ text: t.tasks.copied(n), kind: 'success' });
              });
          }}
        />
      </Screen>
      <Toast msg={msg} onHide={hideMsg} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  row: { gap: space.s, borderTopWidth: 1, paddingTop: space.s },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: TOUCH_MIN },
  icon: { fontSize: 26, lineHeight: 32, width: 32, textAlign: 'center' },
  texts: { flex: 1, gap: 2 },
  arrows: { flexDirection: 'row', gap: 4 },
  arrow: { width: 44, height: 44, borderRadius: radius.s, alignItems: 'center', justifyContent: 'center' },
  toggles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  flex: { flex: 1 },
});
