import { StyleSheet, View } from 'react-native';

import { Island } from '@/components/art/Island';
import { Card } from '@/components/Card';
import { Formula } from '@/components/Formula';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { formatDayMonth, todayISO } from '@/lib/dates';
import { useChildren } from '@/lib/queries';
import { t } from '@/strings.ru';
import { brand, radius, space } from '@/theme';

export default function Today() {
  const kids = useChildren();
  const me = kids.data?.[0];
  return (
    <Screen inTabs>
      <T v="title">{me ? t.childPair.hello(me.name) : t.childTabs.today}</T>
      <T muted>{formatDayMonth(todayISO())}</T>
      <Formula was={0} earned={0} spent={0} />
      <Card title={t.childTabs.today} accent={brand.sun}>
        <View style={[styles.scene, { backgroundColor: brand.ocean }]}>
          <Island width={260} />
        </View>
        <T center>{t.child.todaySoon}</T>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scene: { borderRadius: radius.m, alignItems: 'center', paddingTop: space.m, overflow: 'hidden' },
});
