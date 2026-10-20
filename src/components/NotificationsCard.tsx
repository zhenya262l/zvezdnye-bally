import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, errorText } from '@/lib/api';
import { usePushState } from '@/lib/pushState';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, space } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { ButtonRow } from './ButtonRow';
import { Card } from './Card';
import { T } from './T';
import { TimeField } from './TimeField';

type Msg = { text: string; kind: 'error' | 'info' | 'success' } | null;

/** «Уведомления»: switch on, test, switch off; for parents also the times. */
export function NotificationsCard({ role }: { role: 'parent' | 'child' }) {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const { view, settings, enable, disable } = usePushState();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  // The answer to «Сохранить время» shows under that button.
  const [timesMsg, setTimesMsg] = useState<Msg>(null);
  // Edited times; until the parent changes something, the saved ones show.
  const [draft, setDraft] = useState<{ summary?: string; from?: string; to?: string }>({});
  const saved = settings.data;
  const times = saved
    ? {
        summary: draft.summary ?? saved.summary_at,
        from: draft.from ?? saved.quiet_from,
        to: draft.to ?? saved.quiet_to,
      }
    : null;
  const setTimes = (v: { summary: string; from: string; to: string }) => setDraft(v);

  async function run(action: () => Promise<unknown>, done?: string, show = setMsg) {
    setBusy(true);
    setMsg(null);
    setTimesMsg(null);
    try {
      await action();
      if (done) show({ text: done, kind: 'success' });
    } catch (e) {
      show({ text: errorText(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    !!times &&
    !!saved &&
    (times.summary !== saved.summary_at || times.from !== saved.quiet_from || times.to !== saved.quiet_to);

  return (
    <Card title={t.push.title} accent={brand.turquoise}>
      <T v="small" muted>
        {role === 'parent' ? t.push.leadParent : t.push.leadChild}
      </T>
      {view === 'unsupported' ? <T testID="push-unsupported">{t.push.unsupported}</T> : null}
      {view === 'denied' ? <T testID="push-denied">{t.push.denied}</T> : null}
      {view === 'off' ? (
        <Button
          testID="push-enable"
          title={t.push.enable}
          variant="accent"
          loading={busy}
          // Straight from the tap: iPhone asks for permission only then.
          onPress={() => void run(enable)}
        />
      ) : null}
      {view === 'on' ? (
        <>
          <T v="bodyBold" testID="push-on">
            {t.push.on}
          </T>
          <ButtonRow>
            <Button
              testID="push-test"
              title={t.push.test}
              variant="secondary"
              disabled={busy}
              onPress={() => void run(api.sendTestPush, t.push.testSent)}
            />
            <Button
              testID="push-disable"
              title={t.push.disable}
              variant="ghost"
              disabled={busy}
              onPress={() => void run(disable)}
            />
          </ButtonRow>
        </>
      ) : null}
      <Banner text={msg?.text} kind={msg?.kind} />

      {role === 'parent' && times ? (
        <View style={styles.times}>
          <T v="bodyBold">{t.push.times}</T>
          <TimeField
            testID="push-summary-at"
            label={t.push.summaryAt}
            value={times.summary}
            onChange={(v) => setTimes({ ...times, summary: v })}
          />
          <View style={styles.row}>
            <View style={styles.flex}>
              <TimeField
                testID="push-quiet-from"
                label={t.push.quietFrom}
                value={times.from}
                onChange={(v) => setTimes({ ...times, from: v })}
              />
            </View>
            <View style={styles.flex}>
              <TimeField
                testID="push-quiet-to"
                label={t.push.quietTo}
                value={times.to}
                onChange={(v) => setTimes({ ...times, to: v })}
              />
            </View>
          </View>
          <T v="small" muted>
            {t.push.timesHint}
          </T>
          <Button
            testID="push-save-times"
            title={t.push.saveTimes}
            variant="secondary"
            disabled={!dirty || busy || !times.summary || !times.from || !times.to}
            onPress={() =>
              void run(
                async () => {
                  await api.savePushSettings(times.summary, times.from, times.to);
                  await qc.invalidateQueries({ queryKey: ['pushSettings', uid] });
                  setDraft({});
                },
                t.push.timesSaved,
                setTimesMsg,
              )
            }
          />
          <Banner text={timesMsg?.text} kind={timesMsg?.kind} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  times: { gap: space.s, marginTop: space.s },
  row: { flexDirection: 'row', gap: space.s },
  flex: { flex: 1 },
});
