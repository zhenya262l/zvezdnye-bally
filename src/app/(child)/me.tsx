import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/art/Avatar';
import { Card } from '@/components/Card';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { errorText } from '@/lib/api';
import { formatAge, formatDayMonth } from '@/lib/dates';
import { useChildren } from '@/lib/queries';
import { t } from '@/strings.ru';
import { space } from '@/theme';

export default function Me() {
  const kids = useChildren();
  if (kids.isPending) return <Loading />;
  if (kids.isError) return <LoadError text={errorText(kids.error)} onRetry={() => kids.refetch()} />;
  const me = kids.data[0];
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
      <Card title={t.childTabs.me} accent={me.color}>
        <T>{t.child.meBirthday(formatDayMonth(me.birth_date))}</T>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ hero: { alignItems: 'center', gap: space.s, marginTop: space.l } });
