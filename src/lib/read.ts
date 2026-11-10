/**
 * The live line while someone types: how spicy it is (peppers) and the one
 * thing that would make the complaint easier to act on. On the device, free
 * and instant; the model's own read, which is the one that counts, comes at
 * "Next".
 *
 * The rule for a nudge: say nothing that might be wrong. A complaint can be
 * about a company, a thing nobody owns ("daylight saving time") or a kind of
 * problem, in any language and any capitalization, so a nudge fires only on
 * a pattern that clearly shows something is missing. When in doubt it moves
 * on to the next question. Checked against scripts/read-audit.ts.
 */

export type Read = {
  words: number;
  /** 1 (mild) to 5 (over the line: name-calling at people). */
  spice: number;
  spiceLabel: string;
  /** Name-calling spotted on the device. The model has the final say. */
  overLine: boolean;
  /** False only when the target is clearly missing ("they", "my bank"). */
  who: boolean;
  /** A thing they own with no make or model on it ("my laptop"); null when named or not about one. */
  product: string | null;
  what: boolean;
  when: boolean;
  fix: boolean;
  /** One productive nudge toward the missing piece. */
  nudge: string;
  /** Not English as far as we can tell: show nothing rather than guess. The model reads any language at Next. */
  quiet: boolean;
};

export const SPICE_LABELS = ['', 'mild', 'medium', 'hot', 'extra hot', 'over the line'];
export const MIN_WORDS = 5;

// "never" and "always" say how often, not how angry: they count toward `when`.
const HOT_WORDS =
  /\b(worst|ridiculous|unacceptable|insane|useless|scam|hate|terrible|awful|disgusting|pathetic|joke|garbage|trash|nightmare|absurd|outrageous|furious|livid|infuriating|stupid|sucks?|rip-?off|robbery|sick of|fed up|done with)\b/gi;
const SWEARS = /\b(fuck\w*|shit\w*|goddamn\w*|damn\w*|hell|crap\w*|bullshit|piss\w*|ass|arse|wtf|ffs)\b/gi;
/**
 * Aimed at people. Swearing at a situation is spicy; this is over the line.
 * Exact forms only: "pig\w*" would flag pigeons and "retard\w*" a fire
 * retardant. The model catches what this misses.
 */
const NAME_CALLING =
  /\b(bitch(es|y)?|assholes?|idiots?|morons?|retard(s|ed)?|cunts?|whores?|sluts?|bastards?|dumbass(es)?|dipshits?|scumbags?|douche(bag)?s?|twats?|pricks?|jackass(es)?|dickheads?|motherfuckers?)\b/i;
const ANGRY_EMOJI = /[😡🤬💢😤🙄🖕]/gu;

/** 13 to 16 digits, however they are grouped: probably a payment card. */
const CARD = /(?<![\d-])(?:\d[ -]?){12,15}\d(?![\d-])/;

/** A kind of organization with no name on it: "my bank", "the worst airline". */
const ORG_KIND =
  /\b(?:the|my|our|this|that)\s+(?:[a-z]+\s+)?(insurance company|phone company|cable company|power company|credit card company|airline|bank|credit union|store|shop|app|website|carrier|insurer|gym|restaurant|hotel|dealership|pharmacy|hospital|clinic|school|university|company|city|county|utility|isp)\b/i;
/**
 * A thing of their own with no make or model on it: "my laptop", "our new
 * dishwasher". Only "my"/"our": "the printer" in a gripe about printers in
 * general has no model to ask for. And only when the thing itself is the
 * subject ("my phone died"), never part of another noun ("my phone bill").
 */
const PRODUCT =
  /\b(?:my|our)\s+(?:(?:new|old|brand new|first|second|work|other)\s+)?(laptop|computer|pc|desktop|phone|smartphone|tablet|tv|television|printer|router|modem|car|truck|suv|van|fridge|refrigerator|freezer|washer|washing machine|dryer|dishwasher|oven|stove|microwave|vacuum|headphones|earbuds|smartwatch|watch|camera|console|monitor|keyboard|thermostat|speaker|e-?bike|scooter|mattress|blender|air fryer|coffee maker|air conditioner|water heater|furnace|doorbell)(?!\s+(?:bills?|plans?|shows?|payments?|loans?|compan(?:y|ies)|carriers?|dealers?|dealerships?|numbers?|services?|providers?|subscriptions?|contracts?|warrant(?:y|ies)|stores?|shops?|apps?|cases?|chargers?|insurance|seats?|keys?|tires?|games?|channels?)\b)(?=$|[.,;:!?]|['’]s\b|\s+(?:is|was|has|had|keeps?|kept|won['’]?t|doesn['’]?t|does|did|didn['’]?t|gets?|got|will|would|can['’]?t|cannot|could|never|always|just|still|and|that|which|since|after|when|from|with|for|in|on|at|[a-z]+(?:ed|s))\b)/i;
/** Makes people write in lowercase, and anything that looks like a model number ("xps13", "s23"). */
const MAKE_OR_MODEL =
  /\b(apple|iphone|ipad|macbook|imac|mac|samsung|galaxy|pixel|dell|hp|lenovo|thinkpad|asus|acer|msi|surface|microsoft|sony|lg|vizio|tcl|roku|bose|canon|epson|brother|netgear|toyota|honda|ford|chevy|chevrolet|tesla|nissan|hyundai|kia|subaru|bmw|jeep|whirlpool|maytag|bosch|ge|kitchenaid|frigidaire|dyson|shark|roomba|nest|ring|garmin|fitbit|playstation|ps[45]|xbox|switch|nintendo|keurig|ninja|instant pot)\b|\b(?=[a-z-]*\d)(?=\d*[a-z])[a-z0-9-]{2,}\b/i;

/** Opens on someone unnamed: "They charged me twice", "I hate them". */
const VAGUE_LEAD = /^(?:\W*[\w'’]+\W+){0,2}(?:they|them|their|theirs|he|she|him)\b/i;
/** Capitalized only because they start a sentence. */
const COMMON = new Set(
  'i the a an my our your their his her its it this that these those we they you he she so and but or why how what when where who just again every today yesterday tonight please hey ok okay well also then now still never always even yes no not thanks thank seriously honestly literally apparently there here if because after before since while once all some most many much more less one two three nobody everyone everybody someone anyone nothing everything absolutely totally'.split(
    ' ',
  ),
);

const NUMBER = '(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple of|several)';
const UNIT = '(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)';
/** When it happened, or how often. */
const WHEN = new RegExp(
  '\\b(?:today|yesterday|tonight|this (?:morning|afternoon|evening|week|month|year)|last (?:night|week|month|year|time|winter|spring|summer|fall)|ago|since|every (?:day|time|week|month|year|morning|night)|every single (?:day|time)|again|twice|three times|always|never|constantly|all the time|all day|keeps?|still|daily|weekly|monthly|' +
    '(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:in|on|since|last|this) (?:january|february|march|april|may|june|july|august|september|october|november|december)|(?:jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\.? \\d{1,2}|' +
    '\\d{1,2}\\/\\d{1,2}|(?:19|20)\\d{2}|' +
    `${NUMBER} ${UNIT}|for (?:days|weeks|months|years|hours))\\b`,
  'i',
);
/** Something happened (so "when?" makes sense); a standing gripe or a suggestion has no date. */
const EVENT =
  /\b(was|were|did|didn'?t|had|got|went|lost|broke|took|sent|told|said|paid|hung|left|gave|came|made|wouldn'?t|couldn'?t|[a-z]{3,}ed)\b/i;

/** A wish or a standing suggestion: there is no date to ask for. */
const SUGGESTION = /\b(would be (?:nice|better|great|good)|better if|if only|wish|why (?:can['’]?t|not|don['’]?t|doesn['’]?t)|how about)\b/i;
/** Words an English sentence of any length almost always has one of. */
const ENGLISH = /\b(the|and|my|of|they|this|that|with|not|have|has|their|but|is|are|it|to|was|for|you|on)\b/i;

const IMPERATIVE =
  'show|tell|list|hire|open|answer|lower|cut|remove|drop|offer|extend|make|let|quit|end|ban|publish|honor|reduce|train|staff|put|give|bring|fix|stop|add|refund|replace|change|allow|cancel|return|send|pay|post|label|warn';
/** What would make it right: a wish, a "should", or an instruction to them. */
const FIX = new RegExp(
  "\\b(?:should|shouldn['’]?t|ought|needs? to|has to|have to|must|want|wish|i['’]?d like|would like|please|expect|instead|bring back|put back|refund|replace|fix|" +
    'would be (?:nice|better|great|good)|better if|why (?:can[\'’]?t|not|don[\'’]?t|doesn[\'’]?t)|how about|they could|let (?:me|us|people)|give (?:me|us) back|my money back)\\b|' +
    // An instruction opening a clause: "Refund it.", "..., show the full price up front".
    `(?:^|[.,;:!?]\\s+)(?:just\\s+|please\\s+|and\\s+)?(?:${IMPERATIVE})\\b`,
  'i',
);

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

  // A capitalized name reads as who it's about. Shouting capitalizes everything, so it proves nothing.
  const named =
    caps <= 0.5 &&
    text
      .split(/\s+/)
      .map((w) => w.replace(/^[^\w&]+|[^\w&'’.-]+$/g, ''))
      .some(
        (w) =>
          (/^[A-Z][a-z0-9&'’.-]/.test(w) || /^[a-z]+[A-Z]/.test(w) || (caps < 0.25 && /^[A-Z&]{2,5}$/.test(w))) &&
          !COMMON.has(w.toLowerCase().replace(/['’].*$/, '')),
      );
  // The target is missing only when the text itself shows it: an unnamed
  // kind of organization, or it opens on "they". A topic needs no name.
  const kind = named ? null : (ORG_KIND.exec(text)?.[1].toLowerCase() ?? null);
  const vague = !named && !kind && VAGUE_LEAD.test(text);
  const who = !kind && !vague;
  // Their own product with nothing saying which one. Recommended, never required.
  const product = named || MAKE_OR_MODEL.test(text) ? null : (PRODUCT.exec(text)?.[1].toLowerCase() ?? null);
  // Enough said to ask the next question: a finished sentence, or eight words. Never mid-thought.
  const what = words >= 8 || (words >= MIN_WORDS && /[.!?]$/.test(text));
  const quiet = words >= 6 && !ENGLISH.test(text) && !overLine;
  const when = WHEN.test(text);
  const fix = FIX.test(text);
  const hotHeaded = spice >= 3;

  let nudge: string;
  if (overLine) nudge = 'Swear all you want. Calling people names gets it sent back.';
  else if (CARD.test(text)) nudge = 'If that is a card number, take it out. It would be removed anyway.';
  else if (words < MIN_WORDS) nudge = 'Keep going.';
  else if (kind) nudge = hotHeaded ? `We hear you. Which ${kind}?` : `Which ${kind}? Name it.`;
  else if (vague) nudge = 'Name the target of your complaint.';
  else if (!what) nudge = 'Keep going.';
  else if (!fix && hotHeaded) nudge = 'Love the fire. Now aim it: what should they change?';
  else if (!fix) nudge = 'What would make it right? That part is what gets things fixed.';
  else if (product) nudge = `Which ${product}? The make and model help, if you know them.`;
  else if (!when && EVENT.test(text) && !SUGGESTION.test(text)) nudge = 'When did it happen, or how often? Optional, but it helps.';
  else if (words >= 120) nudge = 'Long ones get skimmed. Lead with the main thing.';
  else nudge = hotHeaded ? 'Spicy and fixable. The best kind. Hit Next.' : 'Someone can act on that. Hit Next.';

  return { words, spice, spiceLabel: SPICE_LABELS[spice], overLine, who, product, what, when, fix, nudge, quiet };
}
