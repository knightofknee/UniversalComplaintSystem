import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text } from 'react-native';

import { Button, Problem, T } from '@/components/ui';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorText, nameOptions, setName } from '@/lib/api';
import { tapHaptic } from '@/lib/haptics';

function confirm(title: string, message: string, yes: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: yes, onPress: () => resolve(true) },
    ]),
  );
}

/**
 * Your public name, and a way to swap it. Names are random and stay random:
 * you shuffle through options instead of typing one. Nothing changes until
 * "Use this name" and the confirmation after it; closing keeps the name you
 * came in with.
 */
export function NameChanger({ name }: { name: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [busy, setBusy] = useState<'shuffle' | 'save' | null>(null);
  // Said inside the pop-up: a toast would be hidden behind it on iOS.
  const [problem, setProblem] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setCandidate(null);
    setProblem(null);
  };
  const shuffle = async () => {
    tapHaptic();
    setProblem(null);
    if (options.length > 0) {
      setCandidate(options[0]);
      setOptions(options.slice(1));
      return;
    }
    setBusy('shuffle');
    try {
      const { names } = await nameOptions({});
      setCandidate(names[0]);
      setOptions(names.slice(1));
    } catch (e) {
      setProblem(`Couldn't get new names. ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!candidate) return;
    if (!(await confirm(`Become ${candidate}?`, `Your complaints will show ${candidate} instead of ${name}.`, 'Change name'))) return;
    setBusy('save');
    setProblem(null);
    try {
      await setName({ name: candidate });
      close();
    } catch (e) {
      setProblem(`Couldn't change your name. ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Your name is ${name}. Change it.`}
        hitSlop={8}
        style={({ pressed }) => [styles.name, pressed && { opacity: 0.7 }]}>
        <T variant="title" style={{ flexShrink: 1 }}>
          {name}
        </T>
        <Ionicons name="shuffle" size={22} color={theme.textSecondary} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={[styles.backdrop, { backgroundColor: theme.scrim }]} onPress={close}>
          <Pressable
          style={[styles.sheet, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          onPress={() => {}}>
            <T variant="small">{candidate ? 'How about' : 'Your name'}</T>
            <Text style={[styles.candidate, { color: theme.text }]}>{candidate ?? name}</Text>
            <Problem text={problem} />
            <Button label="Shuffle" icon="shuffle" kind="secondary" onPress={shuffle} busy={busy === 'shuffle'} />
            {candidate && <Button label="Use this name" onPress={save} busy={busy === 'save'} />}
            <Button label={candidate ? `Keep ${name}` : 'Close'} kind="quiet" onPress={close} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  name: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start' },
  // Dimmed enough that the page reads as background: a sheet's words must never run into the page's.
  backdrop: { flex: 1, justifyContent: 'center', padding: 16 },
  sheet: { borderRadius: 18, borderWidth: 1, padding: 22, gap: 14, width: '100%', maxWidth: 420, alignSelf: 'center' },
  candidate: { fontFamily: Fonts.display, fontSize: 30, lineHeight: 36 },
});
