/**
 * What a shared link shows as its preview card in Messages, Slack, WhatsApp
 * and the rest: the complaint itself, not a generic page title.
 *
 * The web version is a single page, so every link serves the same HTML. The
 * website (waldgrave.com, pages/api/ucs/share.js) asks this for a link's
 * title and description and writes them into that HTML for link-preview
 * fetchers. Public data only, the same a signed-out reader sees; no App
 * Check, because the caller is a server and a preview bot, never the app.
 */
import { onRequest } from 'firebase-functions/v2/https';

import { db } from './common';

const KINDS = { point: 'points', subject: 'subjects', submission: 'submissions' } as const;

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const people = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'person has' : 'people have'}`;

export const linkPreview = onRequest({ maxInstances: 5, memory: '256MiB' }, async (req, res) => {
  const kind = String(req.query.kind ?? '') as keyof typeof KINDS;
  const id = String(req.query.id ?? '');
  if (!(kind in KINDS) || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    res.status(400).json({});
    return;
  }
  const snap = await db.doc(`${KINDS[kind]}/${id}`).get();
  if (!snap.exists || snap.get('removed') !== false) {
    res.status(404).json({});
    return;
  }
  let title: string;
  let description: string;
  if (kind === 'point') {
    const names = ((snap.get('subjectNames') as string[] | undefined) ?? []).slice(0, 3).join(' · ');
    title = clip(snap.get('text') as string, 140);
    description = `${people((snap.get('supportCount') as number | undefined) ?? 0)} this issue${names ? ` · ${names}` : ''}`;
  } else if (kind === 'subject') {
    const points = (snap.get('stats.points') as number | undefined) ?? 0;
    title = `${snap.get('name') as string}: what could be better`;
    description = `${points.toLocaleString('en-US')} ${points === 1 ? 'complaint' : 'complaints'}, sorted by how many people share them.`;
  } else {
    const text = snap.get('text') as string;
    if (text === '[deleted]') {
      res.status(404).json({});
      return;
    }
    title = clip(text, 140);
    description = `A complaint by ${snap.get('authorName') as string}`;
  }
  res.set('Cache-Control', 'public, max-age=300').json({ title, description });
});
