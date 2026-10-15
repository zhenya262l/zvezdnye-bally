import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { CodeInput } from '@/components/CodeInput';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { Avatar } from '@/components/art/Avatar';
import { api, auth, errorText, toApiError } from '@/lib/api';
import { rememberPaired, wasPaired } from '@/lib/childDevice';
import { mustInstallFirst } from '@/lib/platform';
import { useWho } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { t } from '@/strings.ru';
import { brand, space } from '@/theme';

export default function ChildPair() {
  const qc = useQueryClient();
  const who = useWho();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (mustInstallFirst()) return <Redirect href="/install" />;
  if (who.data?.member) return <Redirect href="/" />;

  const unlinked = wasPaired() && !error;

  async function tryPair(c: string) {
    await auth.signInChildDevice();
    return api.pairDevice(c);
  }

  async function connect(c: string) {
    if (busy || c.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      try {
        await tryPair(c);
      } catch (e) {
        // A phone that was unlinked keeps a stale session: start a fresh one and retry once.
        const key = toApiError(e).key;
        if (key === 'generic' || key === 'not_authenticated' || key === 'already_paired') {
          await supabase.auth.signOut();
          await tryPair(c);
        } else {
          throw e;
        }
      }
      rememberPaired();
      await qc.invalidateQueries({ queryKey: ['whoami'] });
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.hero}>
        <Avatar id="starfish" color={brand.sun} size={96} />
        <T v="title" center>
          {t.childPair.title}
        </T>
        <T muted center>
          {t.childPair.lead}
        </T>
      </View>
      {unlinked ? <Banner kind="info" text={t.childPair.unlinked} /> : null}
      <CodeInput
        testID="pair-code"
        accessibilityLabel={t.childPair.title}
        value={code}
        onChange={setCode}
        onComplete={connect}
        autoFocus
      />
      <Banner text={error} />
      <Button
        testID="pair-connect"
        title={t.childPair.connect}
        variant="accent"
        onPress={() => connect(code)}
        loading={busy}
        disabled={code.length < 6}
      />
      <Button title={t.common.back} variant="ghost" onPress={() => router.replace('/welcome')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.s, marginTop: space.l },
});
