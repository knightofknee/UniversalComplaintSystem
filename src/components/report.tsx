import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { showAlert } from '@/components/point-card';
import { Button, Field, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { errorText, report, type ReportKind, type ReportReason } from '@/lib/api';

const REASONS: { key: ReportReason; label: string }[] = [
  { key: 'child_safety', label: 'Harms or sexualizes a child' },
  { key: 'abuse', label: 'Threats, hate or harassment' },
  { key: 'private_person', label: 'It targets a private person' },
  { key: 'personal_data', label: 'It shows personal details' },
  { key: 'spam', label: 'Spam or nonsense' },
  { key: 'illegal', label: 'Something illegal' },
  { key: 'other', label: 'Something else' },
];

export type ReportTarget = { kind: ReportKind; id: string; pointId?: string; orgId?: string; threadId?: string };

/**
 * Report anything. It goes to the people who run UCS, never to the
 * organization, and nothing is hidden automatically: we review every
 * report within a day.
 */
export function ReportButton({
  target,
  label = 'Report',
  compact,
}: {
  target: ReportTarget;
  label?: string;
  /** Just the flag, for a row where something else is the main action. */
  compact?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(false);
    setReason(null);
    setNote('');
  };
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      await report({ ...target, reason, ...(note.trim() ? { note: note.trim() } : {}) });
      close();
      showAlert('Thanks, we’ll look at it', 'Reports go to the people who run UCS, not to the organization. We review every one within a day.');
    } catch (e) {
      showAlert("Couldn't send the report", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={compact ? 6 : 10}
        style={compact ? styles.compact : styles.trigger}>
        <Ionicons name="flag-outline" size={compact ? 19 : 14} color={theme.textSecondary} />
        {!compact && <T variant="small">{label}</T>}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable
          style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          onPress={() => {}}>
            <T variant="heading">What&apos;s wrong with it?</T>
            <T variant="small">
              Reports go to the people who run UCS, never to the organization. Disagreeing with a complaint isn&apos;t a
              reason to remove it.
            </T>
            <View style={{ gap: 8 }}>
              {REASONS.map((r) => {
                const on = r.key === reason;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => setReason(r.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.reason, { borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.primarySoft : theme.background }]}>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? theme.primary : theme.textSecondary} />
                    <T>{r.label}</T>
                  </Pressable>
                );
              })}
            </View>
            <Field value={note} onChangeText={setNote} placeholder="Anything we should know? (optional)" maxLength={500} />
            <Button label="Send report" onPress={send} busy={busy} disabled={!reason} />
            <Button label="Cancel" kind="quiet" onPress={close} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  compact: { width: 40, height: 46, alignItems: 'center', justifyContent: 'center' },
  // Dimmed enough that the page reads as background: a sheet's words must never run into the page's.
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', padding: 16 },
  sheet: { borderRadius: 18, borderWidth: 1, padding: 22, gap: 14, width: '100%', maxWidth: 480, alignSelf: 'center' },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 12 },
});
