import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChildForm } from '@/components/ChildForm';
import { Field } from '@/components/Field';
import { Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { api, errorText, type NewChild } from '@/lib/api';
import { isValidBirthDate } from '@/lib/dates';
import { useFamilyAccess } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, childColors, radius, space, usePalette } from '@/theme';

// How many empty child forms to show at first. The family in SPEC has twins.
const INITIAL_CHILD_FORMS = 2;
const AVATAR_CYCLE = ['turtle', 'dolphin', 'octopus', 'starfish', 'crab', 'whale'];
const MAX_CHILDREN = 6;

const blankChild = (i: number): NewChild => ({
  name: '',
  birth_date: '',
  avatar: AVATAR_CYCLE[i % AVATAR_CYCLE.length],
  color: childColors[i % childColors.length],
});

type Errors = { name?: string | null; birth_date?: string | null };

export default function FamilySetup() {
  const p = usePalette();
  const qc = useQueryClient();
  const session = useSession((s) => s.session);
  const who = useWho();
  const access = useFamilyAccess();
  const [role, setRole] = useState<'mom' | 'dad' | 'other'>('mom');
  const [otherName, setOtherName] = useState('');
  const [kids, setKids] = useState<NewChild[]>(() =>
    Array.from({ length: INITIAL_CHILD_FORMS }, (_, i) => blankChild(i)),
  );
  const [errors, setErrors] = useState<Errors[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) return <Redirect href="/" />;
  if (who.isPending || access.isPending) return <Loading />;
  if (who.data?.member || who.data?.is_anonymous) return <Redirect href="/" />;
  // A new family needs the owner's approval first (the owner does not).
  if (!access.data?.is_admin && access.data?.status !== 'approved') return <Redirect href="/family-request" />;

  const displayName = role === 'mom' ? t.setup.mom : role === 'dad' ? t.setup.dad : otherName.trim();

  async function create() {
    setError(null);
    const errs: Errors[] = kids.map((k) => ({
      name: k.name.trim() ? null : t.errors.invalid_child_name,
      birth_date: isValidBirthDate(k.birth_date) ? null : t.errors.invalid_birth_date,
    }));
    setErrors(errs);
    if (!displayName) {
      setError(t.errors.invalid_display_name);
      return;
    }
    if (errs.some((e) => e.name || e.birth_date)) return;
    setBusy(true);
    try {
      await api.createFamily(
        displayName,
        kids.map((k) => ({ ...k, name: k.name.trim() })),
      );
      await qc.invalidateQueries({ queryKey: ['whoami'] });
      router.replace('/');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const chip = (key: 'mom' | 'dad' | 'other', label: string) => {
    const selected = role === key;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        aria-checked={selected}
        onPress={() => setRole(key)}
        style={[
          styles.chip,
          { borderColor: selected ? p.primary : p.border, backgroundColor: selected ? p.primary : p.card },
        ]}>
        <T v="bodyBold" color={selected ? p.onPrimary : p.text}>
          {label}
        </T>
      </Pressable>
    );
  };

  return (
    <Screen>
      <T v="title">{t.setup.title}</T>
      <Button
        testID="have-invite"
        title={t.setup.haveInvite}
        subtitle={t.setup.haveInviteHint}
        variant="secondary"
        onPress={() => router.push('/join-family')}
      />
      <T muted>{t.setup.lead}</T>

      <Card title={t.setup.youAre} accent={brand.turquoise}>
        <View style={styles.chips}>
          {chip('mom', t.setup.mom)}
          {chip('dad', t.setup.dad)}
          {chip('other', t.setup.other)}
        </View>
        {role === 'other' ? (
          <Field
            value={otherName}
            onChangeText={setOtherName}
            placeholder={t.setup.otherPlaceholder}
            maxLength={30}
          />
        ) : null}
      </Card>

      {kids.map((k, i) => (
        <Card key={i} title={t.setup.child(i + 1)} accent={k.color}>
          <ChildForm
            testPrefix={`child${i}`}
            value={k}
            errors={errors[i]}
            onChange={(v) => setKids((all) => all.map((x, j) => (j === i ? v : x)))}
          />
          {kids.length > 1 ? (
            <Button
              title={t.setup.removeChild}
              variant="ghost"
              onPress={() => {
                setKids((all) => all.filter((_, j) => j !== i));
                setErrors((all) => all.filter((_, j) => j !== i));
              }}
            />
          ) : null}
        </Card>
      ))}

      {kids.length < MAX_CHILDREN ? (
        <Button
          title={t.setup.addChild}
          variant="secondary"
          onPress={() => setKids((all) => [...all, blankChild(all.length)])}
        />
      ) : null}

      <Banner text={error} />
      <Button testID="setup-create" title={t.setup.create} variant="accent" onPress={create} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  chip: {
    minHeight: 48,
    paddingHorizontal: space.l,
    borderRadius: radius.pill,
    borderWidth: 2,
    justifyContent: 'center',
  },
});
