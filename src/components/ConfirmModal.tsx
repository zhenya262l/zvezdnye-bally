import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { t } from '@/strings.ru';
import { radius, space, usePalette } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { Field } from './Field';
import { T } from './T';

type Props = {
  visible: boolean;
  title: string;
  text: string;
  confirmTitle: string;
  danger?: boolean;
  /** If set, the user must type this word to enable the confirm button. */
  typeToConfirm?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/** In-app confirmation dialog (browser alerts are not used). */
export function ConfirmModal(props: Props) {
  const p = usePalette();
  const [typed, setTyped] = useState('');
  const ok = !props.typeToConfirm || typed.trim().toUpperCase() === props.typeToConfirm;
  const close = () => {
    setTyped('');
    props.onCancel();
  };
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessible={false}>
        <Pressable style={[styles.sheet, { backgroundColor: p.card }]} onPress={() => {}} accessible={false}>
          <T v="h2">{props.title}</T>
          <T v="body" muted>
            {props.text}
          </T>
          {props.typeToConfirm ? (
            <Field value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} />
          ) : null}
          <Banner text={props.error} />
          <View style={styles.buttons}>
            <Button
              title={props.confirmTitle}
              variant={props.danger ? 'danger' : 'primary'}
              disabled={!ok}
              loading={props.busy}
              onPress={() => {
                props.onConfirm();
              }}
            />
            <Button title={t.common.cancel} variant="ghost" onPress={close} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 24, 38, 0.55)',
    justifyContent: 'center',
    padding: space.l,
  },
  sheet: {
    borderRadius: radius.l,
    padding: space.xl,
    gap: space.m,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  buttons: { gap: space.s, marginTop: space.s },
});
