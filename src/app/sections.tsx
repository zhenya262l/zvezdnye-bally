import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { api, errorText, type Section } from '@/lib/api';
import { useSections } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { childColors, radius, space, usePalette } from '@/theme';

/** Parent: rename sections, change their colour, add new ones. */
export default function Sections() {
  const uid = useSession((s) => s.session?.user.id);
  const who = useWho();
  const sections = useSections();
  if (!uid) return <Redirect href="/" />;
  if (who.data && who.data.member?.role !== 'parent') return <Redirect href="/" />;
  if (sections.isPending) return <Loading />;
  return (
    <Screen>
      <BackLink fallback="/tasks" />
      <T v="title">{t.sections.title}</T>
      {(sections.data ?? []).map((s) => (
        <SectionEditor key={s.id} section={s} />
      ))}
      <SectionEditor key={`new-${sections.data?.length ?? 0}`} section={null} />
      <Button title={t.common.back} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/tasks'))} />
    </Screen>
  );
}

function SectionEditor({ section }: { section: Section | null }) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const [name, setName] = useState(section?.name ?? '');
  const [color, setColor] = useState(section?.color ?? childColors[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'success' } | null>(null);
  const dirty = !section || name.trim() !== section.name || color.toLowerCase() !== section.color.toLowerCase();

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.saveSection(section?.id ?? null, name, color);
      setMsg({ text: t.common.done, kind: 'success' });
      void qc.invalidateQueries({ queryKey: ['sections', uid] });
      void qc.invalidateQueries({ queryKey: ['childDay', uid] });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={section ? section.name : t.sections.add} accent={color}>
      <Field value={name} onChangeText={setName} placeholder={t.sections.namePlaceholder} maxLength={40} />
      <View style={styles.colors}>
        {childColors.map((c) => {
          const selected = color.toLowerCase() === c.toLowerCase();
          return (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={c}
              onPress={() => setColor(c)}
              style={[styles.swatchOuter, { borderColor: selected ? p.text : 'transparent' }]}>
              <View style={[styles.swatch, { backgroundColor: c }]} />
            </Pressable>
          );
        })}
      </View>
      <Banner text={msg?.text} kind={msg?.kind} />
      <Button
        title={section ? t.common.save : t.sections.add}
        variant={section ? 'secondary' : 'primary'}
        onPress={save}
        loading={busy}
        disabled={!dirty || !name.trim()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  swatchOuter: { borderWidth: 3, borderRadius: radius.pill, padding: 3 },
  swatch: { width: 34, height: 34, borderRadius: radius.pill },
});
