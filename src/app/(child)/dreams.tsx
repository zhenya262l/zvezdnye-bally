import { StyleSheet, View } from 'react-native';

import { ChestIcon } from '@/components/art/Icons';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { t } from '@/strings.ru';
import { brand, space } from '@/theme';

export default function Dreams() {
  return (
    <Screen inTabs>
      <T v="title">{t.childTabs.dreams}</T>
      <Card accent={brand.violet} title={t.childTabs.dreams}>
        <View style={styles.center}>
          <ChestIcon color={brand.violet} size={56} />
          <T center>{t.child.dreamsSoon}</T>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', gap: space.m, paddingVertical: space.l } });
