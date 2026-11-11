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
