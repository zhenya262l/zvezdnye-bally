import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/art/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { api, auth, errorText, type MemberRow } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { useChildren, useMembers } from '@/lib/queries';
import { useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, space, usePalette } from '@/theme';

type Dialog = { kind: 'unlink'; member: MemberRow; name: string } | { kind: 'signout' } | { kind: 'delete' } | null;

export default function Family() {
  const p = usePalette();
  const qc = useQueryClient();
  const who = useWho();
  const kids = useChildren();
  const members = useMembers();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = who.data?.member;
  const tz = me?.timezone;
  const childName = (id: string | null) => kids.data?.find((c) => c.id === id)?.name ?? '';
  const childOf = (id: string | null) => kids.data?.find((c) => c.id === id);
  const phones = (members.data ?? []).filter((m) => m.role === 'child');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    setDialog(null);
    setError(null);
  };

  return (
    <Screen inTabs>
      <T v="title">{t.family.title}</T>

      <Card title={t.family.you} accent={brand.turquoise}>
        <T v="bodyBold">{me?.display_name}</T>
        <T muted>{who.data?.email}</T>
      </Card>

      <Card title={t.family.phones} accent={brand.coral}>
        {phones.length === 0 ? <T muted>{t.family.noPhones}</T> : null}
        {phones.map((m) => {
          const c = childOf(m.child_id);
          return (
            <View key={m.id} style={[styles.phone, { borderColor: p.border }]}>
              {c ? <Avatar id={c.avatar} color={c.color} size={44} /> : null}
              <View style={styles.flex}>
                <T v="bodyBold">{t.family.phoneOf(childName(m.child_id))}</T>
                <T v="small" muted>
                  {t.family.linkedAt(formatDateTime(m.created_at, tz))}
                </T>
              </View>
              <View style={styles.unlink}>
                <Button
                  title={t.family.unlink}
                  variant="danger"
                  onPress={() => setDialog({ kind: 'unlink', member: m, name: childName(m.child_id) })}
                />
              </View>
            </View>
          );
        })}
      </Card>

      <Card title={t.family.secondParent} accent={brand.violet}>
        <T muted>{t.family.secondParentLater}</T>
      </Card>

      <Button title={t.family.signOut} variant="secondary" onPress={() => setDialog({ kind: 'signout' })} />
      <Button title={t.family.deleteFamily} variant="danger" onPress={() => setDialog({ kind: 'delete' })} />

      <ConfirmModal
        visible={dialog?.kind === 'unlink'}
        title={t.family.unlinkTitle}
        text={dialog?.kind === 'unlink' ? t.family.unlinkText(dialog.name) : ''}
        confirmTitle={t.family.unlink}
        danger
        busy={busy}
        error={error}
        onCancel={close}
        onConfirm={() =>
          dialog?.kind === 'unlink' &&
          run(async () => {
            await api.unlinkDevice(dialog.member.id);
            await members.refetch();
          })
        }
      />
      <ConfirmModal
        visible={dialog?.kind === 'signout'}
        title={t.family.signOutTitle}
        text={t.family.signOutText}
        confirmTitle={t.family.signOut}
        busy={busy}
        error={error}
        onCancel={close}
        onConfirm={() =>
          run(async () => {
            await auth.signOut();
            qc.clear();
            router.replace('/welcome');
          })
        }
      />
      <ConfirmModal
        visible={dialog?.kind === 'delete'}
        title={t.family.deleteTitle}
        text={t.family.deleteText}
        confirmTitle={t.family.deleteConfirm}
        typeToConfirm={t.family.deleteWord}
        danger
        busy={busy}
        error={error}
        onCancel={close}
        onConfirm={() =>
          run(async () => {
            await api.deleteFamily();
            qc.clear();
            router.replace('/');
          })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  phone: { flexDirection: 'row', alignItems: 'center', gap: space.m, borderTopWidth: 1, paddingTop: space.m },
  flex: { flex: 1 },
  unlink: { minWidth: 120 },
});
