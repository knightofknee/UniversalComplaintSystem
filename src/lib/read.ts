/**
 * The live read-out while someone types: how hot it is, and whether it has
 * what makes a complaint fixable (who, what, when, the fix). On the device,
 * free and instant; the model's own read comes when they check it.
 */

export type Read = {
  words: number;
  /** 0 (ice cold) to 4 (volcanic). */
  heat: number;
  heatLabel: string;
  who: boolean;
  what: boolean;
  when: boolean;
  fix: boolean;
  /** One productive nudge toward the missing piece. */
  nudge: string;
};

export const HEAT_LABELS = ['ice cold', 'calm', 'simmering', 'boiling', 'volcanic'];
export const MIN_WORDS = 5;

const HOT_WORDS =
  /\b(never|always|worst|ridiculous|unacceptable|insane|useless|scam|hate|terrible|awful|disgusting|pathetic|joke|garbage|trash|nightmare|absurd|outrageous|furious|livid|sick of|fed up|done with)\b/gi;
const SWEARS = /\b(fuck\w*|shit\w*|damn\w*|hell|crap\w*|bullshit|ass\w*|bastard\w*|wtf|ffs)\b/gi;
const ANGRY_EMOJI = /[😡🤬💢😤🙄🖕]/gu;
const PLACE_WORDS =
  /\b(the|my|our|their|this|that)\s+(company|bank|airline|landlord|app|store|shop|website|site|city|school|hospital|carrier|provider|insurer|insurance|doctor|clinic|restaurant|boss|employer|government|dmv|post office|hotel|gym|phone|car|dealer|dealership|delivery|driver|service|support|customer service|isp|utility|council|county|airport|train|bus|subway|printer|laptop|tv|router)\b/i;
const WHEN =
  /\b(today|yesterday|tonight|this (morning|afternoon|evening|week|month|year)|last (night|week|month|year|time)|ago|since|every (day|time|week|month|year)|again|twice|three times|(mon|tues|wednes|thurs|fri|satur|sun)day|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|\d{1,2}\/\d{1,2}|\d{4}|\d+\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?))\b/i;
/** Capitalized only because they start a sentence. */
const COMMON = new Set(
  'i the a an my our your their his her its it this that these those we they you he she so and but or why how what when where who just again every today yesterday tonight please hey ok okay well also then now still never always even yes no not thanks thank seriously honestly literally apparently why there here if because after before since while once all some most many much more less one two three nobody everyone everybody someone anyone nothing everything absolutely totally'.split(
    ' ',
  ),
);
const FIX =
  /\b(should|shouldn'?t|want|wish|need|please|fix|refund|replace|change|stop|let (me|us)|allow|add|bring back|make it|would be (nice|better|great)|ought|expect|instead|put back|give (me|us))\b/i;

export function readComplaint(raw: string): Read {
  const text = raw.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const letters = text.replace(/[^A-Za-z]/g, '');
  const caps = letters.length > 12 ? letters.replace(/[^A-Z]/g, '').length / letters.length : 0;
  const bangs = (text.match(/!/g) ?? []).length;
  const hot = (text.match(HOT_WORDS) ?? []).length;
  const swears = (text.match(SWEARS) ?? []).length;
  const emoji = (text.match(ANGRY_EMOJI) ?? []).length;
  const raw_ = (caps > 0.5 ? 2 : caps > 0.25 ? 1 : 0) + Math.min(bangs, 4) * 0.6 + hot * 0.6 + swears * 0.8 + emoji;
  const heat = words === 0 ? 0 : Math.max(0, Math.min(4, Math.round(raw_)));

  // A capitalized name that isn't just a word starting a sentence reads as who it's about.
  const named = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w&]+|[^\w&'’.-]+$/g, ''))
    .some(
      (w) =>
        (/^[A-Z][a-z0-9&'’.-]/.test(w) || (caps < 0.25 && /^[A-Z&]{2,5}$/.test(w))) &&
        !COMMON.has(w.toLowerCase().replace(/['’].*$/, '')),
    );
  const who = named || PLACE_WORDS.test(text);
  const what = words >= 8;
  const when = WHEN.test(text);
  const fix = FIX.test(text);

  let nudge: string;
  if (words < MIN_WORDS) nudge = 'Keep going. Say what happened.';
  else if (!who) nudge = 'Who is it about? Name the company, product or place.';
  else if (!what) nudge = 'What happened? A sentence or two does it.';
  else if (!fix && heat >= 3) nudge = 'Love the fire. Now aim it: what should they change?';
  else if (!fix) nudge = 'What would make it right? That part is what gets things fixed.';
  else if (!when) nudge = 'When did it happen, or how often? Optional, but it helps.';
  else nudge = heat >= 3 ? 'Loud and fixable. The best kind.' : 'That is a complaint someone can act on.';

  return { words, heat, heatLabel: HEAT_LABELS[heat], who, what, when, fix, nudge };
}
