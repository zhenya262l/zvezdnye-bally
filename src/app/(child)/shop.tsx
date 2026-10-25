import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmModal } from '@/components/ConfirmModal';
import { LoadError, Loading } from '@/components/Loading';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { Toast, type ToastMsg } from '@/components/Toast';
import { api, errorText, type ChildShop } from '@/lib/api';
import { formatTime } from '@/lib/dates';
import { useChildShop } from '@/lib/queries';
import { useSession, useWho } from '@/lib/session';
import { t } from '@/strings.ru';
import { brand, radius, space, usePalette } from '@/theme';

type Item = ChildShop['items'][number];

/** Child: goods with prices, «Купить», and her purchases waiting for a signature. */
export default function Shop() {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  const who = useWho();
  const shop = useChildShop();
  const [asking, setAsking] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ToastMsg>(null);
  const hideInfo = useCallback(() => setInfo(null), []);

  if (shop.isPending) return <Loading />;
  if (shop.isError) return <LoadError text={errorText(shop.error)} onRetry={() => shop.refetch()} />;

  const tz = who.data?.member?.timezone;
  const { available, balance, items, requests, screen } = shop.data;
  const groups = [
    { kind: 'small' as const, title: t.shop.small, color: brand.coral },
    { kind: 'big' as const, title: t.shop.big, color: brand.violet },
  ];

  async function buy(item: Item) {
    setBusy(true);
    setError(null);
    try {
      await api.buy(item.id);
      setAsking(null);
      setInfo({ text: t.shop.bought, kind: 'success' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['shop', uid] });
    }
  }

  return (
    <View style={styles.root}>
      <Screen inTabs>
        <T v="title">{t.childTabs.shop}</T>
        <View style={[styles.balance, { backgroundColor: brand.sun }]}>
          <T v="big" color={brand.ocean} testID="shop-available">
            {t.shop.balance(available)}
          </T>
          {balance > available ? (
            <T v="small" color={brand.ocean}>
              {t.shop.waitingNote(balance - available)}
            </T>
          ) : null}
        </View>
        {screen ? (
          <T v="bodyBold" testID="shop-screen">
            {t.shop.screenLeft(screen.left, screen.limit)}
          </T>
        ) : null}

        {requests.length > 0 ? (
          <Card title={t.shop.myRequests} accent={brand.ocean}>
            {requests.map((r) => (
              <View key={r.id} style={[styles.row, { borderColor: p.border }]} testID={`my-purchase-${r.id}`}>
                <T style={styles.icon}>{r.icon}</T>
                <View style={styles.flex}>
                  <T v="bodyBold">{r.title}</T>
                  <T v="small" muted>{`${r.price} · ${formatTime(r.created_at, tz)}`}</T>
                </View>
                <T
                  v="label"
                  color={r.status === 'approved' ? p.successText : r.status === 'pending' ? brand.ocean : p.textMuted}>
                  {r.status === 'approved'
                    ? t.shop.approved
                    : r.status === 'pending'
                      ? `⏳ ${t.shop.pending}`
                      : t.shop.rejected}
                </T>
              </View>
            ))}
          </Card>
        ) : null}

        {items.length === 0 ? <T muted>{t.shop.empty}</T> : null}
        {groups.map((g) => {
          const list = items.filter((x) => x.kind === g.kind);
          if (list.length === 0) return null;
          return (
            <Card key={g.kind} title={g.title} accent={g.color}>
              {list.map((item) => {
                const missing = item.price - available;
                const noScreen = !!item.screen_minutes && item.screen_minutes > (screen?.left ?? Infinity);
                return (
                  <View key={item.id} style={[styles.item, { borderColor: p.border }]} testID={`shop-${item.id}`}>
                    <View style={styles.top}>
                      <T style={styles.icon}>{item.icon}</T>
                      <View style={styles.flex}>
                        <T v="bodyBold">{item.title}</T>
                        {item.screen_minutes ? (
                          <T v="small" muted>
                            {t.shop.minutes(item.screen_minutes)}
                          </T>
                        ) : null}
                      </View>
                      <View style={[styles.price, { backgroundColor: brand.sun }]}>
                        <T v="bodyBold" color={brand.ocean}>{`⭐ ${item.price}`}</T>
                      </View>
                    </View>
                    <Button
                      testID={`buy-${item.id}`}
                      title={missing > 0 ? t.shop.missing(missing) : noScreen ? t.shop.noScreen : t.shop.buy}
                      variant="accent"
                      disabled={missing > 0 || noScreen}
                      onPress={() => {
                        setError(null);
                        setAsking(item);
                      }}
                    />
                  </View>
                );
              })}
            </Card>
          );
        })}
      </Screen>
      <ConfirmModal
        visible={!!asking}
        title={t.shop.buyTitle}
        text={asking ? t.shop.buyText(asking.title, asking.price) : ''}
        confirmTitle={t.shop.buy}
        busy={busy}
        error={error}
        onConfirm={() => asking && void buy(asking)}
        onCancel={() => {
          if (!busy) setAsking(null);
        }}
      />
      <Toast msg={info} onHide={hideInfo} inTabs />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  balance: { borderRadius: radius.m, padding: space.m, gap: 2, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderTopWidth: 1 },
  item: { gap: space.s, paddingVertical: space.s, borderTopWidth: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  icon: { fontSize: 30, lineHeight: 38, width: 38, textAlign: 'center' },
  flex: { flex: 1, gap: 2 },
  price: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: 2 },
});
