import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { radius, space, usePalette } from '@/theme';
import { Button } from './Button';
import { Chip } from './Chip';
import { T } from './T';

type Props = {
  completionId: string;
  title: string;
  /** Load at once (a request waiting for a signature); otherwise on a tap. */
  auto?: boolean;
};

/** The photo of a task request: a picture in the card, large on a tap. */
export function TaskPhoto({ completionId, title, auto }: Props) {
  const p = usePalette();
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
        <Chip
          testID={`photo-show-${completionId}`}
          label={t.approvals.photoShow}
          selected={false}
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
        accessibilityRole="imagebutton"
        accessibilityLabel={`${t.approvals.photoAlt(title)}. ${t.approvals.photoOpen}`}
        onPress={() => setLarge(true)}>
        <Image source={{ uri: photo.data }} resizeMode="cover" style={[styles.thumb, { backgroundColor: p.cardAlt }]} />
      </Pressable>
      {large ? <PhotoViewer uri={photo.data} title={title} onClose={() => setLarge(false)} /> : null}
    </>
  );
}

/** The photo over the whole screen. */
function PhotoViewer({ uri, title, onClose }: { uri: string; title: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
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
  close: { width: '100%', maxWidth: 560, alignSelf: 'center' },
});
