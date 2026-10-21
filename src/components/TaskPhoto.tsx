import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { radius, space, usePalette } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { ButtonRow } from './ButtonRow';
import { T } from './T';

type Props = {
  completionId: string;
  title: string;
  /** Load at once (a request waiting for a signature); otherwise on a tap. */
  auto?: boolean;
  /** A parent may delete the photo («Удалить фото»). */
  canDelete?: boolean;
};

/** The photo of a task request: a picture in the card, large on a tap. */
export function TaskPhoto({ completionId, title, auto, canDelete }: Props) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const [asked, setAsked] = useState(false);
  const [large, setLarge] = useState(false);
  const photo = useQuery({
    queryKey: ['taskPhoto', uid, completionId],
    queryFn: () => api.taskPhoto(completionId),
    enabled: !!uid && (auto || asked),
    // A photo never changes; it is only deleted after 7 days.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  if (!auto && !asked) {
    return (
      <View style={styles.row}>
        <Button
          testID={`photo-show-${completionId}`}
          title={t.approvals.photoShow}
          variant="secondary"
          onPress={() => setAsked(true)}
        />
      </View>
    );
  }
  if (photo.isPending)
    return (
      <T v="small" muted>
        {t.approvals.photoLoading}
      </T>
    );
  if (photo.isError)
    return (
      <T v="small" color={p.danger}>
        {errorText(photo.error)}
      </T>
    );

  return (
    <>
      <Pressable
        testID={`photo-thumb-${completionId}`}
        accessibilityRole="button"
        accessibilityLabel={`${t.approvals.photoAlt(title)}. ${t.approvals.photoOpen}`}
        onPress={() => setLarge(true)}>
        <Image source={{ uri: photo.data }} resizeMode="cover" style={[styles.thumb, { backgroundColor: p.cardAlt }]} />
      </Pressable>
      {large ? (
        <PhotoViewer
          uri={photo.data}
          title={title}
          onClose={() => setLarge(false)}
          onDelete={
            canDelete
              ? async () => {
                  await api.deleteTaskPhoto(completionId);
                  setLarge(false);
                  qc.removeQueries({ queryKey: ['taskPhoto', uid, completionId] });
                  void qc.invalidateQueries({ queryKey: ['queue', uid] });
                  void qc.invalidateQueries({ queryKey: ['ledger', uid] });
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

type ViewerProps = {
  uri: string;
  title: string;
  onClose: () => void;
  /** Only for a parent: deletes the photo, then the viewer closes. */
  onDelete?: () => Promise<void>;
};

/** The photo over the whole screen; a parent can delete it from here. */
function PhotoViewer({ uri, title, onClose, onDelete }: ViewerProps) {
  const insets = useSafeAreaInsets();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!onDelete) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View
        testID="photo-viewer"
        style={[styles.viewer, { paddingTop: insets.top + space.s, paddingBottom: insets.bottom + space.s }]}>
        <Image
          accessibilityLabel={t.approvals.photoAlt(title)}
          source={{ uri }}
          resizeMode="contain"
          style={styles.full}
        />
        <View style={styles.close}>
          <Banner text={error} />
          {onDelete && asking ? (
            <View style={[styles.ask, { backgroundColor: '#FFFFFF' }]}>
              <T v="bodyBold" color="#13293D">
                {t.approvals.photoDeleteAsk}
              </T>
              <ButtonRow>
                <Button
                  testID="photo-delete-yes"
                  title={t.approvals.photoDeleteYes}
                  variant="danger"
                  loading={busy}
                  onPress={() => void remove()}
                />
                <Button
                  title={t.approvals.photoDeleteNo}
                  variant="secondary"
                  disabled={busy}
                  onPress={() => setAsking(false)}
                />
              </ButtonRow>
            </View>
          ) : onDelete ? (
            <Button
              testID="photo-delete"
              title={t.approvals.photoDelete}
              variant="danger"
              onPress={() => setAsking(true)}
            />
          ) : null}
          <Button testID="photo-close" title={t.approvals.photoClose} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  thumb: { width: '100%', height: 200, borderRadius: radius.m },
  viewer: { flex: 1, backgroundColor: '#000000', gap: space.m, paddingHorizontal: space.m },
  full: { flex: 1, width: '100%' },
  close: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: space.s },
  ask: { borderRadius: radius.m, padding: space.m, gap: space.s },
});
