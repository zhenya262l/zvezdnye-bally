import { useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { Stepper } from '@/components/Stepper';
import { T } from '@/components/T';
import { api, errorText, type Level, type Mark, type MotivationSettings } from '@/lib/api';
import { useMotivationSettings } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, space, usePalette } from '@/theme';

const MARKS: Mark[] = ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1', 'praise'];
const num = (s: string) => s.replace(/[^0-9]/g, '').slice(0, 6);

/** Parent: level thresholds and bonuses, points for grades. */
export default function Motivation() {
  const uid = useSession((s) => s.session?.user.id);
  const who = useWho();
  const settings = useMotivationSettings();
  if (!uid) return <Redirect href="/" />;
  if (who.data && who.data.member?.role !== 'parent') return <Redirect href="/" />;
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <LoadError text={errorText(settings.error)} onRetry={() => settings.refetch()} />;
  return (
    <Screen>
      <BackLink fallback="/settings" />
      <T v="title">{t.levels.settings}</T>
      <LevelsEditor data={settings.data} />
      <GradesEditor data={settings.data} />
    </Screen>
  );
}

function LevelsEditor({ data }: { data: MotivationSettings }) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const [rows, setRows] = useState(() =>
    data.levels.filter((l) => l.idx > 1).map((l) => ({ ...l, min: String(l.min_points), b: String(l.bonus) })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'success' } | null>(null);
  const first = data.levels.find((l) => l.idx === 1) as Level | undefined;

  async function save() {
    setMsg(null);
    const levels = rows.map((r) => ({ idx: r.idx, min_points: Number(r.min), bonus: Number(r.b) }));
    if (levels.some((l, i) => !(l.min_points >= 1) || l.min_points <= (i > 0 ? levels[i - 1].min_points : 0))) {
      return setMsg({ text: t.errors.invalid_levels, kind: 'error' });
    }
    setBusy(true);
    try {
      const r = await api.saveLevels(levels);
      qc.setQueryData(['motivation', uid], r);
      void qc.invalidateQueries({ queryKey: ['level', uid] });
      setMsg({ text: t.levels.saved, kind: 'success' });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t.levels.levelsCard} accent={brand.turquoise}>
      <T v="small" muted>
        {t.levels.levelsHint}
      </T>
      {first ? (
        <View style={[styles.level, { borderColor: p.border }]}>
          <T v="bodyBold">{first.name}</T>
          <T v="small" muted>
            {t.levels.from(0)}
          </T>
        </View>
      ) : null}
      {rows.map((r, i) => (
        <View key={r.idx} style={[styles.level, { borderColor: p.border }]}>
          <T v="bodyBold">{r.name}</T>
          <View style={styles.pair}>
            <View style={styles.flex}>
              <Field
                testID={`level-min-${r.idx}`}
                label={t.levels.minField}
                value={r.min}
                onChangeText={(x) => setRows((all) => all.map((y, j) => (j === i ? { ...y, min: num(x) } : y)))}
                keyboardType="number-pad"
                inputMode="numeric"
              />
            </View>
            <View style={styles.flex}>
              <Field
                testID={`level-bonus-${r.idx}`}
                label={t.levels.bonusField}
                value={r.b}
                onChangeText={(x) => setRows((all) => all.map((y, j) => (j === i ? { ...y, b: num(x) } : y)))}
                keyboardType="number-pad"
                inputMode="numeric"
              />
            </View>
          </View>
        </View>
      ))}
      {msg ? <Banner kind={msg.kind} text={msg.text} /> : null}
      <Button testID="levels-save" title={t.levels.save} variant="secondary" onPress={save} loading={busy} />
    </Card>
  );
}

function GradesEditor({ data }: { data: MotivationSettings }) {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const [points, setPoints] = useState<Record<Mark, number>>(() => ({ ...data.grades }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'success' } | null>(null);

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      const r = await api.saveGradeScale(points);
      qc.setQueryData(['motivation', uid], r);
      setMsg({ text: t.levels.gradesSaved, kind: 'success' });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t.levels.gradesCard} accent={brand.ocean}>
      <T v="small" muted>
        {t.levels.gradesHint}
      </T>
      {MARKS.map((m) => (
        <View key={m} style={styles.grade}>
          <T v="bodyBold" style={styles.flex}>
            {m === 'praise' ? t.grades.praise : m}
          </T>
          <Stepper
            testID={`grade-points-${m}`}
            value={points[m] ?? 0}
            min={0}
            max={50}
            onChange={(v) => setPoints((all) => ({ ...all, [m]: v }))}
          />
        </View>
      ))}
      {msg ? <Banner kind={msg.kind} text={msg.text} /> : null}
      <Button testID="grades-save" title={t.levels.gradesSave} variant="secondary" onPress={save} loading={busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  level: { gap: space.s, paddingTop: space.s, borderTopWidth: 1 },
  pair: { flexDirection: 'row', gap: space.m },
  flex: { flex: 1 },
  grade: { flexDirection: 'row', alignItems: 'center', gap: space.m },
});
