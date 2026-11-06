import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { getDownloadURL, ref } from 'firebase/storage';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable } from 'react-native';

import { showAlert } from '@/components/point-card';
import { ReportButton } from '@/components/report';
import { Card, Chip, Notice, Row, T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { blockAuthor } from '@/lib/blocks';
import { storage } from '@/lib/firebase';
import { timeAgo } from '@/lib/hooks';
import type { Submission } from '@/lib/types';

export function PublicPhoto({ path, size = 96 }: { path: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    getDownloadURL(ref(storage, path)).then(setUrl, () => setUrl(null));
  }, [path]);
  if (!url) return null;
  return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 10 }} contentFit="cover" />;
}

function confirmHide(name: string, onYes: () => void) {
  const msg = `You won't see complaints by ${name} anymore. They won't know. Undo it in Me > Hidden authors.`;
  if (Platform.OS === 'web') {
    if (window.confirm(msg)) onYes();
    return;
  }
  Alert.alert(`Hide ${name}?`, msg, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Hide', style: 'destructive', onPress: onYes },
  ]);
}

/** One person's complaint, in their own words (and in English if they wrote another language). */
export function SubmissionCard({ s, addedPoint }: { s: Submission; addedPoint?: boolean }) {
  const theme = useTheme();
  const { user } = useAuth();
  const [original, setOriginal] = useState(false);
  const translated = !!s.englishText;
  const source = s.source;
  return (
    <Card>
      <Row style={{ flexWrap: 'wrap' }}>
        <T variant="small" style={{ fontWeight: '700' }}>
          {s.authorName}
        </T>
        <T variant="small">{timeAgo(s.createdAt?.toMillis())}</T>
        {source && <Chip label={`Public record · ${source.shortName}`} color={theme.textSecondary} bg={theme.background} />}
        {s.tone === 'rant' && <Chip label="🔥 Rant" color={theme.rant} bg={theme.rantSoft} />}
        {addedPoint && <Chip label="Model added this point from it" color={theme.new} bg={theme.newSoft} />}
        {s.rewritten && <Chip label="Clearer version" color={theme.textSecondary} bg={theme.background} />}
      </Row>
      <T>{translated && !original ? s.englishText : s.text}</T>
      {translated && (
        <Pressable onPress={() => setOriginal((o) => !o)} accessibilityRole="button" hitSlop={8}>
          <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
            {original ? 'Show English translation' : `Translated from "${s.language}" · show original`}
          </T>
        </Pressable>
      )}
      {source && (
        <Notice>
          {source.orgReply && <T variant="small">{source.orgReply}</T>}
          <Pressable onPress={() => Linking.openURL(source.url)} accessibilityRole="link" hitSlop={6}>
            <T variant="small" color={theme.primary} style={{ fontWeight: '700' }}>
              From the {source.name} <Ionicons name="open-outline" size={12} />
            </T>
          </Pressable>
        </Notice>
      )}
      {s.photos.length > 0 && (
        <Row style={{ flexWrap: 'wrap' }}>
          {s.photos.map((p) => (
            <PublicPhoto key={p} path={p} />
          ))}
        </Row>
      )}
      <Row style={{ gap: 16 }}>
        <ReportButton target={{ kind: 'submission', id: s.id }} />
        {user && s.authorId && !source && (
          <Pressable
            onPress={() =>
              confirmHide(s.authorName, () =>
                blockAuthor(user.uid, s.authorId!, s.authorName).catch(() => showAlert("Couldn't hide them")),
              )
            }
            accessibilityRole="button"
            hitSlop={10}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="eye-off-outline" size={14} color={theme.textSecondary} />
            <T variant="small">Hide this author</T>
          </Pressable>
        )}
      </Row>
    </Card>
  );
}
