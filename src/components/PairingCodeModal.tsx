import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';

import { api, errorText, type Child } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { radius, space, usePalette } from '@/theme';
import { Avatar } from './art/Avatar';
import { Banner } from './Banner';
import { Button } from './Button';
import { T } from './T';

// Must match the code lifetime in create_pairing_code (SQL).
const CODE_LIFETIME_MS = 10 * 60 * 1000;

type Code = { code: string; expires_at: string };
type Props = { child: Child; onClose: () => void };

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Shows a 10-minute code for the child's phone and notices when the phone connects.
 * Mount it with key={child.id}: every opening starts fresh and asks for a new code.
 */
export function PairingCodeModal({ child, onClose }: Props) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const [code, setCode] = useState<Code | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [paired, setPaired] = useState(false);
  const issuedAt = useRef<number | null>(null);

  const request = () =>
    api.createPairingCode(child.id).then(
      (fresh) => {
        issuedAt.current = new Date(fresh.expires_at).getTime() - CODE_LIFETIME_MS;
        setCode(fresh);
        setNow(Date.now());
      },
      (e) => setError(errorText(e)),
    );

  // First code when the window opens.
  useEffect(() => {
    void request();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick the countdown and check whether the phone has connected.
  useEffect(() => {
    if (paired) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const issued = issuedAt.current;
      if (issued === null) return;
      try {
        const members = await api.listMembers();
        // A phone of this child linked after the code was issued (server clock on both sides).
        if (members.some((m) => m.child_id === child.id && new Date(m.created_at).getTime() >= issued)) {
          setPaired(true);
          void qc.invalidateQueries({ queryKey: ['members', uid] });
        }
      } catch {}
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [child.id, paired, qc, uid]);

  function newCode() {
    setError(null);
    setCode(null);
    void request();
  }

  const left = code ? new Date(code.expires_at).getTime() - now : 0;
  const expired = !!code && left <= 0;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
        <Pressable style={[styles.sheet, { backgroundColor: p.card }]} onPress={() => {}} accessible={false}>
          <View style={styles.head}>
            <Avatar id={child.avatar} color={child.color} size={56} />
            <T v="h2" style={styles.flex}>
              {t.pairing.title(child.name)}
            </T>
          </View>
          {paired ? (
            <Banner kind="success" text={`${t.childPair.hello(child.name)} ✓`} />
          ) : (
            <>
              <T muted>{t.pairing.steps(child.name)}</T>
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
            title={paired ? t.common.done : t.common.close}
            variant={paired ? 'primary' : 'ghost'}
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
