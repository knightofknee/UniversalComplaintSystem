import { useEffect, useRef, useState } from 'react';

/**
 * Rudy the red pepper: the little guy on the icon and beside the spice
 * meter. Mostly he says nothing: his FACE is the feedback. He beams at one
 * pepper, smiles at two, goes neutral at three, worries at four, and at five
 * (name-calling) he cries. Nobody is told they are being bad; a sad pepper
 * says it.
 */
export const RUDY_FACES = {
  1: require('@/assets/images/rudy-1.png'),
  2: require('@/assets/images/rudy-2.png'),
  3: require('@/assets/images/rudy-3.png'),
  4: require('@/assets/images/rudy-4.png'),
  5: require('@/assets/images/rudy-5.png'),
} as const;

export const rudyFace = (spice: number) => RUDY_FACES[Math.max(1, Math.min(5, Math.round(spice))) as 1 | 2 | 3 | 4 | 5];

/**
 * A hidden extra: someone who has been writing hot the whole time for
 * minutes gets one quiet line from him, in a bubble a tap puts away. Every
 * line says kindness is good, or is simply kind. None says the writer is
 * doing anything wrong, and none could be wrong about them.
 */
export const RUDY_LINES = [
  'Anger tells you something matters. Kindness is how it gets fixed.',
  'Kindness is not weakness. It is aim.',
  'Patience is anger with a plan.',
  'A kind word travels further than anyone expects.',
  'A grievance told kindly is very hard to ignore.',
  'Speak as if the fix is possible. It usually is.',
  'Kindness is the spice that lasts.',
  'You are allowed to be upset. This matters.',
  "I'm sorry this happened to you.",
  'Saying it out loud is a good thing to do. Thank you.',
  'You sound tired of this. That is fair.',
  "Take your time. I'm a pepper, I have plenty.",
  'I am small and spicy and I believe in you.',
  "I'm on your side. All of my sides.",
];

/** Hot the whole time for this long before he says anything. */
const FIRST_AFTER_MS = 3 * 60_000;
const EVERY_MS = 3 * 60_000;
const OFFSET_MS = 45_000;
const SHOWN_FOR_MS = 12_000;

/** `hot`: the writing is at three peppers or more right now. Cooling off resets the clock. */
export function useRudy(hot: boolean) {
  const [line, setLine] = useState<string | null>(null);
  const last = useRef(-1);
  useEffect(() => {
    if (!hot) return;
    let next: ReturnType<typeof setTimeout>;
    let hide: ReturnType<typeof setTimeout>;
    const speak = () => {
      let i = Math.floor(Math.random() * RUDY_LINES.length);
      if (i === last.current) i = (i + 1) % RUDY_LINES.length;
      last.current = i;
      setLine(RUDY_LINES[i]);
      hide = setTimeout(() => setLine(null), SHOWN_FOR_MS);
      next = setTimeout(speak, EVERY_MS + (Math.random() * 2 - 1) * OFFSET_MS);
    };
    next = setTimeout(speak, FIRST_AFTER_MS);
    return () => {
      clearTimeout(next);
      clearTimeout(hide);
      setLine(null);
    };
  }, [hot]);
  return { line, dismiss: () => setLine(null) };
}

/**
 * Tap Rudy and he says something. He is a pepper, and spicy himself: these
 * are his jokes. Like his kind lines, none is about the writer or could be
 * wrong about them.
 */
export const RUDY_QUIPS = [
  "Careful, I'm hot.",
  'I put the pep in pepper.',
  "I'm not mad. I'm just spicy.",
  'Scoville rating: emotionally available.',
  "I've been pickled before. I can handle anything.",
  'Some people do yoga. I do complaints.',
  'My cousin is a jalapeño. He is way too chill.',
  'Every great fix started as a good rant.',
  'Bring the heat. Aim it at the problem.',
  'Hot tip: say what would make it better.',
  "I'd high-five you, but I'm a pepper.",
  'Complain away. I run on hot air.',
  'Ow. I mean, hi!',
  "Tickles. Don't stop typing.",
];

/** While the model reads it (after Next): what is happening, in his words. */
export const RUDY_READING = [
  'Reading it closely…',
  'Checking who else has this…',
  'Naming the issue…',
  'Finding where it belongs…',
  'Almost there…',
];

/** After posting: one of these under the cheer. */
export const RUDY_CHEERS = [
  'Rudy is doing his victory dance.',
  'Hot off the grill.',
  "That's how it's done.",
  'Loud, clear, and on the record.',
  'Spicy and published. Chef’s kiss.',
];

/** His take on the model's verdict, one line on the review. */
export function rudyVerdict(r: {
  tone?: string;
  spice?: number;
  rantScore?: number | null;
  actionability?: number;
  missing?: string[];
}): string {
  const fixable = (r.actionability ?? 0) >= 40;
  if (!fixable && (r.missing ?? []).length > 0)
    return 'Good start! A detail or two from below would make it hit harder.';
  if (r.tone === 'rant' && (r.rantScore ?? 0) >= 7) return "Ooh. This one's getting read out loud.";
  if (r.tone === 'rant' && (r.spice ?? 1) >= 4) return 'Extra hot and it still makes sense. Respect.';
  if (r.tone === 'rant') return 'A rant with a point. My favorite kind.';
  if (r.tone === 'constructive') return "Clear and fixable. Chef's kiss.";
  return 'Just the facts. Very professional.';
}

export const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
