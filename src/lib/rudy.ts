import { useEffect, useRef, useState } from 'react';

/**
 * Rudy the red pepper: the little guy on the icon and beside the spice
 * meter. The live advice under the complaint is his. When someone has been
 * writing hot for a while he also pipes up, in a speech bubble, about why
 * kindness works better. He is a scholar of kindness, and on the writer's
 * side: some of what he says is something he has worked out, some is plainly
 * nice, some is just cute. Never snark, never a jab at anyone.
 *
 * He speaks once after the writing has been at three peppers or more for a
 * bit, then again every couple of minutes (a random offset keeps it from
 * feeling like a timer), and goes quiet the moment things cool down.
 */
export const RUDY_LINES = [
  // What he has worked out.
  'Anger tells you something matters. Kindness is how it gets fixed.',
  'Be hard on the problem and soft on the person.',
  'Heat can warm or burn. You get to choose which.',
  'You can be right without being cruel. It is harder, and it works better.',
  'The truth does not need help from an insult.',
  'Somewhere a tired person will read this. Write to them.',
  'Every company is just people. Talk to the people.',
  'The loudest voice is rarely the one remembered. The clearest is.',
  'Patience is not giving up. It is anger with a plan.',
  'Kindness is not weakness. It is aim.',
  'Being heard starts with being easy to hear.',
  'What you want is change. Aim every word at that.',
  'A grievance told kindly is very hard to ignore.',
  'Speak as if the fix is possible. It usually is.',
  'Nobody was ever insulted into caring.',
  'Leave the door open. Someone may walk through it with a fix.',
  // Plainly nice.
  'You are allowed to be upset. This matters.',
  "I'm sorry this happened to you. Let's get it fixed.",
  'Saying it out loud is a good thing to do. Thank you.',
  'You sound tired of this. That is fair.',
  // Cute.
  "Deep breath. I'll wait. I'm a pepper, I have time.",
  'I am small and spicy and I believe in you.',
  'Even peppers cool off eventually.',
  'I have been the hottest thing in the room. It is lonely. Be warm instead.',
  'From one hothead to another: you have got this.',
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
