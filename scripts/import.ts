/**
 * Seeding the record from public government complaint data, so day one
 * isn't empty. Every source is a US government work (public domain). Every
 * imported complaint is labelled with its source and links back to it, and
 * goes through the same intake as anyone's: the model files it, matches it
 * to existing points, and nothing is posted that the intake wouldn't post.
 *
 *   npm run import -- cfpb "WELLS FARGO & COMPANY" [--days 120] [--max 1000] [--groups 20] [--dry]
 *   npm run import -- nhtsa tesla "model 3" 2023 [--max 25] [--dry]
 *   npm run import -- fcc [--days 30] [--max 3000] [--groups 8] [--dry]
 *
 * Reuse terms (all US government open data, free to reuse):
 *   CFPB  https://www.consumerfinance.gov/complaint/data-use/  (public data;
 *         the CFPB says complaints are not a statistical sample, so we say so)
 *   NHTSA https://www.nhtsa.gov/nhtsa-datasets-and-apis  (public API, public domain)
 *   FCC   https://opendata.fcc.gov/Consumer/CGB-Consumer-Complaints-Data/3xyp-aqkj
 *         licensed "Public Domain U.S. Government",
 *         https://www.usa.gov/government-works  (the FCC does not verify the
 *         facts alleged, so we say so)
 *   CPSC  (not imported) SaferProducts.gov incident reports are only offered
 *         through an API that needs a registered application key
 *         (https://www.saferproducts.gov/FAQs/FrequentlyAskedQuestions11; the
 *         endpoint answers 401 without one) and there's no bulk download, so
 *         there's no CPSC source here until we have a key. Never scrape the
 *         public search instead.
 *
 * CFPB (Consumer Financial Protection Bureau): the public API no longer
 * includes narratives, so complaints are grouped by company and issue; each
 * group becomes one complaint on the record ("412 people told the CFPB...")
 * and every complaint in it counts as one supporter, dated when it was
 * filed. NHTSA (vehicle safety): each complaint has its own narrative and is
 * imported on its own. FCC (Consumer Help Center): rows are terse (form,
 * issue, how they were called, when) and name no company, so the most recent
 * complaints are grouped by issue like the CFPB's and each group becomes a
 * topic-only point (robocalls, phone billing...). Only the issue fields are
 * read: caller ID numbers, the advertiser's number and the complainant's
 * city, state and ZIP never leave the FCC.
 *
 * Imports spend from the same daily AI budget as everyone else and stop when
 * it runs out; run again tomorrow to continue. Re-running is safe: each
 * government complaint counts once (supports are keyed by its id), and it
 * refreshes the source's caveat on what was already imported.
 *
 * Needs gcloud credentials (`gcloud auth application-default login`) and the
 * Anthropic key in functions/.secret.local (or ANTHROPIC_API_KEY).
 */
import { readableCompany } from './cfpb-names';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

process.env.GCLOUD_PROJECT ??= 'universal-complaint-system';
try {
  for (const line of readFileSync('functions/.secret.local', 'utf8').split('\n')) {
    const m = line.match(/^ANTHROPIC_API_KEY=(.+)$/);
    if (m) process.env.ANTHROPIC_API_KEY ??= m[1].trim();
  }
} catch {
  // Not there: ANTHROPIC_API_KEY must be set some other way.
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const dry = args.includes('--dry');
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

type Imported = { submissionId: string; pointIds: string[] };

/** Each agency's own caveat about its data, shown with every complaint imported from it. */
const CFPB_NOTE = 'The CFPB says its complaints are not a statistical sample.';
const FCC_NOTE = 'The FCC does not verify the facts alleged in these complaints.';

const FCC_API = 'https://opendata.fcc.gov/resource/3xyp-aqkj.json';
/** The FCC's complaint form ("issue_type"), as a reader would say it. */
const FCC_SERVICE: Record<string, string> = {
  Phone: 'phone service',
  Internet: 'internet service',
  TV: 'TV service',
  Radio: 'radio reception',
  Emergency: 'emergency communications',
  Accessibility: 'accessible communications',
};
/** The kind of line ("method"). */
const FCC_LINE: Record<string, string> = {
  'Wireless (cell phone/other mobile device)': 'cell',
  Wired: 'landline',
  'Internet (VOIP)': 'internet (VoIP)',
};
/** What an unwanted call was ("type_of_call_or_messge", sic). */
const FCC_CALL: Record<string, string> = {
  'Text Message': 'text messages',
  'Prerecorded Voice': 'prerecorded (robocall) calls',
  'Live Voice': 'calls from live callers',
};

async function main() {
  const intake = await import('../functions/src/intake');
  const { db, FieldValue, Timestamp } = await import('../functions/src/common');
  const { BudgetPaused } = await import('../functions/src/budget');

  /** One government complaint = one supporter on each point it's about. */
  async function addSupports(pointIds: string[], people: { id: string; at: Date }[]) {
    const weekAgo = Date.now() - 7 * 24 * 3600_000;
    for (const pointId of pointIds) {
      const point = await db.doc(`points/${pointId}`).get();
      if (!point.exists) continue;
      let added = 0;
      let week = 0;
      for (const p of people) {
        const ok = await db
          .doc(`points/${pointId}/supports/${p.id}`)
          .create({ uid: p.id, at: Timestamp.fromDate(p.at), via: 'import' })
          .then(() => true)
          .catch(() => false);
        if (ok) {
          added++;
          if (p.at.getTime() > weekAgo) week++;
        }
      }
      if (!added) continue;
      await point.ref.update({ supportCount: FieldValue.increment(added), weekSupport: FieldValue.increment(week) });
      for (const sid of point.get('subjectIds') as string[]) {
        await db.doc(`subjects/${sid}`).update({ 'stats.supporters': FieldValue.increment(added) });
      }
    }
  }

  /** Analyze and record one complaint from a public source (or, if already imported, just add people). */
  // `text` is what the model files; `display`, if given, is what the public record shows (for a group).
  async function record(
    key: string,
    text: string,
    authorName: string,
    source: Parameters<typeof intake.recordPublic>[0]['source'],
    people: { id: string; at: Date }[],
    display?: string,
  ) {
    const ref = db.doc(`imports/${createHash('sha256').update(key).digest('hex').slice(0, 32)}`);
    const done = await ref.get();
    if (done.exists) {
      const prev = done.data() as Imported;
      if (!dry) {
        await addSupports(prev.pointIds, people);
        // Keep the agency's caveat current on what was imported before it existed.
        if (source?.note) await db.doc(`submissions/${prev.submissionId}`).update({ 'source.note': source.note });
      }
      return 'updated';
    }
    if (dry) {
      console.log(`  would import: ${text.slice(0, 140)}`);
      if (display) console.log(`    shown as: ${display}`);
      return 'dry';
    }
    const uid = people[0].id;
    const analysis = await intake.analyzeText({ uid, text, photoPaths: [], hintId: null });
    const draftRef = db.doc(`drafts/${analysis.draftId}`);
    const draft = (await draftRef.get()).data() as Parameters<typeof intake.recordPublic>[0]['draft'];
    await draftRef.delete();
    if (!analysis.result.isComplaint || analysis.result.safety?.unsafe) return 'skipped';
    const res = await intake.recordPublic({
      uid,
      displayName: authorName,
      responderFor: [],
      draft,
      options: {
        useRewrite: false,
        removePII: true,
        keep: analysis.result.points.map((_, i) => i),
        removeSubjects: new Set(),
        addSubjectIds: [],
      },
      source,
    });
    const pointIds = [...res.matchedPointIds, ...res.addedPointIds];
    if (display) await db.doc(`submissions/${res.submissionId}`).update({ text: display });
    await addSupports(pointIds, people.slice(1));
    await ref.set({ submissionId: res.submissionId, pointIds, key, at: FieldValue.serverTimestamp() });
    return 'imported';
  }

  const [kind] = positional;
  const tally: Record<string, number> = {};
  const count = (r: string) => (tally[r] = (tally[r] ?? 0) + 1);

  try {
    if (kind === 'cfpb') {
      const company = positional[1];
      if (!company) throw new Error('Usage: npm run import -- cfpb "COMPANY NAME AS THE CFPB LISTS IT"');
      const days = flag('days', 120);
      const max = flag('max', 1000);
      const groupsWanted = flag('groups', 20);
      const since = new Date(Date.now() - days * 24 * 3600_000).toISOString().slice(0, 10);
      type Hit = { complaint_id: string; date_received: string; product: string; sub_product: string | null; issue: string; sub_issue: string | null; company_response: string | null };
      const hits: Hit[] = [];
      // Pages of up to 1000, continued with search_after (the API ignores offsets).
      let after: string | null = null;
      while (hits.length < max) {
        const size = Math.min(1000, max - hits.length);
        const params = new URLSearchParams({ company, date_received_min: since, size: String(size), no_aggs: 'true', sort: 'created_date_desc' });
        if (after) params.set('search_after', after);
        const url = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?' + params;
        const page = (await (await fetch(url)).json()) as { hits: { hits: { _source: Hit; sort?: (string | number)[] }[] } };
        const list = page.hits.hits;
        hits.push(...list.map((h) => h._source));
        if (list.length < size || !list[list.length - 1].sort) break;
        after = list[list.length - 1].sort!.join('_');
      }
      const seen = new Set<string>();
      for (let i = hits.length - 1; i >= 0; i--) {
        if (seen.has(hits[i].complaint_id)) hits.splice(i, 1);
        else seen.add(hits[i].complaint_id);
      }
      console.log(`${hits.length} CFPB complaints about ${company} since ${since}.`);
      const groups = new Map<string, Hit[]>();
      for (const h of hits) {
        const k = [h.product, h.issue, h.sub_issue ?? ''].join('|');
        groups.set(k, [...(groups.get(k) ?? []), h]);
      }
      const biggest = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, groupsWanted);
      for (const [k, list] of biggest) {
        const h = list[0];
        const what = `${h.issue}${h.sub_issue && h.sub_issue !== 'None' ? `: ${h.sub_issue}` : ''}`;
        const product = `${h.product}${h.sub_product && h.sub_product !== 'None' ? `, ${h.sub_product.toLowerCase()}` : ''}`;
        const dates = list.map((x) => new Date(x.date_received)).sort((a, b) => a.getTime() - b.getTime());
        const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const replies = new Map<string, number>();
        for (const x of list) if (x.company_response) replies.set(x.company_response, (replies.get(x.company_response) ?? 0) + 1);
        const orgReply = [...replies.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} ${r.toLowerCase()}`).join(', ');
        // The model files the problem itself; the record shows the count and dates.
        const text = `${company}, ${product}: ${what}.`;
        const first = fmt(dates[0]);
        const last = fmt(dates[dates.length - 1]);
        const display =
          `${list.length} ${list.length === 1 ? 'person' : 'people'} complained to the Consumer Financial Protection Bureau about ${readableCompany(company)} ` +
          `${first === last ? `on ${first}` : `between ${first} and ${last}`}. The problem: ${what} (${product}).`;
        const r = await record(
          `cfpb|${company}|${k}`,
          text,
          'CFPB public record',
          {
            name: 'Consumer Financial Protection Bureau complaint database',
            shortName: 'CFPB',
            id: k,
            url:
              'https://www.consumerfinance.gov/data-research/consumer-complaints/search/?' +
              new URLSearchParams({ company, issue: h.issue, date_received_min: since }),
            date: Timestamp.fromDate(dates[dates.length - 1]),
            orgReply: orgReply ? `Company responses to the CFPB: ${orgReply}.` : null,
            note: CFPB_NOTE,
          },
          list.map((x) => ({ id: `import:cfpb:${x.complaint_id}`, at: new Date(x.date_received) })),
          display,
        );
        count(r);
        console.log(`  ${r}: ${list.length} × ${what}`);
      }
    } else if (kind === 'nhtsa') {
      const [, make, model, year] = positional;
      if (!make || !model || !year) throw new Error('Usage: npm run import -- nhtsa <make> "<model>" <year>');
      const max = flag('max', 25);
      const url = `https://api.nhtsa.gov/complaints/complaintsByVehicle?${new URLSearchParams({ make, model, modelYear: year })}`;
      const data = (await (await fetch(url)).json()) as {
        results: { odiNumber: number | string; summary: string; components: string; dateComplaintFiled: string; crash: boolean | string; fire: boolean | string }[];
      };
      const recent = data.results
        .filter((c) => c.summary && c.summary.length > 40)
        .sort((a, b) => Date.parse(b.dateComplaintFiled) - Date.parse(a.dateComplaintFiled))
        .slice(0, max);
      console.log(`${data.results.length} NHTSA complaints about the ${year} ${make} ${model}; importing ${recent.length}.`);
      for (const c of recent) {
        const filed = new Date(c.dateComplaintFiled);
        const text = `About my ${year} ${make.toUpperCase()} ${model.toUpperCase()} (${c.components.toLowerCase()}): ${c.summary}`;
        const r = await record(
          `nhtsa|${c.odiNumber}`,
          text,
          'NHTSA public record',
          {
            name: 'NHTSA vehicle safety complaints',
            shortName: 'NHTSA',
            id: String(c.odiNumber),
            url: `https://www.nhtsa.gov/vehicle/${year}/${encodeURIComponent(make.toUpperCase())}/${encodeURIComponent(model.toUpperCase())}`,
            date: Timestamp.fromDate(filed),
            orgReply: null,
          },
          [{ id: `import:nhtsa:${c.odiNumber}`, at: filed }],
        );
        count(r);
        console.log(`  ${r}: ${c.summary.slice(0, 90)}`);
      }
    } else if (kind === 'fcc') {
      const days = flag('days', 30);
      const max = flag('max', 3000);
      const groupsWanted = flag('groups', 8);
      const since = new Date(Date.now() - days * 24 * 3600_000).toISOString().slice(0, 10);
      // Only the issue fields: never caller ID numbers, advertiser numbers or where the person lives.
      type Row = { id: string; date_created: string; issue_type?: string; issue?: string; method?: string; type_of_call_or_messge?: string };
      const rows: Row[] = [];
      while (rows.length < max) {
        const size = Math.min(1000, max - rows.length);
        const params = new URLSearchParams({
          $select: 'id,date_created,issue_type,issue,method,type_of_call_or_messge',
          $where: `date_created >= '${since}'`,
          $order: 'date_created DESC, id DESC',
          $limit: String(size),
          $offset: String(rows.length),
        });
        const res = await fetch(`${FCC_API}?${params}`);
        if (!res.ok) throw new Error(`FCC open data answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const page = (await res.json()) as Row[];
        rows.push(...page);
        if (page.length < size) break;
      }
      const seen = new Set<string>();
      const unique = rows.filter((r) => r.id && r.issue && !seen.has(r.id) && seen.add(r.id));
      console.log(`${unique.length} recent FCC complaints since ${since}.`);
      // Unwanted calls split by what reached them (texts, robocalls, live callers); the rest by the kind of line.
      const subOf = (r: Row) => ((r.issue === 'Unwanted Calls' ? r.type_of_call_or_messge : r.method) ?? '').trim();
      const groups = new Map<string, Row[]>();
      for (const r of unique) {
        const k = [r.issue_type ?? '', r.issue, subOf(r)].join('|');
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      const biggest = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, groupsWanted);
      for (const [k, list] of biggest) {
        const r = list[0];
        const issue = (r.issue ?? '').replace(/\s*\(.*\)$/, ''); // "Cramming (unauthorized charges...)" reads as "Cramming"
        const detail = (r.issue ?? '').match(/\((.*)\)$/)?.[1];
        const sub = subOf(r);
        const service = FCC_SERVICE[r.issue_type ?? ''] ?? (r.issue_type ?? 'communications service').toLowerCase();
        const line = FCC_LINE[sub] ?? sub.toLowerCase();
        const calls = r.issue === 'Unwanted Calls' ? `unwanted ${FCC_CALL[sub] ?? 'calls'}` : null;
        const problem = `${issue.toLowerCase()}${detail ? ` (${detail})` : ''}`;
        const what = calls ?? `their ${line ? `${line} ` : ''}${service}`;
        // date_created is a day with no zone: hold it at noon UTC so it never slips a day.
        const dayOf = (x: Row) => new Date(`${x.date_created.slice(0, 10)}T12:00:00Z`);
        const dates = list.map(dayOf).sort((a, b) => a.getTime() - b.getTime());
        const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        const first = fmt(dates[0]);
        const last = fmt(dates[dates.length - 1]);
        // No company in the record: the model files the problem under a topic.
        const text = calls ? `I keep getting ${calls} on my phone.` : `Problem with my ${line ? `${line} ` : ''}${service}: ${problem}.`;
        const display =
          `${list.length} ${list.length === 1 ? 'person' : 'people'} complained to the Federal Communications Commission about ${what} ` +
          `${first === last ? `on ${first}` : `between ${first} and ${last}`}.` +
          (calls ? '' : ` The problem: ${problem}.`);
        const res = await record(
          `fcc|${k}`,
          text,
          'FCC public record',
          {
            name: 'FCC consumer complaint data',
            shortName: 'FCC',
            id: k,
            url: 'https://opendata.fcc.gov/Consumer/CGB-Consumer-Complaints-Data/3xyp-aqkj',
            date: Timestamp.fromDate(dates[dates.length - 1]),
            orgReply: null,
            note: FCC_NOTE,
          },
          list.map((x) => ({ id: `import:fcc:${x.id}`, at: dayOf(x) })),
          display,
        );
        count(res);
        console.log(`  ${res}: ${list.length} × ${calls ?? `${what}: ${problem}`}`);
      }
    } else {
      throw new Error('Usage: npm run import -- cfpb "<company>" | nhtsa <make> "<model>" <year> | fcc');
    }
  } catch (e) {
    if (e instanceof BudgetPaused) console.log("\nToday's AI budget is used up; run again tomorrow to continue.");
    else throw e;
  }
  console.log('\n', tally);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
