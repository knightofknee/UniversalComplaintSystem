/**
 * Seeding the record from public government complaint data, so day one
 * isn't empty. Both sources are US government works (public domain). Every
 * imported complaint is labelled with its source and links back to it, and
 * goes through the same intake as anyone's: the model files it, matches it
 * to existing points, and nothing is posted that the intake wouldn't post.
 *
 *   npm run import -- cfpb "WELLS FARGO & COMPANY" [--days 120] [--max 1000] [--groups 20] [--dry]
 *   npm run import -- nhtsa tesla "model 3" 2023 [--max 25] [--dry]
 *
 * CFPB (Consumer Financial Protection Bureau): the public API no longer
 * includes narratives, so complaints are grouped by company and issue; each
 * group becomes one complaint on the record ("412 people told the CFPB...")
 * and every complaint in it counts as one supporter, dated when it was
 * filed. NHTSA (vehicle safety): each complaint has its own narrative and is
 * imported on its own.
 *
 * Imports spend from the same daily AI budget as everyone else and stop when
 * it runs out; run again tomorrow to continue. Re-running is safe: each
 * government complaint counts once (supports are keyed by its id).
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
      if (!dry) await addSupports(prev.pointIds, people);
      return 'updated';
    }
    if (dry) {
      console.log(`  would import: ${text.slice(0, 140)}`);
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
    } else {
      throw new Error('Usage: npm run import -- cfpb "<company>" | nhtsa <make> "<model>" <year>');
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
