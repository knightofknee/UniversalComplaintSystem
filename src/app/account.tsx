import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { showToast, Toaster } from "@/components/toast";
import { Button, Field, Screen, T } from "@/components/ui";
import { Fonts } from "@/constants/theme";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { errorText } from "@/lib/api";
import {
  appleAvailable,
  Cancelled,
  continueWithApple,
  continueWithEmail,
  continueWithGoogle,
  googleAvailable,
  resetPassword,
  WrongPassword,
} from "@/lib/sso";

type Said = { tone: "error" | "info"; text: string; reset?: boolean };

/**
 * Sign in. Everyone already has an anonymous account, so signing in with
 * Apple, Google or an email attaches that to the same account and keeps
 * everything it posted and supported. A verified email is also how people
 * respond for their organization.
 *
 * Email has ONE button: it signs in if the email has an account and makes
 * the account if it doesn't (`continueWithEmail`). Every outcome is said
 * right here, under the button: this is a sheet, and on iOS a toast drawn
 * by the root layout would sit hidden behind it.
 */
export default function AccountScreen() {
  const { user, refresh } = useAuth();
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<Said | null>(null);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    // The reset button's own words come from what was said; keep them while it sends.
    if (what !== 'reset') setSaid(null);
    try {
      await fn();
    } catch (e) {
      // Closing the Apple or Google sheet is a choice, not a failure.
      if (e instanceof Cancelled) return;
      if (e instanceof WrongPassword)
        setSaid({ tone: "error", text: e.message, reset: true });
      else {
        const code = (e as { code?: string })?.code ?? "";
        setSaid({
          tone: "error",
          text: errorText(e),
          reset: code === "auth/too-many-requests",
        });
      }
    } finally {
      setBusy(null);
    }
  };

  // Signed in already: this sheet has nothing to say. (Me shows the email,
  // a line to confirm it if needed, and Sign out; deleting is under Settings.)
  if (user && !user.isAnonymous) return <Close />;

  const address = email.trim();
  const ready =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && password.length >= 8;
  const submit = () =>
    run("email", async () => {
      const outcome = await continueWithEmail(address, password);
      await refresh();
      // The sheet closes itself now; this shows on the page underneath.
      setTimeout(
        () =>
          outcome === "created"
            ? showToast(
                `Account made for ${address}`,
                "We sent a link to that address to confirm it.",
                "info",
              )
            : showToast(`Signed in as ${address}`, undefined, "info"),
        350,
      );
    });
  const reset = () =>
    run("reset", async () => {
      if (!address.includes("@")) {
        setSaid({
          tone: "error",
          text: "Type your email above first, then tap this again.",
        });
        return;
      }
      await resetPassword(address);
      setSaid({
        tone: "info",
        text: `If ${address} has an account, a link to set a new password is on its way. Check your spam folder too.`,
      });
    });

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Stack.Screen options={{ title: "Sign in or sign up" }} />
        <View style={styles.providers}>
          {googleAvailable && (
            <ProviderButton
              name="Google"
              logo={
                <Image
                  source={require("@/assets/images/google-g.svg")}
                  style={styles.logo}
                  contentFit="contain"
                />
              }
              busy={busy === "google"}
              disabled={!!busy}
              onPress={() =>
                run(
                  "google",
                  async () => (await continueWithGoogle(), refresh()),
                )
              }
            />
          )}
          {appleAvailable && (
            <ProviderButton
              name="Apple"
              solid
              logo={(color) => (
                <Ionicons name="logo-apple" size={22} color={color} />
              )}
              busy={busy === "apple"}
              disabled={!!busy}
              onPress={() =>
                run("apple", async () => (await continueWithApple(), refresh()))
              }
            />
          )}
        </View>
        <View style={styles.divider}>
          <View style={[styles.line, { backgroundColor: theme.border }]} />
          <T variant="small">or with email</T>
          <View style={[styles.line, { backgroundColor: theme.border }]} />
        </View>
        <Field
          label="Email"
          value={email}
          onChangeText={(t) => (setEmail(t), setSaid(null))}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          keyboardButton={false}
          returnKeyType="next"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={(t) => (setPassword(t), setSaid(null))}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => ready && !busy && submit()}
        />
        {password.length > 0 && password.length < 8 && (
          <T variant="small">
            At least 8 characters ({8 - password.length} more).
          </T>
        )}
        <Button
          label="Continue"
          busy={busy === "email"}
          disabled={!!busy || !ready}
          onPress={submit}
        />
        {said && (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.said,
              {
                backgroundColor:
                  said.tone === "error" ? theme.warningSoft : theme.primarySoft,
              },
            ]}
          >
            <Ionicons
              name={said.tone === "error" ? "alert-circle" : "mail-outline"}
              size={20}
              color={said.tone === "error" ? theme.danger : theme.primary}
            />
            <T style={{ flex: 1 }}>{said.text}</T>
          </View>
        )}
        <T variant="small">
          New here? The same button makes your account. Already have one? It
          signs you in, and anything you did before signing in, like a complaint
          you just posted, moves into it. Your email is never shown.
        </T>
        <Button
          label={
            said?.reset ? "Send me a link to reset it" : "Forgot your password?"
          }
          kind={said?.reset ? "secondary" : "quiet"}
          busy={busy === "reset"}
          disabled={!!busy}
          onPress={reset}
        />
      </Screen>
      <Toaster />
    </View>
  );
}

/**
 * Apple's and Google's buttons, side by side: the mark and one word. Nobody
 * needs "Continue with" spelled out on a button with the logo on it. Google's
 * mark keeps its own four colors; Apple's button is solid, as its guidelines ask.
 */
function ProviderButton({
  name,
  logo,
  solid,
  busy,
  disabled,
  onPress,
}: {
  name: string;
  logo: ReactNode | ((color: string) => ReactNode);
  solid?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const fg = solid ? theme.background : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Sign in with ${name}`}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [
        styles.provider,
        {
          backgroundColor: solid ? theme.text : theme.background,
          borderColor: solid ? theme.text : theme.border,
          opacity: pressed ? 0.85 : disabled && !busy ? 0.7 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {typeof logo === "function" ? logo(fg) : logo}
          <Text style={[styles.providerText, { color: fg }]}>{name}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Closes the sheet as soon as it is shown. */
function Close() {
  const router = useRouter();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/me");
  }, [router]);
  return null;
}

const styles = StyleSheet.create({
  providers: { flexDirection: "row", gap: 10 },
  provider: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
  },
  providerText: { fontFamily: Fonts.bold, fontSize: 16 },
  logo: { width: 22, height: 22 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  said: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 12,
    padding: 12,
  },
});
