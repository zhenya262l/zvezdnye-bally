// Import single weights only, so the build does not carry every font file.
import { Comfortaa_600SemiBold } from '@expo-google-fonts/comfortaa/600SemiBold';
import { Comfortaa_700Bold } from '@expo-google-fonts/comfortaa/700Bold';
import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular';
import { Nunito_600SemiBold } from '@expo-google-fonts/nunito/600SemiBold';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { T } from '@/components/T';
import { toApiError } from '@/lib/api';
import { startSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { usePalette } from '@/theme';

// The phone was unlinked, the family deleted, or a parent's role changed
// while the app was open: check the account again, so the app moves to the
// right screen instead of showing the same error with «Попробовать снова».
const MEMBERSHIP_ERRORS = ['not_member', 'parent_only', 'child_only'];

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (e, query) => {
      if (query.queryKey[0] === 'whoami') return;
      if (MEMBERSHIP_ERRORS.includes(toApiError(e).key)) {
        void queryClient.invalidateQueries({ queryKey: ['whoami'] });
      }
    },
  }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true },
    // Offline taps must fail with "нет связи" at once, not wait silently and
    // fire later (maybe on another day or outside the task's time).
    mutations: { networkMode: 'always' },
  },
});

export default function RootLayout() {
  const p = usePalette();
  const [fontsLoaded, fontError] = useFonts({
    Comfortaa_600SemiBold,
    Comfortaa_700Bold,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  useEffect(() => {
    startSession();
  }, []);

  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: p.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
          <Stack.Screen name="child-edit" options={{ presentation: 'modal' }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <Screen>
        <T v="title">{t.boundary.title}</T>
        <T muted>{t.boundary.text}</T>
        <Button title={t.common.retry} onPress={retry} />
      </Screen>
    </SafeAreaProvider>
  );
}
