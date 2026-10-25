import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { api, errorText } from '@/lib/api';
import { parentVerifier, type CreateOptions } from '@/platform/biometric';
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
  const faceSupported = useQuery({
    queryKey: ['faceSupported'],
    queryFn: parentVerifier.isPasskeySupported,
    staleTime: Infinity,
  });
  const [open, setOpen] = useState(false);
  const [faceOpen, setFaceOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!pin.data) return null;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['pin', uid] });

  async function faceOff() {
    setError(null);
    try {
      await api.deletePasskeys();
      setSaved(t.shop.faceRemoved);
    } catch (e) {
      setError(errorText(e));
    } finally {
      refresh();
    }
  }
  return (
    <Card title={t.shop.pinTitle} accent={brand.ocean}>
      <T v="small" muted testID="pin-state">
        {pin.data.set ? t.shop.pinIsSet : t.shop.pinNotSet}
      </T>
      {saved ? <Banner kind="success" text={saved} /> : null}
      <Banner text={error} />
      <Button
        testID="pin-open"
        title={pin.data.set ? t.shop.pinChange : t.shop.pinSet}
        variant="secondary"
        onPress={() => {
          setSaved(null);
          setOpen(true);
        }}
      />
      {faceSupported.data && pin.data.set ? (
        <>
          <T v="small" muted testID="face-state">
            {pin.data.passkeys > 0 ? t.shop.faceOn : t.shop.faceOff}
          </T>
          {pin.data.passkeys > 0 ? (
            <Button testID="face-off" title={t.shop.faceDisable} variant="ghost" onPress={() => void faceOff()} />
          ) : (
            <Button
              testID="face-on"
              title={`🙂 ${t.shop.faceEnable}`}
              variant="secondary"
              onPress={() => {
                setSaved(null);
                setFaceOpen(true);
              }}
            />
          )}
        </>
      ) : null}
      {faceOpen ? (
        <FaceSetup
          onDone={() => {
            setFaceOpen(false);
            setSaved(t.shop.faceDone);
            refresh();
          }}
          onCancel={() => setFaceOpen(false)}
        />
      ) : null}
      {open ? (
        <PinSetup
          needOld={pin.data.set && !pin.data.can_reset}
          onDone={() => {
            setOpen(false);
            setSaved(t.shop.pinSaved);
            refresh();
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

/** Turning Face ID on: the PIN, then a tap that asks the phone for the face. */
function FaceSetup({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const p = usePalette();
  const [pin, setPin] = useState('');
  const [start, setStart] = useState<{ id: string; options: CreateOptions } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function next() {
    setError(null);
    if (pin.length !== 4) return setError(t.errors.pin_format);
    setBusy(true);
    try {
      const r = await api.passkeyBeginRegister(pin);
      if (!r.ok || !r.challenge_id || !r.options) setError(pinErrorText(r.error ?? 'generic', r.tries_left));
      else setStart({ id: r.challenge_id, options: r.options });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!start) return;
    // First thing in the tap: iPhone asks for the face only right after a tap.
    const answer = parentVerifier.register(start.options);
    setBusy(true);
    setError(null);
    try {
      await api.passkeyCheck(start.id, await answer);
      onDone();
    } catch (e) {
      setError(e instanceof Error && e.name === 'NotAllowedError' ? t.shop.faceFailed : errorText(e));
      setStart(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onCancel()} accessible={false}>
        <Pressable
          testID="face-setup"
          style={[styles.sheet, { backgroundColor: p.card }]}
          onPress={() => {}}
          accessible={false}>
          <T v="h2">{t.shop.faceTitle}</T>
          <T muted>{t.shop.faceLead}</T>
          {start ? (
            <Button
              testID="face-confirm"
              title={`🙂 ${t.shop.faceConfirm}`}
              variant="accent"
              onPress={confirm}
              loading={busy}
            />
          ) : (
            <>
              <Field
                testID="face-pin"
                label={t.shop.pinField}
                value={pin}
                onChangeText={(x) => setPin(digits(x))}
                secureTextEntry
                keyboardType="number-pad"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
              />
              <Button testID="face-next" title={t.shop.faceNext} onPress={next} loading={busy} />
            </>
          )}
          <Banner text={error} />
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
