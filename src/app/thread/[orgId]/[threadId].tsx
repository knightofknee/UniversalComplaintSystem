import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { collection, orderBy, query } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { showAlert } from '@/components/point-card';
import { PublicPhoto } from '@/components/submission-card';
import { Button, Card, Chip, Empty, Field, Notice, Row, Screen, T } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { errorText, markThreadRead, sendMessage, setThreadStatus } from '@/lib/api';
import { db } from '@/lib/firebase';
import { timeAgo, useCollection, useDoc } from '@/lib/hooks';
import type { Message, Subject, Thread } from '@/lib/types';

/**
 * A private complaint and the conversation about it. The author and the
 * organization's verified responders see the same page; nobody else can.
 */
export default function ThreadScreen() {
  const { orgId, threadId } = useLocalSearchParams<{ orgId: string; threadId: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { data: thread, loading } = useDoc<Thread>(`subjects/${orgId}/inbox/${threadId}`);
  const { data: org } = useDoc<Subject>(`subjects/${orgId}`);
  const messages = useCollection<Message>(
    query(collection(db, `subjects/${orgId}/inbox/${threadId}/messages`), orderBy('at', 'asc')),
    `messages:${orgId}:${threadId}`,
  );
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [original, setOriginal] = useState(false);
  const owner = !!thread && thread.uid === user?.uid;
  const unread = !!thread && (owner ? thread.unreadByUser : thread.unreadByOrg);

  useEffect(() => {
    if (unread) markThreadRead({ orgId, threadId }).catch(() => {});
  }, [unread, orgId, threadId]);

  if (!thread) {
    return (
      <Screen>
        <Empty loading={loading} text="This conversation is private or gone." />
      </Screen>
    );
  }

  const send = async () => {
    setBusy(true);
    try {
      await sendMessage({ orgId, threadId, text: text.trim() });
      setText('');
    } catch (e) {
      showAlert("Couldn't send", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const toggleStatus = () =>
    setThreadStatus({ orgId, threadId, status: thread.status === 'resolved' ? 'open' : 'resolved' }).catch((e) =>
      showAlert("Couldn't change that", errorText(e)),
    );
  const orgName = org?.name ?? 'the organization';

  return (
    <Screen>
      <Stack.Screen options={{ title: owner ? `Private · ${orgName}` : `Private · ${thread.authorName}` }} />
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label="Private" color={theme.primary} bg={theme.primarySoft} />
        <Chip
          label={thread.status === 'resolved' ? 'Resolved' : 'Open'}
          color={thread.status === 'resolved' ? theme.good : theme.warning}
          bg={thread.status === 'resolved' ? theme.goodSoft : theme.warningSoft}
        />
      </Row>
      {owner ? (
        <T variant="small">
          Only you and {orgName}&apos;s verified team can read this. {orgName} will never ask for your password or
          card number here.
        </T>
      ) : (
        <T variant="small">
          From {thread.authorName} · {thread.email}. Only your organization&apos;s verified responders and the author can
          read this.
        </T>
      )}
      {owner && org && !org.claimed && (
        <Notice tone="warn">
          <T>{orgName} hasn&apos;t joined UCS yet. This is held for them; you&apos;ll be notified when they reply.</T>
        </Notice>
      )}

      <Card>
        <Row>
          <T variant="small" style={{ fontWeight: '700' }}>
            {thread.authorName}
          </T>
          <T variant="small">{timeAgo(thread.createdAt?.toMillis())}</T>
        </Row>
        <T>{thread.englishText && !original ? thread.englishText : thread.text}</T>
        {thread.englishText && (
          <Button
            kind="quiet"
            label={original ? 'Show English translation' : `Translated from "${thread.language}" · show original`}
            onPress={() => setOriginal((o) => !o)}
          />
        )}
        {thread.photos.length > 0 && (
          <Row style={{ flexWrap: 'wrap' }}>
            {thread.photos.map((p) => (
              <PublicPhoto key={p} path={p} />
            ))}
          </Row>
        )}
      </Card>

      <T variant="label">What it&apos;s about</T>
      {thread.points.map((p) => (
        <Card key={p.privatePointId} onPress={p.pointId ? () => router.push(`/point/${p.pointId}`) : undefined}>
          <T>{p.statement}</T>
          <T variant="small">{p.pointId ? 'Also on the public record · open it' : 'Raised privately only'}</T>
        </Card>
      ))}

      <T variant="label">Conversation</T>
      {messages.items.length === 0 && <Empty loading={messages.loading} text="No replies yet." />}
      {messages.items.map((m) => {
        const mine = owner ? m.from === 'user' : m.from === 'org';
        return (
          <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
            <Card style={{ maxWidth: '88%', backgroundColor: mine ? theme.primarySoft : theme.backgroundElement }}>
              <T variant="small" style={{ fontWeight: '700' }}>
                {m.from === 'org' ? `${orgName} · @${m.domain}` : m.authorName}
              </T>
              <T>{m.text}</T>
              <T variant="small">{timeAgo(m.at?.toMillis())}</T>
            </Card>
          </View>
        );
      })}

      <Field
        multiline
        value={text}
        onChangeText={setText}
        placeholder={owner ? `Reply to ${orgName}` : `Reply to ${thread.authorName}`}
        maxLength={4000}
        style={{ minHeight: 80 }}
      />
      <Button label="Send" icon="send" onPress={send} busy={busy} disabled={!text.trim()} />
      <Button
        kind="quiet"
        label={thread.status === 'resolved' ? 'Reopen' : 'Mark resolved'}
        onPress={toggleStatus}
      />
    </Screen>
  );
}
