/**
 * Calls and the network (phase 4) — the rules. Pure: no Foundry globals.
 * @file scripts/utils/callNet.js
 * @module night-city-messenger
 * @description Design dev/design/CALLS.md §8. A call needs signal on both ends; losing it mid-call drops the call for
 *   both, with a reason in words. A withheld number keeps the caller off the callee's client entirely (only the GM
 *   holds the real identity) until a trace reveals it. A tap or sniffer on a node of the network a call rides, on the
 *   caller's scene, catches it as if it were mail: the transcript when it was typed, else who / when / how long.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Why this client's side of a call just went dead — or null when it still has its line.
 * @param {{wasNet?: string, curNet?: string, deadZone?: boolean, nodeDead?: boolean, block?: {state: string}|null, nodeName?: string, sceneName?: string}} o
 */
export function dropReason({ wasNet = '', curNet = '', deadZone = false, nodeDead = false, block = null, nodeName = '', sceneName = '' } = {}) {
  const where = sceneName ? ` at ${sceneName}` : '';
  if (deadZone) return `Dead zone${where} — no signal`;
  if (block) {
    const what = nodeName || `the node${where}`;
    if (block.state === 'jammed') return `${what} is jammed`;
    if (block.state === 'damaged') return `${what} is damaged`;
    return `${what} went dark`;
  }
  if (nodeDead || !curNet) return `Lost signal${where}`;
  if (wasNet && curNet !== wasNet) return 'Changed network — the call could not follow';
  return null;
}

/** A withheld caller as the callee's client sees it: nothing that leads back to them. */
export function maskCaller(from = {}) {
  return { userId: from.userId || null, anon: true, name: 'Unknown caller', number: '', actorId: null, contactId: null, img: '' };
}

/** The real caller or the mask, for one recipient. */
export function callerFor(from = {}, { isGM = false, isCaller = false, traced = false } = {}) {
  return from.anon && !isGM && !isCaller && !traced ? maskCaller(from) : from;
}

/** What a tap catches from a call (a mail-shaped copy for the tapper's EXFIL folder). */
export function interceptMail(summary = {}, { fmtDuration = (s) => `${s}s` } = {}) {
  const name = (p) => (p?.anon ? 'Number withheld' : (p?.name || p?.number || 'unknown'));
  const lines = Array.isArray(summary.lines) ? summary.lines : [];
  const head = `<p><b>${esc(name(summary.from))}</b> → <b>${esc(name(summary.to))}</b>${summary.seconds ? ` · ${esc(fmtDuration(summary.seconds))}` : ''}${summary.net?.name ? ` · ${esc(summary.net.name)}` : ''}</p>`;
  const body = lines.length
    ? head + lines.map((l) => `<p><b>${esc(l.side === 'caller' ? name(summary.from) : name(summary.to))}:</b> ${esc(l.text)}</p>`).join('')
    : `${head}<p><em>A voice call — nothing was typed, so only who, when and how long were caught.</em></p>`;
  return { subject: `Intercepted call: ${name(summary.from)} → ${name(summary.to)}`, body };
}

/**
 * NETWORK LOAD for Admin → Phone → Live: calls on each network right now and today.
 * @param {{calls: object[], logs: object[], nets: {id, name, color}[], today: string}} o — today = 'YYYY-MM-DD' (game date)
 */
export function networkLoad({ calls = [], logs = [], nets = [], today = '', blocks = {} } = {}) {
  const rows = new Map(nets.map((n) => [n.id, { id: n.id, name: n.name, color: n.color || '', now: 0, today: 0, cut: blocks[n.id]?.state || '' }]));
  const row = (net) => {
    if (!net?.id) return null;
    if (!rows.has(net.id)) rows.set(net.id, { id: net.id, name: net.name || net.id, color: '', now: 0, today: 0, cut: blocks[net.id]?.state || '' });
    return rows.get(net.id);
  };
  for (const c of calls) if (['live', 'held'].includes(c.state)) { const r = row(c.net); if (r) r.now++; }
  for (const l of logs) if (today && String(l.gameTime || '').slice(0, 10) === today) { const r = row(l.net); if (r) r.today++; }
  const list = [...rows.values()].filter((r) => r.now || r.today || r.cut);
  const max = Math.max(1, ...list.map((r) => r.today + r.now));
  for (const r of list) r.pct = Math.round(((r.today + r.now) / max) * 100);
  list.sort((a, b) => b.now - a.now || b.today - a.today || a.name.localeCompare(b.name));
  return { rows: list, now: list.reduce((n, r) => n + r.now, 0), today: list.reduce((n, r) => n + r.today, 0) };
}
