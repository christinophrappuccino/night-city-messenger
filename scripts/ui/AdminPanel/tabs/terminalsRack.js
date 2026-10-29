/**
 * terminalsRack — pure rules for the Terminals rack's group folds (no Foundry globals).
 * @file scripts/ui/AdminPanel/tabs/terminalsRack.js
 * @module night-city-messenger
 *
 * The default-fold rule (dev-approved 2026-10-28):
 *   first group open, the rest closed; a closed group always shows its count plus
 *   anything that needs you; the group holding the selection is forced open; a
 *   search (or a non-default filter chip) opens everything; the GM's own choices
 *   last for the session.
 */

/** Session memory of the GM's fold choices: `${windowKey}|${grouping}` → Map(groupKey → open). */
const SESSION = new Map();

/** The GM's fold choices for one window + grouping (created on first use, kept for the page load). */
export function rackFoldMemory(windowKey, grouping) {
  const k = `${windowKey || 'panel'}|${grouping || 'location'}`;
  if (!SESSION.has(k)) SESSION.set(k, new Map());
  return SESSION.get(k);
}

/** Test hook: forget every remembered choice. */
export function resetRackFoldMemory() { SESSION.clear(); }

/**
 * Is each group open, and why?
 * @param {string[]} keys        group keys in display order
 * @param {object}   o
 * @param {Map}      o.choices   groupKey → true (GM opened) / false (GM closed)
 * @param {string}   [o.selectedKey] the group holding the selected terminal
 * @param {boolean}  [o.openAll] a search or a non-default filter is on
 * @returns {Map<string, {open:boolean, forced:''|'selection'|'search'}>}
 */
export function rackFoldState(keys, { choices = new Map(), selectedKey = null, openAll = false } = {}) {
  const out = new Map();
  keys.forEach((k, i) => {
    if (openAll) return out.set(k, { open: true, forced: 'search' });
    if (k === selectedKey) return out.set(k, { open: true, forced: 'selection' });
    if (choices.has(k)) return out.set(k, { open: !!choices.get(k), forced: '' });
    out.set(k, { open: i === 0, forced: '' });
  });
  return out;
}

/**
 * What a CLOSED group head shows: one count chip per light kind that is on, plus heat and trace.
 * Fixed width whatever the group size (a per-unit strip grows with the group and
 * cannot carry heat or a trace). Order = most urgent first.
 * @param {object[]} units  rack units ({ leds:[in,out,armed,locked], maxHeat, traceTag, gmBypassed })
 */
export function rackHeadSummary(units) {
  const n = (f) => units.filter(f).length;
  const out = n((u) => u.leds?.[1]?.cls);
  const trace = n((u) => u.traceTag);
  const armed = n((u) => u.leds?.[2]?.cls);
  const hot = n((u) => (u.maxHeat || 0) >= 25);
  const unl = n((u) => u.gmBypassed);
  const inn = n((u) => u.leds?.[0]?.cls);
  const sealed = n((u) => u.leds?.[3]?.cls);
  const chips = [];
  if (out) chips.push({ kind: 'bad', led: true, count: out, tip: `${out} with someone locked out` });
  if (trace) chips.push({ kind: 'trace', led: false, icon: 'fa-stopwatch', count: trace, tip: `${trace} with a trace closing in` });
  if (armed) chips.push({ kind: 'attn', led: true, count: armed, tip: `${armed} with an armed plant` });
  if (hot) chips.push({ kind: 'hot', led: false, icon: 'fa-fire', count: hot, tip: `${hot} running hot (heat 25+)` });
  if (unl) chips.push({ kind: 'unl', led: false, icon: 'fa-unlock', count: unl, tip: `${unl} GM-unlocked (every login skipped)` });
  if (inn) chips.push({ kind: 'good', led: true, count: inn, tip: `${inn} with someone logged in` });
  if (sealed) chips.push({ kind: 'secret', led: true, count: sealed, tip: `${sealed} with every account locked` });
  const needs = !!(out || trace || armed || hot || unl);
  return { chips, needs, tone: (out || trace) ? 'bad' : (needs ? 'attn' : '') };
}
