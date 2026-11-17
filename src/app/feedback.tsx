import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { showToast, Toaster } from '@/components/toast';
import { Button, Field, Problem, Screen, T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, sendFeedback, type FeedbackTopic } from '@/lib/api';

/** Mirrored in FEEDBACK_TOPICS, functions/src/moderation.ts. */
const TOPICS: { key: FeedbackTopic; label: string }[] = [
  { key: 'problem', label: 'Something isn’t working' },
  { key: 'idea', label: 'An idea for UCS' },
  { key: 'account', label: 'My account or my complaints' },
  { key: 'organization', label: 'I work for an organization on UCS' },
  { key: 'child_safety', label: 'A child’s safety' },
  { key: 'other', label: 'Something else' },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Write to the people who run UCS, from Settings or Help, signed in or not.
 * Something on the record is reported with its flag; this is for everything
 * else. A sheet: every outcome is said inside it.
 */
export default function FeedbackScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();
  const accountEmail = user?.email ?? null;
  const [topic, setTopic] = useState<FeedbackTopic | null>(null);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const typed = email.trim();
  const short = message.trim().length < 10;
  const badEmail = !!typed && !EMAIL.test(typed);

  const send = async () => {
    if (!topic || short || badEmail) return;
    setBusy(true);
    setProblem(null);
    try {
      await sendFeedback({
        topic,
        message: message.trim(),
        ...(typed ? { email: typed } : {}),
        platform: Platform.OS,
        appVersion: Application.nativeApplicationVersion ?? undefined,
      });
      router.back();
      // On the page underneath, once the sheet is gone.
      setTimeout(
        () =>
          showToast(
            'Sent. Thank you!',
            typed || accountEmail ? `We read every message and answer at ${typed || accountEmail}.` : 'We read every message.',
            'info',
          ),
        350,
      );
    } catch (e) {
      setProblem(`Couldn't send it. ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <T>
          This goes to the people who run UCS. To report a complaint or anything else on the record, tap the flag on it.
        </T>
        <T variant="label">What&apos;s it about?</T>
        <View style={{ gap: 8 }}>
          {TOPICS.map((t) => {
            const on = t.key === topic;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTopic(t.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[
                  styles.topic,
                  {
                    borderColor: on ? theme.primary : theme.border,
                    backgroundColor: on ? theme.primarySoft : theme.background,
                  },
                ]}>
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={on ? theme.primary : theme.textSecondary}
                />
                <T>{t.label}</T>
              </Pressable>
            );
          })}
        </View>
        {topic === 'child_safety' && (
          <T variant="small">
            We read these first. If a child is in danger right now, call your local emergency number.
          </T>
        )}
        <Field
          label="Your message"
          value={message}
          onChangeText={setMessage}
          placeholder="Tell us what happened, or what would be better"
          multiline
          maxLength={4000}
          style={{ minHeight: 140, textAlignVertical: 'top' }}
        />
        <Field
          label={accountEmail ? 'Answer me at (optional)' : 'Your email, if you want an answer (optional)'}
          value={email}
          onChangeText={setEmail}
          placeholder={accountEmail ?? 'you@example.com'}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
        />
        {badEmail && <T variant="small">That email doesn&apos;t look right.</T>}
        <Problem text={problem} />
        <Button label="Send" onPress={send} busy={busy} disabled={!topic || short || badEmail} />
        {!!topic && short && <T variant="small">Say a little more: at least 10 characters.</T>}
      </Screen>
      <Toaster />
    </View>
  );
}

const styles = StyleSheet.create({
  topic: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 12 },
});
