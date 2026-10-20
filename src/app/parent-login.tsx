import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { CodeInput } from '@/components/CodeInput';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { auth, errorText } from '@/lib/api';
import { mustInstallFirst } from '@/lib/platform';
import { useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { space } from '@/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_SECONDS = 60;

export default function ParentLogin() {
  const qc = useQueryClient();
  const who = useWho();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  if (mustInstallFirst()) return <Redirect href="/install" />;
  if (who.data?.member?.role === 'parent') return <Redirect href="/" />;

  const normalized = email.trim().toLowerCase();

  async function send() {
    setError(null);
    if (!EMAIL_RE.test(normalized)) {
      setError(t.errors.emailInvalid);
      return;
    }
    setBusy(true);
    try {
      await auth.sendEmailCode(normalized);
      setStep('code');
      setCode('');
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(token: string) {
    if (busy || token.length < 6) return;
    setError(null);
    setBusy(true);
    try {
      await auth.verifyEmailCode(normalized, token);
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
      <T v="title">{step === 'email' ? t.parentLogin.title : t.parentLogin.codeTitle}</T>
      {step === 'email' ? (
        <View style={styles.block}>
          <Field
            testID="login-email"
            label={t.parentLogin.emailLabel}
            placeholder={t.parentLogin.emailPlaceholder}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            inputMode="email"
            autoComplete="email"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={send}
            returnKeyType="send"
            autoFocus
          />
          <Banner text={error} />
          <Button testID="login-send" title={t.parentLogin.sendCode} onPress={send} loading={busy} />
          <Button title={t.common.back} variant="ghost" onPress={() => router.replace('/welcome')} />
        </View>
      ) : (
        <View style={styles.block}>
          <T muted>{t.parentLogin.codeSentTo(normalized)}</T>
          <CodeInput
            testID="login-code"
            accessibilityLabel={t.parentLogin.codeTitle}
            value={code}
            onChange={setCode}
            onComplete={verify}
            autoFocus
          />
          <Banner text={error} />
          <Button
            testID="login-verify"
            title={t.parentLogin.verify}
            onPress={() => verify(code)}
            loading={busy}
            disabled={code.length < 6}
          />
          <Button
            title={cooldown > 0 ? t.parentLogin.resendIn(cooldown) : t.parentLogin.resend}
            variant="secondary"
            disabled={cooldown > 0 || busy}
            onPress={send}
          />
          <Button
            title={t.parentLogin.changeEmail}
            variant="ghost"
            onPress={() => {
              setStep('email');
              setError(null);
            }}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ block: { gap: space.l } });
