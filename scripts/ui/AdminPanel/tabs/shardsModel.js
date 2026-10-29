/**
 * shardsModel — the pure rules behind Admin → Shards' cartridge list and its
 * detail pane (dev-approved mock dev/mockups/admin-shards-modules-mock.html,
 * frame "B-left"). No Foundry globals: ShardsTab gathers the world, these turn a
 * gathered row into what the template draws. Sim: dev/tools/sims/test-shards-cartridges.mjs.
 * @file scripts/ui/AdminPanel/tabs/shardsModel.js
 * @module night-city-messenger
 */

/** Gathered `status` → the state light + its words + its meaning colour. */
export const SHARD_STATES = Object.freeze({
  blackice:  { light: 'ice',      label: 'Black ICE armed', short: 'Black ICE', tone: 'is-bad',    icon: 'fa-skull' },
  locked:    { light: 'locked',   label: 'Locked',          short: 'Locked',    tone: 'is-secret', icon: 'fa-lock' },
  breached:  { light: 'breached', label: 'Breached',        short: 'Breached',  tone: 'is-good',   icon: 'fa-lock-open' },
  open:      { light: 'open',     label: 'Open',            short: 'Open',      tone: 'is-plain',  icon: 'fa-lock-open' },
  destroyed: { light: 'bricked',  label: 'Bricked',         short: 'Bricked',   tone: 'is-bad',    icon: 'fa-skull-crossbones' },
});
export const stateOf = (status) => SHARD_STATES[status] || SHARD_STATES.locked;

/** The five notches, in the order a runner meets them. */
export const NOTCHES = Object.freeze([
  { key: 'net',   name: 'Network',    icon: 'fa-wifi' },
  { key: 'key',   name: 'Key item',   icon: 'fa-key' },
  { key: 'login', name: 'Login',      icon: 'fa-user-lock' },
  { key: 'enc',   name: 'Encryption', icon: 'fa-lock' },
  { key: 'ice',   name: 'Black ICE',  icon: 'fa-skull' },
]);
const LAYER_NOTCH = { network: 'net', keyitem: 'key', login: 'login', encryption: 'enc' };

/**
 * Gathered layers ({key, small, cleared, ice}) → five notches, coloured EXACTLY like
 * the detail's breach-path stops so a notch on the left points at its stop on the
 * right: a standing lock = violet (secret), ICE = red (bad), cleared = green (good),
 * and the next lock a runner faces carries the stop's amber ring (`next`). The
 * encryption notch goes red with the ICE notch when Black ICE guards the cipher —
 * on the path that is one red skull stop.
 */
export function notchStates(layers = []) {
  const have = {};
  const nextIdx = layers.findIndex((l) => !l.cleared);
  const next = nextIdx >= 0 && !layers[nextIdx].ice ? LAYER_NOTCH[layers[nextIdx].key] : null;
  for (const l of layers) {
    const k = LAYER_NOTCH[l.key];
    if (!k) continue;
    have[k] = l;
    if (k === 'enc' && l.ice) have.ice = l;
  }
  return NOTCHES.map((n) => {
    const l = have[n.key];
    const on = !!l;
    const cleared = on && !!l.cleared;
    const isNext = on && !cleared && n.key === next;
    const tone = !on ? '' : cleared ? 'is-ok' : (n.key === 'ice' || (n.key === 'enc' && l.ice)) ? 'is-ice' : 'is-lock';
    const cls = tone + (isNext ? ' is-next' : '');
    const what = on ? `${n.name}${l.small ? `: ${l.small}` : ''}${cleared ? ' — cleared' : isNext ? ' — the next lock' : ''}` : `${n.name} — none`;
    return { key: n.key, icon: n.icon, cls, tone, next: isNext, tip: what };
  });
}

/**
 * An entry's colour in the detail list: one category hue per content TYPE (the
 * admin's eight --ncm-hue-* tokens, tuned per preset for text contrast), so entries
 * of different kinds never look alike. The viewer's accent family is kept where it
 * can be (messages / logs cool, dossiers / malware pink-red, payloads / galleries
 * violet, places / sheets green). Meaning tokens stay reserved for meaning — the one
 * exception is the eddies drop, which IS money.
 */
export const ENTRY_HUES = Object.freeze({
  message: 'var(--ncm-hue-8)', chatlog: 'var(--ncm-hue-7)', syslog: 'var(--ncm-hue-2)', record: 'var(--ncm-hue-2)',
  eddies: 'var(--ncm-money)', banking: 'var(--ncm-hue-6)',
  dossier: 'var(--ncm-hue-1)', credentials: 'var(--ncm-hue-5)', malware: 'var(--ncm-hue-1)',
  payload: 'var(--ncm-hue-4)', gallery: 'var(--ncm-hue-4)', schematic: 'var(--ncm-hue-7)',
  avlog: 'var(--ncm-hue-3)', location: 'var(--ncm-hue-3)', spreadsheet: 'var(--ncm-hue-6)',
  calendar: 'var(--ncm-hue-5)', document: 'var(--ncm-hue-8)', note: 'var(--ncm-hue-5)',
});
export const entryHue = (type) => ENTRY_HUES[type] || ENTRY_HUES.message;

/** The detail's foldable sections, in page order (folds are remembered per session). */
export const DETAIL_SECTIONS = Object.freeze(['path', 'integ', 'ents']);

/** Integrity tiers (IntegrityModel's tierOf keys → the words + the colour class). */
export const INTEG_TIERS = Object.freeze([
  { key: 'severe', css: 'critical', name: 'Critical', lo: 1,  hi: 24 },
  { key: 'heavy',  css: 'unstable', name: 'Unstable', lo: 25, hi: 49 },
  { key: 'light',  css: 'degraded', name: 'Degraded', lo: 50, hi: 74 },
  { key: 'clean',  css: 'intact',   name: 'Intact',   lo: 75, hi: 100 },
]);
const BRICKED_TIER = { key: 'bricked', css: 'bricked', name: 'Bricked', lo: 0, hi: 0 };

/** A percent → its tier record (bricked at 0). */
export function integTier(pct) {
  const p = Math.round(Number(pct) || 0);
  if (p <= 0) return BRICKED_TIER;
  return INTEG_TIERS.find((t) => p >= t.lo && p <= t.hi) || INTEG_TIERS[3];
}

/**
 * One entry's damage level (0..1, quarter steps) → its state badge + battery.
 * whole = nothing lost · part = some lost · lost = gone.
 */
export function entryState(level) {
  const lv = Math.max(0, Math.min(1, Math.round((Number(level) || 0) * 4) / 4));
  const on = Math.round(lv * 4);   // cells lost
  const cells = [0, 1, 2, 3].map((i) => ({ i, lost: i >= 4 - on, lv: 4 - i }));
  if (lv >= 1) return { key: 'lost', css: 'bricked', label: 'Lost', icon: 'fa-xmark', pct: 100, cells };
  if (lv > 0) return { key: 'part', css: on >= 2 ? 'unstable' : 'degraded', label: `${(4 - on) * 25}% left`, icon: 'fa-circle-half-stroke', pct: Math.round(lv * 100), cells };
  return { key: 'whole', css: 'intact', label: '', icon: '', pct: 0, cells };
}

/** "3h ago" style, from a ms age. */
export function agoLabel(ms) {
  if (!(ms > 0)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

/**
 * A gathered shard row → one cartridge. `opts.groupMode` drops the holder from the
 * meta line when the bay already says it; `opts.sort` marks the sort key.
 */
export function cartridgeView(s, opts = {}) {
  const st = stateOf(s.status);
  const on = !!s.integrityEnabled;
  const pct = on ? Math.max(0, Math.min(100, Math.round(s.integrityPercent ?? 100))) : null;
  const tier = on ? integTier(pct) : null;
  const holder = s.ownerKey === 'world' ? '' : String(s.ownerName || '').replace(/’s gear$/, '');
  return {
    itemId: s.itemId,
    name: s.name,
    img: s.img || '',
    bricked: s.status === 'destroyed',
    madeBy: s.makerName || '',
    madeByLabel: s.makerName ? `Made by ${s.makerName}` : '',
    holder,
    showHolder: opts.groupMode !== 'owner',
    files: s.entryCount ?? 0,
    integ: pct,
    integKey: opts.sort === 'integ',
    tierCss: tier ? tier.css : 'off',
    stripTip: on ? `Integrity ${pct}% · ${tier.name}` : 'Integrity off',
    light: st.light,
    stateWord: st.short,
    stateLabel: st.label,
    stateTone: st.tone.replace(/^is-/, ''),
    notches: notchStates(s.layers),
    eb: s.unclaimedEddies > 0 ? s.unclaimedEddies.toLocaleString() : '',
  };
}

/** A bay's folded summary: one state light per shard, capped, "+N" past it. */
export function peekLights(cards, cap = 22) {
  return { lights: cards.slice(0, cap).map((c) => ({ light: c.light, name: c.name })), more: Math.max(0, cards.length - cap) };
}

/** A bay's edge colour, by what it groups. */
export function bayColor(groupMode, key) {
  if (groupMode === 'status') {
    const st = SHARD_STATES[String(key).replace(/^status:/, '')];
    return { ice: 'var(--ncm-bad)', locked: 'var(--ncm-secret)', breached: 'var(--ncm-good)', open: 'var(--ncm-text-label)', bricked: 'var(--ncm-bad)' }[st?.light] || 'var(--ncm-border-active)';
  }
  return '';   // the template hues it by name
}

/**
 * The A2 integrity module's view-model from a RESOLVED integrity config
 * (IntegrityModel.resolveIntegrity) + the per-hit loss after hardening.
 */
export function integrityView(cfg, perHit) {
  const max = cfg.maxIntegrity || 100;
  const cur = Math.max(0, Math.min(max, cfg.currentIntegrity ?? max));
  const pct = Math.round((cur / max) * 100);
  const tier = integTier(pct);
  const per = Math.max(1, Math.round(perHit || 1));
  const stepsTo = (targetPct) => Math.max(1, Math.ceil((cur - Math.floor(max * targetPct / 100)) / per));
  let say;
  if (tier.key === 'bricked') say = { dead: true };
  else {
    const toBrick = Math.max(1, Math.ceil(cur / per));
    const idx = INTEG_TIERS.findIndex((t) => t.key === tier.key);
    const next = idx > 0 ? INTEG_TIERS[idx - 1] : null;
    say = { dead: false, toBrick, toBrickOne: toBrick === 1, next: next ? { css: next.css, name: next.name, n: stepsTo(next.hi), one: stepsTo(next.hi) === 1 } : null };
  }
  // History = the percent after each hit; the row is the change and any tier it crossed.
  const hist = Array.isArray(cfg.history) ? cfg.history : [];
  const rows = [];
  for (let i = hist.length - 1; i >= 1 && rows.length < 12; i--) {
    const d = hist[i] - hist[i - 1];
    if (!d) continue;
    const before = integTier(hist[i - 1]), after = integTier(hist[i]);
    rows.push({
      d: d > 0 ? `+${d}` : String(d),
      up: d > 0,
      kind: hist[i] <= 0 ? 'brick' : d > 0 ? 'fix' : 'hit',
      icon: hist[i] <= 0 ? 'fa-skull' : d > 0 ? 'fa-screwdriver-wrench' : 'fa-bolt',
      why: d > 0 ? 'Repaired' : hist[i] <= 0 ? 'Bricked' : 'Took a hit',
      cross: before.key !== after.key ? { css: after.css, name: after.name } : null,
      latest: i === hist.length - 1,
    });
  }
  return {
    on: true,
    cur, max, pct,
    tierCss: tier.css, tierName: tier.name,
    per,
    say,
    scale: INTEG_TIERS.map((t) => ({ css: t.css, name: t.name, range: `${t.lo}–${t.hi}%`, on: t.key === tier.key, setTo: t.hi })),
    dividers: [25, 50, 75],
    dead: tier.key === 'bricked',
    full: cur >= max,
    hist: rows,
    lastBy: cfg.lastHit?.by || '',
  };
}

/* ─── Default folds + the one-line summaries a closed band shows ──────────────
   The approved rule: the first bay open, the rest closed; a closed bay keeps its
   count + state lights; the bay holding the selection is forced open; a search
   opens everything; the GM's own fold choices last for the session. The detail
   bands (Breach path / Integrity / Entries) all start closed and say, in one line
   of plain words, what they would show. A summary is a list of parts
   `{text, tone}` — tone = a meaning colour (bad / attn / good / money / secret) or ''. */

/**
 * Is bay `index` (keyed `key`) folded? `opened` / `closed` are the GM's explicit
 * choices this session; `holdsSel` = the selected shard sits in it.
 */
export function bayShut({ index, key, opened, closed, holdsSel, searching }) {
  if (searching || holdsSel) return false;
  if (closed?.has(key)) return true;
  if (opened?.has(key)) return false;
  return index > 0;
}

/** Breach path: layers ({name, cleared, ice}) + failed attempts. */
export function pathSummary(layers = [], attempts = 0) {
  const parts = [];
  if (!layers.length) parts.push({ text: 'No locks — anyone can read it', tone: '' });
  else if (layers.every((l) => l.cleared)) parts.push({ text: layers.length === 1 ? 'Breached — its lock is open' : `Breached — all ${layers.length} locks open`, tone: 'good' });
  else {
    const open = layers.filter((l) => l.cleared).length;
    const next = layers.find((l) => !l.cleared);
    parts.push({ text: `${open} of ${layers.length} open`, tone: '' });
    parts.push({ text: `next: ${next.name}`, tone: next.ice ? 'bad' : 'secret' });
  }
  if (attempts > 0) parts.push({ text: `${attempts} failed attempt${attempts === 1 ? '' : 's'}`, tone: 'bad' });
  return parts;
}

/** Integrity: an integrityView() result (or null when integrity is off). */
export function integSummary(igv) {
  if (!igv) return [{ text: 'Off', tone: '' }];
  return [{ text: `${igv.pct}%`, tone: 'tier', tier: igv.tierCss }, { text: igv.tierName, tone: 'tier', tier: igv.tierCss }];
}

/** Entries: counts → "5 files · 1 damaged · 200 eb unclaimed" (zero parts dropped). */
export function entsSummary({ count = 0, damaged = 0, lost = 0, encrypted = 0, unclaimedEb = 0 } = {}) {
  if (!count) return [{ text: 'Empty', tone: '' }];
  const parts = [{ text: `${count} file${count === 1 ? '' : 's'}`, tone: '' }];
  if (lost) parts.push({ text: `${lost} lost`, tone: 'bad' });
  if (damaged) parts.push({ text: `${damaged} damaged`, tone: 'attn' });
  if (encrypted) parts.push({ text: `${encrypted} encrypted`, tone: 'secret' });
  if (unclaimedEb > 0) parts.push({ text: `${Number(unclaimedEb).toLocaleString()} eb unclaimed`, tone: 'money' });
  return parts;
}
