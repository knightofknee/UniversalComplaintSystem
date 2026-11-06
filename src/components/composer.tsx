import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ref, uploadBytes } from "firebase/storage";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FiledUnder, type Tag } from "@/components/filed-under";
import { PointCard, PointList, shortCount } from "@/components/point-card";
import { TermsCheck, useTermsAccepted } from "@/components/terms-check";
import { Button, Chip, InlineError, Row, T, Tabs } from "@/components/ui";
import { Fonts } from "@/constants/theme";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import {
  analyzeComplaint,
  errorText,
  getDraft,
  searchPoints,
  submitComplaint,
} from "@/lib/api";
import { storage } from "@/lib/firebase";
import { successHaptic } from "@/lib/haptics";
import { offerPush } from "@/lib/push";
import { MIN_WORDS, readComplaint, type Read } from "@/lib/read";
import type { Analysis, PointHit } from "@/lib/types";

const MAX_PHOTOS = 4;
const SEARCH_AFTER_CHARS = 15;
/** Cosine distance under which a point "sounds familiar" (search itself goes to 0.45). */
const FAMILIAR = 0.3;
const PROMPTS = [
  "What's bugging you?",
  "What broke today?",
  "Who let you down?",
  "What should be better?",
  "Go on. Say it.",
];

type Photo = { uri: string; path: string | null };
type Step =
  | { kind: "write" }
  | { kind: "queued" }
  | { kind: "review"; analysis: Analysis }
  | { kind: "done"; analysis: Analysis; matched: string[]; added: string[] }
  | {
      kind: "sent";
      orgId: string;
      orgName: string;
      threadId: string;
      claimed: boolean;
      website: string | null;
      pointCount: number;
    };

/**
 * The first thing anyone sees: a nearly empty page and a place to type. As
 * they type it fills in: how hot it reads, what would make it fixable, and
 * who already said the same thing. Checking it shows how it would post, on
 * the same page; nothing is public until they post.
 */
export function Composer({ home }: { home?: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const canSendPrivately = !!user && !user.isAnonymous && user.emailVerified;
  const termsAccepted = useTermsAccepted();
  const [agreed, setAgreed] = useState(false);
  const params = useLocalSearchParams<{
    subjectId?: string;
    subjectName?: string;
    draft?: string;
  }>();
  const [prompt] = useState(
    () => PROMPTS[Math.floor(Math.random() * PROMPTS.length)],
  );
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [similar, setSimilar] = useState<PointHit[]>([]);
  const [raisedPrivately, setRaisedPrivately] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "write" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removePII, setRemovePII] = useState(true);
  const [useRewrite, setUseRewrite] = useState(false);
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [untagged, setUntagged] = useState<Set<number>>(new Set());
  const [addedTags, setAddedTags] = useState<Tag[]>([]);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  /** Index into the analysis's subjects: which organization a private complaint goes to. */
  const [privateTo, setPrivateTo] = useState<number | null>(null);
  const searchSeq = useRef(0);
  const read = readComplaint(text);
  const searching = text.trim().length >= SEARCH_AFTER_CHARS;

  // Who already said it, while typing.
  useEffect(() => {
    if (step.kind !== "write" || text.trim().length < SEARCH_AFTER_CHARS)
      return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await searchPoints({ query: text.trim() });
        if (seq !== searchSeq.current) return;
        // Only close matches here: "Sounds familiar" should mean it.
        setSimilar(res.points.filter((p) => (p.distance ?? 0) < FAMILIAR).slice(0, 5));
        setRaisedPrivately(res.raisedPrivately);
      } catch {
        // Search is a convenience; a failure just shows nothing.
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [text, step.kind]);

  const addPhoto = async () => {
    if (!user) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (picked.canceled) return;
    // Re-encoding resizes the photo and drops its metadata (location included).
    const rendered = await ImageManipulator.manipulate(picked.assets[0].uri)
      .resize({ width: 1600 })
      .renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.7,
    });
    const local: Photo = { uri: saved.uri, path: null };
    setPhotos((p) => [...p, local]);
    try {
      const path = `uploads/${user.uid}/${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
      const blob = await (await fetch(saved.uri)).blob();
      await uploadBytes(ref(storage, path), blob, {
        contentType: "image/jpeg",
      });
      setPhotos((p) => p.map((x) => (x === local ? { ...x, path } : x)));
    } catch (e) {
      setPhotos((p) => p.filter((x) => x !== local));
      setError(`That photo didn't upload. ${errorText(e)}`);
    }
  };

  const review = (analysis: Analysis) => {
    setRemovePII(true);
    setUseRewrite(false);
    setDropped(new Set());
    setUntagged(new Set());
    setAddedTags([]);
    setVisibility("public");
    setPrivateTo(analysis.subjects.findIndex((s) => s.kind === "organization"));
    setStep({ kind: "review", analysis });
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
      .catch((e) => setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [draftParam, user]);

  const check = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await analyzeComplaint({
        text: text.trim(),
        photoPaths: photos.flatMap((p) => (p.path ? [p.path] : [])),
        ...(params.subjectId ? { subjectId: params.subjectId } : {}),
      });
      if (res.queued) {
        setStep({ kind: "queued" });
        void offerPush("posted", !!profile?.pushOn);
        return;
      }
      review(res);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const post = async (analysis: Analysis) => {
    setError(null);
    setBusy(true);
    try {
      const res = await submitComplaint({
        draftId: analysis.draftId,
        useRewrite,
        removePII,
        keepPoints: analysis.result.points
          .map((_, i) => i)
          .filter((i) => !dropped.has(i)),
        removeSubjects: [...untagged],
        addSubjectIds: addedTags.map((t) => t.id!),
        visibility,
        ...(visibility === "private" && privateTo !== null
          ? { privateTo }
          : {}),
        ...(agreed ? { acceptTerms: true } : {}),
      });
      successHaptic();
      if (res.visibility === "private") setStep({ kind: "sent", ...res });
      else
        setStep({
          kind: "done",
          analysis,
          matched: res.matchedPointIds,
          added: res.addedPointIds,
        });
      void offerPush(
        res.visibility === "private" ? "private" : "posted",
        !!profile?.pushOn,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setText("");
    setPhotos([]);
    setSimilar([]);
    setError(null);
    setStep({ kind: "write" });
    if (params.subjectId || params.draft)
      router.setParams({
        subjectId: undefined,
        subjectName: undefined,
        draft: undefined,
      });
  };

  const top = home ? (
    <Row style={{ justifyContent: "space-between" }}>
      <Row style={{ gap: 8 }}>
        <Image
          source={require("../../assets/images/mark.png")}
          style={styles.mark}
          accessibilityIgnoresInvertColors
        />
        <Text style={[styles.wordmark, { color: theme.text }]}>UCS</Text>
      </Row>
      <Pressable
        onPress={() => router.push("/browse")}
        accessibilityRole="link"
        hitSlop={8}
        style={({ pressed }) => [
          styles.recordLink,
          { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text
          style={{
            color: theme.text,
            fontFamily: Fonts.bold,
            fontSize: 15,
            paddingRight: 2,
          }}
        >
          The Record
        </Text>
        <Ionicons name="arrow-forward" size={16} color={theme.text} />
      </Pressable>
    </Row>
  ) : null;

  // ---- After posting -------------------------------------------------------
  if (step.kind === "queued" || step.kind === "sent" || step.kind === "done") {
    return (
      <Page top={top} insets={insets} home={home}>
        {step.kind === "queued" && (
          <>
            <Text style={styles.bigEmoji}>⏳</Text>
            <T variant="title">Saved. It&apos;s in line.</T>
            <T>
              So many complaints came in today that checking is paused until
              tomorrow. Yours is safe: we&apos;ll check it as soon as we can and
              ping you to post it.
            </T>
          </>
        )}
        {step.kind === "sent" && (
          <>
            <Text style={styles.bigEmoji}>🔒</Text>
            <T variant="title">Sent to {step.orgName}. Just them.</T>
            <T>
              Only {step.orgName} can read it, and they can reply to you here.
              It counts toward what they hear about, but nothing of it is
              public.
            </T>
            {!step.claimed && (
              <T variant="small">
                {step.orgName} isn&apos;t on UCS yet, so it waits for them.
                We&apos;ll tell you when they show up.
                {step.website
                  ? " Meanwhile, their own support might help:"
                  : ""}
              </T>
            )}
            {!step.claimed && step.website && (
              <Button
                kind="secondary"
                label={step.website.replace(/^https?:\/\//, "")}
                onPress={() =>
                  Linking.openURL(
                    step.website!.startsWith("http")
                      ? step.website!
                      : `https://${step.website}`,
                  )
                }
              />
            )}
            <Button
              label="Open the conversation"
              icon="chatbubbles"
              onPress={() =>
                router.push(`/thread/${step.orgId}/${step.threadId}`)
              }
            />
          </>
        )}
        {step.kind === "done" && <Done step={step} dropped={dropped} />}
        <Button
          label="Complain about something else"
          kind="secondary"
          onPress={reset}
        />
        {home && (
          <Button
            label="See the record"
            kind="quiet"
            onPress={() => router.push("/browse")}
          />
        )}
      </Page>
    );
  }

  // ---- Writing, and then the check ---------------------------------------
  const reviewing = step.kind === "review";
  const analysis = reviewing ? step.analysis : null;
  const result = analysis?.result;
  const blocked = !!result && (result.safety?.unsafe || !result.isComplaint);
  const orgIndexes = analysis
    ? analysis.subjects.flatMap((s, i) =>
        s.kind === "organization" && !untagged.has(i) ? [i] : [],
      )
    : [];
  const isPrivate =
    visibility === "private" &&
    privateTo !== null &&
    orgIndexes.includes(privateTo);
  const privateName =
    isPrivate && analysis ? analysis.subjects[privateTo!].name : "";
  const keptCount = result ? result.points.length - dropped.size : 0;
  const ready = read.words >= MIN_WORDS && !photos.some((p) => !p.path);

  const bar = reviewing ? (
    blocked ? (
      <Button
        label="Edit it"
        kind="secondary"
        onPress={() => setStep({ kind: "write" })}
      />
    ) : (
      <>
        <TermsCheck checked={agreed} onChange={setAgreed} compact />
        <Button
          label={
            isPrivate
              ? `Send to ${privateName}`
              : keptCount === 0
                ? "Nothing to post"
                : "Post it"
          }
          icon={isPrivate ? "lock-closed" : "megaphone"}
          onPress={() => post(analysis!)}
          busy={busy}
          disabled={
            keptCount === 0 ||
            (!termsAccepted && !agreed) ||
            (untagged.size >= analysis!.subjects.length &&
              addedTags.length === 0) ||
            (isPrivate && !canSendPrivately)
          }
        />
      </>
    )
  ) : text.trim().length > 0 ? (
    <Button
      label={
        ready
          ? "See how it posts"
          : `Keep going (${Math.max(0, MIN_WORDS - read.words)} more words)`
      }
      icon={ready ? "sparkles" : undefined}
      onPress={check}
      busy={busy}
      disabled={!ready}
    />
  ) : null;

  return (
    <Page
      top={top}
      insets={insets}
      home={home}
      bar={bar}
      error={error}
      onDismissError={() => setError(null)}
    >
      {params.subjectName && !reviewing && (
        <Chip
          label={`About ${params.subjectName}`}
          color={theme.primary}
          bg={theme.primarySoft}
        />
      )}

      {reviewing ? (
        <Pressable
          onPress={() => setStep({ kind: "write" })}
          accessibilityRole="button"
          accessibilityLabel="Edit what you wrote"
        >
          <View style={[styles.quote, { borderLeftColor: theme.primary }]}>
            <Text
              style={[styles.quoteText, { color: theme.text }]}
              numberOfLines={6}
            >
              {text.trim()}
            </Text>
            <Text
              style={{
                color: theme.primary,
                fontFamily: Fonts.bold,
                fontSize: 14,
              }}
            >
              Edit
            </Text>
          </View>
        </Pressable>
      ) : (
        <TextInput
          multiline
          autoFocus={home && Platform.OS !== "web"}
          value={text}
          onChangeText={setText}
          placeholder={
            params.subjectName
              ? `What's wrong with ${params.subjectName}?`
              : prompt
          }
          placeholderTextColor={theme.textSecondary}
          maxLength={4000}
          accessibilityLabel="Your complaint"
          style={[styles.box, { color: theme.text }]}
        />
      )}

      {!reviewing && text.trim().length === 0 && (
        <View style={{ gap: 6 }}>
          <T color={theme.textSecondary}>
            Type it out and see who else has the same problem. Nothing is posted
            until you say so.
          </T>
          <T variant="small">
            Vent all you want. Then say what would make it better: that&apos;s
            the part that gets things fixed.
          </T>
        </View>
      )}

      {!reviewing && (
        <Row style={{ flexWrap: "wrap" }}>
          {photos.map((p, i) => (
            <View key={i}>
              <Image source={{ uri: p.uri }} style={styles.thumb} />
              <Pressable
                accessibilityLabel="Remove photo"
                onPress={() => setPhotos((ps) => ps.filter((x) => x !== p))}
                style={[styles.remove, { backgroundColor: theme.text }]}
              >
                <Ionicons name="close" size={14} color={theme.background} />
              </Pressable>
            </View>
          ))}
          {photos.length < MAX_PHOTOS && (
            <Pressable
              onPress={addPhoto}
              accessibilityLabel="Add a photo"
              hitSlop={6}
              style={({ pressed }) => [
                styles.photoButton,
                { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons
                name="camera-outline"
                size={18}
                color={theme.textSecondary}
              />
              <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
                {photos.length ? "Another" : "Photo"}
              </Text>
            </Pressable>
          )}
        </Row>
      )}

      {!reviewing && read.words > 0 && <ReadOut read={read} />}

      {!reviewing && searching && similar.length > 0 && (
        <View style={{ gap: 4 }}>
          <T variant="heading">Sounds familiar</T>
          <T variant="small">
            Already on the record? Hit the arrow to add your voice
            {read.words >= MIN_WORDS ? ", or post yours too" : ""}.
          </T>
          <PointList>
            {similar.map((p) => (
              <PointCard key={p.id} point={p} />
            ))}
          </PointList>
        </View>
      )}
      {!reviewing && searching && raisedPrivately && (
        <T variant="small">
          Others have raised something like this privately too.
        </T>
      )}

      {reviewing && result && analysis && (
        <ReviewSection
          analysis={analysis}
          dropped={dropped}
          setDropped={setDropped}
          untagged={untagged}
          setUntagged={setUntagged}
          addedTags={addedTags}
          setAddedTags={setAddedTags}
          orgIndexes={orgIndexes}
          isPrivate={isPrivate}
          privateName={privateName}
          setVisibility={setVisibility}
          privateTo={privateTo}
          setPrivateTo={setPrivateTo}
          canSendPrivately={canSendPrivately}
          removePII={removePII}
          setRemovePII={setRemovePII}
          useRewrite={useRewrite}
          setUseRewrite={setUseRewrite}
          onEdit={() => setStep({ kind: "write" })}
        />
      )}
    </Page>
  );
}

/** The page: scrolls, keeps the action bar above the keyboard. */
function Page({
  top,
  insets,
  home,
  bar,
  error,
  onDismissError,
  children,
}: {
  top: ReactNode;
  insets: { top: number; bottom: number };
  home?: boolean;
  bar?: ReactNode;
  error?: string | null;
  onDismissError?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.page,
          { paddingTop: (home ? insets.top : 0) + 12, paddingBottom: 24 },
        ]}
      >
        {top}
        {children}
      </ScrollView>
      {(bar || error) && (
        <View
          style={[
            styles.bar,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: theme.background,
              borderTopColor: theme.border,
            },
          ]}
        >
          <InlineError text={error ?? null} onDismiss={onDismissError} />
          {bar}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/** Heat and fixability, live. */
function ReadOut({ read }: { read: Read }) {
  const theme = useTheme();
  const heatColors = [
    theme.textSecondary,
    theme.primary,
    theme.warning,
    theme.rant,
    theme.danger,
  ];
  const parts: [keyof Read, string][] = [
    ["who", "who"],
    ["what", "what"],
    ["when", "when"],
    ["fix", "the fix"],
  ];
  return (
    <View
      style={[styles.read, { backgroundColor: theme.backgroundElement }]}
      accessibilityLiveRegion="polite"
    >
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={[styles.readLabel, { color: theme.textSecondary }]}>
          HEAT
        </Text>
        <Row style={{ gap: 4 }}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.heatBar,
                {
                  backgroundColor:
                    i < read.heat ? heatColors[read.heat] : theme.border,
                },
              ]}
            />
          ))}
          <Text style={[styles.heatText, { color: heatColors[read.heat] }]}>
            {read.heat >= 3 ? "🔥 " : ""}
            {read.heatLabel}
          </Text>
        </Row>
      </Row>
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={[styles.readLabel, { color: theme.textSecondary }]}>
          FIXABLE
        </Text>
        <Row style={{ gap: 10 }}>
          {parts.map(([k, label]) => (
            <Row key={k} style={{ gap: 4 }}>
              <Ionicons
                name={read[k] ? "checkmark-circle" : "ellipse-outline"}
                size={15}
                color={read[k] ? theme.good : theme.textSecondary}
              />
              <Text
                style={{
                  color: read[k] ? theme.text : theme.textSecondary,
                  fontSize: 13,
                  fontWeight: "600",
                }}
              >
                {label}
              </Text>
            </Row>
          ))}
        </Row>
      </Row>
      <Text style={{ color: theme.text, fontSize: 15, lineHeight: 20 }}>
        {read.nudge}
      </Text>
    </View>
  );
}

function ReviewSection(props: {
  analysis: Analysis;
  dropped: Set<number>;
  setDropped: (f: (d: Set<number>) => Set<number>) => void;
  untagged: Set<number>;
  setUntagged: (f: (u: Set<number>) => Set<number>) => void;
  addedTags: Tag[];
  setAddedTags: (f: (a: Tag[]) => Tag[]) => void;
  orgIndexes: number[];
  isPrivate: boolean;
  privateName: string;
  setVisibility: (v: "public" | "private") => void;
  privateTo: number | null;
  setPrivateTo: (i: number) => void;
  canSendPrivately: boolean;
  removePII: boolean;
  setRemovePII: (v: boolean) => void;
  useRewrite: boolean;
  setUseRewrite: (v: boolean) => void;
  onEdit: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { analysis, dropped, isPrivate, orgIndexes } = props;
  const { result, subjects, matched } = analysis;

  if (result.safety?.unsafe) {
    return (
      <Section title="This one can't go up">
        <T>{result.safety.reason ?? "It breaks the terms of use."}</T>
        <T variant="small">
          Anger and harsh words about organizations are welcome. Threats, hate,
          sexual content and posts aimed at private people never are.
        </T>
      </Section>
    );
  }
  if (!result.isComplaint) {
    return (
      <Section title="Hmm, what's the complaint?">
        <T>
          {result.notComplaintReason ??
            "We couldn't find something wrong in there to record."}
        </T>
      </Section>
    );
  }

  const tone =
    result.tone === "rant"
      ? { label: "🔥 Rant", color: theme.rant, bg: theme.rantSoft }
      : result.tone === "constructive"
        ? { label: "🛠 Constructive", color: theme.good, bg: theme.goodSoft }
        : {
            label: "😐 Matter-of-fact",
            color: theme.textSecondary,
            bg: theme.backgroundElement,
          };
  const fixability = Math.round((result.actionability ?? 0) / 10);
  const unpostablePhotos = result.photos.filter(
    (p) => !p.ok || p.containsPersonalData,
  ).length;

  return (
    <View style={{ gap: 22 }}>
      <Section title="The verdict">
        <Row style={{ flexWrap: "wrap" }}>
          <Chip label={tone.label} color={tone.color} bg={tone.bg} />
          <Chip
            label={`Fixability ${fixability}/10`}
            color={theme.primary}
            bg={theme.primarySoft}
          />
        </Row>
        {result.coaching && <T>{result.coaching}</T>}
        {result.coaching && result.suggestedRewrite && (
          <Pressable
            onPress={() => props.setUseRewrite(!props.useRewrite)}
            accessibilityRole="switch"
            accessibilityState={{ checked: props.useRewrite }}
            style={[
              styles.option,
              { borderColor: props.useRewrite ? theme.primary : theme.border },
            ]}
          >
            <Row style={{ justifyContent: "space-between" }}>
              <T style={{ fontWeight: "700", flex: 1 }}>
                Post the sharper version instead
              </T>
              <Switch
                value={props.useRewrite}
                onValueChange={props.setUseRewrite}
              />
            </Row>
            <T variant="small" color={theme.text}>
              “{result.suggestedRewrite}”
            </T>
          </Pressable>
        )}
      </Section>

      {result.supportTicket.isTicket && orgIndexes.length > 0 && !isPrivate && (
        <View style={[styles.tip, { backgroundColor: theme.warningSoft }]}>
          <T>
            {result.supportTicket.advice ??
              "This sounds like your own order or account. Only they can look that up."}
          </T>
          <Button
            kind="secondary"
            icon="lock-closed"
            label={`Send it privately to ${subjects[orgIndexes[0]].name}`}
            onPress={() => {
              props.setVisibility("private");
              props.setPrivateTo(orgIndexes[0]);
            }}
          />
        </View>
      )}

      <Section title="It becomes" hint="Tap one to leave it out.">
        {result.points.map((p, i) => {
          const hit = p.matchedPointId ? matched[p.matchedPointId] : null;
          const kept = !dropped.has(i);
          return (
            <Pressable
              key={i}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: kept }}
              onPress={() =>
                props.setDropped((d) => {
                  const n = new Set(d);
                  if (kept) n.add(i);
                  else n.delete(i);
                  return n;
                })
              }
              style={[
                styles.pointRow,
                { borderTopColor: theme.border, opacity: kept ? 1 : 0.45 },
              ]}
            >
              <Ionicons
                name={kept ? "checkmark-circle" : "ellipse-outline"}
                size={22}
                color={kept ? theme.good : theme.textSecondary}
              />
              <View style={{ flex: 1, gap: 3 }}>
                <T>{hit ? hit.text : p.statement}</T>
                <T variant="small" color={hit ? theme.primary : theme.new}>
                  {hit
                    ? `Joins ${shortCount(hit.supportCount)} ${hit.supportCount === 1 ? "person" : "people"} who said it`
                    : "New point · worded by the model"}
                  {analysis.alsoPrivate?.[i] && !isPrivate
                    ? " · raised privately too"
                    : ""}
                </T>
              </View>
            </Pressable>
          );
        })}
      </Section>

      <FiledUnder
        tags={subjects}
        removed={props.untagged}
        onRemove={(i) => props.setUntagged((u) => new Set(u).add(i))}
        onRestore={(i) =>
          props.setUntagged((u) => {
            const n = new Set(u);
            n.delete(i);
            return n;
          })
        }
        added={props.addedTags}
        onAdd={(t) => props.setAddedTags((a) => [...a, t])}
        onUnadd={(id) =>
          props.setAddedTags((a) => a.filter((t) => t.id !== id))
        }
      />

      {orgIndexes.length > 0 && (
        <Section title="Who sees it">
          <Tabs
            options={[
              { key: "public", label: "🌍 Everyone" },
              { key: "private", label: "🔒 Just them" },
            ]}
            value={isPrivate ? "private" : "public"}
            onChange={(v) => {
              props.setVisibility(v);
              if (
                v === "private" &&
                (props.privateTo === null ||
                  !orgIndexes.includes(props.privateTo))
              ) {
                props.setPrivateTo(orgIndexes[0]);
              }
            }}
          />
          {isPrivate && orgIndexes.length > 1 && (
            <Row style={{ flexWrap: "wrap" }}>
              {orgIndexes.map((i) => (
                <Pressable
                  key={i}
                  onPress={() => props.setPrivateTo(i)}
                  accessibilityRole="radio"
                >
                  <Chip
                    label={subjects[i].name}
                    color={i === props.privateTo ? theme.onPrimary : theme.text}
                    bg={
                      i === props.privateTo
                        ? theme.primaryFill
                        : theme.backgroundElement
                    }
                  />
                </Pressable>
              ))}
            </Row>
          )}
          <T variant="small">
            {isPrivate
              ? `Only ${props.privateName} reads it, and they can reply to you. Nothing of it is public.`
              : "Anyone can read it and add their voice. More voices, more pressure."}
          </T>
          {isPrivate && !props.canSendPrivately && (
            <Button
              kind="secondary"
              label="Add your email to send privately"
              onPress={() => router.push("/account")}
            />
          )}
        </Section>
      )}

      {result.pii.sensitive.length > 0 && (
        <T variant="small">
          Removed before anything is stored: {result.pii.sensitive.join(", ")}.
        </T>
      )}
      {!isPrivate && result.pii.found.length > 0 && result.pii.redactedText && (
        <Row style={{ justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: "700" }}>Hide personal details</T>
            <T variant="small">Found {result.pii.found.join(", ")}.</T>
          </View>
          <Switch value={props.removePII} onValueChange={props.setRemovePII} />
        </Row>
      )}
      {unpostablePhotos > 0 && (
        <T variant="small">
          {unpostablePhotos} photo{unpostablePhotos === 1 ? "" : "s"} won&apos;t
          go up (personal details, or not suitable).
        </T>
      )}
    </View>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View>
        <T variant="heading">{title}</T>
        {hint && <T variant="small">{hint}</T>}
      </View>
      {children}
    </View>
  );
}

function Done({
  step,
  dropped,
}: {
  step: Extract<Step, { kind: "done" }>;
  dropped: Set<number>;
}) {
  const theme = useTheme();
  const router = useRouter();
  const total = step.matched.length + step.added.length;
  const fresh = step.analysis.result.points
    .filter((p, i) => !dropped.has(i) && !p.matchedPointId)
    .map((p) => p.statement);
  return (
    <>
      <Stamp />
      <T variant="title">It&apos;s on the record.</T>
      <T>
        You&apos;re now behind {total} point{total === 1 ? "" : "s"}
        {step.matched.length > 0 &&
          `, ${step.matched.length} alongside people who said it first`}
        . We&apos;ll tell you when anything moves.
      </T>
      <View>
        {step.matched.map((id) => (
          <Pressable
            key={id}
            onPress={() => router.push(`/point/${id}`)}
            style={[styles.pointRow, { borderTopColor: theme.border }]}
          >
            <Ionicons name="people" size={20} color={theme.primary} />
            <T style={{ flex: 1 }}>{step.analysis.matched[id]?.text}</T>
          </Pressable>
        ))}
        {step.added.map((id, i) => (
          <Pressable
            key={id}
            onPress={() => router.push(`/point/${id}`)}
            style={[styles.pointRow, { borderTopColor: theme.border }]}
          >
            <Ionicons name="sparkles" size={20} color={theme.new} />
            <T style={{ flex: 1 }}>{fresh[i]}</T>
          </Pressable>
        ))}
      </View>
    </>
  );
}

/** The "on the record" moment: a rubber stamp that lands. */
function Stamp() {
  const theme = useTheme();
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      friction: 5,
      tension: 120,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [anim]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] });
  return (
    <Animated.View
      accessibilityLabel="On the record"
      style={[
        styles.stamp,
        {
          borderColor: theme.good,
          opacity: anim,
          transform: [{ rotate: "-8deg" }, { scale }],
        },
      ]}
    >
      <Text style={[styles.stampText, { color: theme.good }]}>
        ON THE RECORD
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 20,
    gap: 18,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    flexGrow: 1,
  },
  mark: { width: 28, height: 28 },
  wordmark: { fontFamily: Fonts.display, fontSize: 20, letterSpacing: 0.5 },
  recordLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  box: {
    fontFamily: Fonts.medium,
    fontSize: 26,
    lineHeight: 34,
    minHeight: 150,
    textAlignVertical: "top",
    paddingTop: 8,
    paddingHorizontal: 0,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
  },
  quote: { borderLeftWidth: 3, paddingLeft: 12, gap: 6 },
  quoteText: { fontFamily: Fonts.medium, fontSize: 19, lineHeight: 26 },
  photoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  thumb: { width: 64, height: 64, borderRadius: 12 },
  remove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  read: { borderRadius: 16, padding: 14, gap: 10 },
  readLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  heatBar: { width: 16, height: 8, borderRadius: 4 },
  heatText: { fontFamily: Fonts.bold, fontSize: 14, marginLeft: 6 },
  bar: {
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  option: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  tip: { borderRadius: 16, padding: 14, gap: 10 },
  pointRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bigEmoji: { fontSize: 48 },
  stamp: {
    alignSelf: "flex-start",
    borderWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginVertical: 8,
  },
  stampText: { fontFamily: Fonts.display, fontSize: 24, letterSpacing: 2 },
});
