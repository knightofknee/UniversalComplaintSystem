import { useEffect, useRef, useState } from 'react';

/**
 * Rudy the red pepper: the little guy on the icon and beside the spice
 * meter. The live advice under the complaint is his. When someone has been
 * writing hot for a while he also pipes up, in a speech bubble, about why
 * staying decent works better. He is on the writer's side: heat is welcome,
 * rudeness just gets a complaint skipped.
 *
 * He speaks once after the writing has been at three peppers or more for a
 * bit, then again every couple of minutes (a random offset keeps it from
 * feeling like a timer), and goes quiet the moment things cool down.
 */
export const RUDY_LINES = [
  'Spicy gets read. Rude gets skipped.',
  'Roast the problem, not the person.',
  "The person reading this didn't break it.",
  'Heat is flavor. Insults are just smoke.',
  'You can be furious and still be fair.',
  'Angry gets attention. Specific gets fixed.',
  'Nobody ever refunded an insult.',
  "Somebody's cousin works there. Aim at the company.",
  "I'm a pepper. I know heat. This is a lot of heat.",
  'Breathe. Then tell them exactly what to fix.',
  'Kind and relentless beats loud every time.',
  "Say what you want changed. That's the part they can't ignore.",
  'Burn bright, not bridges.',
  'Rude is easy. Useful is spicy.',
  'A calm sentence with a fact in it scares a company more than caps lock.',
  'Be the complaint they have to answer, not the one they get to dismiss.',
  'Mad is fine. Mean is a gift to their PR team.',
  'Tell it like a story a stranger would repeat.',
];

const FIRST_AFTER_MS = 20_000;
const EVERY_MS = 120_000;
const OFFSET_MS = 40_000;
const SHOWN_FOR_MS = 10_000;

/** `hot`: the writing is at three peppers or more right now. */
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
