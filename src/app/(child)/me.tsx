import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/art/Avatar';
import { Card } from '@/components/Card';
import { LedgerList } from '@/components/LedgerList';
import { LevelCard } from '@/components/Levels';
import { LoadError, Loading } from '@/components/Loading';
import { NotificationsCard } from '@/components/NotificationsCard';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { errorText } from '@/lib/api';
import { formatAge, formatDayMonth } from '@/lib/dates';
import { useChildren, useLedger } from '@/lib/queries';
import { t } from '@/strings.ru';
import { brand, space } from '@/theme';

export default function Me() {
  const kids = useChildren();
  const me = kids.data?.[0];
  const ledger = useLedger(me?.id);
  if (kids.isPending) return <Loading />;
  if (kids.isError) return <LoadError text={errorText(kids.error)} onRetry={() => kids.refetch()} />;
  if (!me) return <Loading />;
  return (
    <Screen inTabs>
      <View style={styles.hero}>
        <Avatar id={me.avatar} color={me.color} size={128} />
        <T v="name" center>
          {me.name}
        </T>
        <T v="big" center>
          {t.child.meAge(formatAge(me.birth_date))}
        </T>
      </View>
      <LevelCard color={me.color} />
      <Card title={t.childTabs.me} accent={me.color}>
        <T>{t.child.meBirthday(formatDayMonth(me.birth_date))}</T>
      </Card>
      <NotificationsCard role="child" />
      <Card title={t.child.history} accent={brand.sun}>
        <LedgerList rows={ledger.data ?? []} loading={ledger.isPending} failed={ledger.isError} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ hero: { alignItems: 'center', gap: space.s, marginTop: space.l } });
