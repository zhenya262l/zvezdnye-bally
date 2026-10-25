import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { api, errorText, type Agreement } from '@/lib/api';
import { dateISO, formatDate } from '@/lib/dates';
import { useAgreement } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, space, usePalette } from '@/theme';

/**
 * «Наш семейный договор»: the rules, who signed, the changes. Shown first to
 * everyone who has not signed the newest version; also opened from «Настройки»
 * (parent) and «Я» (child). A parent can change the rules here.
 */
export default function AgreementScreen() {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const who = useWho();
  const agreement = useAgreement();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  if (!uid) return <Redirect href="/" />;
  if (who.isPending || agreement.isPending) return <Loading />;
  if (who.isError) return <LoadError text={errorText(who.error)} onRetry={() => who.refetch()} />;
  if (agreement.isError) return <LoadError text={errorText(agreement.error)} onRetry={() => agreement.refetch()} />;
  const member = who.data.member;
  if (!member) return <Redirect href="/" />;

  const a = agreement.data;
  const required = who.data.needs_agreement === true;
  const parent = member.role === 'parent';
  const tz = member.timezone;
  const date = (ts: string) => formatDate(dateISO(ts, tz));

  async function sign() {
    setBusy(true);
    setError(null);
    try {
      await api.signAgreement(a.version);
      await qc.invalidateQueries({ queryKey: ['agreement', uid] }).catch(() => undefined);
      await qc.invalidateQueries({ queryKey: ['whoami'] }).catch(() => undefined);
      if (required) router.replace('/');
    } catch (e) {
      setError(errorText(e));
      void qc.invalidateQueries({ queryKey: ['agreement', uid] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      {required ? null : <BackLink fallback="/" />}
      <T v="title">{t.agreement.title}</T>
      {required ? (
        <T muted testID="agreement-must">
          {parent ? t.agreement.mustSignParent : t.agreement.mustSignChild}
        </T>
      ) : null}
      <Card accent={brand.leaf}>
        <View testID="agreement-rules" style={styles.rules}>
          {a.rules.map((rule, i) => (
            <View key={i} style={styles.rule}>
              <T v="bodyBold" color={brand.leaf} style={styles.num}>{`${i + 1}.`}</T>
              <T style={styles.flex} testID={`agreement-rule-text-${i}`}>
                {rule}
              </T>
            </View>
          ))}
        </View>
      </Card>

      <Banner text={error} />
      {a.my_signed_at ? (
        <T v="bodyBold" color={p.successText} testID="agreement-signed">
          {(parent ? t.agreement.signedAtParent : t.agreement.signedAt)(date(a.my_signed_at))}
        </T>
      ) : (
        <Button testID="agreement-sign" title={t.agreement.sign} onPress={() => void sign()} loading={busy} />
      )}

      <Card title={t.agreement.signatures} accent={brand.turquoise}>
        {a.signatures.length === 0 ? (
          <T muted>{t.agreement.nobody}</T>
        ) : (
          a.signatures.map((s, i) => (
            <T key={i} testID={`agreement-signature-${i}`}>{`✓ ${s.name} · ${date(s.signed_at)}`}</T>
          ))
        )}
        <T v="small" muted testID="agreement-waiting">
          {a.waiting.length === 0 ? t.agreement.allSigned : t.agreement.waiting(a.waiting.join(', '))}
        </T>
      </Card>

      <Card title={t.agreement.changes} accent={brand.sun}>
        {a.changes.length === 0 ? (
          <T muted testID="agreement-no-changes">
            {t.agreement.noChanges}
          </T>
        ) : (
          a.changes.map((c) => (
            <T key={c.version} testID={`agreement-change-${c.version}`}>
              {t.agreement.changeLine(date(c.created_at), c.note ?? '', c.by_name)}
            </T>
          ))
        )}
      </Card>

      {a.can_edit ? (
        editing ? (
          <Editor
            agreement={a}
            onCancel={() => setEditing(false)}
            onSaved={(next) => {
              qc.setQueryData(['agreement', uid], next);
              void qc.invalidateQueries({ queryKey: ['whoami'] });
              setEditing(false);
              setInfo(t.agreement.saved);
            }}
          />
        ) : (
          <>
            <Banner kind="success" text={info} />
            <T v="small" muted>
              {t.agreement.editHint}
            </T>
            <Button testID="agreement-edit" title={t.agreement.edit} variant="secondary" onPress={() => setEditing(true)} />
          </>
        )
      ) : null}
    </Screen>
  );
}

/** A parent changes the rules and writes down what changed. Everyone signs again. */
function Editor({
  agreement,
  onCancel,
  onSaved,
}: {
  agreement: Agreement;
  onCancel: () => void;
  onSaved: (a: Agreement) => void;
}) {
  const [rules, setRules] = useState<string[]>(agreement.rules);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const clean = rules.map((r) => r.trim()).filter(Boolean);
    if (clean.length === 0 || !note.trim()) return setError(t.agreement.errorEmpty);
    setBusy(true);
    try {
      onSaved(await api.saveAgreement(clean, note.trim()));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t.agreement.edit} accent={brand.violet}>
      <T v="small" muted>
        {t.agreement.editHint}
      </T>
      {rules.map((rule, i) => (
        <View key={i} style={styles.editRow}>
          <Field
            testID={`agreement-rule-${i}`}
            label={t.agreement.rule(i + 1)}
            value={rule}
            onChangeText={(x) => setRules(rules.map((r, j) => (j === i ? x : r)))}
            multiline
            maxLength={200}
          />
          {rules.length > 1 ? (
            <Button
              testID={`agreement-rule-remove-${i}`}
              title={t.agreement.removeRule}
              variant="ghost"
              onPress={() => setRules(rules.filter((_, j) => j !== i))}
            />
          ) : null}
        </View>
      ))}
      {rules.length < 10 ? (
        <Button
          testID="agreement-rule-add"
          title={t.agreement.addRule}
          variant="secondary"
          onPress={() => setRules([...rules, ''])}
        />
      ) : null}
      <Field
        testID="agreement-note"
        label={t.agreement.noteLabel}
        value={note}
        onChangeText={setNote}
        maxLength={200}
      />
      <Banner text={error} />
      <Button testID="agreement-save" title={t.agreement.save} onPress={() => void save()} loading={busy} />
      <Button title={t.agreement.cancel} variant="ghost" onPress={onCancel} disabled={busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  rules: { gap: space.m },
  rule: { flexDirection: 'row', gap: space.s },
  num: { minWidth: 24 },
  flex: { flex: 1 },
  editRow: { gap: space.xs },
});
