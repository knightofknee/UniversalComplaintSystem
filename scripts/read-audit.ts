/**
 * Audit of the live line under the complaint box (src/lib/read.ts).
 *
 *   npm run read-audit
 *
 * Types each sample word by word and prints every change of the line, so a
 * person can read what a user would see. Then runs the checks below, which
 * are the mistakes this logic has made before; it exits 1 if one comes back.
 */
import { readComplaint } from '../src/lib/read';

const SAMPLES = [
  'Comcast charged me twice this month and their support line hung up on me. They should refund the second charge.',
  'the self checkout at kroger never works and there is only one cashier',
  'daylight saving time is pointless and makes everyone tired for a week',
  'my landlord has not fixed the heat in three weeks',
  'i hate how every app wants a subscription now',
  'THIS IS THE WORST AIRLINE EVER!!! NEVER AGAIN!!!',
  'potholes on 5th street have been there since last winter, the city should fill them',
  'Why does it take 45 minutes on hold to cancel a gym membership',
  'the new iOS update killed my battery',
  'Delta lost my bag yesterday and the agent was a total bitch about it',
  'I ordered a couch from Wayfair in March. It arrived broken. I want a replacement or my money back.',
  'printer ink costs more than the printer',
  'It would be nice if the DMV took appointments online',
  "What the hell is wrong with people who don't return shopping carts",
  "my doctor's office never answers the phone",
  'Uber Eats charged a $9 service fee on a $12 order, show the full price up front',
  'airlines should stop charging for carry ons',
  'customer service these days is a joke',
  'they charged me twice and nobody will pick up the phone',
  'my bank closed my account with no warning and kept the balance for two weeks',
  'Mi banco me cobró una comisión que nadie me explicó',
  'my card 4111 1111 1111 1111 was charged twice by the gym',
  'my laptop gets too hot to use on my lap and the fan never stops, they should fix the cooling',
  'My Dell XPS 13 gets too hot to use on my lap, they should fix the cooling',
];

for (const sample of SAMPLES) {
  const words = sample.split(' ');
  let last = '';
  console.log(`\n"${sample}"`);
  for (let i = 1; i <= words.length; i++) {
    const r = readComplaint(words.slice(0, i).join(' '));
    const line = r.quiet ? '(nothing shown: not English)' : `${'🌶'.repeat(r.spice)} ${r.nudge}`;
    if (line !== last) console.log(`  ${String(i).padStart(2)} words  ${line}`);
    last = line;
  }
}

type Check = {
  text: string;
  /** The composer's own state, e.g. the Not sure button. */
  opts?: { notSure?: boolean };
  want: (r: ReturnType<typeof readComplaint>) => boolean;
  why: string;
};
const says = (re: RegExp) => (r: ReturnType<typeof readComplaint>) => re.test(r.nudge);
const CHECKS: Check[] = [
  // A topic nobody owns has a target. Never ask for one.
  { text: 'daylight saving time is pointless and makes everyone tired', want: (r) => r.who, why: 'a topic needs no name' },
  { text: 'the self checkout at kroger never works at all', want: (r) => r.who, why: 'lowercase brands are still targets' },
  { text: 'printer ink costs more than the printer does', want: (r) => r.who, why: 'a product is a target' },
  { text: 'the new iOS update killed my battery life', want: (r) => r.who, why: 'iOS is a name' },
  // Clearly missing targets do get asked.
  { text: 'they charged me twice and will not answer', want: says(/Name the target/), why: 'opens on "they"' },
  { text: 'my bank closed my account with no warning', want: says(/Which bank/), why: 'an unnamed bank' },
  { text: 'THIS IS THE WORST AIRLINE EVER!!! NEVER AGAIN!!!', want: says(/Which airline/), why: 'shouting names nobody' },
  { text: 'Chase is my bank and they closed my account', want: (r) => r.who, why: 'named, so no "which bank"' },
  // The fix, however it is phrased.
  { text: 'Uber Eats charged a $9 fee on a $12 order, show the full price up front', want: (r) => r.fix, why: 'an instruction is a fix' },
  { text: 'It would be nice if the DMV took appointments online', want: (r) => r.fix, why: 'a wish is a fix' },
  { text: 'the train does not stop at my station any more', want: (r) => !r.fix, why: '"stop" mid-clause is not an instruction' },
  // When: no false dates, and no "when?" for a suggestion.
  { text: 'they may charge whatever they like for it', want: (r) => !r.when, why: '"may" is not a month' },
  { text: 'the repair quote was $1200 for a cracked screen', want: (r) => !r.when, why: 'a price is not a year' },
  { text: 'my landlord has not fixed the heat in three weeks', want: (r) => r.when, why: 'number words count' },
  { text: 'It would be nice if the DMV took appointments online', want: (r) => !/When did/.test(r.nudge), why: 'a suggestion has no date' },
  // Spice: swearing is hot, name-calling is the line, and ordinary words are neither.
  { text: 'their fucking support line hung up on me again', want: (r) => r.spice === 3, why: 'one swear is hot' },
  { text: 'the agent was a total bitch about the fee', want: (r) => r.spice === 5, why: 'name-calling' },
  { text: 'pigeons are nesting in the station roof again', want: (r) => r.spice < 5, why: 'pigeons are not pigs' },
  { text: 'the fire retardant foam was never replaced here', want: (r) => r.spice < 5, why: 'retardant' },
  { text: 'the hedge by the path is prickly and overgrown', want: (r) => r.spice < 5, why: 'prickly' },
  { text: 'the self checkout never works when i go there', want: (r) => r.spice === 1, why: '"never" is how often, not anger' },
  { text: 'a b', want: says(/^Keep going/), why: 'too short for anything else' },
  // People: a first name is all it takes, and a person's action is a complaint like any other.
  { text: 'my friend missed the goal from two feet away.', want: says(/Which friend\? A first name is fine/), why: 'an unnamed person' },
  { text: "Brian's shot on goal could've been better.", want: (r) => r.goals.who && r.goals.what && r.goals.better, why: 'a named person, what happened, what could be better' },
  { text: 'the coach benched Maria for no reason, she should play.', want: (r) => r.goals.who, why: 'named, so the coach needs no name' },
  { text: 'Comcast charged me twice this month.', want: (r) => r.goals.who && r.goals.what && !r.goals.better, why: 'goals tick separately' },
  { text: 'a b', want: (r) => r.nudge === 'Keep going', why: 'no period after Keep going' },
  { text: 't', want: (r) => !r.goals.who, why: 'one letter names nobody' },
  { text: '', want: (r) => !r.goals.who && !r.goals.what && !r.goals.better && /who it's about, how it is, and how it should be/.test(r.nudge), why: 'before typing: every goal open, Rudy says what is expected' },
  { text: 'it keeps breaking and nobody cares at all', want: (r) => !r.goals.who && /Who or what is this about/.test(r.nudge), why: 'no one named' },
  { text: 'Daylight saving time is pointless and should end.', want: (r) => r.goals.who, why: 'a topic it opens on' },
  { text: 'waiting forever at the dmv again, they should hire more people', want: (r) => r.goals.who, why: '"the dmv"' },
  // Next waits for all three goals, so "what would be better" has to be heard in its common forms.
  { text: "Comcast's app logs me out every day, I'd love it to remember me.", want: (r) => r.goals.better, why: "I'd love" },
  { text: 'The bus is late every morning. The route needs more drivers.', want: (r) => r.goals.better, why: 'needs more' },
  { text: 'Delta lost my bag twice this year.', want: (r) => !r.goals.better, why: 'no fix said yet' },
  // How it should be: "I don't know" is an answer too; how to get there is a bonus.
  { text: "The crosswalk paint on Main St gets slippery when it rains. I don't know how to fix it.", want: (r) => r.goals.better && r.notSure && /Seeing it is enough/.test(r.nudge), why: "not knowing the fix still meets the goal" },
  { text: 'The bus on Route 9 is late every morning.', want: (r) => !r.goals.better && /Not sure is fine too/.test(r.nudge), why: 'Rudy offers the out' },
  { text: 'The bus on Route 9 is late every morning.', opts: { notSure: true }, want: (r) => r.goals.better, why: 'the Not sure button meets the goal' },
  { text: 'The bus on Route 9 is late every morning. It should be on time.', want: (r) => r.goals.better && !r.goals.how && /Bonus/.test(r.nudge), why: 'ideal said, no way there yet: the bonus is offered, Next is not held' },
  { text: 'The bus on Route 9 is late every morning. They should hire more drivers.', want: (r) => r.goals.better && r.goals.how, why: 'a way to get there ticks the bonus' },
  { text: 'The crosswalk paint on Main St gets slippery when it rains. They should repaint it with grippy paint.', want: (r) => r.goals.better && r.goals.how, why: '"should repaint"' },
  { text: 'Parking downtown is a nightmare, it would be better if they built a garage by adding a level to the lot.', want: (r) => r.goals.how, why: '"by adding"' },
  { text: 'Delta lost my bag twice this year and I have no idea how they could fix their baggage system.', want: (r) => r.goals.better, why: '"no idea how"' },
  { text: 'Comcast charged me twice this month', want: says(/^Keep going/), why: 'never interrupts mid-sentence' },
  { text: 'Comcast charged me twice this month.', want: says(/How should it be instead/), why: 'a finished sentence gets the next question' },
  { text: 'Mi banco me cobró una comisión que nadie me explicó', want: (r) => r.quiet, why: 'not English: say nothing' },
  { text: 'printer ink costs more than the printer does', want: (r) => !r.quiet, why: 'English stays on' },
  { text: 'you bitch', want: says(/names/), why: 'the line comes first, even at two words' },
  { text: 'my card 4111 1111 1111 1111 was charged twice', want: says(/card number/), why: 'card numbers' },
  { text: 'call me on 415 555 0134 about my order please', want: (r) => !/card number/.test(r.nudge), why: 'a phone number is not a card' },
  // Products: ask for the make and model only of a thing they own that has none on it.
  { text: 'my laptop overheats every day, they should fix the fan', want: says(/Which laptop\? The make and model/), why: 'an unnamed laptop' },
  { text: 'my laptop overheats every day and burns my legs', want: says(/How should it be instead/), why: 'how it should be is asked before the model' },
  { text: 'my Dell laptop overheats every day, they should fix the fan', want: (r) => r.product === null, why: 'a named make' },
  { text: 'my dell laptop overheats every day, they should fix the fan', want: (r) => r.product === null, why: 'a lowercase make' },
  { text: 'my xps13 laptop overheats every day, they should fix the fan', want: (r) => r.product === null, why: 'a model number' },
  { text: 'our new dishwasher leaves everything wet, it should dry them', want: says(/Which dishwasher/), why: 'an unnamed appliance' },
  { text: 'printer ink costs more than the printer does', want: (r) => r.product === null, why: 'printers in general have no model' },
  { text: 'my phone bill went up again, they should warn people first', want: (r) => r.product === null, why: 'a phone bill is not a phone' },
  { text: 'my car insurance doubled this year, they should explain why', want: (r) => r.product === null, why: 'car insurance is not a car' },
  { text: 'my phone dies by noon every day, they should fix the battery', want: says(/Which phone/), why: 'the phone itself' },
];

let failed = 0;
console.log('\nChecks');
for (const c of CHECKS) {
  const r = readComplaint(c.text, c.opts);
  const ok = c.want(r);
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.why}: "${c.text}" -> ${'🌶'.repeat(r.spice)} ${r.nudge}`);
}
console.log(failed ? `\n${failed} failed` : `\nAll ${CHECKS.length} checks pass`);
process.exit(failed ? 1 : 0);
