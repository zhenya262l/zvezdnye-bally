import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { api, errorText } from '@/lib/api';
import { formatDayMonth } from '@/lib/dates';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';
import { Field } from './Field';
import { pinErrorText } from './PinModal';
import { T } from './T';

const digits = (s: string) => s.replace(/[^0-9]/g, '').slice(0, 4);

/** Parent: the PIN asked before a purchase is signed. */
export function PinCard() {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const pin = useQuery({ queryKey: ['pin', uid], queryFn: api.myPin, enabled: !!uid });
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!pin.data) return null;
  return (
    <Card title={t.shop.pinTitle} accent={brand.ocean}>
      <T v="small" muted testID="pin-state">
        {pin.data.set ? t.shop.pinIsSet : t.shop.pinNotSet}
      </T>
      {saved ? <Banner kind="success" text={t.shop.pinSaved} /> : null}
      <Button
        testID="pin-open"
        title={pin.data.set ? t.shop.pinChange : t.shop.pinSet}
        variant="secondary"
        onPress={() => {
          setSaved(false);
          setOpen(true);
        }}
      />
      {open ? (
        <PinSetup
          needOld={pin.data.set && !pin.data.can_reset}
          onDone={() => {
            setOpen(false);
            setSaved(true);
            void qc.invalidateQueries({ queryKey: ['pin', uid] });
          }}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </Card>
  );
}

function PinSetup({ needOld, onDone, onCancel }: { needOld: boolean; onDone: () => void; onCancel: () => void }) {
  const p = usePalette();
  const [old, setOld] = useState('');
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (pin.length !== 4 || (needOld && old.length !== 4)) return setError(t.errors.pin_format);
    if (pin !== repeat) return setError(t.errors.pin_mismatch);
    setBusy(true);
    try {
      const r = await api.setParentPin(pin, needOld ? old : undefined);
      if (r.ok) onDone();
      else setError(pinErrorText(r.error ?? 'generic'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const field = (testID: string, label: string, value: string, set: (v: string) => void) => (
    <Field
      testID={testID}
      label={label}
      value={value}
      onChangeText={(x) => set(digits(x))}
      secureTextEntry
      keyboardType="number-pad"
      inputMode="numeric"
      autoComplete="off"
      maxLength={4}
    />
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onCancel()} accessible={false}>
        <Pressable style={[styles.sheet, { backgroundColor: p.card }]} onPress={() => {}} accessible={false}>
          <T v="h2">{t.shop.pinTitle}</T>
          {needOld ? field('pin-old', t.shop.pinOld, old, setOld) : null}
          {field('pin-new', t.shop.pinNew, pin, setPin)}
          {field('pin-new-repeat', t.shop.pinRepeat, repeat, setRepeat)}
          {needOld ? (
            <T v="small" muted>
              {t.shop.pinForgot}
            </T>
          ) : null}
          <Banner text={error} />
          <Button testID="pin-save" title={t.shop.pinSave} onPress={save} loading={busy} />
          <Button title={t.common.cancel} variant="ghost" onPress={onCancel} disabled={busy} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Parent: screen minutes per day (cartoons and tablet together). */
export function ScreenLimitCard() {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const settings = useQuery({ queryKey: ['screen', uid], queryFn: api.screenSettings, enabled: !!uid });
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'success' } | null>(null);
  if (!settings.data) return null;
  const s = settings.data;
  const value = draft ?? String(s.next ?? s.today);

  async function save() {
    setMsg(null);
    const n = Number(value.trim());
    if (!value.trim() || !Number.isInteger(n) || n < 0 || n > 600) {
      return setMsg({ text: t.errors.invalid_screen_limit, kind: 'error' });
    }
    setBusy(true);
    try {
      const r = await api.saveScreenLimit(n);
      qc.setQueryData(['screen', uid], r);
      setDraft(null);
      setMsg({ text: t.shop.screenSaved, kind: 'success' });
    } catch (e) {
      setMsg({ text: errorText(e), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t.shop.screenTitle} accent={brand.violet}>
      <T v="small" muted>
        {t.shop.screenHint}
      </T>
      <View style={styles.lines}>
        <T v="bodyBold" testID="screen-today">
          {t.shop.screenToday(s.today)}
        </T>
        {s.next != null && s.from ? (
          <T v="small" testID="screen-next">
            {t.shop.screenFrom(s.next, formatDayMonth(s.from))}
          </T>
        ) : null}
      </View>
      <Field
        testID="screen-limit"
        label={t.shop.screenField}
        value={value}
        onChangeText={(x) => setDraft(x.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={3}
      />
      {msg ? <Banner kind={msg.kind} text={msg.text} /> : null}
      <Button testID="screen-save" title={t.shop.screenSave} variant="secondary" onPress={save} loading={busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  lines: { gap: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 24, 38, 0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    padding: space.l,
    paddingBottom: space.xl,
    gap: space.m,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
});
