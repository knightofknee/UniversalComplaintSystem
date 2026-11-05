import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/hooks/use-auth';

SplashScreen.preventAutoHideAsync();

/** Holds the splash until the (anonymous) account is ready. */
function SplashGate() {
  const { loading } = useAuth();
  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);
  return null;
}

export default function RootLayout() {
  const dark = useColorScheme() === 'dark';
  const palette = dark ? Colors.dark : Colors.light;
  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.primary,
      background: palette.background,
      card: palette.background,
      text: palette.text,
      border: palette.border,
    },
  };
  return (
    <ThemeProvider value={navTheme}>
      <AuthProvider>
        <SplashGate />
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Universal Complaint System' }} />
          <Stack.Screen name="point/[id]" options={{ title: 'Point' }} />
          <Stack.Screen name="subject/[id]" options={{ title: '' }} />
          <Stack.Screen name="submission/[id]" options={{ title: 'Complaint' }} />
          <Stack.Screen name="account" options={{ title: 'Account', presentation: 'modal' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="company/index" options={{ title: 'Respond' }} />
          <Stack.Screen name="company/claim" options={{ title: 'Respond for an organization', presentation: 'modal' }} />
          <Stack.Screen name="about" options={{ title: 'How UCS works' }} />
          <Stack.Screen name="removals" options={{ title: 'Removal log' }} />
          <Stack.Screen name="threads" options={{ title: 'Private complaints' }} />
          <Stack.Screen name="thread/[orgId]/[threadId]" options={{ title: 'Private' }} />
          <Stack.Screen name="privacy" options={{ title: 'Privacy policy' }} />
          <Stack.Screen name="terms" options={{ title: 'Terms of use' }} />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
