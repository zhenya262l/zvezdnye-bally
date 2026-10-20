import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { api, errorText, type Child } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { radius, space, usePalette } from '@/theme';
import { Avatar } from './art/Avatar';
import { Banner } from './Banner';
import { Button } from './Button';
import { Field } from './Field';
import { Stepper } from './Stepper';
import { T } from './T';

/** Parent gives a surprise bonus: amount 1–50 (3 by default) and a comment. */
export function BonusModal({ child, onClose }: { child: Child; onClose: () => void }) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const [points, setPoints] = useState<number>(t.bonus.defaultPoints);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function give() {
    setBusy(true);
    setError(null);
    try {
      await api.giveBonus(child.id, points, comment);
      setDone(points);
      void qc.invalidateQueries({ queryKey: ['childDay', uid] });
      void qc.invalidateQueries({ queryKey: ['ledger', uid] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
        <Pressable style={[styles.sheet, { backgroundColor: p.card }]} onPress={() => {}} accessible={false}>
          <View style={styles.head}>
            <Avatar id={child.avatar} color={child.color} size={48} />
            <T v="h2" style={styles.flex}>
              {t.bonus.title(child.name)}
            </T>
          </View>
          {done !== null ? (
            <Banner kind="success" text={t.bonus.done(done)} />
          ) : (
            <>
              <Stepper testID="bonus-points" label={t.bonus.points} value={points} onChange={setPoints} />
              <Field
                testID="bonus-comment"
                label={t.bonus.comment}
                placeholder={t.bonus.commentPlaceholder}
                value={comment}
                onChangeText={setComment}
                maxLength={120}
              />
              <Banner text={error} />
              <Button testID="bonus-give" title={t.bonus.give(points)} variant="accent" onPress={give} loading={busy} />
            </>
          )}
          <Button title={done !== null ? t.common.done : t.common.cancel} variant="ghost" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 24, 38, 0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    padding: space.xl,
    paddingBottom: space.xxl + 12,
    gap: space.m,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  flex: { flex: 1 },
});
