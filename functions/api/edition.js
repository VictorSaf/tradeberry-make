// /api/edition — the Opening Note's edition of the day: one for everyone per UTC day. It is written by
// tools/edition.mjs (Claude Code CLI on the administrator's Mac, with the photograph it picks on Unsplash) straight
// into D1; this endpoint only serves it. The page keeps its format; only the words and the picture change.
// GET  → { edition, admin, requested } — today's edition or, until it is written, the latest one (null: none yet,
//        the page shows its built-in note); requested: a new edition was asked for and is being written
// POST { op: 'regen' } → { queued: true } — administrators only: ask for a new edition now (picked up within ~2 min)
import { json, now, sameOrigin, audit } from '../../server/auth.js';

const day = () => new Date().toISOString().slice(0, 10);
const shape = r => { if (!r || !r.data) return null; try { return { day: r.day, n: r.n, ts: r.created_at, ...JSON.parse(r.data) }; } catch (e) { return null; } };

export async function onRequestGet({ env, data }) {
  const [last, req] = await Promise.all([
    env.DB.prepare("SELECT day, n, data, created_at FROM editions WHERE status = 'ready' ORDER BY day DESC LIMIT 1").first(),
    env.DB.prepare('SELECT COUNT(*) AS c FROM edition_req WHERE day = ?').bind(day()).first()
  ]);
  return json({ edition: shape(last), admin: !!data.user.admin, requested: !!(req && req.c) });
}

export async function onRequestPost({ request, env, data }) {
  if (!data.user.admin) return json({ error: 'Administrators only' }, 403);
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused' }, 403);
  const d = day();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM edition_req WHERE day <> ?').bind(d),
    env.DB.prepare('INSERT INTO edition_req (day, by, at) VALUES (?, ?, ?)').bind(d, data.user.username, now())
  ]);
  await audit(env, request, data.user.username, 'edition.regen');
  return json({ queued: true });
}
