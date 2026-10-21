import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet } from 'react-native';

import type { DayTask } from '@/lib/api';
import { errorText } from '@/lib/api';
import { shrinkPhoto, type Photo } from '@/platform/photo';
import { t } from '@/strings.ru';
import { radius, space, usePalette } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { PhotoPicker } from './PhotoPicker';
import { T } from './T';

type Props = {
  task: DayTask;
  /** The photo is being sent with «Сделала». */
  sending: boolean;
  error: string | null;
  onSend: (photo: Photo) => void;
  onClose: () => void;
};

/** Child: «Сделала» for a task with «Фото» — take a photo, look at it, send. */
export function PhotoSheet({ task, sending, error, onSend, onClose }: Props) {
  const p = usePalette();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function picked(file: File) {
    setPreparing(true);
    setLocalError(null);
    try {
      setPhoto(await shrinkPhoto(file));
    } catch (e) {
      setLocalError(errorText(e));
    } finally {
      setPreparing(false);
    }
  }

  const close = () => {
    if (!sending) onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessible={false}>
        <Pressable
          testID="photo-sheet"
          style={[styles.sheet, { backgroundColor: p.card }]}
          onPress={() => {}}
          accessible={false}>
          <T v="h2">{`${task.icon} ${t.child.photoTitle(task.title)}`}</T>
          <T muted>{t.child.photoLead}</T>
          {photo ? (
            <Image
              testID="photo-preview"
              accessibilityLabel={t.child.photoPreview}
              source={{ uri: photo.uri }}
              resizeMode="contain"
              style={[styles.preview, { backgroundColor: p.cardAlt }]}
            />
          ) : null}
          {preparing ? <T muted>{t.child.photoPreparing}</T> : null}
          <Banner text={localError ?? error} />
          {photo ? (
            <>
              <Button
                testID="photo-send"
                title={t.child.photoSend}
                variant="accent"
                loading={sending}
                disabled={preparing}
                onPress={() => onSend(photo)}
              />
              <PhotoPicker
                testID="photo-retake"
                title={t.child.photoRetake}
                variant="secondary"
                disabled={sending || preparing}
                onPicked={picked}
              />
            </>
          ) : (
            <PhotoPicker testID="photo-take" title={t.child.photoTake} disabled={preparing} onPicked={picked} />
          )}
          <Button title={t.common.cancel} variant="ghost" onPress={close} disabled={sending} />
        </Pressable>
      </Pressable>
    </Modal>
  );
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
  preview: { width: '100%', height: 280, borderRadius: radius.m },
});
