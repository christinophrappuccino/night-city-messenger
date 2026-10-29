/**
 * Bypass skills with their own DV — the shared SECURITY_BLOCK's skill check.
 *
 * The block used to carry `bypassSkills: [names]` + ONE `bypassDC` for all of
 * them, so a network that took Interface OR Electronics/Security Tech had to
 * give both the same DV (tester, 2026-10-27 — Interface and a Stat + Skill
 * check are not the same difficulty). Now an optional `bypassSkillDCs`
 * `{ skillName: dv }` map sits beside it. No migration: a skill missing from
 * the map — every block written before this — falls back to `bypassDC`.
 *
 * Shards are NOT on this path: their item config has had `skillDCs` for years.
 *
 * Pure apart from the DOM helpers at the bottom (which only touch the element
 * they are handed).
 */

import { SKILL_MAP, canonicalizeSkillName } from './constants.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_/\\&.-]+/g, '');

/**
 * The DV a bypass with this skill must meet. Names compare space- and
 * punctuation-insensitive, so "Electronics/SecurityTech" finds the
 * "Electronics/Security Tech" row.
 * @param {object} sec a SECURITY_BLOCK
 * @param {string} skill
 * @returns {number}
 */
export function bypassDCFor(sec, skill) {
  const base = Number(sec?.bypassDC ?? 15) || 15;
  const map = sec?.bypassSkillDCs;
  if (!map || typeof map !== 'object' || !skill) return base;
  const want = norm(skill);
  for (const [name, dv] of Object.entries(map)) {
    if (norm(name) !== want) continue;
    const n = Number(dv);
    if (dv !== '' && dv !== null && Number.isFinite(n)) return n;
  }
  return base;
}

/** One row per configured skill: `{ name, dv }`. */
export function bypassRowsOf(sec) {
  return (Array.isArray(sec?.bypassSkills) ? sec.bypassSkills : [])
    .filter(Boolean)
    .map((name) => ({ name, dv: bypassDCFor(sec, name) }));
}

/** "Interface DV 13 · Electronics/Security Tech DV 15" — for summary chips. */
export function bypassSummary(sec) {
  return bypassRowsOf(sec).map((r) => `${r.name} DV ${r.dv}`).join(' · ');
}

/**
 * Turn edited rows back into the block's three fields. `bypassDC` stays the
 * FIRST row's DV, so any reader that still looks only at the single number
 * sees a sensible value.
 * @param {{name: string, dv: number}[]} rows
 * @param {number} [fallbackDV]
 */
export function bypassFieldsFrom(rows, fallbackDV = 15) {
  const seen = new Set();
  const clean = [];
  for (const r of rows || []) {
    const name = canonicalizeSkillName(String(r?.name || '').trim());
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    const dv = Number(r?.dv);
    clean.push({ name, dv: Number.isFinite(dv) && r?.dv !== '' ? Math.max(0, Math.round(dv)) : fallbackDV });
  }
  const bypassSkillDCs = {};
  for (const r of clean) bypassSkillDCs[r.name] = r.dv;
  return {
    bypassSkills: clean.map((r) => r.name),
    bypassDC: clean[0]?.dv ?? fallbackDV,
    bypassSkillDCs,
  };
}

// ─── The row editor (Network Manager + terminal account editor) ───

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function rowHtml({ name, dv }, cls) {
  const skills = Object.keys(SKILL_MAP);
  if (name && !skills.some((s) => norm(s) === norm(name))) skills.unshift(name);
  const opts = skills.map((s) => `<option value="${esc(s)}" ${norm(s) === norm(name) ? 'selected' : ''}>${esc(s)}</option>`).join('');
  return `<div class="ncm-bypass__row" data-bypass-row>
    <select class="ncm-bypass__skill ${cls.select || ''}" aria-label="Bypass skill">${opts}</select>
    <span class="ncm-bypass__dvl">DV</span>
    <input type="number" class="ncm-bypass__dv ${cls.input || ''}" value="${Number(dv) || 0}" min="0" max="40" aria-label="DV for this skill">
    <button type="button" class="ncm-bypass__rm" data-bypass-remove aria-label="Remove this skill" data-tooltip="Remove"><i class="fas fa-xmark"></i></button>
  </div>`;
}

/**
 * The editor's markup. Inputs are UNNAMED on purpose — the owning form reads
 * them back through `readBypassRows`, never through FormData.
 * @param {object} sec a SECURITY_BLOCK (or null for a new one)
 * @param {{select?: string, input?: string, defaultSkill?: string, defaultDV?: number}} [opts]
 */
export function bypassRowsHtml(sec, opts = {}) {
  let rows = bypassRowsOf(sec);
  if (!rows.length) rows = [{ name: opts.defaultSkill || 'Interface', dv: Number(sec?.bypassDC ?? opts.defaultDV ?? 15) || 15 }];
  return `<div class="ncm-bypass" data-bypass-rows data-default-dv="${Number(opts.defaultDV ?? sec?.bypassDC ?? 15) || 15}"
      data-cls-select="${esc(opts.select || '')}" data-cls-input="${esc(opts.input || '')}">
    <div class="ncm-bypass__list" data-bypass-list>${rows.map((r) => rowHtml(r, opts)).join('')}</div>
    <button type="button" class="ncm-bypass__add" data-bypass-add><i class="fas fa-plus"></i> Add skill</button>
  </div>`;
}

/** Add / remove rows. Call from the owning window's `_onRender`; safe to call twice. */
export function wireBypassRows(root) {
  const box = root?.querySelector?.('[data-bypass-rows]');
  if (!box || box._ncmBypassWired) return;
  box._ncmBypassWired = true;
  box.addEventListener('click', (e) => {
    const add = e.target.closest('[data-bypass-add]');
    const rm = e.target.closest('[data-bypass-remove]');
    if (!add && !rm) return;
    e.preventDefault();
    e.stopPropagation();
    const list = box.querySelector('[data-bypass-list]');
    if (add) {
      const taken = new Set(readBypassRows(box).map((r) => norm(r.name)));
      const next = Object.keys(SKILL_MAP).find((s) => !taken.has(norm(s))) || 'Interface';
      list.insertAdjacentHTML('beforeend', rowHtml(
        { name: next, dv: Number(box.dataset.defaultDv) || 15 },
        { select: box.dataset.clsSelect, input: box.dataset.clsInput },
      ));
    } else {
      rm.closest('[data-bypass-row]')?.remove();
    }
    // Let dirty-tracking listeners on the form notice the change.
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** The rows as `{ name, dv }`, in screen order. */
export function readBypassRows(root) {
  const box = root?.matches?.('[data-bypass-rows]') ? root : root?.querySelector?.('[data-bypass-rows]');
  if (!box) return null;
  return [...box.querySelectorAll('[data-bypass-row]')].map((row) => ({
    name: row.querySelector('.ncm-bypass__skill')?.value || '',
    dv: row.querySelector('.ncm-bypass__dv')?.value ?? '',
  }));
}
