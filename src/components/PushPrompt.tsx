import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorText } from '@/lib/api';
import { readPref, writePref } from '@/lib/localPrefs';
import { usePushState } from '@/lib/pushState';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { ButtonRow } from './ButtonRow';
import { T } from './T';

const KEY = 'zb.push.prompt.hidden';

/**
 * A short invitation at the top of the main tab until notifications are on.
 * «Не сейчас» hides it on this phone; the card in Settings (or «Я») stays.
 */
export function PushPrompt({ role }: { role: 'parent' | 'child' }) {
  const p = usePalette();
  const { view, enable } = usePushState();
  const [hidden, setHidden] = useState(() => readPref<boolean>(KEY, false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (hidden || view !== 'off') return null;

  return (
    <View testID="push-prompt" style={[styles.box, { backgroundColor: p.card, borderColor: brand.turquoise }]}>
      <T v="bodyBold">{role === 'parent' ? t.push.promptParent : t.push.promptChild}</T>
      <ButtonRow>
        <Button
          testID="push-prompt-enable"
          title={t.push.enable}
          variant="accent"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await enable();
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        />
        <Button
          testID="push-prompt-later"
          title={t.push.later}
          variant="ghost"
          onPress={() => {
            writePref(KEY, true);
            setHidden(true);
          }}
        />
      </ButtonRow>
      <Banner text={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 2, borderRadius: radius.m, padding: space.m, gap: space.s },
});
