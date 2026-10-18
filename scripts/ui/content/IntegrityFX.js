/**
 * IntegrityFX — the DOM side of shard integrity (the rules are IntegrityModel).
 * @file scripts/ui/content/IntegrityFX.js
 * @module night-city-messenger
 *
 * Everything here PAINTS. The cosmetic garble never changes a character: the real
 * one stays in the DOM (transparent fill) and a glyph is drawn over it with a
 * ::before, so copy/paste and screen readers get the truth. Data that is really
 * gone (mechanical mode) was removed before render by IntegrityModel.applyLoss.
 */

import { rng, garbleRate, GLYPHS, LOST } from './IntegrityModel.js';

/** Painted glyphs per entry, at most — a 500-row spreadsheet must stay fast. */
const GARBLE_CAP = 1200;

/** Should motion play? Vetoed by the OS setting or the module's animation pref; never raised. */
export function motionAllowed(el) {
  try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch { /* no matchMedia */ }
  const host = el?.closest?.('[data-ncm-animation-level]');
  return host?.dataset?.ncmAnimationLevel !== 'off';
}

/**
 * Paint the cosmetic layer onto a rendered shard viewer.
 * @param {HTMLElement} root   the `.ncm-item-inbox` element
 * @param {object} o
 * @param {string} o.tier       clean | light | heavy | severe
 * @param {string} o.legibility readable | rough | hard
 * @param {boolean} o.garble    paint garbled text
 * @param {boolean} o.drops     static blocks (the tearing toggle)
 * @param {Set<string>} [o.skip] entry ids not to paint (a GM's "show original")
 */
export function paintIntegrity(root, o = {}) {
  if (!root) return;
  // Mark text that carries mechanically-lost data so it reads as damage.
  root.querySelectorAll('.ncm-entry-card').forEach((card) => markLost(card));

  if (!['light', 'heavy', 'severe'].includes(o.tier)) return;
  const rate = garbleRate(o.legibility, o.tier);
  root.querySelectorAll('.ncm-entry-card').forEach((card) => {
    const id = card.dataset.entryId || '';
    if (o.skip?.has(id)) return;
    if (o.drops && o.tier !== 'light') addDrops(card, id, o.tier === 'severe' ? 4 : 2);
    if (o.garble) garbleCard(card, id, rate);
  });

  // The index strip glitches too, at half the body's rate so it stays usable for
  // getting around — and only from Unstable down (a Degraded strip stays clean).
  if (o.garble && o.tier !== 'light') {
    root.querySelectorAll('.ncm-shard-index-chip[data-entry-id]').forEach((chip) => {
      const id = chip.dataset.entryId || '';
      if (o.skip?.has(id)) return;
      const title = chip.querySelector('.ncm-shard-index-chip-title');
      if (title && !chip.classList.contains('ncm-ig-chip--lost')) garbleText(title, `${id}:chip`, rate / 2, 'script, style, .ncm-ig-lost');
    });
  }
}

function markLost(card) {
  const tw = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (tw.nextNode()) {
    const v = tw.currentNode.nodeValue;
    if (v.includes(LOST) || v.includes('#ERR!')) hits.push(tw.currentNode);
  }
  hits.forEach((n) => n.parentElement?.classList.add('ncm-ig-lost'));
}

function addDrops(card, id, n) {
  const r = rng(`${id}:drop`);
  for (let k = 0; k < n; k++) {
    const d = document.createElement('i');
    d.className = 'ncm-ig-drop';
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = `left:${(r() * 70).toFixed(1)}%;top:${(15 + r() * 75).toFixed(1)}%;width:${(12 + r() * 30).toFixed(1)}%;height:${(4 + r() * 10).toFixed(0)}px;--dd:${(r() * 3).toFixed(2)}s`;
    card.appendChild(d);
  }
}

function garbleCard(card, id, rate) {
  const body = card.querySelector('.ncm-ig-body');
  if (body) garbleText(body, `${id}:g`, rate);
}

/** Text inside these is never painted over — controls must stay legible, lost data is already marked. */
const SKIP_DEFAULT = 'button, [data-action], input, textarea, select, script, style, .ncm-ig-lost, [contenteditable]';

/** Paint a seeded share of the text inside `el`. */
function garbleText(el, seed, rate, skip = SKIP_DEFAULT) {
  if (!(rate > 0) || !el) return;
  const body = el;
  const r = rng(seed);
  const tw = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (
      !n.nodeValue.trim() ||
      n.parentElement?.closest(skip)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (tw.nextNode()) nodes.push(tw.currentNode);
  let painted = 0;
  for (const node of nodes) {
    if (painted >= GARBLE_CAP) break;
    const frag = document.createDocumentFragment();
    let run = '';
    let changed = false;
    for (const ch of node.nodeValue) {
      if (painted < GARBLE_CAP && ch.trim() && r() < rate) {
        if (run) { frag.appendChild(document.createTextNode(run)); run = ''; }
        const s = document.createElement('span');
        s.className = 'ncm-ig-ch';
        s.dataset.g = GLYPHS[Math.floor(r() * GLYPHS.length)];
        s.textContent = ch;
        frag.appendChild(s);
        painted++; changed = true;
      } else run += ch;
    }
    if (!changed) continue;
    if (run) frag.appendChild(document.createTextNode(run));
    node.replaceWith(frag);
  }
}

/**
 * A slow shimmer — a few painted glyphs change while you watch. Returns a stop
 * function. Nothing runs when motion is vetoed.
 */
export function startShimmer(root) {
  if (!root || !motionAllowed(root)) return () => {};
  const t = setInterval(() => {
    if (!root.isConnected) return;
    const all = root.querySelectorAll('.ncm-ig-ch');
    if (!all.length) return;
    for (let k = 0; k < Math.min(12, all.length); k++) {
      const s = all[Math.floor(Math.random() * all.length)];
      s.dataset.g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }
  }, 220);
  return () => clearInterval(t);
}

/** The jolt when integrity drops. */
export function playHit(root) {
  if (!root || !motionAllowed(root)) return;
  const row = root.querySelector('.ncm-shard-integrity-row');
  for (const el of [root, row]) {
    if (!el) continue;
    el.classList.remove('ncm-ig-hit');
    void el.offsetWidth;
    el.classList.add('ncm-ig-hit');
  }
}

/**
 * The death sequence: every entry burns out in turn. Resolves when it is done
 * (immediately when motion is vetoed).
 */
export function playBurnOut(root) {
  const cards = root ? [...root.querySelectorAll('.ncm-entry-card')] : [];
  if (!cards.length || !motionAllowed(root)) return Promise.resolve();
  playHit(root);
  cards.forEach((c, i) => { c.style.setProperty('--i', i); c.classList.add('ncm-ig-dying'); });
  return new Promise((r) => setTimeout(r, 500 + Math.min(cards.length, 12) * 90));
}
