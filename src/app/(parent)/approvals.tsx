import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { PenIcon } from '@/components/art/Icons';
import { t } from '@/strings.ru';
import { space, usePalette } from '@/theme';

export default function Approvals() {
  const p = usePalette();
  return (
    <Screen inTabs>
      <T v="title">{t.approvals.title}</T>
      <Card>
        <View style={styles.empty}>
          <PenIcon color={p.primary} size={44} />
          <T v="bodyBold" center>
            {t.approvals.empty}
          </T>
          <T muted center>
            {t.approvals.emptyHint}
          </T>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ empty: { alignItems: 'center', gap: space.s, paddingVertical: space.l } });
