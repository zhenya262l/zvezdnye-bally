import { useState } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';

import { errorText } from '@/lib/api';
import { t } from '@/strings.ru';
import { radius, space, usePalette } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { Field } from './Field';
import { T } from './T';

type Props = {
  /** enter: type the PIN to sign; create: no PIN yet, make one (then sign). */
  mode: 'enter' | 'create';
  title: string;
  busy: boolean;
  error: string | null;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
};

const digits = (s: string) => s.replace(/[^0-9]/g, '').slice(0, 4);

/** The parent's 4-digit PIN before a purchase is signed. */
export function PinModal({ mode, title, busy, error, onSubmit, onCancel }: Props) {
  const p = usePalette();
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  function submit() {
    setLocal(null);
    if (pin.length !== 4) return setLocal(t.errors.pin_format);
    if (mode === 'create' && pin !== repeat) return setLocal(t.errors.pin_mismatch);
    onSubmit(pin);
  }

  const close = () => {
    if (!busy) onCancel();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessible={false}>
        <Pressable
          testID="pin-modal"
          style={[styles.sheet, { backgroundColor: p.card }]}
          onPress={() => {}}
          accessible={false}>
          <T v="h2">{title}</T>
          <T muted>{mode === 'create' ? t.shop.pinCreate : t.shop.pinEnter}</T>
          <Field
            testID="pin-input"
            label={t.shop.pinField}
            value={pin}
            onChangeText={(x) => setPin(digits(x))}
            secureTextEntry
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            autoFocus
            onSubmitEditing={mode === 'enter' ? submit : undefined}
          />
          {mode === 'create' ? (
            <Field
              testID="pin-repeat"
              label={t.shop.pinRepeat}
              value={repeat}
              onChangeText={(x) => setRepeat(digits(x))}
              secureTextEntry
              keyboardType="number-pad"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
            />
          ) : null}
          <Banner text={local ?? error} />
          <Button testID="pin-submit" title={t.shop.pinSign} onPress={submit} loading={busy} />
          <Button title={t.common.cancel} variant="ghost" onPress={close} disabled={busy} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Text for a failed PIN check from the server. */
export function pinErrorText(error: string, triesLeft?: number | null): string {
  if (error === 'pin_wrong' && triesLeft != null) return t.shop.pinTriesLeft(triesLeft);
  return errorText(new Error(error));
}

const styles = StyleSheet.create({
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
