import { StyleSheet, View } from 'react-native';

import type { LedgerRow } from '@/lib/api';
import { formatDayMonth } from '@/lib/dates';
import { t } from '@/strings.ru';
import { space, usePalette } from '@/theme';
import { T } from './T';
import { TaskPhoto } from './TaskPhoto';

/** History of points: every ledger entry with date, reason and amount. */
type Props = { rows: LedgerRow[]; loading?: boolean; failed?: boolean };

export function LedgerList({ rows, loading, failed }: Props) {
  const p = usePalette();
  if (loading) return <T muted>{t.common.loading}</T>;
  if (failed && rows.length === 0) return <T muted>{t.child.historyError}</T>;
  if (rows.length === 0) {
    return <T muted>{t.history.empty}</T>;
  }
  return (
    <View>
      {rows.map((r) => (
        <View key={r.id} style={[styles.row, { borderColor: p.border }]} testID={`ledger-${r.id}`}>
          <View style={styles.texts}>
            <T v="bodyBold">{r.title}</T>
            <T v="small" muted>
              {`${formatDayMonth(r.for_date)} · ${t.history.kinds[r.kind] ?? r.kind}`}
              {r.comment ? ` · ${r.comment}` : ''}
              {r.completion?.praise ? ` · ${t.history.praise(r.completion.praise)}` : ''}
            </T>
            {r.completion?.has_photo ? <TaskPhoto completionId={r.completion.id} title={r.title} /> : null}
          </View>
          <T v="big" color={r.delta > 0 ? p.successText : p.danger}>
            {r.delta > 0 ? `+${r.delta}` : `−${Math.abs(r.delta)}`}
          </T>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderTopWidth: 1 },
  texts: { flex: 1, gap: 2 },
});
