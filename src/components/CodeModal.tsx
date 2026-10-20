import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';

import { errorText } from '@/lib/api';
import { t } from '@/strings.ru';
import { radius, space, usePalette } from '@/theme';
import { Banner } from './Banner';
import { Button } from './Button';
import { T } from './T';

// Must match the code lifetime in the SQL functions that create codes.
const CODE_LIFETIME_MS = 10 * 60 * 1000;

type Code = { code: string; expires_at: string };

type Props = {
  title: string;
  steps: string;
  icon?: ReactNode;
  doneText: string;
  /** Asks the server for a fresh code. */
  request: () => Promise<Code>;
  /** True once someone used the code (checked every 3 s). `issuedAt` is server time in ms. */
  isDone: (issuedAt: number) => Promise<boolean>;
  onDone?: () => void;
  onClose: () => void;
};

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Shows a 10-minute one-time code and notices when it has been used.
 * Mount it with a `key`: every opening starts fresh and asks for a new code.
 */
export function CodeModal({ title, steps, icon, doneText, request, isDone, onDone, onClose }: Props) {
  const p = usePalette();
  const [code, setCode] = useState<Code | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState(false);
  const issuedAt = useRef<number | null>(null);

  const fetchCode = () =>
    request().then(
      (fresh) => {
        issuedAt.current = new Date(fresh.expires_at).getTime() - CODE_LIFETIME_MS;
        setCode(fresh);
        setNow(Date.now());
      },
      (e) => setError(errorText(e)),
    );

  useEffect(() => {
    void fetchCode();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (done) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const issued = issuedAt.current;
      if (issued === null) return;
      try {
        if (await isDone(issued)) {
          setDone(true);
          onDone?.();
        }
      } catch {}
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  function newCode() {
    setError(null);
    setCode(null);
    void fetchCode();
  }

  const left = code ? new Date(code.expires_at).getTime() - now : 0;
  const expired = !!code && left <= 0;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
        <Pressable style={[styles.sheet, { backgroundColor: p.card }]} onPress={() => {}} accessible={false}>
          <View style={styles.head}>
            {icon}
            <T v="h2" style={styles.flex}>
              {title}
            </T>
          </View>
          {done ? (
            <Banner kind="success" text={doneText} />
          ) : (
            <>
              <T muted>{steps}</T>
              <View style={[styles.codeBox, { backgroundColor: p.cardAlt }]}>
                {code ? (
                  <T v="code" testID="pairing-code" color={expired ? p.textMuted : p.text} center>
                    {`${code.code.slice(0, 3)} ${code.code.slice(3)}`}
                  </T>
                ) : error ? null : (
                  <ActivityIndicator color={p.primary} />
                )}
              </View>
              {code ? (
                <T center muted={!expired} color={expired ? p.danger : undefined}>
                  {expired ? t.pairing.expired : t.pairing.expiresIn(mmss(left))}
                </T>
              ) : null}
              <Banner text={error} />
              {expired || error ? <Button title={t.pairing.newCode} onPress={newCode} /> : null}
            </>
          )}
          <Button
            title={done ? t.common.done : t.common.close}
            variant={done ? 'primary' : 'ghost'}
            onPress={onClose}
          />
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
    padding: space.xl,
    paddingBottom: space.xxl + 12,
    gap: space.m,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  flex: { flex: 1 },
  codeBox: {
    borderRadius: radius.m,
    paddingVertical: space.l,
    alignItems: 'center',
    minHeight: 84,
    justifyContent: 'center',
  },
});
