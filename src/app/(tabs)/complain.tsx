import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ref, uploadBytes } from 'firebase/storage';
import { useEffect, useRef, useState } from 'react';
import { Animated, Linking, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { FiledUnder, type Tag } from '@/components/filed-under';
import { PointCard, showAlert } from '@/components/point-card';
import { TermsCheck, useTermsAccepted } from '@/components/terms-check';
import { Button, Card, Chip, Field, Notice, Row, Screen, T, Tabs } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { analyzeComplaint, errorText, getDraft, searchPoints, submitComplaint } from '@/lib/api';
import { storage } from '@/lib/firebase';
import { successHaptic } from '@/lib/haptics';
import { offerPush } from '@/lib/push';
import type { Analysis, PointHit } from '@/lib/types';

const MAX_PHOTOS = 4;
const SEARCH_AFTER_CHARS = 15;

type Photo = { uri: string; path: string | null };
type Step =
  | { kind: 'write' }
  | { kind: 'queued' }
  | { kind: 'review'; analysis: Analysis }
  | { kind: 'done'; analysis: Analysis; matched: string[]; added: string[] }
  | {
      kind: 'sent';
      orgId: string;
      orgName: string;
      threadId: string;
      claimed: boolean;
      website: string | null;
      pointCount: number;
    };

/**
 * Complaining, in three steps: write it (while similar points show up live),
 * see what the model did with it, post it.
 */
export default function ComplainScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, profile } = useAuth();
  const canSendPrivately = !!user && !user.isAnonymous && user.emailVerified;
  const termsAccepted = useTermsAccepted();
  const [agreed, setAgreed] = useState(false);
  const params = useLocalSearchParams<{ subjectId?: string; subjectName?: string; draft?: string }>();
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [similar, setSimilar] = useState<PointHit[]>([]);
  const [raisedPrivately, setRaisedPrivately] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'write' });
  const [busy, setBusy] = useState(false);
  const [removePII, setRemovePII] = useState(true);
  const [useRewrite, setUseRewrite] = useState(false);
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [untagged, setUntagged] = useState<Set<number>>(new Set());
  const [addedTags, setAddedTags] = useState<Tag[]>([]);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  /** Index into the analysis's subjects: which organization a private complaint goes to. */
  const [privateTo, setPrivateTo] = useState<number | null>(null);
  const searchSeq = useRef(0);
  const searching = text.trim().length >= SEARCH_AFTER_CHARS;

  // "Is this what you mean?" while typing.
  useEffect(() => {
    if (step.kind !== 'write' || text.trim().length < SEARCH_AFTER_CHARS) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await searchPoints({ query: text.trim() });
        if (seq !== searchSeq.current) return;
        setSimilar(res.points.slice(0, 4));
        setRaisedPrivately(res.raisedPrivately);
      } catch {
        // Search is a convenience; a failure just shows nothing.
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [text, step.kind]);

  const addPhoto = async () => {
    if (!user) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    // Re-encoding resizes the photo and drops its metadata (location included).
    const rendered = await ImageManipulator.manipulate(asset.uri).resize({ width: 1600 }).renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
    const local: Photo = { uri: saved.uri, path: null };
    setPhotos((p) => [...p, local]);
    try {
      const path = `uploads/${user.uid}/${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
      const blob = await (await fetch(saved.uri)).blob();
      await uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg' });
      setPhotos((p) => p.map((x) => (x === local ? { ...x, path } : x)));
    } catch (e) {
      setPhotos((p) => p.filter((x) => x !== local));
      showAlert("Couldn't add that photo", errorText(e));
    }
  };

  const review = (analysis: Analysis) => {
    setRemovePII(true);
    setUseRewrite(false);
    setDropped(new Set());
    setUntagged(new Set());
    setAddedTags([]);
    setVisibility('public');
    setPrivateTo(analysis.subjects.findIndex((s) => s.kind === 'organization'));
    setStep({ kind: 'review', analysis });
  };

  // A queued complaint that has since been checked (from its notification).
  const draftParam = params.draft;
  useEffect(() => {
    if (!draftParam || !user) return;
    let live = true;
    getDraft({ draftId: draftParam })
      .then(({ text: saved, ...analysis }) => {
        if (!live) return;
        setText(saved);
        review(analysis);
      })
      .catch((e) => showAlert("Couldn't open that complaint", errorText(e)));
    return () => {
      live = false;
    };
  }, [draftParam, user]);

  const check = async () => {
    setBusy(true);
    try {
      const res = await analyzeComplaint({
        text: text.trim(),
        photoPaths: photos.flatMap((p) => (p.path ? [p.path] : [])),
        ...(params.subjectId ? { subjectId: params.subjectId } : {}),
      });
      if (res.queued) {
        setStep({ kind: 'queued' });
        void offerPush('posted', !!profile?.pushOn);
        return;
      }
      review(res);
    } catch (e) {
      showAlert("Couldn't check your complaint", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const post = async (analysis: Analysis) => {
    setBusy(true);
    try {
      const res = await submitComplaint({
        draftId: analysis.draftId,
        useRewrite,
        removePII,
        keepPoints: analysis.result.points.map((_, i) => i).filter((i) => !dropped.has(i)),
        removeSubjects: [...untagged],
        addSubjectIds: addedTags.map((t) => t.id!),
        visibility,
        ...(visibility === 'private' && privateTo !== null ? { privateTo } : {}),
        ...(agreed ? { acceptTerms: true } : {}),
      });
      successHaptic();
      if (res.visibility === 'private') setStep({ kind: 'sent', ...res });
      else setStep({ kind: 'done', analysis, matched: res.matchedPointIds, added: res.addedPointIds });
      void offerPush(res.visibility === 'private' ? 'private' : 'posted', !!profile?.pushOn);
    } catch (e) {
      showAlert("Couldn't post", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setText('');
    setPhotos([]);
    setStep({ kind: 'write' });
    if (params.subjectId || params.draft) router.setParams({ subjectId: undefined, subjectName: undefined, draft: undefined });
  };

  if (step.kind === 'queued') {
    return (
      <Screen topInset>
        <Ionicons name="hourglass-outline" size={44} color={theme.primary} />
        <T variant="title">Saved. It&apos;s in line.</T>
        <T>
          So many complaints came in today that checking them is paused until tomorrow. Yours is saved, nothing is
          lost: we&apos;ll check it as soon as checking reopens and notify you to review and post it.
        </T>
        <Button label="Complain about something else" onPress={reset} kind="quiet" />
      </Screen>
    );
  }

  if (step.kind === 'sent') {
    return (
      <Screen topInset>
        <Ionicons name="lock-closed" size={44} color={theme.primary} />
        <T variant="title">Sent privately to {step.orgName}.</T>
        <T>
          Only {step.orgName} can read it, and they can reply to you here. What it&apos;s about is counted for them
          ({step.pointCount} point{step.pointCount === 1 ? '' : 's'}), but nothing about it is shown publicly.
        </T>
        {!step.claimed && (
          <Notice tone="warn">
            <T>
              {step.orgName} hasn&apos;t joined UCS yet. Your complaint is held for them and they&apos;ll see it when
              they do. We&apos;ll tell you when that happens.
            </T>
            {step.website && (
              <Button
                kind="secondary"
                label={`Their own support: ${step.website.replace(/^https?:\/\//, '')}`}
                onPress={() => Linking.openURL(step.website!.startsWith('http') ? step.website! : `https://${step.website}`)}
              />
            )}
          </Notice>
        )}
        <Button
          label="Open the conversation"
          icon="chatbubbles"
          onPress={() => router.push(`/thread/${step.orgId}/${step.threadId}`)}
        />
        <Button label="Complain about something else" onPress={reset} kind="quiet" />
      </Screen>
    );
  }

  if (step.kind === 'done') {
    const total = step.matched.length + step.added.length;
    return (
      <Screen topInset>
        <Stamp />
        <T variant="title">It&apos;s on the record.</T>
        <T>
          Your complaint is counted and public. You now support {total} point{total === 1 ? '' : 's'}
          {step.matched.length > 0 &&
            `, ${step.matched.length} of them shared with people who said it before you`}
          . We&apos;ll tell you when anything moves on them.
        </T>
        {step.added.length > 0 && (
          <Notice tone="new">
            <T variant="small" color={theme.new}>
              {step.added.length} new point{step.added.length === 1 ? ' was' : 's were'} added to the record from
              what you wrote.
            </T>
          </Notice>
        )}
        {step.matched.map((id) => (
          <Card key={id} onPress={() => router.push(`/point/${id}`)}>
            <T>{step.analysis.matched[id]?.text}</T>
          </Card>
        ))}
        {step.added.map((id, i) => (
          <Card key={id} onPress={() => router.push(`/point/${id}`)}>
            <Chip label="New point" color={theme.new} bg={theme.newSoft} />
            <T>{newStatements(step.analysis, dropped)[i]}</T>
          </Card>
        ))}
        <Button label="Complain about something else" onPress={reset} kind="quiet" />
      </Screen>
    );
  }

  if (step.kind === 'review') {
    const { result, subjects, matched } = step.analysis;
    const unpostablePhotos = result.photos.filter((p) => !p.ok || p.containsPersonalData).length;
    const keptCount = result.points.length - dropped.size;
    // Only organizations can receive private complaints; topics can't.
    const orgIndexes = subjects.flatMap((s, i) => (s.kind === 'organization' && !untagged.has(i) ? [i] : []));
    const isPrivate = visibility === 'private' && privateTo !== null && orgIndexes.includes(privateTo);
    const privateName = isPrivate ? subjects[privateTo!].name : '';
    return (
      <Screen topInset>
        <T variant="title">Here&apos;s what we found</T>
        {result.safety?.unsafe ? (
          <>
            <Notice tone="warn">
              <T variant="label">This can&apos;t go on the record</T>
              <T>{result.safety.reason ?? 'It breaks the terms of use.'}</T>
              <T variant="small">
                Anger and harsh criticism of organizations are welcome here. Threats, hate, sexual content and posts
                aimed at private people never are.
              </T>
            </Notice>
            <Button label="Edit what I wrote" kind="secondary" onPress={() => setStep({ kind: 'write' })} />
          </>
        ) : !result.isComplaint ? (
          <>
            <Notice tone="warn">
              <T>{result.notComplaintReason ?? 'There is nothing here to record as a complaint.'}</T>
            </Notice>
            <Button label="Edit" kind="secondary" onPress={() => setStep({ kind: 'write' })} />
          </>
        ) : (
          <>
            {result.supportTicket.isTicket && (
              <Notice tone="warn">
                <T variant="label">This sounds like a private case</T>
                <T>
                  {result.supportTicket.advice ??
                    'Only the organization can look up your own order or account: send it to them privately.'}
                </T>
                {orgIndexes.length > 0 ? (
                  visibility === 'public' && (
                    <Button
                      kind="secondary"
                      icon="lock-closed"
                      label={`Send it privately to ${subjects[orgIndexes[0]].name}`}
                      onPress={() => {
                        setVisibility('private');
                        setPrivateTo(orgIndexes[0]);
                      }}
                    />
                  )
                ) : (
                  <T variant="small">
                    The general problem behind it is still worth recording below, so others can join it.
                  </T>
                )}
              </Notice>
            )}

            <FiledUnder
              tags={subjects}
              removed={untagged}
              onRemove={(i) => setUntagged((u) => new Set(u).add(i))}
              onRestore={(i) =>
                setUntagged((u) => {
                  const n = new Set(u);
                  n.delete(i);
                  return n;
                })
              }
              added={addedTags}
              onAdd={(t) => setAddedTags((a) => [...a, t])}
              onUnadd={(id) => setAddedTags((a) => a.filter((t) => t.id !== id))}
            />

            {orgIndexes.length > 0 && (
              <Card>
                <T variant="label">Who sees it</T>
                <Tabs
                  options={[
                    { key: 'public', label: 'Public' },
                    { key: 'private', label: 'Private' },
                  ]}
                  value={isPrivate ? 'private' : 'public'}
                  onChange={(v) => {
                    setVisibility(v);
                    if (v === 'private' && (privateTo === null || !orgIndexes.includes(privateTo))) {
                      setPrivateTo(orgIndexes[0]);
                    }
                  }}
                />
                {isPrivate ? (
                  <>
                    {orgIndexes.length > 1 && (
                      <Row style={{ flexWrap: 'wrap' }}>
                        {orgIndexes.map((i) => (
                          <Pressable key={i} onPress={() => setPrivateTo(i)} accessibilityRole="radio">
                            <Chip
                              label={subjects[i].name}
                              color={i === privateTo ? theme.onPrimary : theme.text}
                              bg={i === privateTo ? theme.primaryFill : theme.backgroundElement}
                            />
                          </Pressable>
                        ))}
                      </Row>
                    )}
                    <T>
                      Only {privateName} can read it, and they can reply to you. What it&apos;s about is still counted
                      for them, but nothing about it is shown publicly and it doesn&apos;t add to any public count.
                    </T>
                    {!canSendPrivately && (
                      <Notice tone="warn">
                        <T>Private complaints need a verified email, so {privateName} can reach you.</T>
                        <Button kind="secondary" label="Add your email" onPress={() => router.push('/account')} />
                      </Notice>
                    )}
                  </>
                ) : (
                  <T>
                    Anyone can read what you wrote and add their support. The more support a point has, the more
                    likely it gets fixed.
                  </T>
                )}
              </Card>
            )}

            <T variant="label">
              {Object.keys(matched).length} existing · {result.points.filter((p) => !p.matchedPointId).length} new
            </T>
            {result.points.map((p, i) => {
              const hit = p.matchedPointId ? matched[p.matchedPointId] : null;
              const kept = !dropped.has(i);
              return (
                <Card key={i} style={!kept && { opacity: 0.5 }}>
                  {hit ? (
                    <Chip label={`Matches · ${hit.supportCount} already said it`} color={theme.primary} bg={theme.primarySoft} />
                  ) : (
                    <Chip label="New point · added by the model" color={theme.new} bg={theme.newSoft} />
                  )}
                  {step.analysis.alsoPrivate?.[i] && !isPrivate && (
                    <Chip label="Others have raised this privately too" color={theme.textSecondary} bg={theme.background} />
                  )}
                  <T>{hit ? hit.text : p.statement}</T>
                  {hit && hit.text !== p.statement && <T variant="small">From yours: “{p.statement}”</T>}
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T variant="small">{kept ? 'Included' : 'Left out'}</T>
                    <Switch
                      value={kept}
                      onValueChange={(on) =>
                        setDropped((d) => {
                          const n = new Set(d);
                          if (on) n.delete(i);
                          else n.add(i);
                          return n;
                        })
                      }
                    />
                  </Row>
                </Card>
              );
            })}

            {result.pii.sensitive.length > 0 && (
              <Notice tone="warn">
                <T variant="small">
                  Removed before anything is stored, public or private: {result.pii.sensitive.join(', ')}. No
                  organization ever needs these in a message.
                </T>
              </Notice>
            )}

            {!isPrivate && result.pii.found.length > 0 && result.pii.redactedText && (
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="heading" style={{ flex: 1 }}>
                    Remove personal details
                  </T>
                  <Switch value={removePII} onValueChange={setRemovePII} />
                </Row>
                <T variant="small">Found: {result.pii.found.join(', ')}. Your complaint is public.</T>
                {removePII && <T variant="small">Posts as: “{result.pii.redactedText}”</T>}
              </Card>
            )}

            {result.coaching && result.suggestedRewrite && (
              <Card>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="heading" style={{ flex: 1 }}>
                    Post a clearer version?
                  </T>
                  <Switch value={useRewrite} onValueChange={setUseRewrite} />
                </Row>
                <T variant="small">{result.coaching}</T>
                <T>“{result.suggestedRewrite}”</T>
                <T variant="small">
                  Optional. The clearest wording of a point becomes its headline, credited to whoever wrote it.
                </T>
              </Card>
            )}

            {(isPrivate ? result.photos.filter((p) => !p.ok).length : unpostablePhotos) > 0 && (
              <Notice tone="warn">
                <T variant="small">
                  {unpostablePhotos} photo{unpostablePhotos === 1 ? '' : 's'} won&apos;t be posted (personal details
                  or not suitable).
                </T>
              </Notice>
            )}

            <TermsCheck checked={agreed} onChange={setAgreed} />
            <Button
              label={
                isPrivate
                  ? `Send privately to ${privateName}`
                  : `Post to the record (${keptCount} point${keptCount === 1 ? '' : 's'})`
              }
              icon={isPrivate ? 'lock-closed' : undefined}
              onPress={() => post(step.analysis)}
              busy={busy}
              disabled={
                keptCount === 0 ||
                (!termsAccepted && !agreed) ||
                (untagged.size >= subjects.length && addedTags.length === 0) ||
                (isPrivate && !canSendPrivately)
              }
            />
            <Button label="Edit what I wrote" kind="quiet" onPress={() => setStep({ kind: 'write' })} />
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen topInset>
      <T variant="title">Complain</T>
      <T>
        About any company, product, or thing. Say what&apos;s wrong or what could be better. Rants are welcome;
        specifics get things fixed.
      </T>
      {params.subjectName && (
        <Chip label={`About ${params.subjectName}`} color={theme.primary} bg={theme.primarySoft} />
      )}
      <Field
        multiline
        value={text}
        onChangeText={setText}
        placeholder="What's wrong?"
        maxLength={4000}
        accessibilityLabel="Your complaint"
      />
      <Row style={{ flexWrap: 'wrap' }}>
        {photos.map((p, i) => (
          <View key={i}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
            <Pressable
              accessibilityLabel="Remove photo"
              onPress={() => setPhotos((ps) => ps.filter((x) => x !== p))}
              style={[styles.remove, { backgroundColor: theme.text }]}>
              <Ionicons name="close" size={14} color={theme.background} />
            </Pressable>
          </View>
        ))}
        {photos.length < MAX_PHOTOS && (
          <Pressable
            onPress={addPhoto}
            accessibilityLabel="Add a photo"
            style={[styles.thumb, styles.addPhoto, { borderColor: theme.border }]}>
            <Ionicons name="camera-outline" size={24} color={theme.textSecondary} />
          </Pressable>
        )}
      </Row>

      {searching && similar.length > 0 && (
        <>
          <T variant="label">Already on the record? Tap “Same here”</T>
          {similar.map((p) => (
            <PointCard key={p.id} point={p} />
          ))}
        </>
      )}
      {searching && raisedPrivately && (
        <T variant="small">Others have raised something like this privately.</T>
      )}

      <Button
        label="Check my complaint"
        onPress={check}
        busy={busy}
        disabled={text.trim().length < 8 || photos.some((p) => !p.path)}
      />
      <T variant="small">
        Nothing is sent until you see how it will be recorded, and choose public or private. No account needed
        for public complaints.
      </T>
    </Screen>
  );
}

/** The "on the record" moment: a rubber stamp that lands. */
function Stamp() {
  const theme = useTheme();
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, friction: 5, tension: 120, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [anim]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] });
  return (
    <Animated.View
      accessibilityLabel="On the record"
      style={[
        styles.stamp,
        { borderColor: theme.good, opacity: anim, transform: [{ rotate: '-8deg' }, { scale }] },
      ]}>
      <Text style={[styles.stampText, { color: theme.good }]}>ON THE RECORD</Text>
    </Animated.View>
  );
}

/** The kept new points, in the order the server created them. */
function newStatements(analysis: Analysis, dropped: Set<number>) {
  return analysis.result.points.filter((p, i) => !dropped.has(i) && !p.matchedPointId).map((p) => p.statement);
}

const styles = StyleSheet.create({
  stamp: {
    alignSelf: 'flex-start',
    borderWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginVertical: 8,
  },
  stampText: { fontSize: 22, fontWeight: '900', letterSpacing: 2 },
  thumb: { width: 72, height: 72, borderRadius: 10 },
  addPhoto: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
