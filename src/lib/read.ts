/**
 * The live read-out while someone types: how spicy it is (peppers), and
 * whether it has what makes a complaint fixable (who, what, when, the fix).
 * On the device, free and instant; the model's own read, which is the one
 * that counts, comes at "Next".
 */

export type Read = {
  words: number;
  /** 1 (mild) to 5 (over the line: name-calling at people). */
  spice: number;
  spiceLabel: string;
  /** Name-calling spotted on the device. The model has the final say. */
  overLine: boolean;
  who: boolean;
  what: boolean;
  when: boolean;
  fix: boolean;
  /** One productive nudge toward the missing piece. */
  nudge: string;
};

export const SPICE_LABELS = ['', 'mild', 'medium', 'hot', 'extra hot', 'over the line'];
export const MIN_WORDS = 5;

const HOT_WORDS =
  /\b(never|always|worst|ridiculous|unacceptable|insane|useless|scam|hate|terrible|awful|disgusting|pathetic|joke|garbage|trash|nightmare|absurd|outrageous|furious|livid|sick of|fed up|done with)\b/gi;
const SWEARS = /\b(fuck\w*|shit\w*|damn\w*|hell|crap\w*|bullshit|ass|arse|wtf|ffs)\b/gi;
/** Aimed at people. Swearing at a situation is spicy; this is over the line. */
const NAME_CALLING =
  /\b(bitch\w*|asshole\w*|idiot\w*|moron\w*|retard\w*|cunt\w*|whore\w*|slut\w*|bastard\w*|dumbass\w*|dipshit\w*|scumbag\w*|scum|douche\w*|twat\w*|prick\w*|jackass\w*|dickhead\w*|motherfucker\w*|loser\w*|pig\w*)\b/i;
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
  const heat = (caps > 0.5 ? 2 : caps > 0.25 ? 1 : 0) + Math.min(bangs, 4) * 0.6 + hot * 0.6 + swears * 1.5 + emoji;
  const overLine = NAME_CALLING.test(text);
  // 1-4 from how loud it is (one swear is already hot); 5 only for name-calling.
  const spice = words === 0 ? 1 : overLine ? 5 : Math.max(1, Math.min(4, Math.round(heat) + 1));

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
  else if (overLine) nudge = 'Swear all you want. Calling people names gets it sent back.';
  else if (!who) nudge = 'Name the target of your complaint.';
  else if (!what) nudge = 'What happened? A sentence or two does it.';
  else if (!fix && spice >= 3) nudge = 'Love the fire. Now aim it: what should they change?';
  else if (!fix) nudge = 'What would make it right? That part is what gets things fixed.';
  else if (!when) nudge = 'When did it happen, or how often? Optional, but it helps.';
  else nudge = spice >= 3 ? 'Spicy and fixable. The best kind.' : 'That is a complaint someone can act on.';

  return { words, spice, spiceLabel: SPICE_LABELS[spice], overLine, who, what, when, fix, nudge };
}
