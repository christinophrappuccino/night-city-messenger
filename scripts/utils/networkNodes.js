/**
 * Network nodes — the pure rules (no Foundry globals, so the sims drive them directly).
 * @file scripts/utils/networkNodes.js
 * @module night-city-messenger
 *
 * A NODE is a physical thing on a map that carries a network into a place: a router, a relay mast, a junction box,
 * an antenna. Design: dev/design/NETWORK-NODES.md.
 *
 * The scene rule (version 1, dev 2026-10-29): if a scene has nodes for a network, that network reaches the scene only
 * while at least ONE of those nodes is up — and an up node CARRIES its network there even when the scene was never
 * wired to it (a node is what brings a network into a place). A scene with no nodes for a network behaves exactly as before — nodes are
 * optional, and a world that never makes one sees no change.
 *
 * Storage: the world setting `networkNodes` = { [nodeId]: node }. Times are GAME-clock milliseconds.
 */

export const NODE_KINDS = Object.freeze({
  router:   { label: 'Router',        icon: 'fas fa-server',            firmware: 'ROUTE-OS' },
  relay:    { label: 'Relay',         icon: 'fas fa-tower-cell',        firmware: 'RELAY-FW' },
  mast:     { label: 'Mast',          icon: 'fas fa-tower-broadcast',   firmware: 'MAST-CTRL' },
  junction: { label: 'Junction box',  icon: 'fas fa-box',               firmware: 'JBX' },
  antenna:  { label: 'Antenna',       icon: 'fas fa-satellite-dish',    firmware: 'ANT-LINK' },
});

/** on = carrying the network · off = switched off · jammed = off until jammedUntil · damaged = off until repaired. */
export const NODE_STATES = Object.freeze({
  on:      { label: 'On',      tone: 'good' },
  off:     { label: 'Off',     tone: 'plain' },
  jammed:  { label: 'Jammed',  tone: 'attn' },
  damaged: { label: 'Damaged', tone: 'bad' },
});

export const ALERT_LEVELS = Object.freeze(['Calm', 'Wary', 'Alarmed', 'Lockdown']);

/** Longest log a node keeps. */
export const NODE_LOG_CAP = 40;

const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Normalise a node record. Unknown kind → relay, unknown state → on. Never throws.
 * @param {object} raw
 * @returns {object}
 */
export function sanitizeNode(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = NODE_KINDS[r.kind] ? r.kind : 'relay';
  const state = NODE_STATES[r.state] ? r.state : 'on';
  const log = Array.isArray(r.log) ? r.log.filter((e) => e && typeof e === 'object').slice(-NODE_LOG_CAP).map((e) => ({
    ts: Number(e.ts) || 0, who: str(e.who, 80), what: str(e.what, 160), wiped: !!e.wiped,
  })) : [];
  return {
    id: str(r.id, 64),
    networkId: str(r.networkId, 64),
    name: str(r.name, 80) || `${NODE_KINDS[kind].label}`,
    kind,
    sceneId: str(r.sceneId, 64),
    place: str(r.place, 120),
    state,
    jammedUntil: Number(r.jammedUntil) > 0 ? Number(r.jammedUntil) : 0,
    hidden: !!r.hidden,
    discoverable: !!r.discoverable,
    alert: clampInt(r.alert, 0, ALERT_LEVELS.length - 1, 0),
    alertAt: Number(r.alertAt) || 0,
    showTraffic: r.showTraffic !== false,
    flavour: Array.isArray(r.flavour) ? r.flavour.map((x) => str(x, 120)).filter(Boolean).slice(0, 12) : [],
    security: r.security && typeof r.security === 'object' ? r.security : null,
    override: r.override && typeof r.override === 'object' ? r.override : null,
    log,
    taps: sanitizeEffects(r.taps),
    backdoors: sanitizeEffects(r.backdoors),
    runs: sanitizeRuns(r.runs),
    infections: sanitizeInfections(r.infections),
    createdAt: Number(r.createdAt) || 0,
  };
}

/**
 * The state a node is REALLY in at `now`: a jam whose time has passed reads as on (the stored record is tidied by the
 * GM's reaper; readers never wait for it).
 */
export function nodeStateAt(node, now = 0) {
  if (!node) return 'off';
  if (node.state === 'jammed' && node.jammedUntil && now >= node.jammedUntil) return 'on';
  return NODE_STATES[node.state] ? node.state : 'on';
}

export const nodeIsUp = (node, now = 0) => nodeStateAt(node, now) === 'on';

/** Every node as an array, optionally narrowed. @param {object|object[]} all */
export function listNodes(all, { networkId, sceneId } = {}) {
  const arr = Array.isArray(all) ? all : Object.values(all || {});
  return arr.filter((n) => n && (!networkId || n.networkId === networkId) && (!sceneId || n.sceneId === sceneId));
}

/**
 * The scene rule. @returns {{ hasNodes, up, down, cut }}
 * cut = the scene has nodes for this network and none of them is up.
 */
export function sceneVerdict(all, networkId, sceneId, now = 0) {
  const here = sceneId ? listNodes(all, { networkId, sceneId }) : [];
  const up = here.filter((n) => nodeIsUp(n, now)).length;
  return { hasNodes: here.length > 0, up, down: here.length - up, cut: here.length > 0 && up === 0 };
}

/** The set of network ids a scene's nodes currently cut. */
export function cutNetworks(all, sceneId, now = 0) {
  const ids = new Set(listNodes(all, { sceneId }).map((n) => n.networkId));
  return new Set([...ids].filter((id) => sceneVerdict(all, id, sceneId, now).cut));
}

/** The set of network ids a scene's up nodes bring onto it (whatever the scene's own wiring says). */
export function carriedNetworks(all, sceneId, now = 0) {
  return new Set(listNodes(all, { sceneId }).filter((n) => nodeIsUp(n, now)).map((n) => n.networkId));
}

/** Nodes whose jam has run out (the GM's reaper turns them back on). */
export const expiredJams = (all, now) => listNodes(all).filter((n) => n.state === 'jammed' && n.jammedUntil && now >= n.jammedUntil);

/** A stable hex address for a node — 0x3FA2·C9 — drawn from its id (display flavour, never a key). */
export function nodeHex(id = '') {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const v = (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `0x${v.slice(0, 4)}·${v.slice(4, 6)}`;
}

/** "ROUTE-OS 4.7" — firmware flavour per kind, versioned off the id so a node always says the same thing. */
export function nodeFirmware(node) {
  const k = NODE_KINDS[node?.kind] || NODE_KINDS.relay;
  let s = 0; for (const ch of String(node?.id || '')) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return `${k.firmware} ${1 + (s % 6)}.${s % 10}`;
}

/** Append a log line (pure — returns the new array, capped). */
export function appendLog(log, entry) {
  return [...(Array.isArray(log) ? log : []), { ts: Number(entry.ts) || 0, who: str(entry.who, 80), what: str(entry.what, 160), wiped: false }].slice(-NODE_LOG_CAP);
}

/**
 * A node's state change, as a patch. jam needs minutes (> 0) and the current game time.
 * @returns {object|null} null for an unknown state
 */
export function statePatch(state, { now = 0, minutes = 0 } = {}) {
  if (!NODE_STATES[state]) return null;
  if (state === 'jammed') {
    const m = Math.max(1, Math.round(Number(minutes) || 30));
    return { state, jammedUntil: now + m * 60000 };
  }
  return { state, jammedUntil: 0 };
}

/** "Jammed · 18m" etc. for a list row. */
export function stateLabel(node, now = 0) {
  const s = nodeStateAt(node, now);
  if (s === 'jammed' && node.jammedUntil) {
    const mins = Math.max(1, Math.ceil((node.jammedUntil - now) / 60000));
    return `Jammed · ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}`;
  }
  return NODE_STATES[s].label;
}

/**
 * The console ticker, built from what is really there (dev, 2026-10-29: "tailor it to the content"): the node's own
 * log (never a wiped line), the GM's flavour lines, and — when it shows traffic — packet chatter in the network's
 * naming. Off / damaged = no carrier, jammed = noise. Pure: the caller formats times.
 * @param {object} node — sanitized
 * @param {{name?:string}} network
 * @param {{now?:number, fmt?:(ts:number)=>string}} [o]
 * @returns {string[]}
 */
export function tickerLines(node, network = {}, { now = 0, fmt = () => '', symptoms = true } = {}) {
  const st = nodeStateAt(node, now);
  const hex = nodeHex(node?.id);
  if (st === 'off') return ['— no carrier —'];
  if (st === 'damaged') return ['!! hardware fault — no carrier !!'];
  if (st === 'jammed') return [`${hex} !! carrier noise !! retry · retry`, `${hex} !! sync lost — retrying`, '░▒▓ ░▒▓ ░▒▓'];
  const tag = String(network?.name || 'net').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || 'net';
  const out = [];
  for (const e of (node.log || []).filter((x) => !x.wiped).slice(-5).reverse()) out.push(`${fmt(e.ts)} ${e.who ? e.who + ' — ' : ''}${e.what}`.trim());
  for (const f of node.flavour || []) out.push(`${hex} ${f}`);
  if (symptoms) out.push(...symptomLines(node));
  if (node.showTraffic !== false) {
    let s = 0; for (const ch of String(node.id || '')) s = (s * 33 + ch.charCodeAt(0)) >>> 0;
    for (let i = 0; i < 4; i++) {
      const u = 1 + ((s >>> (i * 3)) % 15), size = 120 + ((s >>> i) % 1800);
      out.push(i % 2 ? `${hex} relay → ${tag}.unit-${String(u).padStart(2, '0')} · ${size}b · ▼` : `${hex} ${tag}.unit-${String(u).padStart(2, '0')} → relay · ${size}b · ▲`);
    }
    out.push(`${hex} keepalive ok`);
  }
  return out.length ? out : [`${hex} idle`];
}

/**
 * Why each network is cut on a scene, for the network selector: { [networkId]: { state, until } } — 'jammed' when any
 * of its nodes there is jammed (until = the LAST jam to end), else 'damaged' when any is damaged, else 'off'.
 */
export function sceneBlocks(all, sceneId, now = 0) {
  const out = {};
  for (const id of cutNetworks(all, sceneId, now)) {
    const here = listNodes(all, { networkId: id, sceneId });
    const states = here.map((n) => nodeStateAt(n, now));
    if (states.includes('jammed')) out[id] = { state: 'jammed', until: Math.max(...here.filter((n) => nodeStateAt(n, now) === 'jammed').map((n) => n.jammedUntil || 0)) };
    else if (states.includes('damaged')) out[id] = { state: 'damaged', until: 0 };
    else out[id] = { state: 'off', until: 0 };
  }
  return out;
}

// ═══ Session effects a runner leaves on a node (step 4): TAPS (mail over the network copied to them) and
// BACKDOORS (they skip the network's login). { id, actorId, actorName, at, until } — until 0 = until removed.
// A tap only listens while its node is up. ═══

export const NODE_EFFECTS = Object.freeze({
  taps: { label: 'Tap', icon: 'fa-ear-listen' },
  backdoors: { label: 'Backdoor', icon: 'fa-door-open' },
});

/** Clean an effect list. */
export function sanitizeEffects(list) {
  return (Array.isArray(list) ? list : []).filter((e) => e && typeof e === 'object' && e.id && e.actorId).slice(-20).map((e) => ({
    id: str(e.id, 40), actorId: str(e.actorId, 64), actorName: str(e.actorName, 80), at: Number(e.at) || 0, until: Number(e.until) > 0 ? Number(e.until) : 0,
  }));
}

/** The effects of a kind still in force at `now`. */
export function activeEffects(node, kind, now = 0) {
  return (node?.[kind] || []).filter((e) => !e.until || now < e.until);
}

/** Replace any earlier effect of the same runner (one tap / backdoor per runner per node). */
export function withEffect(list, effect) {
  return [...(list || []).filter((e) => e.actorId !== effect.actorId), effect].slice(-20);
}

/** Effects whose time ran out, per kind (the reaper drops them). */
export function expiredEffects(node, now) {
  const out = {};
  for (const k of Object.keys(NODE_EFFECTS)) { const gone = (node?.[k] || []).filter((e) => e.until && now >= e.until); if (gone.length) out[k] = gone; }
  return out;
}

// ═══ Step 5 — INFECTIONS: a program inserted from a shard lives on the node. ═══
// { id, family, kind, name, actorId, actorName, at, quality, sloppy, stealthDV, every (h), nextAt, maxNodes, carry,
//   fireAt, cap, loot[] }. `family` ties a worm's copies together (cleaning one node cleans one node; recall / a bomb
// acts on the whole family).

/** The network programs (the registry's `node` mode mirrors these keys with a `node` prefix). */
export const NODE_PROGRAMS = Object.freeze({
  worm:    { label: 'Worm', icon: 'fa-bug', blurb: 'copies itself to another node of the network every few hours' },
  tap:     { label: 'Tap', icon: 'fa-ear-listen', blurb: 'mail sent over the network is copied to you' },
  bomb:    { label: 'Blackout bomb', icon: 'fa-bomb', blurb: 'after a delay every node it reached goes dark' },
  sniffer: { label: 'Sniffer', icon: 'fa-satellite-dish', blurb: 'records traffic — come back and collect it' },
  patch:   { label: 'Patch', icon: 'fa-kit-medical', blurb: 'cleans every infection on the node' },
});

/** 'nodeWorm' → 'worm' (the registry key → the infection kind); anything else → null. */
export function nodeProgramKind(effectKey) {
  const m = /^node([A-Z]\w*)$/.exec(String(effectKey || ''));
  const k = m ? m[1].charAt(0).toLowerCase() + m[1].slice(1) : '';
  return NODE_PROGRAMS[k] ? k : null;
}

const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** Clean an infection list. */
export function sanitizeInfections(list) {
  return (Array.isArray(list) ? list : []).filter((x) => x && typeof x === 'object' && x.id && NODE_PROGRAMS[x.kind]).slice(-30).map((x) => ({
    id: str(x.id, 40), family: str(x.family || x.id, 40), kind: x.kind, name: str(x.name, 80) || NODE_PROGRAMS[x.kind].label,
    actorId: str(x.actorId, 64), actorName: str(x.actorName, 80), at: numOr(x.at, 0),
    quality: Math.max(0, Math.min(100, numOr(x.quality, 50))), sloppy: !!x.sloppy, stealthDV: Math.max(0, Math.min(40, Math.round(numOr(x.stealthDV, 12)))),
    every: Math.max(0.25, numOr(x.every, 3)), nextAt: numOr(x.nextAt, 0), maxNodes: Math.max(1, Math.min(50, Math.round(numOr(x.maxNodes, 6)))),
    carry: NODE_PROGRAMS[x.carry] && x.carry !== 'worm' && x.carry !== 'patch' ? x.carry : '',
    fireAt: numOr(x.fireAt, 0), cap: Math.max(1, Math.min(100, Math.round(numOr(x.cap, 20)))),
    loot: Array.isArray(x.loot) ? x.loot.filter((m) => m && typeof m === 'object').slice(-100) : [],
    quest: !!x.quest, note: str(x.note, 200),
  }));
}

/**
 * A new infection from an inserted program.
 * @param {string} kind — worm | tap | bomb | sniffer
 * @param {object} p — { id, family?, name, actorId, actorName, now, quality, stealthDV, params:{every, maxNodes, carry, delay, cap} }
 */
export function makeInfection(kind, p) {
  const prm = p.params || {};
  const sloppy = (p.quality ?? 50) < 50;
  const every = Math.max(0.25, numOr(prm.every, 3)) * (sloppy ? 2 : 1);
  const [inf] = sanitizeInfections([{
    id: p.id, family: p.family || p.id, kind, name: p.name, actorId: p.actorId, actorName: p.actorName, at: p.now,
    quality: p.quality, sloppy, stealthDV: p.stealthDV, every, nextAt: kind === 'worm' ? p.now + every * 3600000 : 0,
    maxNodes: prm.maxNodes, carry: kind === 'worm' ? prm.carry : '', quest: !!p.quest, note: p.note, fireAt: kind === 'bomb' ? p.now + Math.max(0, numOr(prm.delay, 2)) * 3600000 : 0, cap: prm.cap,
  }]);
  return inf;
}

/** Every node (sanitized list) carrying a member of this family. */
export const familyNodes = (all, family) => listNodes(all).filter((n) => (n.infections || []).some((x) => x.family === family));

/**
 * Where a worm spreads next: another node of the same network that does not carry the family yet — other scenes
 * first, then nearest by id order. Deterministic (the sim can predict it). null = nowhere left / at its limit.
 */
export function wormTarget(all, node, inf) {
  const fam = familyNodes(all, inf.family);
  if (fam.length >= inf.maxNodes) return null;
  const has = new Set(fam.map((n) => n.id));
  const cands = listNodes(all, { networkId: node.networkId }).filter((n) => !has.has(n.id));
  if (!cands.length) return null;
  cands.sort((a, b) => (Number(a.sceneId === node.sceneId) - Number(b.sceneId === node.sceneId)) || a.id.localeCompare(b.id));
  return cands[0];
}

/** Infections a sweep with this total uncovers (stealth DV ≤ total; force = all). Never the runner's own. */
export function sweepFinds(node, total, { actorId = '', force = false } = {}) {
  return (node?.infections || []).filter((x) => x.actorId !== actorId && (force || total >= x.stealthDV));
}

/** A line for the ticker when a node is infected and symptoms show: a stray retry / garbled packet, never the name. */
export function symptomLines(node) {
  if (!(node?.infections || []).length) return [];
  const hex = nodeHex(node.id);
  return [`${hex} ??? checksum mismatch — retry`, `${hex} pkt 0x${hex.slice(2, 6)} ▒▒▒ resent`];
}

// ═══ RUNS — a runner's session on a node, saved so jacking out and back in (or a refresh) does not refill the moves.
// { actorId, actorName, rank, moves, used, since, until, open } — one per runner per node. Until `until` (game ms)
// a fresh jack-in resumes it; `open` = still jacked in (a refresh resumes it with no roll). ═══

/** Clean a run list. */
export function sanitizeRuns(list) {
  return (Array.isArray(list) ? list : []).filter((r) => r && typeof r === 'object' && r.actorId).slice(-20).map((r) => {
    const moves = clampInt(r.moves, 0, 20, 0);
    return {
      actorId: str(r.actorId, 64), actorName: str(r.actorName, 80), rank: clampInt(r.rank, 0, 20, 0),
      moves, used: clampInt(r.used, 0, moves, 0), since: Number(r.since) || 0, until: Number(r.until) || 0, open: !!r.open, kicks: clampInt(r.kicks, 0, 999, 0),
    };
  });
}

/** This runner's session on the node, if it has not run out. */
export function liveRun(node, actorId, now = 0) {
  if (!actorId) return null;
  return (node?.runs || []).find((r) => r.actorId === actorId && now < r.until) || null;
}

/** Replace the runner's earlier record. */
export function withRun(list, run) {
  return [...(list || []).filter((r) => r.actorId !== run.actorId), run].slice(-20);
}

/** Runs whose time is up (the reaper drops them). */
export function expiredRuns(node, now) {
  return (node?.runs || []).filter((r) => now >= r.until);
}
