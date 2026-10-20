import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { BackLink } from '@/components/BackLink';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { ChildForm } from '@/components/ChildForm';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { api, errorText, type NewChild } from '@/lib/api';
import { isValidBirthDate } from '@/lib/dates';
import { useChildren } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { childColors } from '@/theme';

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/kids'));

/** Add a child (no id) or edit a child's profile. Parents only. */
export default function ChildEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const uid = useSession((s) => s.session?.user.id);
  // A reload or a link opened directly: wait for the saved sign-in.
  const ready = useSession((s) => s.ready);
  const who = useWho();
  const kids = useChildren();

  if (!ready) return <Loading />;
  if (!uid) return <Redirect href="/" />;
  if (who.data && who.data.member?.role !== 'parent') return <Redirect href="/" />;
  if (!id) {
    return <ChildEditForm id={null} initial={{ name: '', birth_date: '', avatar: 'turtle', color: childColors[0] }} />;
  }
  if (kids.isPending) return <Loading />;
  if (kids.isError) return <LoadError text={errorText(kids.error)} onRetry={() => kids.refetch()} />;
  const existing = kids.data.find((c) => c.id === id);
  if (!existing) return <Redirect href="/kids" />;
  return (
    <ChildEditForm
      key={existing.id}
      id={existing.id}
      initial={{ name: existing.name, birth_date: existing.birth_date, avatar: existing.avatar, color: existing.color }}
    />
  );
}

function ChildEditForm({ id, initial }: { id: string | null; initial: NewChild }) {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const [value, setValue] = useState<NewChild>(initial);
  const [errors, setErrors] = useState<{ name?: string | null; birth_date?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const errs = {
      name: value.name.trim() ? null : t.errors.invalid_child_name,
      birth_date: isValidBirthDate(value.birth_date) ? null : t.errors.invalid_birth_date,
    };
    setErrors(errs);
    if (errs.name || errs.birth_date) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveChild({ id, ...value, name: value.name.trim() });
      await qc.invalidateQueries({ queryKey: ['children', uid] });
      goBack();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BackLink fallback="/kids" />
      <T v="title">{id ? t.childEdit.titleEdit : t.childEdit.titleNew}</T>
      <ChildForm value={value} onChange={setValue} errors={errors} testPrefix="edit" />
      <Banner text={error} />
      <Button testID="edit-save" title={t.common.save} onPress={save} loading={busy} />
      <Button title={t.common.cancel} variant="ghost" onPress={goBack} />
    </Screen>
  );
}
