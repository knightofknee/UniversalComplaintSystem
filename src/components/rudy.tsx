import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { successHaptic, tapHaptic } from '@/lib/haptics';
import { pick, RUDY_CHEERS, rudyFace } from '@/lib/rudy';

const native = Platform.OS !== 'web';

/**
 * Rudy beside the peppers. His face follows the peppers (beaming at one,
 * crying at five). He hops whenever `hops` goes up (a goal ticked), dances
 * a whole routine while Next is working (`routine`), and wiggles when tapped.
 */
export function Rudy({
  spice,
  dancing,
  hops = 0,
  size = 40,
  onPress,
}: {
  spice: number;
  dancing?: boolean;
  /** Bump it to make him hop once. */
  hops?: number;
  size?: number;
  onPress?: () => void;
}) {
  const [moves] = useState(() => ({
    rot: new Animated.Value(0),
    spin: new Animated.Value(0),
    x: new Animated.Value(0),
    y: new Animated.Value(0),
    sx: new Animated.Value(1),
    sy: new Animated.Value(1),
  }));
  const [hop] = useState(() => new Animated.Value(0));
  const [wiggle] = useState(() => new Animated.Value(0));
  const firstHop = useRef(hops);

  useEffect(() => {
    const { rot, spin, x, y, sx, sy } = moves;
    const rest = () => {
      rot.setValue(0);
      spin.setValue(0);
      x.setValue(0);
      y.setValue(0);
      sx.setValue(1);
      sy.setValue(1);
    };
    if (!dancing) {
      rest();
      return;
    }
    const loop = Animated.loop(routine(moves));
    loop.start();
    return () => {
      loop.stop();
      rest();
    };
  }, [dancing, moves]);

  useEffect(() => {
    if (hops === firstHop.current) return;
    hop.setValue(0);
    Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: native }),
      Animated.spring(hop, { toValue: 0, friction: 3, tension: 160, useNativeDriver: native }),
    ]).start();
  }, [hops, hop]);

  const tap = () => {
    tapHaptic();
    wiggle.setValue(0);
    Animated.timing(wiggle, { toValue: 1, duration: 520, easing: Easing.linear, useNativeDriver: native }).start();
    onPress?.();
  };

  const tilt = wiggle.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -16, 0, 16, 0] });
  const rotate = Animated.add(moves.rot, tilt).interpolate({
    inputRange: [-360, 360],
    outputRange: ['-360deg', '360deg'],
  });
  const turn = moves.spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const jump = hop.interpolate({ inputRange: [0, 1], outputRange: [0, -9] });
  const translateY = Animated.add(moves.y, jump);
  const grow = hop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const scaleX = Animated.multiply(moves.sx, grow);
  const scaleY = Animated.multiply(moves.sy, grow);

  const face = (
    <Animated.View
      style={{
        transform: [{ translateX: moves.x }, { translateY }, { rotate }, { rotate: turn }, { scaleX }, { scaleY }],
      }}>
      <Image
        source={rudyFace(dancing ? 1 : spice)}
        style={{ width: size, height: size }}
        accessibilityIgnoresInvertColors
      />
    </Animated.View>
  );
  if (!onPress) return <View accessibilityLabel="Rudy the red pepper">{face}</View>;
  return (
    <Pressable
      onPress={tap}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={dancing ? 'Rudy the red pepper, dancing while it is read' : 'Rudy the red pepper. Tap him.'}>
      {face}
    </Pressable>
  );
}

type Moves = Record<'rot' | 'spin' | 'x' | 'y' | 'sx' | 'sy', Animated.Value>;

/**
 * Rudy's dance while the model reads, about six seconds and then again: a
 * sway, a double hop with a squash before each jump, a full spin, a quick
 * shimmy, a lean-back bob, and a big finish. Long enough that a wait looks
 * like the show, not a stall.
 */
function routine({ rot, spin, x, y, sx, sy }: Moves) {
  const to = (v: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
    Animated.timing(v, { toValue, duration, easing, useNativeDriver: native });
  const all = (...a: Animated.CompositeAnimation[]) => Animated.parallel(a);
  const squash = (w: number, h: number, ms: number) => all(to(sx, w, ms), to(sy, h, ms));
  const hopOnce = () => Animated.sequence([
    squash(1.14, 0.84, 110),
    all(to(y, -16, 200, Easing.out(Easing.quad)), squash(0.9, 1.12, 200)),
    all(to(y, 0, 170, Easing.in(Easing.quad)), squash(1.12, 0.88, 170)),
    squash(1, 1, 110),
  ]);
  return Animated.sequence([
    // Sway.
    all(to(rot, -14, 240), to(x, -5, 240)),
    all(to(rot, 14, 420), to(x, 5, 420)),
    all(to(rot, -14, 420), to(x, -5, 420)),
    all(to(rot, 0, 240), to(x, 0, 240)),
    // Double hop.
    hopOnce(),
    hopOnce(),
    // Spin.
    all(to(spin, 1, 640, Easing.inOut(Easing.cubic)), Animated.sequence([to(y, -8, 320), to(y, 0, 320)])),
    to(spin, 0, 0),
    // Shimmy.
    ...[-6, 6, -6, 6, -6, 6, 0].map((d) => all(to(x, d, 70, Easing.linear), to(rot, d / 2, 70, Easing.linear))),
    // Lean back and bob.
    all(to(rot, 12, 300), to(x, -6, 300)),
    to(y, -5, 160),
    to(y, 0, 160),
    to(y, -5, 160),
    to(y, 0, 160),
    all(to(rot, 0, 260), to(x, 0, 260)),
    // Big finish.
    all(to(y, -10, 220, Easing.out(Easing.back(2))), squash(1.16, 1.16, 220)),
    all(to(y, 0, 320, Easing.bounce), squash(1, 1, 320)),
    Animated.delay(260),
  ]);
}

const CONFETTI =['🌶️', '🎉', '✨', '🔥', '🎊', '⭐', '🌶️', '💥'];
const PIECES = 30;

type Piece = { emoji: string; x: number; y: number; spin: number; delay: number; size: number };

/** Where each piece flies: a burst up and out from Rudy, then down under gravity. */
function makePieces(): Piece[] {
  return Array.from({ length: PIECES }, (_, i) => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
    const power = 140 + Math.random() * 170;
    return {
      emoji: CONFETTI[i % CONFETTI.length],
      x: Math.cos(angle) * power,
      y: Math.sin(angle) * power,
      spin: (Math.random() - 0.5) * 900,
      delay: Math.random() * 160,
      size: 18 + Math.random() * 16,
    };
  });
}

function ConfettiPiece({ piece, run }: { piece: Piece; run: Animated.Value }) {
  // run goes 0 -> 1 over the burst; y adds a gravity drop on top of the throw.
  const translateX = run.interpolate({ inputRange: [0, 1], outputRange: [0, piece.x * 1.25] });
  const translateY = run.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, piece.y * 0.55, piece.y * 0.75 + 60, piece.y * 0.8 + 190, piece.y * 0.8 + 380],
  });
  const rotate = run.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.spin}deg`] });
  const opacity = run.interpolate({ inputRange: [0, 0.05, 0.75, 1], outputRange: [0, 1, 1, 0] });
  return (
    <Animated.Text
      style={[
        styles.piece,
        { fontSize: piece.size, opacity, transform: [{ translateX }, { translateY }, { rotate }] },
      ]}>
      {piece.emoji}
    </Animated.Text>
  );
}

/**
 * Posted! A cheer over everything: Rudy jumps up beaming, confetti and
 * peppers burst out of him, "Yayyyy!", and a line on who they just joined.
 * Moves on by itself after a few seconds, or at a tap.
 */
export function Celebration({ visible, detail, onDone }: { visible: boolean; detail: string; onDone: () => void }) {
  const theme = useTheme();
  const [pieces] = useState(makePieces);
  const [runs] = useState(() => pieces.map(() => new Animated.Value(0)));
  const [pop] = useState(() => new Animated.Value(0));
  const [bounce] = useState(() => new Animated.Value(0));
  const [cheer] = useState(() => pick(RUDY_CHEERS));
  const done = useRef(false);

  useEffect(() => {
    if (!visible) return;
    done.current = false;
    successHaptic();
    const taps = [220, 420, 620].map((ms) => setTimeout(tapHaptic, ms));
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 90, useNativeDriver: native }).start();
    const hopping = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: native,
        }),
        Animated.timing(bounce, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: native }),
      ]),
    );
    hopping.start();
    runs.forEach((r, i) => {
      r.setValue(0);
      Animated.timing(r, {
        toValue: 1,
        duration: 1700,
        delay: pieces[i].delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: native,
      }).start();
    });
    const leave = setTimeout(finish, 3200);
    return () => {
      taps.forEach(clearTimeout);
      clearTimeout(leave);
      hopping.stop();
    };
    // finish is stable enough for a one-shot timer; re-running on it would restart the show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function finish() {
    if (done.current) return;
    done.current = true;
    onDone();
  }

  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const jump = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -22] });
  const tilt = bounce.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '6deg'] });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={finish}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: /^#[0-9a-f]{6}$/i.test(theme.background) ? `${theme.background}F0` : theme.scrim }]}
        onPress={finish}
        accessibilityRole="button"
        accessibilityLabel={`Posted! ${detail} Tap to continue.`}>
        <View style={styles.stage}>
          {pieces.map((p, i) => (
            <ConfettiPiece key={i} piece={p} run={runs[i]} />
          ))}
          <Animated.View style={{ transform: [{ translateY: jump }, { rotate: tilt }, { scale }] }}>
            <Image source={rudyFace(1)} style={{ width: 132, height: 132 }} />
          </Animated.View>
        </View>
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border, transform: [{ scale }] },
          ]}>
          <Text style={[styles.yay, { color: theme.text }]}>Yayyyy!</Text>
          <Text style={[styles.live, { color: theme.text }]}>Your complaint is live.</Text>
          <Text style={[styles.detail, { color: theme.textSecondary }]}>{detail}</Text>
          <Text style={[styles.cheer, { color: theme.rant }]}>{cheer}</Text>
        </Animated.View>
        <Text style={[styles.tap, { color: theme.textSecondary }]}>Tap anywhere to see it</Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    padding: 24,
  },
  stage: { alignItems: 'center', justifyContent: 'center', height: 170, width: '100%' },
  piece: { position: 'absolute' },
  card: {
    alignItems: 'center',
    gap: 6,
    maxWidth: 360,
    width: '100%',
    borderRadius: 24,
    borderWidth: 1,
    paddingVertical: 22,
    paddingHorizontal: 20,
  },
  yay: { fontFamily: Fonts.bold, fontSize: 52, lineHeight: 58, textAlign: 'center' },
  live: { fontFamily: Fonts.bold, fontSize: 22, textAlign: 'center' },
  detail: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
  cheer: { fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  tap: { fontSize: 13, position: 'absolute', bottom: 48 },
});
