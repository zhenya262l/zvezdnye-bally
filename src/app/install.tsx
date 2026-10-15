import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { PlusSquareIcon, ShareIcon } from '@/components/art/Icons';
import { Island } from '@/components/art/Island';
import { isIOS, isIOSSafari, isStandalone } from '@/lib/platform';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';

function Step({ n, text, icon }: { n: number; text: string; icon?: React.ReactNode }) {
  const p = usePalette();
  return (
    <View style={styles.step}>
      <View style={[styles.num, { backgroundColor: p.primary }]}>
        <T v="bodyBold" color={p.onPrimary}>
          {n}
        </T>
      </View>
      <T style={styles.stepText}>{text}</T>
      {icon}
    </View>
  );
}

/** Shown in Safari on iPhone until the app is opened from the Home Screen icon. */
export default function Install() {
  const p = usePalette();
  const ios = isIOS();
  return (
    <Screen bg={brand.ocean}>
      <View style={styles.hero}>
        <Island width={280} />
        <T v="hero" color="#FFFFFF" center>
          {t.appName}
        </T>
      </View>
      <Card title={t.install.title} accent={brand.coral}>
        <T>{t.install.lead}</T>
        {ios && !isIOSSafari() ? <Banner text={t.install.notSafari} /> : null}
        {ios ? (
          <>
            <Step n={1} text={t.install.step1} icon={<ShareIcon color={p.primary} />} />
            <Step n={2} text={t.install.step2} icon={<PlusSquareIcon color={p.primary} />} />
            <Step n={3} text={t.install.step3} />
            <Step n={4} text={t.install.step4} />
          </>
        ) : (
          <T>{t.install.androidHint}</T>
        )}
      </Card>
      {!ios || isStandalone() ? (
        <Button title={t.install.continueAnyway} variant="secondary" onPress={() => router.replace('/welcome')} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.s, marginTop: space.l },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  num: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1 },
});
