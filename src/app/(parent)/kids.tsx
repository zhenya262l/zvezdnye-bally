import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/art/Avatar';
import { PhoneIcon, StarIcon } from '@/components/art/Icons';
import { Banner } from '@/components/Banner';
import { BonusModal } from '@/components/BonusModal';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { KidDreams } from '@/components/GoalCards';
import { LoadError, Loading } from '@/components/Loading';
import { PairingCodeModal } from '@/components/PairingCodeModal';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { errorText, type Child } from '@/lib/api';
import { formatAge, formatDayMonth } from '@/lib/dates';
import { useChildDay, useChildren, useMembers } from '@/lib/queries';
import { t } from '@/strings.ru';
import { onColor, space, usePalette } from '@/theme';

function Balance({ childId }: { childId: string }) {
  const p = usePalette();
  const day = useChildDay(childId);
  if (!day.data) return null;
  return (
    <T v="bodyBold" color={p.text} testID={`balance-${childId}`}>
      {`⭐ ${t.kids.balance(day.data.formula.left)}`}
    </T>
  );
}

export default function Kids() {
  const p = usePalette();
  const kids = useChildren();
  const members = useMembers();
  const [pairing, setPairing] = useState<Child | null>(null);
  const [bonus, setBonus] = useState<Child | null>(null);

  if (kids.isPending) return <Loading />;
  if (kids.isError) return <LoadError text={errorText(kids.error)} onRetry={() => kids.refetch()} />;

  const phones = (id: string) => (members.data ?? []).filter((m) => m.child_id === id).length;

  return (
    <Screen inTabs>
      <T v="title">{t.kids.title}</T>
      {members.isError ? <Banner text={errorText(members.error)} /> : null}
      {kids.data.map((c) => (
        <Card key={c.id} title={c.name} accent={c.color}>
          <View style={styles.row}>
            <Avatar id={c.avatar} color={c.color} size={72} />
            <View style={styles.info}>
              <T v="big">{formatAge(c.birth_date)}</T>
              <Balance childId={c.id} />
              <T muted>{t.kids.birthday(formatDayMonth(c.birth_date))}</T>
              {/* Unknown until the list loads: no «не подключён» on a slow network. */}
              {members.isSuccess ? (
                <T
                  v={phones(c.id) > 0 ? 'bodyBold' : 'small'}
                  color={phones(c.id) > 0 ? p.successText : p.textMuted}
                  testID={`phones-${c.id}`}>
                  {t.kids.phones(phones(c.id))}
                </T>
              ) : null}
            </View>
          </View>
          <KidDreams childId={c.id} />
          <Button
            testID={`bonus-${c.id}`}
            title={t.kids.bonus}
            variant="accent"
            icon={<StarIcon color={onColor(p.accent)} filled />}
            onPress={() => setBonus(c)}
          />
          <Button
            title={t.kids.history}
            variant="secondary"
            onPress={() => router.push({ pathname: '/history', params: { child: c.id } })}
          />
          {!members.isSuccess ? null : phones(c.id) === 0 ? (
            <Button
              testID={`connect-${c.id}`}
              title={t.kids.connectPhone(c.name)}
              icon={<PhoneIcon color={p.onPrimary} />}
              onPress={() => setPairing(c)}
            />
          ) : (
            // Already connected: only a quiet option for a new or second phone.
            <Button
              testID={`connect-${c.id}`}
              title={t.kids.connectAnother}
              variant="ghost"
              onPress={() => setPairing(c)}
            />
          )}
          <Button
            title={t.kids.edit}
            variant="ghost"
            onPress={() => router.push({ pathname: '/child-edit', params: { id: c.id } })}
          />
        </Card>
      ))}
      <Button title={t.kids.add} variant="ghost" onPress={() => router.push('/child-edit')} />
      {pairing ? (
        <PairingCodeModal
          key={pairing.id}
          child={pairing}
          onClose={() => {
            setPairing(null);
            void members.refetch();
          }}
        />
      ) : null}
      {bonus ? <BonusModal key={bonus.id} child={bonus} onClose={() => setBonus(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  info: { flex: 1, gap: 2 },
});
