/**
 * The jack-in lock — the climax of jacking into a network node (step 3, 2026-10-29).
 * @file scripts/ui/NetworkNodes/JackInLock.js
 * @module night-city-messenger
 *
 * Dev-approved look: dev/mockups/network-nodes-jackin-mock.html ("love it", then the cyberpunk pass). A lock of
 * rings, one per layer the node REALLY has (box lock only when the box is locked · firmware · the network); each
 * layer clicks into the slot, the last ring is the roll — it stalls one short with a heartbeat, then lands. IN splits
 * the lock apart with a shockwave and blooms the network's REAL node count out behind it; MISS grinds red, cracks,
 * slams shut, static + the ICE skull. GM-decides = the last ring turns until setVerdict().
 *
 * Framework-free and deterministic: ONE paint(t) fed by rAF, a wall-clock cap so a stalled rAF (hidden tab) can never
 * leave it on screen, click to skip, reduced motion = the final frame. Mounted INSIDE the host window so it wears its
 * palette; the network colour rides --nc.
 */

const NS = 'http://www.w3.org/2000/svg';
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const eOut = (u) => 1 - Math.pow(1 - u, 3);
const eIn = (u) => u * u * u;
const eBack = (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const pt = (r, a) => [r * Math.sin(a * Math.PI / 180), -r * Math.cos(a * Math.PI / 180)];
const arcD = (r, a0, a1) => { const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GLYPHS = '0123456789ABCDEF#$%&@';
const scramble = (txt, u, seed) => [...String(txt)].map((ch, i) => (ch === ' ' || i / txt.length < u) ? ch : GLYPHS[(i * 7 + seed) % GLYPHS.length]).join('');

/** When the beats land (seconds). OPEN = the verdict. */
export const JACK_TIMING = Object.freeze({ OPEN: 4.1, END_IN: 6.4, END_MISS: 5.6, HOLD: 0.9 });

/** Ring geometry for N layers (2 or 3) — outermost first; the last ring is the roll. */
export function ringPlan(n) {
  const radii = n >= 3 ? [150, 118, 86] : [140, 96];
  const widths = n >= 3 ? [7, 6, 9] : [7, 9];
  const segs = n >= 3 ? [6, 5, 4] : [6, 4];
  const spins = n >= 3 ? [300, 260, 520] : [300, 520];
  const dirs = n >= 3 ? [1, -1, 1] : [1, 1];
  return radii.map((r, i) => {
    const last = i === radii.length - 1;
    const t0 = last ? 3.1 : 0.45 + i * 0.8;
    return { r, w: widths[i], seg: segs[i], spin: spins[i], dir: dirs[i], t0, T: last ? 4.1 : t0 + 0.9 };
  });
}

/** A loose tree of `count` nodes for the bloom (deterministic). */
export function bloomPlan(count = 8) {
  const n = Math.max(3, Math.min(17, count));
  const out = [{ a: 0, r: 0, p: -1, hub: true }];
  const inner = Math.min(4, n - 1);
  for (let i = 0; i < inner; i++) out.push({ a: (i * 360) / inner + 20, r: 72, p: 0 });
  for (let i = inner + 1; i < n; i++) {
    const parent = 1 + ((i - inner - 1) % inner);
    const spread = ((i - inner - 1) / Math.max(1, n - inner - 1)) * 360;
    out.push({ a: spread + 10, r: 140 + ((i * 13) % 32), p: parent });
  }
  return out;
}

/**
 * Play the jack-in over `host`.
 * @param {HTMLElement} host — the console window's content element
 * @param {object} o
 * @param {string} o.color — the network colour
 * @param {string} o.title — "Jacking in // Kabuki relay mast"
 * @param {string} o.dvLabel — "Interface · DV 15"
 * @param {{label:string, icon:string, text?:string}[]} o.layers — outside in (2 or 3)
 * @param {{label:string, value:number}[]} o.parts — the fixed parts of the roll (stat, rank, gear…)
 * @param {number} o.bloom — how many nodes the network has (the bloom)
 * @param {string} o.netName @param {string} o.hex
 * @param {'in'|'miss'|'wait'} o.kind
 * @param {{d10:number,total:number,dv:number,moves:number,sub?:string}} [o.result] — known now (auto), or via setVerdict
 * @returns {{ setVerdict:(kind:'in'|'miss', result:object)=>void, finished:Promise<void>, destroy:()=>void }}
 */
export function runJackIn(host, o = {}) {
  const reduced = !!o.reduced || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  let KIND = o.kind || 'in';
  let R = o.result || null;
  const layers = (o.layers || []).slice(0, 3);
  const plan = ringPlan(layers.length);
  const OPEN = JACK_TIMING.OPEN;

  const root = document.createElement('div');
  root.className = 'ncm-jk';
  root.style.setProperty('--nc', o.color || '#19f3f7');
  root.innerHTML = `
    <div class="ncm-jk__rain"></div><div class="ncm-jk__sweep"></div><div class="ncm-jk__vig"></div>
    <div class="ncm-jk__bar"><i class="fas fa-plug"></i><span>${esc(o.title || 'Jacking in')}</span><span class="ncm-jk__bar-r">${esc(o.dvLabel || '')}</span><span class="ncm-jk__haz"></span></div>
    <svg class="ncm-jk__svg" viewBox="-180 -180 360 360" aria-hidden="true"></svg>
    <div class="ncm-jk__lock"><i class="fas fa-lock"></i></div>
    <div class="ncm-jk__layers">${layers.map((l, i) => `<div class="ncm-jk__ly" data-ly="${i}"><i class="fas ${esc(l.icon)}"></i><b><span class="ix">L${i + 1}</span>${esc(l.label)}</b><small>—</small></div>`).join('')}</div>
    <div class="ncm-jk__hud ncm-jk__hud--l"></div><div class="ncm-jk__hud ncm-jk__hud--r"></div>
    <div class="ncm-jk__roll">
      <div class="ncm-jk__cols">${(o.parts || []).map((p, i) => `${i ? '<span class="op">+</span>' : ''}<span class="cw lock"><span class="c">${esc(p.value)}</span>${esc(p.label)}</span>`).join('')}${(o.parts || []).length ? '<span class="op">+</span>' : ''}<span class="cw is-d10"><span class="c" data-d10>?</span>d10</span><span class="tot">TOTAL<b data-tot>—</b></span></div>
      <div class="ncm-jk__meter"><i data-met></i><em data-dvline></em></div>
    </div>
    <div class="ncm-jk__res"><div class="nm" data-nm></div><div class="sub" data-sub></div><div class="pips" data-pips></div></div>
    <div class="ncm-jk__wait"><b>AWAITING GM</b><small>The GM is running the netrun at the table</small></div>
    <div class="ncm-jk__slices"></div><div class="ncm-jk__skull"><i class="fas fa-skull"></i></div>
    <div class="ncm-jk__static"></div><div class="ncm-jk__flash"></div>
    <div class="ncm-jk__skip">CLICK TO SKIP</div>`;
  host.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const SVG = $('.ncm-jk__svg');
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.appendChild(e); return e; };

  // background rain
  const RAIN = $('.ncm-jk__rain');
  const rain = Array.from({ length: 28 }, (_, i) => {
    const d = document.createElement('div');
    d.style.left = `${(i * 23 + 4)}px`;
    d.textContent = Array.from({ length: 40 }, (_, k) => '0123456789ABCDEF'[(i * 13 + k * 7 + (i * k) % 5) % 16]).join('\n');
    RAIN.appendChild(d);
    return { d, speed: 30 + (i * 37) % 50, phase: (i * 71) % 480 };
  });

  // chromatic split
  const DEFS = el('defs', {}, SVG);
  const uid = `jk${Math.random().toString(36).slice(2, 8)}`;
  const FIL = el('filter', { id: `${uid}c`, x: '-20%', y: '-20%', width: '140%', height: '140%' }, DEFS);
  el('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'r' }, FIL);
  const OFR = el('feOffset', { in: 'r', dx: 0, dy: 0, result: 'ro' }, FIL);
  el('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: '0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0', result: 'gb' }, FIL);
  const OFB = el('feOffset', { in: 'gb', dx: 0, dy: 0, result: 'gbo' }, FIL);
  el('feBlend', { in: 'ro', in2: 'gbo', mode: 'screen' }, FIL);

  // the bloom (underneath) — the network's real node count
  const BLOOM = el('g', {}, SVG);
  const nodes = bloomPlan(o.bloom || 8);
  nodes.forEach((n) => { n.xy = pt(n.r, n.a); n.depth = n.p < 0 ? 0 : nodes[n.p].depth + 1; });
  nodes.forEach((n) => {
    if (n.p < 0) return;
    const [x0, y0] = nodes[n.p].xy, [x1, y1] = n.xy;
    n.len = Math.hypot(x1 - x0, y1 - y0);
    n.line = el('line', { class: 'edge', x1: x0, y1: y0, x2: x1, y2: y1, 'stroke-dasharray': n.len, 'stroke-dashoffset': n.len }, BLOOM);
  });
  nodes.forEach((n) => { n.dot = el('circle', { class: `bn${n.hub ? ' hub' : ''}`, cx: n.xy[0], cy: n.xy[1], r: 0 }, BLOOM); });
  const SHOCK = el('circle', { class: 'shock', r: 0, 'stroke-width': 0, opacity: 0 }, SVG);
  const GUIDE = el('line', { class: 'guide', x1: 0, y1: -170, x2: 0, y2: -44 }, SVG);

  // the rings
  const LOCKG = el('g', { filter: `url(#${uid}c)` }, SVG);
  plan.forEach((P, ri) => {
    P.g = el('g', { class: 'ring' }, LOCKG);
    P.rot = el('g', {}, P.g);
    el('circle', { class: 'tick', r: P.r - P.w - 3, 'stroke-dasharray': '1 7' }, P.rot);
    const step = 360 / P.seg, gap = 7;
    P.arcs = [];
    for (let i = 0; i < P.seg; i++) {
      const a0 = i * step + gap / 2 + (i === 0 ? 5 : 0), a1 = (i + 1) * step - gap / 2 - (i === P.seg - 1 ? 5 : 0);
      const g = el('g', {}, P.rot);
      el('path', { class: 'arc', d: arcD(P.r, a0, a1), 'stroke-width': P.w }, g);
      P.arcs.push({ g, mid: (a0 + a1) / 2 });
    }
    const tr = P.r - P.w / 2 - 10;
    el('path', { id: `${uid}t${ri}`, d: `M0 ${-tr} A${tr} ${tr} 0 1 1 -0.01 ${-tr}`, fill: 'none' }, DEFS);
    const base = `${layers[ri]?.text || layers[ri]?.label || ''} // `.toUpperCase();
    P.txt = el('text', { class: 'txt' }, P.rot);
    const tp = el('textPath', { href: `#${uid}t${ri}` }, P.txt);
    const circ = 2 * Math.PI * tr;
    tp.textContent = base.repeat(Math.ceil(circ / Math.max(1, base.length * 6.6)) + 1).slice(0, Math.floor(circ / 6.6));
    P.notch = el('polygon', { class: 'notch', points: `-5,${-P.r - P.w / 2 - 7} 5,${-P.r - P.w / 2 - 7} 0,${-P.r + P.w / 2 + 1}` }, P.rot);
  });
  const HLT = [-22, -16, 16, 22].map((x) => el('rect', { class: 'hlt', x: x - 1.5, y: -178, width: 3, height: 6 }, SVG));
  const SLOT = el('path', { class: 'slot', d: 'M-12 -176 L-6 -168 L6 -168 L12 -176' }, SVG);
  const CORE = el('polygon', { class: 'core', points: [0, 60, 120, 180, 240, 300].map((a) => pt(40, a).map((v) => v.toFixed(1)).join(',')).join(' ') }, SVG);
  const CRACK = el('path', { class: 'crack', d: 'M-150 -40 L-60 -10 L-20 -34 L30 12 L80 -6 L150 30', 'stroke-dasharray': 360, 'stroke-dashoffset': 360, opacity: 0 }, SVG);

  const ringAngle = (P, i, t) => {
    const final = i === plan.length - 1;
    const target = final && KIND === 'miss' ? -34 : 0;
    if (final && KIND === 'wait') {
      const v = P.spin * Math.max(0.12, 1 - prog(t, 2.6, 3.6) * 0.88);
      return (P.spin * Math.min(t, 2.6) + P.spin * 0.56 * Math.max(0, Math.min(t, 3.6) - 2.6) + v * Math.max(0, t - 3.6)) * P.dir;
    }
    const Rem = P.spin * (P.T - P.t0) / 3;
    let a;
    if (t < P.t0) a = target - P.dir * (Rem + P.spin * (P.t0 - t));
    else if (t < P.T) { const u = prog(t, P.t0, P.T); a = target - P.dir * Rem * (1 - (final ? eBack(u) : eOut(u))); }
    else a = target;
    if (final && KIND === 'miss' && t > P.T && t < P.T + 0.5) a += Math.sin(t * 90) * 4 * (1 - prog(t, P.T, P.T + 0.5));
    return a;
  };
  const glitchAmt = (t) => {
    const marks = plan.map((P, i) => (i === plan.length - 1 && KIND === 'wait') ? null : P.T).filter((x) => x != null)
      .concat(KIND === 'wait' ? [] : [OPEN + (KIND === 'miss' ? 0.45 : 0)]);
    let g = 0; marks.forEach((m) => { const d = t - m; if (d >= 0 && d < 0.14) g = Math.max(g, 1 - d / 0.14); });
    return g;
  };
  const hex = (n, w = 4) => (n >>> 0).toString(16).toUpperCase().padStart(w, '0').slice(-w);
  const partsSum = (o.parts || []).reduce((s, p) => s + (Number(p.value) || 0), 0);
  const dv = Number(o.dv ?? R?.dv) || 15;
  $('[data-dvline]').style.left = `${(Math.min(dv, 25) / 25) * 100}%`;
  $('[data-dvline]').dataset.dv = `DV ${dv}`;

  function paint(t) {
    const isIn = KIND === 'in', isMiss = KIND === 'miss', isWait = KIND === 'wait';
    root.classList.toggle('is-miss', isMiss);
    const fade = eOut(prog(t, 0, 0.45));
    SVG.style.opacity = fade;
    rain.forEach((c) => { c.d.style.transform = `translateY(${(((t * c.speed + c.phase) % 480) - 480).toFixed(1)}px)`; });
    const SW = $('.ncm-jk__sweep');
    SW.style.transform = `rotate(${(t * 140) % 360}deg)`;
    SW.style.opacity = isIn && t > OPEN ? 1 - prog(t, OPEN, OPEN + 0.4) : (isMiss && t > OPEN ? 0 : fade * 0.9);
    const f = Math.floor(t * 20);
    $('.ncm-jk__hud--l').innerHTML = `SYN ▸ <em>${esc(o.hex || '')}</em>\nLAT ${String(9 + (f * 7) % 9).padStart(3, '0')}ms\nPKT <b>${hex(f * 2654435761, 6)}</b>\nKEY ${hex(f * 40503 + 77)}-${hex(f * 9176 + 3)}`;
    const hs = plan.filter((P, i) => t >= P.T && !(i === plan.length - 1 && (isWait || isMiss))).length;
    $('.ncm-jk__hud--r').innerHTML = `HANDSHAKE <b>${hs}/${plan.length}</b>\nTRACE ${isMiss && t > OPEN ? '<b class="bad">LOCKED</b>' : (Math.min(t, OPEN) * 0.11).toFixed(2)}\nICE <em>${isMiss && t > OPEN ? 'ARMED' : 'DORMANT'}</em>`;
    const g = glitchAmt(t);
    const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2.4)), 6);
    const stall = prog(t, 3.0, 3.3) * (isWait ? 1 : 1 - prog(t, 4.0, 4.1));
    const dx = 0.7 + g * 6 + stall * beat * 3 + (isMiss && t > OPEN + 0.45 ? 2.5 + Math.sin(t * 50) * 1.5 : 0);
    OFR.setAttribute('dx', dx.toFixed(2)); OFB.setAttribute('dx', (-dx).toFixed(2));
    SVG.style.transform = g > 0 ? `translateX(${((f % 2 ? 1 : -1) * g * 5).toFixed(1)}px)` : '';
    const SL = $('.ncm-jk__slices');
    if (g > 0.05) {
      const seed = Math.floor(t * 50);
      SL.innerHTML = [0, 1, 2, 3].map((k) => `<i style="top:${(seed * 37 + k * 113) % 400}px;height:${3 + ((seed + k * 7) % 14)}px;background:${isMiss && t > OPEN ? 'var(--jk-bad)' : (k % 2 ? 'var(--jk-hl)' : 'var(--nc)')};opacity:${(g * 0.45).toFixed(2)};transform:translateX(${((k % 2 ? 1 : -1) * 20 * g).toFixed(0)}px)"></i>`).join('');
    } else if (SL.innerHTML) SL.innerHTML = '';
    // rings
    plan.forEach((P, i) => {
      const last = i === plan.length - 1;
      const ang = ringAngle(P, i, t);
      const settled = t >= P.T && !(last && isWait);
      const snap = settled ? Math.max(0, 1 - (t - P.T) / 0.25) : 0;
      let scale = 1 + snap * 0.04;
      const bad = isMiss && t >= OPEN + (plan.length - 1 - i) * 0.1;
      P.g.classList.toggle('ok', settled && !(last && isMiss) && !bad);
      P.g.classList.toggle('bad', bad);
      if (isMiss) scale *= 1 - 0.12 * eIn(prog(t, OPEN + 0.4, OPEN + 0.55)) + 0.03 * Math.sin(prog(t, OPEN + 0.55, OPEN + 0.9) * Math.PI);
      P.rot.setAttribute('transform', `rotate(${ang.toFixed(2)})`);
      P.g.setAttribute('transform', `scale(${scale.toFixed(4)})`);
      const op = isIn ? prog(t, OPEN + 0.05, OPEN + 0.75) : 0;
      P.arcs.forEach((A) => {
        const k = eIn(op) * (130 + i * 30), [dx2, dy2] = pt(k, A.mid);
        A.g.setAttribute('transform', `translate(${dx2.toFixed(1)} ${dy2.toFixed(1)})`);
        A.g.style.opacity = 1 - op;
      });
      P.notch.style.opacity = 1 - op; P.txt.style.opacity = 1 - op;
      P.g.style.filter = (isIn && t >= OPEN && t < OPEN + 0.25) ? 'brightness(2.4)'
        : (last && stall > 0 && !isMiss ? `drop-shadow(0 0 ${(4 + 8 * beat).toFixed(1)}px var(--nc))` : '');
    });
    GUIDE.style.stroke = hs ? `color-mix(in srgb, var(--nc) ${30 + hs * 22}%, #fff)` : '';
    const gone = isIn ? 1 - prog(t, OPEN, OPEN + 0.4) : 1;
    GUIDE.style.opacity = gone; SLOT.style.opacity = gone; HLT.forEach((h) => { h.style.opacity = gone; });
    CORE.style.opacity = isIn ? 1 - prog(t, OPEN, OPEN + 0.35) : 1;
    CORE.style.stroke = isMiss && t > OPEN ? 'var(--jk-bad)' : '';
    // layers
    root.querySelectorAll('.ncm-jk__ly').forEach((ly, i) => {
      const P = plan[i], last = i === plan.length - 1, s = ly.querySelector('small');
      const st = t >= P.T ? (last ? (isIn ? 'ok' : isMiss ? 'bad' : 'live') : 'ok') : t >= P.t0 - 0.3 ? 'live' : '';
      ly.className = `ncm-jk__ly ${st}`;
      s.textContent = st === 'ok' ? 'OPEN' : st === 'bad' ? 'DENIED' : st === 'live' ? (last && isWait && t >= P.T ? 'AWAITING GM' : 'WORKING…') : '—';
    });
    // the roll
    const d10Locked = !isWait && t >= 4.0 && R;
    $('[data-d10]').textContent = d10Locked ? R.d10 : (t > 2.0 ? GLYPHS[Math.floor(t * 23) % 10] : '?');
    $('.ncm-jk__cols .is-d10').classList.toggle('lock', !!d10Locked);
    let tot = partsSum;
    if (d10Locked) tot = Math.round(partsSum + (R.total - partsSum) * eOut(prog(t, 4.0, 4.18)));
    $('[data-tot]').textContent = t >= 2.3 ? tot : '—';
    $('[data-met]').style.width = `${(Math.min(t >= 2.3 ? tot : 0, 25) / 25) * 100}%`;
    $('.ncm-jk__vig').style.opacity = (stall * (0.55 + 0.35 * beat)).toFixed(3);
    // the lock glyph
    const LOCK = $('.ncm-jk__lock'), li = LOCK.querySelector('i');
    if (isIn && t >= OPEN) { li.className = 'fas fa-lock-open'; LOCK.style.transform = `scale(${1 + prog(t, OPEN, OPEN + 0.5) * 0.9})`; LOCK.style.opacity = 1 - prog(t, OPEN + 0.15, OPEN + 0.6); LOCK.style.color = '#fff'; }
    else { li.className = 'fas fa-lock'; LOCK.style.transform = isMiss && t > OPEN + 0.4 && t < OPEN + 0.9 ? `translateX(${(Math.sin(t * 80) * 4).toFixed(1)}px)` : ''; LOCK.style.opacity = isMiss ? 1 - prog(t, OPEN + 0.5, OPEN + 0.6) : fade; LOCK.style.color = isMiss && t > OPEN ? 'var(--jk-bad)' : ''; }
    // IN: flash, shock, bloom, result
    $('.ncm-jk__flash').style.opacity = isIn ? (0.75 * (prog(t, OPEN, OPEN + 0.06) - prog(t, OPEN + 0.06, OPEN + 0.5))).toFixed(3) : 0;
    const sw = isIn ? prog(t, OPEN, OPEN + 0.8) : 0;
    SHOCK.setAttribute('r', (40 + eOut(sw) * 300).toFixed(1));
    SHOCK.setAttribute('stroke-width', (6 * (1 - sw)).toFixed(2));
    SHOCK.setAttribute('opacity', sw > 0 && sw < 1 ? (1 - sw).toFixed(3) : 0);
    nodes.forEach((n) => {
      const t0 = OPEN + 0.25 + n.depth * 0.2;
      const u = isIn ? prog(t, t0, t0 + 0.3) : 0;
      if (n.line) n.line.setAttribute('stroke-dashoffset', (n.len * (1 - eOut(u))).toFixed(1));
      const p = isIn ? prog(t, t0 + 0.2, t0 + 0.4) : 0;
      n.dot.setAttribute('r', ((n.hub ? 9 : 5) * eBack(p) * (p > 0 ? 1 : 0)).toFixed(2));
    });
    $('.ncm-jk__roll').style.opacity = isWait ? 1 : 1 - prog(t, OPEN + 0.2, OPEN + 0.5);
    const RES = $('.ncm-jk__res');
    RES.style.opacity = isWait ? 0 : prog(t, OPEN + 0.45, OPEN + 0.7);
    RES.style.transform = `translateY(${(10 * (1 - eOut(prog(t, OPEN + 0.45, OPEN + 0.8)))).toFixed(1)}px)`;
    if (isIn && R) {
      $('[data-nm]').textContent = scramble(String(o.netName || 'ACCESS').toUpperCase(), prog(t, OPEN + 0.5, OPEN + 1.3), Math.floor(t * 30));
      $('[data-sub]').textContent = R.sub || `ACCESS GRANTED · ${R.total} VS DV ${dv} · NODE ${o.hex || ''}`;
      const P = $('[data-pips]');
      if (P.dataset.n !== String(R.moves)) { P.dataset.n = String(R.moves); P.innerHTML = `<span>MOVES</span>${'<span class="pip"></span>'.repeat(R.moves || 0)}`; }
      P.querySelectorAll('.pip').forEach((pp, i) => { const s0 = 5.4 + i * 0.22, u = prog(t, s0, s0 + 0.18); pp.style.opacity = u; pp.style.transform = `rotate(45deg) translateY(${(-14 * (1 - eOut(u))).toFixed(1)}px)`; });
    } else if (isMiss && R) {
      $('[data-nm]').textContent = scramble('REJECTED', prog(t, OPEN + 0.6, OPEN + 1.1), Math.floor(t * 30));
      $('[data-sub]').textContent = R.sub || `${R.total} VS DV ${dv}`;
      $('[data-pips]').innerHTML = '';
    }
    CRACK.setAttribute('opacity', isMiss && t > OPEN + 0.25 ? 1 - prog(t, OPEN + 1.0, OPEN + 1.4) * 0.6 : 0);
    CRACK.setAttribute('stroke-dashoffset', (360 * (1 - eOut(isMiss ? prog(t, OPEN + 0.25, OPEN + 0.45) : 0))).toFixed(1));
    $('.ncm-jk__static').style.opacity = isMiss ? (prog(t, OPEN + 0.45, OPEN + 0.5) * (1 - 0.6 * prog(t, OPEN + 0.9, OPEN + 1.4)) * (0.7 + 0.3 * Math.sin(t * 60))).toFixed(3) : 0;
    const sk = isMiss ? prog(t, OPEN + 0.5, OPEN + 0.72) : 0;
    const SK = $('.ncm-jk__skull');
    SK.style.opacity = sk; SK.style.transform = `scale(${(3 - 2 * eOut(sk)).toFixed(3)})`;
    root.style.transform = isMiss && t > OPEN + 0.5 && t < OPEN + 0.9 ? `translate(${(Math.sin(t * 70) * 5).toFixed(1)}px, ${(Math.cos(t * 53) * 3).toFixed(1)}px)` : '';
    $('.ncm-jk__wait').style.opacity = isWait ? prog(t, 3.6, 3.9) * (0.75 + 0.25 * Math.sin(t * 4)) : 0;
  }

  const endOf = () => (KIND === 'in' ? JACK_TIMING.END_IN : KIND === 'miss' ? JACK_TIMING.END_MISS : Infinity);
  let start = performance.now(), raf = 0, done = false, cap = 0;
  let resolveFinished;
  const finished = new Promise((res) => { resolveFinished = res; });
  const finish = () => {
    if (done) return;
    done = true; cancelAnimationFrame(raf); clearTimeout(cap);
    paint(endOf() === Infinity ? 5 : endOf());
    setTimeout(() => { root.classList.add('is-out'); setTimeout(() => { root.remove(); resolveFinished(); }, 320); }, JACK_TIMING.HOLD * 1000);
  };
  const loop = (now) => {
    const t = (now - start) / 1000;
    paint(t);
    if (t >= endOf()) return finish();
    raf = requestAnimationFrame(loop);
  };
  const armCap = () => { clearTimeout(cap); if (endOf() !== Infinity) cap = setTimeout(finish, (endOf() + 1.5) * 1000); };
  root.addEventListener('click', () => { if (KIND !== 'wait') finish(); });

  if (Number.isFinite(o.freezeAt)) paint(o.freezeAt);            // review probes: one frame, no motion
  else if (reduced && KIND !== 'wait') finish();
  else { raf = requestAnimationFrame(loop); armCap(); }

  return {
    finished,
    /** GM decided (or the auto roll arrived late): continue from the last ring's spin into the verdict. */
    setVerdict(kind, result) {
      if (done) return;
      R = result || R;
      KIND = kind === 'in' ? 'in' : 'miss';
      if (reduced) return finish();
      const t = (performance.now() - start) / 1000;
      if (t > 3.15) start = performance.now() - 3.15 * 1000;   // pick the final ring up just before it settles
      armCap();
    },
    destroy() { done = true; cancelAnimationFrame(raf); clearTimeout(cap); root.remove(); resolveFinished(); },
  };
}
