import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, errorText } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { useFamilyRequests } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, space, usePalette } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { ButtonRow } from './ButtonRow';
import { Card } from './Card';
import { T } from './T';

/** Owner only: requests from new families and the consent text. */
export function FamilyRequestsCard({ tz }: { tz?: string }) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const list = useFamilyRequests(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setError(null);
    try {
      await api.decideFamilyRequest(id, approve);
      await qc.invalidateQueries({ queryKey: ['familyRequests', uid] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const rows = list.data ?? [];
  // Waiting requests are what the owner acts on; decisions fold away.
  const pending = rows.filter((r) => r.status === 'pending');
  const decided = rows.filter((r) => r.status !== 'pending');
  const shown = showDecided ? [...pending, ...decided] : pending;
  return (
    <Card title={t.admin.title} accent={brand.sun}>
      {list.isError ? <Banner text={errorText(list.error)} /> : null}
      {pending.length === 0 && !list.isPending ? <T muted>{t.admin.empty}</T> : null}
      {shown.map((r) => (
        <View key={r.id} testID={`family-request-${r.id}`} style={[styles.row, { borderColor: p.border }]}>
          <T v="bodyBold">{`${r.display_name} · ${r.email}`}</T>
          <T v="small" muted>
            {t.admin.sentAt(formatDateTime(r.created_at, tz))}
          </T>
          <T v="small" muted>
            {t.admin.consentLine(r.consent_version, formatDateTime(r.consent_at, tz))}
          </T>
          {r.status === 'pending' ? (
            <View style={styles.buttons}>
              <ButtonRow>
                <Button
                  testID={`approve-${r.id}`}
                  title={t.admin.approve}
                  onPress={() => decide(r.id, true)}
                  loading={busy === r.id}
                />
                <Button
                  testID={`decline-${r.id}`}
                  title={t.admin.decline}
                  variant="secondary"
                  onPress={() => decide(r.id, false)}
                  disabled={busy === r.id}
                />
              </ButtonRow>
            </View>
          ) : (
            <View style={styles.decided}>
              <T v="small" color={r.status === 'approved' ? p.successText : p.danger} style={styles.flex}>
                {r.status === 'approved'
                  ? t.admin.approved(formatDateTime(r.decided_at ?? r.created_at, tz))
                  : t.admin.declined(formatDateTime(r.decided_at ?? r.created_at, tz))}
              </T>
              {r.status === 'declined' ? (
                <Button
                  title={t.admin.approve}
                  variant="ghost"
                  onPress={() => decide(r.id, true)}
                  loading={busy === r.id}
                />
              ) : null}
            </View>
          )}
        </View>
      ))}
      {decided.length > 0 ? (
        <Button
          testID="requests-decided"
          title={showDecided ? t.admin.hideDecided : t.admin.decidedGroup(decided.length)}
          variant="ghost"
          onPress={() => setShowDecided((v) => !v)}
        />
      ) : null}
      <Banner text={error} />
      <Button
        testID="consent-admin"
        title={t.admin.consentEdit}
        variant="secondary"
        onPress={() => router.push('/consent-admin')}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, borderTopWidth: 1, paddingTop: space.s },
  buttons: { marginTop: space.xs },
  decided: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  flex: { flex: 1 },
});
