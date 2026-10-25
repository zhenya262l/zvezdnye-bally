import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { api, errorText } from '@/lib/api';
import { formatPoints, pluralRu } from '@/lib/dates';
import { useBirthday } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Field } from './Field';
import { T } from './T';

/** Child, «Сегодня»: the congratulation on her birthday (and the parent's bonus, if it is on). */
export function BirthdayCard() {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const b = useBirthday();
  const d = b.data;
  const credited = d && d.today ? d.bonus : null;
  // The first call on the day credits the bonus: the formula and the history catch up.
  useEffect(() => {
    if (credited == null) return;
    void qc.invalidateQueries({ queryKey: ['childDay', uid] });
    void qc.invalidateQueries({ queryKey: ['ledger', uid] });
    void qc.invalidateQueries({ queryKey: ['level', uid] });
  }, [credited, qc, uid]);
  if (!d || d.today === false) return null;
  return (
    <View testID="birthday-card">
      <Card title={t.birthday.title(d.name)} accent={brand.sun}>
        <T v="big" testID="birthday-age">
          {t.birthday.age(`${d.age} ${pluralRu(d.age, t.common.yearsForms)}`)}
        </T>
        {d.bonus ? <T testID="birthday-bonus">{t.birthday.bonus(formatPoints(d.bonus))}</T> : null}
      </Card>
    </View>
  );
}

/** Parent, «Настройки»: the birthday bonus, off until the parent sets the points. */
export function BirthdayBonusCard() {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const settings = useQuery({ queryKey: ['birthdaySettings', uid], queryFn: api.birthdaySettings, enabled: !!uid });
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'success' } | null>(null);
  if (!settings.data) return null;
  const bonus = settings.data.bonus;
  const value = draft ?? (bonus != null ? String(bonus) : '');

  async function save(points: number | null) {
    setMsg(null);
    if (points !== null && (!Number.isInteger(points) || points < 1 || points > 500)) {
      return setMsg({ text: t.errors.invalid_birthday_bonus, kind: 'error' });
    }
    setBusy(true);
    try {
      const r = await api.saveBirthdayBonus(points);
      qc.setQueryData(['birthdaySettings', uid], r);
      setDraft(null);
      setMsg({ text: t.birthday.saved, kind: 'success' });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t.birthday.settingsTitle} accent={brand.sun}>
      <T v="small" muted>
        {t.birthday.settingsHint}
      </T>
      <T v="bodyBold" testID="birthday-state">
        {bonus != null ? t.birthday.on(formatPoints(bonus)) : t.birthday.off}
      </T>
      <Field
        testID="birthday-input"
        label={t.birthday.label}
        value={value}
        onChangeText={(x) => setDraft(x.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={3}
      />
      {msg ? <Banner kind={msg.kind} text={msg.text} /> : null}
      <Button
        testID="birthday-save"
        title={t.birthday.save}
        variant="secondary"
        onPress={() => void save(value.trim() ? Number(value.trim()) : NaN)}
        loading={busy}
      />
      {bonus != null ? (
        <Button
          testID="birthday-off"
          title={t.birthday.turnOff}
          variant="ghost"
          onPress={() => void save(null)}
          disabled={busy}
        />
      ) : null}
    </Card>
  );
}
