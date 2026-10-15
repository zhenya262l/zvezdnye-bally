import { StyleSheet, View } from 'react-native';

import { BagIcon } from '@/components/art/Icons';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { t } from '@/strings.ru';
import { brand, space } from '@/theme';

export default function Shop() {
  return (
    <Screen inTabs>
      <T v="title">{t.childTabs.shop}</T>
      <Card accent={brand.coral} title={t.childTabs.shop}>
        <View style={styles.center}>
          <BagIcon color={brand.coral} size={56} />
          <T center>{t.child.shopSoon}</T>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', gap: space.m, paddingVertical: space.l } });
