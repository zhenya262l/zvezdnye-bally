import { router } from 'expo-router';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { t } from '@/strings.ru';

/** An unknown address: a Russian screen instead of the router's English one. */
export default function NotFoundScreen() {
  return (
    <Screen>
      <T v="title">{t.notFound.title}</T>
      <T muted>{t.notFound.text}</T>
      <Button testID="not-found-home" title={t.notFound.home} onPress={() => router.replace('/')} />
    </Screen>
  );
}
