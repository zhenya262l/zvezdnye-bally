import { Redirect, Tabs } from 'expo-router';
import type { ReactNode } from 'react';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Loading } from '@/components/Loading';
import { useSession, useWho } from '@/lib/session';
import { useTextScale } from '@/lib/textScale';
import { fonts, usePalette } from '@/theme';

export type TabDef = { name: string; title: string; icon: (color: string) => ReactNode };

/** Bottom tabs for one role; anyone else is sent back to the start screen. */
export function TabsShell({ role, tabs }: { role: 'parent' | 'child'; tabs: TabDef[] }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const scale = useTextScale((s) => s.scale);
  const session = useSession((s) => s.session);
  const ready = useSession((s) => s.ready);
  const who = useWho();

  // Larger iPhone text makes tab labels taller: the bar grows with them.
  const labelScale = Math.min(scale, 1.25);
  const extra = Math.round((labelScale - 1) * 64);

  if (!ready) return <Loading />;
  if (!session) return <Redirect href="/" />;
  if (who.isPending) return <Loading />;
  if (who.data?.member?.role !== role) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.primary,
        tabBarInactiveTintColor: p.textMuted,
        tabBarStyle: {
          backgroundColor: p.tabBar,
          borderTopColor: p.border,
          height: 64 + extra + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 12 * labelScale, lineHeight: 16 * labelScale },
        sceneStyle: { backgroundColor: p.bg },
      }}>
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{ title: tab.title, tabBarIcon: ({ color }) => tab.icon(String(color)) }}
        />
      ))}
    </Tabs>
  );
}
