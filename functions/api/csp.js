// POST /api/csp ← the browser's Content-Security-Policy violation reports (report-uri in host/server.mjs, security
// audit 09.11.2026, F06). Open without a session (a browser sends them without cookies) and never trusted: the body is
// capped, only a few fields are read, each cut short and stripped of control characters, and at most 30 lines a minute
// reach the log (server.log on the Mac mini), so a flood cannot fill it. Answers 204 whatever came.
const MAX = 8192, PER_MIN = 30;
let minute = 0, lines = 0, dropped = 0;
const field = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160);

export async function onRequestPost({ request }) {
  const none = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  const text = await request.text().catch(() => '');
  if (!text || text.length > MAX) return none();
  let r; try { r = JSON.parse(text); } catch (e) { return none(); }
  r = r && (r['csp-report'] || (Array.isArray(r) ? r[0] && r[0].body : r.body) || r);
  if (!r || typeof r !== 'object') return none();
  const m = Math.floor(Date.now() / 60000);
  if (m !== minute) { if (dropped) console.log(new Date().toISOString(), `csp: ${dropped} more reports dropped last minute`); minute = m; lines = 0; dropped = 0; }
  if (++lines > PER_MIN) { dropped++; return none(); }
  let page = ''; try { page = new URL(r['document-uri'] || r.documentURL || '').pathname; } catch (e) {}
  console.log(new Date().toISOString(), `csp: ${field(r['effective-directive'] || r.effectiveDirective || r['violated-directive'])} blocked ${field(r['blocked-uri'] || r.blockedURL)} on ${field(page)}${r['line-number'] || r.lineNumber ? ` (${field(r['source-file'] || r.sourceFile).split('/').pop()}:${field(r['line-number'] || r.lineNumber)})` : ''}`);
  return none();
}
