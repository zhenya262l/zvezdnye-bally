import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { Island } from '@/components/art/Island';
import { KidsIcon, StarIcon } from '@/components/art/Icons';
import { mustInstallFirst } from '@/lib/platform';
import { useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, space } from '@/theme';

export default function Welcome() {
  const who = useWho();
  if (mustInstallFirst()) return <Redirect href="/install" />;
  // The saved sign-in came back (for example, the internet returned): go on.
  if (who.data?.member) return <Redirect href="/" />;
  return (
    <Screen bg={brand.ocean}>
      <View style={styles.hero}>
        <Island width={300} />
        <T v="hero" color="#FFFFFF" center>
          {t.appName}
        </T>
        <T v="body" color="#CDE7F2" center>
          {t.tagline}
        </T>
      </View>
      <View style={styles.spacer} />
      <T v="h2" color="#FFFFFF" center>
        {t.welcome.title}
      </T>
      <View style={styles.buttons}>
        <Button
          testID="role-child"
          title={t.welcome.child}
          subtitle={t.welcome.childHint}
          variant="accent"
          icon={<StarIcon color="#FFFFFF" filled />}
          onPress={() => router.push('/child-pair')}
        />
        <Button
          testID="role-parent"
          title={t.welcome.parent}
          subtitle={t.welcome.parentHint}
          variant="primary"
          icon={<KidsIcon color="#FFFFFF" />}
          onPress={() => router.push('/parent-login')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.s, marginTop: space.xl },
  spacer: { flex: 1, minHeight: space.l },
  buttons: { gap: space.m },
});
