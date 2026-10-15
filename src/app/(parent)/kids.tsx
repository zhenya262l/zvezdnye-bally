import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/art/Avatar';
import { PhoneIcon } from '@/components/art/Icons';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { LoadError, Loading } from '@/components/Loading';
import { PairingCodeModal } from '@/components/PairingCodeModal';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { errorText, type Child } from '@/lib/api';
import { formatAge, formatDayMonth } from '@/lib/dates';
import { useChildren, useMembers } from '@/lib/queries';
import { t } from '@/strings.ru';
import { space } from '@/theme';

export default function Kids() {
  const kids = useChildren();
  const members = useMembers();
  const [pairing, setPairing] = useState<Child | null>(null);

  if (kids.isPending) return <Loading />;
  if (kids.isError) return <LoadError text={errorText(kids.error)} onRetry={() => kids.refetch()} />;

  const phones = (id: string) => (members.data ?? []).filter((m) => m.child_id === id).length;

  return (
    <Screen inTabs>
      <T v="title">{t.kids.title}</T>
      {kids.data.map((c) => (
        <Card key={c.id} title={c.name} accent={c.color}>
          <View style={styles.row}>
            <Avatar id={c.avatar} color={c.color} size={72} />
            <View style={styles.info}>
              <T v="big">{formatAge(c.birth_date)}</T>
              <T muted>{t.kids.birthday(formatDayMonth(c.birth_date))}</T>
              <T v="small" muted>
                {t.kids.phones(phones(c.id))}
              </T>
            </View>
          </View>
          <Button
            testID={`connect-${c.id}`}
            title={t.kids.connectPhone(c.name)}
            icon={<PhoneIcon color="#FFFFFF" />}
            onPress={() => setPairing(c)}
          />
          <Button
            title={t.kids.edit}
            variant="secondary"
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  info: { flex: 1, gap: 2 },
});
