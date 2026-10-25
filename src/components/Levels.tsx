import { StyleSheet, View } from 'react-native';

import { useChildLevel } from '@/lib/queries';
import { t } from '@/strings.ru';
import { brand, space, usePalette } from '@/theme';
import { Card } from './Card';
import { Progress } from './Dreams';
import { T } from './T';

/** Child, «Я»: her level, the way to the next one and all levels. */
export function LevelCard({ color }: { color: string }) {
  const p = usePalette();
  const lv = useChildLevel();
  if (!lv.data) return null;
  const { earned, level, next, levels } = lv.data;
  return (
    <Card title={t.levels.title} accent={color}>
      <T v="big" testID="level-name">
        {`🏝 ${level.name}`}
      </T>
      <T v="small" muted testID="level-earned">
        {t.levels.earned(earned)}
      </T>
      {next ? (
        <>
          <Progress
            held={earned - level.min_points}
            price={next.min_points - level.min_points}
            color={brand.turquoise}
          />
          <T v="bodyBold" testID="level-next">
            {t.levels.toNext(next.name, next.left)}
          </T>
          {next.bonus > 0 ? (
            <T v="small" muted>
              {t.levels.nextBonus(next.bonus)}
            </T>
          ) : null}
        </>
      ) : (
        <T v="bodyBold" color={p.successText}>
          {t.levels.top}
        </T>
      )}
      <T v="label">{t.levels.all}</T>
      {levels.map((l, i) => (
        <View key={l.idx} style={[styles.row, { borderColor: p.border }]}>
          <T style={styles.mark}>{l.reached ? '✓' : '·'}</T>
          <T v={l.idx === level.idx ? 'bodyBold' : 'body'} style={styles.flex} color={l.reached ? p.text : p.textMuted}>
            {l.name}
          </T>
          <T v="small" muted>
            {[
              t.levels.from(l.min_points),
              t.levels.bonus(l.bonus),
              i === levels.length - 1 && l.bonus > 0 ? t.levels.surprise : '',
            ]
              .filter(Boolean)
              .join(' ')}
          </T>
        </View>
      ))}
    </Card>
  );
}

/** Parent, «Дети»: the level of one child in a line. */
export function KidLevel({ childId }: { childId: string }) {
  const lv = useChildLevel(childId);
  if (!lv.data) return null;
  return (
    <View testID={`kid-level-${childId}`}>
      <T v="bodyBold">{t.levels.kid(lv.data.level.name)}</T>
      {lv.data.next ? (
        <T v="small" muted>
          {t.levels.toNext(lv.data.next.name, lv.data.next.left)}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.xs, borderTopWidth: 1 },
  mark: { width: 20, textAlign: 'center' },
  flex: { flex: 1 },
});
