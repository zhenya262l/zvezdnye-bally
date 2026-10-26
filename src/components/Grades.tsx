import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { api, errorText, type GradeItem, type Mark } from '@/lib/api';
import { formatTime } from '@/lib/dates';
import { useChildGrades } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { Avatar } from './art/Avatar';
import { Banner } from './Banner';
import { Button } from './Button';
import { ButtonRow } from './ButtonRow';
import { Card } from './Card';
import { Chip } from './Chip';
import { Field } from './Field';
import { T } from './T';

const MARKS: Mark[] = ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'];

/** Child, «Сегодня»: her grades today and «Получила оценку». */
export function GradesCard() {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const grades = useChildGrades();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  if (!grades.data) return null;
  const g = grades.data;
  return (
    <Card title={t.grades.title} accent={brand.ocean}>
      {g.grades.map((x) => (
        <View key={x.id} style={[styles.row, { borderColor: p.border }]} testID={`my-grade-${x.id}`}>
          <T style={styles.icon}>📝</T>
          <T v="bodyBold" style={styles.flex}>
            {t.grades.caption(x.mark, x.subject)}
          </T>
          <T
            v="label"
            color={x.status === 'approved' ? p.successText : x.status === 'pending' ? brand.ocean : p.textMuted}>
            {x.status === 'approved'
              ? t.grades.approved(x.points)
              : x.status === 'pending'
                ? t.grades.pending
                : t.grades.rejected}
          </T>
        </View>
      ))}
      {sent ? <Banner kind="success" text={t.grades.sent} /> : null}
      <Button
        testID="grade-add"
        title={t.grades.add}
        variant="secondary"
        onPress={() => {
          setSent(false);
          setOpen(true);
        }}
      />
      {open ? (
        <GradeSheet
          scale={g.scale}
          subjects={g.subjects}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            setSent(true);
            void qc.invalidateQueries({ queryKey: ['grades', uid] });
          }}
        />
      ) : null}
    </Card>
  );
}

function GradeSheet({
  scale,
  subjects,
  onCancel,
  onDone,
}: {
  scale: Record<Mark, number>;
  subjects: string[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const p = usePalette();
  const [mark, setMark] = useState<Mark | null>(null);
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = !!mark && subject.trim().length > 0;

  async function send() {
    if (!mark) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitGrade(mark, subject.trim());
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onCancel()} accessible={false}>
        <Pressable
          testID="grade-sheet"
          style={[styles.sheet, { backgroundColor: p.card }]}
          onPress={() => {}}
          accessible={false}>
          <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
            <T v="h2">{t.grades.sheetTitle}</T>
            <View style={styles.chips}>
              {MARKS.map((m) => (
                <Chip
                  key={m}
                  testID={`grade-mark-${m}`}
                  label={(scale[m] ?? 0) > 0 ? `${m}  +${scale[m]}` : m}
                  selected={mark === m}
                  onPress={() => setMark(m)}
                />
              ))}
            </View>
            <Chip
              testID="grade-mark-praise"
              label={`${t.grades.praise}  ${t.grades.points(scale.praise ?? 0)}`}
              selected={mark === 'praise'}
              onPress={() => setMark('praise')}
            />
            <Field
              testID="grade-subject"
              label={t.grades.subject}
              placeholder={t.grades.subjectPlaceholder}
              value={subject}
              onChangeText={setSubject}
              maxLength={40}
            />
            {subjects.length > 0 ? (
              <>
                <T v="label">{t.grades.recent}</T>
                <View style={styles.chips}>
                  {subjects.map((s) => (
                    <Chip key={s} label={s} selected={subject.trim() === s} onPress={() => setSubject(s)} />
                  ))}
                </View>
              </>
            ) : null}
            <Banner text={error} />
            <Button
              testID="grade-send"
              title={t.grades.send}
              variant="accent"
              onPress={() => void send()}
              disabled={!ok}
              loading={busy}
            />
            <Button title={t.common.cancel} variant="ghost" onPress={onCancel} disabled={busy} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Parent, «Подписи»: one grade to sign. */
export function GradeCard({
  item,
  tz,
  highlighted,
  busy,
  onDecide,
}: {
  item: GradeItem;
  tz?: string;
  highlighted?: boolean;
  busy?: boolean;
  onDecide?: (approve: boolean) => void;
}) {
  const p = usePalette();
  const rejected = item.status === 'rejected';
  const name = item.decided_by_name || t.common.formerParent;
  const decided =
    item.status === 'approved' && item.decided_at
      ? t.grades.signedBy(name, formatTime(item.decided_at, tz))
      : rejected && item.decided_at
        ? t.grades.rejectedBy(name, formatTime(item.decided_at, tz))
        : null;
  return (
    <View
      testID={`grade-${item.id}`}
      style={[
        styles.card,
        {
          backgroundColor: p.card,
          borderColor: highlighted ? brand.coral : rejected ? p.danger : item.child_color,
          borderWidth: highlighted || rejected ? 3 : 2,
          opacity: item.status === 'approved' ? 0.85 : 1,
        },
      ]}>
      <View style={styles.top}>
        <Avatar id={item.child_avatar} color={item.child_color} size={44} />
        <View style={styles.flex}>
          <T v="bodyBold">{`📝 ${t.grades.caption(item.mark, item.subject)}`}</T>
          <T v="small" muted>
            {`${item.child_name} · ${formatTime(item.created_at, tz)}`}
          </T>
        </View>
        <View style={[styles.points, { backgroundColor: rejected ? p.cardAlt : brand.sun }]}>
          <T v="bodyBold" color={rejected ? p.textMuted : brand.ocean}>
            {t.grades.points(item.points)}
          </T>
        </View>
      </View>
      {item.status === 'pending' && onDecide ? (
        <ButtonRow>
          <Button
            testID={`grade-sign-${item.id}`}
            title={t.grades.sign}
            onPress={() => onDecide(true)}
            loading={busy}
          />
          <Button
            testID={`grade-reject-${item.id}`}
            title={t.grades.reject}
            variant="secondary"
            onPress={() => onDecide(false)}
            disabled={busy}
          />
        </ButtonRow>
      ) : decided ? (
        <T v={rejected ? 'label' : 'small'} color={rejected ? p.danger : p.successText}>
          {decided}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderTopWidth: 1 },
  icon: { fontSize: 24, lineHeight: 32, width: 32, textAlign: 'center' },
  flex: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 24, 38, 0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    width: '100%',
    maxWidth: 560,
    maxHeight: '92%',
    alignSelf: 'center',
  },
  inner: { padding: space.l, paddingBottom: space.xl, gap: space.m },
  card: { borderRadius: radius.m, padding: space.m, gap: space.s },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  points: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 2 },
});
