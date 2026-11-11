import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { ref, uploadBytes } from "firebase/storage";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FiledUnder, type Tag } from "@/components/filed-under";
import { shortCount } from "@/components/point-card";
import { TermsCheck, useTermsAccepted } from "@/components/terms-check";
import { Button, Chip, InlineError, Row, T, Tabs } from "@/components/ui";
import { Fonts } from "@/constants/theme";
import { useAuth } from "@/hooks/use-auth";
import { ConfirmEmail } from "@/components/email-status";
import { setJustPosted } from "@/lib/just-posted";
import { rudyFace, useRudy } from "@/lib/rudy";
import { useTheme } from "@/hooks/use-theme";
import {
  analyzeComplaint,
  errorText,
  getDraft,
  submitComplaint,
} from "@/lib/api";
import { storage } from "@/lib/firebase";
import { successHaptic } from "@/lib/haptics";
import { offerPush } from "@/lib/push";
import { MIN_WORDS, SPICE_LABELS, readComplaint } from "@/lib/read";
import type { Analysis } from "@/lib/types";

const MAX_PHOTOS = 4;

type Photo = { uri: string; path: string | null };
/** The unfinished complaint in the main box, while the app is open. */
const kept = { draft: "" };
const keepDraft = (text: string) => {
  kept.draft = text;
};

type Step =
  | { kind: "write" }
  | { kind: "queued" }
  | { kind: "review"; analysis: Analysis }
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
 * How much of `ref`'s view the keyboard covers, and whether it is up. Measured
 * rather than assumed, so it is right with or without a navigation header
 * above the view (KeyboardAvoidingView needs to be told the header's height).
 */
/**
 * How much of the screen the keyboard took the last time the box was open
 * (keyboard plus its hide bar), remembered across launches. The box opens
 * already laid out for it, so nothing resizes while the keyboard comes up:
 * the screen and the keyboard rise together and land where they are.
 */
const KEYBOARD_KEY = "ucs.composerKeyboard";
let rememberedOverlap: number | null = null;
void AsyncStorage.getItem(KEYBOARD_KEY).then(
  (v) => {
    const n = Number(v);
    if (n > 100) rememberedOverlap = n;
  },
  () => {},
);
/** Before it has ever been measured: about what an iPhone keyboard with its hide bar takes. */
const expectedOverlap = () =>
  rememberedOverlap ?? Math.round(Dimensions.get("window").height * 0.405);

function useKeyboard(
  ref: RefObject<View | null>,
  opts: {
    /** The keyboard opens with the screen: lay out for it from the first frame. */
    expectOpen: boolean;
    /** Set while the screen is leaving: the layout holds still as it goes. */
    frozen: RefObject<boolean>;
  },
) {
  const ios = Platform.OS === "ios";
  const [state, setState] = useState(() =>
    opts.expectOpen && ios
      ? { overlap: expectedOverlap(), visible: true }
      : { overlap: 0, visible: false },
  );
  const { expectOpen, frozen } = opts;
  useEffect(() => {
    const animate = (duration?: number) =>
      LayoutAnimation.configureNext({
        duration: duration || 250,
        update: { type: ios ? "keyboard" : "easeInEaseOut" },
      });
    const show = Keyboard.addListener(
      ios ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        const top = e.endCoordinates.screenY;
        const apply = (bottom: number) => {
          const overlap = Math.max(0, Math.round(bottom - top));
          if (expectOpen && ios && overlap > 100 && overlap !== rememberedOverlap) {
            rememberedOverlap = overlap;
            void AsyncStorage.setItem(KEYBOARD_KEY, String(overlap)).catch(() => {});
          }
          setState((was) => {
            // Already laid out for it: nothing moves.
            if (was.visible && Math.abs(was.overlap - overlap) < 1) return was;
            animate(e.duration);
            return { overlap, visible: true };
          });
        };
        const node = ref.current;
        // This screen runs to the bottom of the window. Measuring it while it
        // is still sliding in would give a moving answer.
        if (!node || expectOpen) return apply(Dimensions.get("window").height);
        node.measureInWindow((_x, y, _w, h) =>
          apply(h > 0 ? y + h : Dimensions.get("window").height),
        );
      },
    );
    const hide = Keyboard.addListener(
      ios ? "keyboardWillHide" : "keyboardDidHide",
      (e) => {
        if (frozen.current) return;
        animate(e?.duration);
        setState({ overlap: 0, visible: false });
      },
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [ref, ios, expectOpen, frozen]);
  return state;
}

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
  // What is typed in the main box survives leaving it (the menu button, a
  // tab, coming back later): closing a screen should never cost someone
  // their words. Kept for the session; cleared once it is posted.
  const [text, setTextState] = useState(() => (home ? kept.draft : ""));
  const setText = (next: string) => {
    if (home) keepDraft(next);
    setTextState(next);
  };
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoMenu, setPhotoMenu] = useState(false);
  const [focused, setFocused] = useState(false);
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
  const wide = useWindowDimensions().width >= 700;
  const rootRef = useRef<View>(null);
  const leaving = useRef(false);
  const keyboard = useKeyboard(rootRef, {
    expectOpen: !!home,
    frozen: leaving,
  });
  const navigation = useNavigation();
  const read = readComplaint(text);
  // Hot the whole time for minutes: Rudy says one kind thing (a hidden extra).
  const rudy = useRudy(read.words > 0 && read.spice >= 3);

  /** Resize, strip metadata (location included), upload. */
  const ingest = async (uri: string) => {
    if (!user) return;
    const rendered = await ImageManipulator.manipulate(uri)
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

  const addPhoto = async (source: "camera" | "library") => {
    setPhotoMenu(false);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError("Camera access is off. Allow it in Settings to take a photo.");
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
      if (shot.canceled) return;
      await ingest(shot.assets[0].uri);
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsMultipleSelection: room > 1,
      selectionLimit: room,
    });
    if (picked.canceled) return;
    for (const a of picked.assets.slice(0, room)) await ingest(a.uri);
  };

  /** Take a photo or choose one: the platform's own sheet on iOS, a row of choices on Android, the file picker on web. */
  const choosePhoto = () => {
    if (Platform.OS === "web") return void addPhoto("library");
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Take Photo", "Choose from Library", "Cancel"], cancelButtonIndex: 2 },
        (i) => {
          if (i === 0) void addPhoto("camera");
          if (i === 1) void addPhoto("library");
        },
      );
      return;
    }
    setPhotoMenu((m) => !m);
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
        setTextState(saved);
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

  const reset = () => {
    setText("");
    setPhotos([]);
    setError(null);
    setStep({ kind: "write" });
    if (params.subjectId || params.draft)
      router.setParams({
        subjectId: undefined,
        subjectName: undefined,
        draft: undefined,
      });
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
      void offerPush(
        res.visibility === "private" ? "private" : "posted",
        !!profile?.pushOn,
      );
      if (res.visibility === "private") setStep({ kind: "sent", ...res });
      else {
        // Posted: the box is cleared and they land on their profile, with
        // the new complaint marked, so they know where it lives.
        // The box goes away as it is (clearing it first would bring the
        // keyboard back up on the way out); only the kept draft is dropped.
        keepDraft("");
        setJustPosted(res.submissionId);
        if (!leaveTo("me")) reset();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Leaving the box for a tab. The box came up from the bottom over the
  // tabs, so it goes back down the same way: the tab underneath is switched
  // first (unseen, the box covers it), then the box drops away. Going
  // "forward" to the tab instead would slide sideways and not match.
  const leaveTo = (tab: "browse" | "me") => {
    const state = navigation.getState();
    const under = state ? state.routes[state.index - 1] : undefined;
    if (home && under?.name === "(tabs)") {
      leaving.current = true;
      // Tell the tabs underneath which tab to show (they follow their
      // `screen` param), then pop the box off them.
      navigation.dispatch({
        type: "SET_PARAMS",
        payload: { params: { screen: tab } },
        source: under.key,
      });
      router.back();
      return true;
    }
    router.navigate(`/${tab}`);
    return false;
  };
  // The menu button always lands on the Complaints tab, whichever tab was open before.
  const leave = () => leaveTo("browse");

  // The main screen carries nothing but the box: a menu button out, a way to get help.
  const top = home ? (
    <Row style={{ justifyContent: "space-between", marginHorizontal: -6 }}>
      <Pressable
        onPress={leave}
        accessibilityRole="button"
        accessibilityLabel="Everything else: complaints, search, your account"
        hitSlop={8}
        style={({ pressed }) => [
          styles.help,
          { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Ionicons name="menu" size={26} color={theme.textSecondary} />
      </Pressable>
      <Pressable
        onPress={() => router.push("/help")}
        accessibilityRole="button"
        accessibilityLabel="Help"
        hitSlop={8}
        style={({ pressed }) => [
          styles.help,
          { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Ionicons name="help-circle-outline" size={26} color={theme.textSecondary} />
      </Pressable>
    </Row>
  ) : null;

  // ---- After posting -------------------------------------------------------
  if (step.kind === "queued" || step.kind === "sent") {
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
        <Button
          label="Complain about something else"
          kind="secondary"
          onPress={reset}
        />
        {home && (
          <Button
            label="See all complaints"
            kind="quiet"
            onPress={leave}
          />
        )}
      </Page>
    );
  }

  // ---- Writing, and then the check ---------------------------------------
  const reviewing = step.kind === "review";
  const analysis = reviewing ? step.analysis : null;
  const result = analysis?.result;
  const blocked =
    !!result &&
    (result.safety?.unsafe || !result.isComplaint || (result.spice ?? 1) >= 5);
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
  ) : null;

  // ---- Writing: the screen is the box --------------------------------------
  // It runs from the two icons to the keyboard. Everything about the
  // complaint lives inside it: the text, photos, one live line, and Next.
  if (!reviewing) {
    return (
      <View
        ref={rootRef}
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingBottom: keyboard.overlap,
        }}
      >
        <View
          style={[
            styles.write,
            {
              paddingTop: (home ? insets.top : 0) + 6,
              paddingBottom: keyboard.visible
                ? 10
                : Math.max(insets.bottom, 12),
            },
          ]}
        >
          {top}
          {params.subjectName && (
            <Chip
              label={`About ${params.subjectName}`}
              color={theme.primary}
              bg={theme.primarySoft}
            />
          )}
          <InlineError text={error} onDismiss={() => setError(null)} />
          <View
            style={[
              styles.box,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: focused ? theme.primary : theme.border,
                // A phone gives it the whole screen; a wide window stops it here.
                maxHeight: wide ? 460 : undefined,
              },
            ]}
          >
            <TextInput
              multiline
              value={text}
              onChangeText={setText}
              autoFocus={home}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="What could be better?"
              placeholderTextColor={theme.textSecondary}
              maxLength={4000}
              accessibilityLabel="Your complaint"
              style={[styles.input, { color: theme.text }]}
            />
            {photos.length > 0 && (
              <Row style={{ flexWrap: "wrap", gap: 10 }}>
                {photos.map((p, i) => (
                  <View key={i}>
                    <Image source={{ uri: p.uri }} style={styles.thumb} />
                    {!p.path && (
                      <View
                        style={[
                          styles.uploading,
                          { backgroundColor: theme.background },
                        ]}
                      />
                    )}
                    <Pressable
                      accessibilityLabel="Remove photo"
                      hitSlop={8}
                      onPress={() =>
                        setPhotos((ps) => ps.filter((x) => x !== p))
                      }
                      style={[styles.remove, { backgroundColor: theme.text }]}
                    >
                      <Ionicons
                        name="close"
                        size={14}
                        color={theme.background}
                      />
                    </Pressable>
                  </View>
                ))}
              </Row>
            )}
            {rudy.line && read.words > 0 && !read.quiet && (
              <Pressable
                onPress={rudy.dismiss}
                accessibilityRole="button"
                accessibilityLabel={`Rudy says: ${rudy.line} Tap to dismiss.`}
                accessibilityLiveRegion="polite"
                style={[styles.bubble, { backgroundColor: theme.rantSoft }]}
              >
                <Text style={[styles.bubbleText, { color: theme.text }]}>
                  {rudy.line}
                </Text>
                <Ionicons name="close" size={15} color={theme.textSecondary} />
                <View
                  style={[styles.bubbleTail, { backgroundColor: theme.rantSoft }]}
                />
              </Pressable>
            )}
            {read.words > 0 && !read.quiet && (
              <View
                style={styles.live}
                accessibilityLiveRegion="polite"
              >
                {/* Rudy: his face follows the peppers, beaming at one, crying at five. */}
                <Image
                  source={rudyFace(read.spice)}
                  style={styles.rudy}
                  accessibilityLabel="Rudy the red pepper"
                />
                <Peppers n={read.spice} size={13} />
                <Text
                  numberOfLines={2}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    lineHeight: 17,
                    color: read.overLine ? theme.danger : theme.textSecondary,
                  }}
                >
                  {read.nudge}
                </Text>
              </View>
            )}
            <Row style={{ justifyContent: "space-between" }}>
              <Row style={{ gap: 14 }}>
                {photos.length < MAX_PHOTOS && (
                  <Pressable
                    onPress={choosePhoto}
                    accessibilityRole="button"
                    accessibilityLabel="Add a photo"
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.tool,
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Ionicons
                      name="add"
                      size={26}
                      color={theme.textSecondary}
                    />
                  </Pressable>
                )}
                {photoMenu && (
                  <>
                    <Pressable
                      onPress={() => addPhoto("camera")}
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.toolText, { color: theme.primary }]}>
                        Take photo
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => addPhoto("library")}
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.toolText, { color: theme.primary }]}>
                        Choose photo
                      </Text>
                    </Pressable>
                  </>
                )}
              </Row>
              <Row style={{ gap: 12 }}>
                {text.length >= 3500 && (
                  <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                    {4000 - text.length}
                  </Text>
                )}
                <Pressable
                  onPress={check}
                  disabled={!ready || busy}
                  accessibilityRole="button"
                  accessibilityLabel="Next"
                  accessibilityState={{ disabled: !ready || busy, busy }}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.next,
                    {
                      backgroundColor: theme.primaryFill,
                      opacity: !ready ? 0.35 : pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={theme.onPrimary} />
                  ) : (
                    <Text style={[styles.nextText, { color: theme.onPrimary }]}>
                      Next
                    </Text>
                  )}
                </Pressable>
              </Row>
            </Row>
          </View>
        </View>
      </View>
    );
  }

  return (
    <Page
      top={top}
      insets={insets}
      home={home}
      bar={bar}
      error={error}
      onDismissError={() => setError(null)}
    >
      {reviewing && (
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
          signedOut={!user || user.isAnonymous}
          removePII={removePII}
          setRemovePII={setRemovePII}
          useRewrite={useRewrite}
          setUseRewrite={setUseRewrite}
          onEdit={() => setStep({ kind: "write" })}
          onUseAlternative={(alt) => {
            setText(alt);
            setStep({ kind: "write" });
          }}
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

/** One to five peppers; the ones past `n` are faded. */
function Peppers({ n, size = 16 }: { n: number; size?: number }) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 1 }}
      accessibilityLabel={`${n} of 5 peppers`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={{ fontSize: size, opacity: i <= n ? 1 : 0.18 }}>
          🌶️
        </Text>
      ))}
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
  /** No email on the account yet (vs. one that isn't confirmed). */
  signedOut: boolean;
  removePII: boolean;
  setRemovePII: (v: boolean) => void;
  useRewrite: boolean;
  setUseRewrite: (v: boolean) => void;
  onEdit: () => void;
  /** Swap the text for one of the model's rewrites and go back to the box. */
  onUseAlternative: (text: string) => void;
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
  if ((result.spice ?? 1) >= 5) {
    return (
      <View style={{ gap: 18 }}>
        <View style={{ gap: 6 }}>
          <Peppers n={5} size={28} />
          <T variant="title">Over the line</T>
          <T>{result.spiceReason ?? "Name-calling at people doesn't go up."}</T>
          <T variant="small">
            Furious is fine. Swearing is fine. Insults at people get sent back,
            and they never got anyone a refund anyway.
          </T>
        </View>
        {(result.alternatives ?? []).length > 0 && (
          <Section title="Same heat, aimed at the problem" hint="Tap one to use it, then edit it however you like.">
            {result.alternatives!.map((alt, i) => (
              <Pressable
                key={i}
                onPress={() => props.onUseAlternative(alt)}
                accessibilityRole="button"
                accessibilityLabel="Use this version"
                style={({ pressed }) => [
                  styles.option,
                  { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <T>{alt}</T>
                <T variant="small" color={theme.primary} style={{ fontWeight: "700" }}>
                  Use this
                </T>
              </Pressable>
            ))}
          </Section>
        )}
      </View>
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
          <Row style={{ gap: 6 }}>
            <Peppers n={result.spice ?? 1} size={14} />
            <T variant="small">{SPICE_LABELS[result.spice ?? 1]}</T>
          </Row>
        </Row>
        {result.suggestedRewrite && (
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
                Post this wording instead
              </T>
              <Switch
                value={props.useRewrite}
                onValueChange={props.setUseRewrite}
              />
            </Row>
            <T variant="small" color={theme.text}>
              “{result.suggestedRewrite}”
            </T>
            <Pressable
              onPress={() => props.onUseAlternative(result.suggestedRewrite!)}
              accessibilityRole="button"
              hitSlop={8}
            >
              <T
                variant="small"
                color={theme.primary}
                style={{ fontWeight: "700" }}
              >
                Edit it first
              </T>
            </Pressable>
          </Pressable>
        )}
      </Section>

      {(result.missing ?? []).length > 0 && (
        <Section
          title="Potentially missing"
          hint="Optional. These would make it easier to act on."
        >
          <View style={{ gap: 6 }}>
            {(result.missing ?? []).map((m) => (
              <Row key={m} style={{ alignItems: "flex-start", gap: 8 }}>
                <Ionicons
                  name="add-circle-outline"
                  size={18}
                  color={theme.textSecondary}
                  style={{ marginTop: 2 }}
                />
                <T style={{ flex: 1 }}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </T>
              </Row>
            ))}
          </View>
          <Button kind="secondary" label="Go back and add" onPress={props.onEdit} />
        </Section>
      )}

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

      <Section title="The issues it raises" hint="Each one collects everyone who has it. Tap one to leave it out.">
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
                <T style={{ fontWeight: "600" }}>{hit ? hit.text : p.statement}</T>
                {!!p.said && (
                  <T variant="small" color={theme.text}>
                    You said: {p.said}
                  </T>
                )}
                <T variant="small" color={hit ? theme.primary : theme.new}>
                  {hit
                    ? `Joins ${shortCount(hit.supportCount)} ${hit.supportCount === 1 ? "person" : "people"} with this issue`
                    : "New issue · worded by the model"}
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
          {isPrivate && !props.canSendPrivately && props.signedOut && (
            <Button
              kind="secondary"
              label="Sign in to send privately"
              onPress={() => router.push("/account")}
            />
          )}
          {isPrivate && !props.canSendPrivately && !props.signedOut && (
            <ConfirmEmail reason="to send privately" />
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

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: 20,
    gap: 18,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    flexGrow: 1,
  },
  help: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  // The writing screen: two icons, then the box down to the keyboard.
  write: {
    flex: 1,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    paddingHorizontal: 16,
    gap: 8,
    justifyContent: "center",
  },
  box: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 10,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.medium,
    fontSize: 20,
    lineHeight: 28,
    textAlignVertical: "top",
    padding: 0,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
  },
  live: { flexDirection: "row", alignItems: "center", gap: 8 },
  rudy: { width: 40, height: 40, marginLeft: -6, marginRight: -4 },
  bubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    maxWidth: "92%",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 2,
  },
  bubbleText: {
    flexShrink: 1,
    fontFamily: Fonts.medium,
    fontSize: 14,
    lineHeight: 19,
  },
  // The little point of the bubble, aimed down at Rudy.
  bubbleTail: {
    position: "absolute",
    left: 10,
    bottom: -4,
    width: 10,
    height: 10,
    borderRadius: 2,
    transform: [{ rotate: "45deg" }],
  },
  next: {
    height: 40,
    minWidth: 88,
    paddingHorizontal: 20,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  nextText: { fontFamily: Fonts.bold, fontSize: 16 },
  tool: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  toolText: { fontSize: 14, fontWeight: "700" },
  quote: { borderLeftWidth: 3, paddingLeft: 12, gap: 6 },
  quoteText: { fontFamily: Fonts.medium, fontSize: 19, lineHeight: 26 },
  thumb: { width: 64, height: 64, borderRadius: 12 },
  uploading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, opacity: 0.5 },
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
});
