import {
  BricolageGrotesque_500Medium,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/bricolage-grotesque";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { Colors, Fonts } from "@/constants/theme";
import { Toaster } from "@/components/toast";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { loadAppearance, useScheme } from "@/lib/appearance";
import { usePush } from "@/lib/push";

SplashScreen.preventAutoHideAsync();

/** The tabs sit under the complaint box, so its menu button always has somewhere to go back to. */
export const unstable_settings = { initialRouteName: "(tabs)" };
void loadAppearance();

/** Holds the splash until the (anonymous) account and the fonts are ready. */
function SplashGate({ fontsReady }: { fontsReady: boolean }) {
  const { loading, user, profile } = useAuth();
  usePush(user?.uid, profile?.pushOn);
  useEffect(() => {
    if (!loading && fontsReady) void SplashScreen.hideAsync();
  }, [loading, fontsReady]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_500Medium,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
  });
  const fontsReady = fontsLoaded || !!fontError;
  const dark = useScheme() === "dark";
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
        <SplashGate fontsReady={fontsReady} />
        <StatusBar style={dark ? "light" : "dark"} />
        {/* Nothing mounts before the fonts: text measured in the fallback face stays truncated (tab labels). */}
        {fontsReady && (
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerBackButtonDisplayMode: "minimal",
              headerTitleStyle: { fontFamily: Fonts.bold, fontSize: 18 },
            }}
          >
            <Stack.Screen
              name="(tabs)"
              options={{ headerShown: false, title: "Complaints" }}
            />
            <Stack.Screen
              name="index"
              options={{
                headerShown: false,
                title: "Universal Complaint System",
              }}
            />
            <Stack.Screen name="complain" options={{ title: "" }} />
            <Stack.Screen
              name="help"
              options={{ title: "Help", presentation: "modal" }}
            />
            <Stack.Screen name="point/[id]" options={{ title: "" }} />
            <Stack.Screen name="subject/[id]" options={{ title: "" }} />
            <Stack.Screen
              name="submission/[id]"
              options={{ title: "Complaint" }}
            />
            <Stack.Screen
              name="account"
              options={{ title: "Sign in", presentation: "modal" }}
            />
            <Stack.Screen
              name="delete-account"
              options={{ title: "Delete account" }}
            />
            <Stack.Screen
              name="notifications"
              options={{ title: "Notifications" }}
            />
            <Stack.Screen name="company/index" options={{ title: "Respond" }} />
            <Stack.Screen
              name="company/claim"
              options={{
                title: "Respond for an organization",
                presentation: "modal",
              }}
            />
            <Stack.Screen name="about" options={{ title: "How UCS works" }} />
            <Stack.Screen name="removals" options={{ title: "Removal log" }} />
            <Stack.Screen
              name="thread/[orgId]/[threadId]"
              options={{ title: "Private" }}
            />
            <Stack.Screen
              name="privacy"
              options={{ title: "Privacy policy" }}
            />
            <Stack.Screen name="terms" options={{ title: "Terms of use" }} />
            <Stack.Screen
              name="operator"
              options={{ title: "Operator queue" }}
            />
          </Stack>
        )}
        <Toaster />
      </AuthProvider>
    </ThemeProvider>
  );
}
