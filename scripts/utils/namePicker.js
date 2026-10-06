/**
 * Name picker — the shared "searchable list of world names, with art" dialog.
 * @file scripts/utils/namePicker.js
 * @module night-city-messenger
 * @description The burn-picker pattern, extracted. It had been written four times
 *   (burn-to-shard target, the Security tab's operator-gate gear + role choosers,
 *   the Encoder config's blank-item picker) and the copies had already drifted —
 *   so a new caller gets this instead of a fifth.
 *
 *   Why a dialog and not a `<select>`: a native dropdown has no search and no item
 *   art, and it forces the CALLER to build the whole option list on every render.
 *   This reads the world on demand, when the GM actually opens the picker.
 *
 *   **A chosen entry renders greyed, not hidden** (`is-taken`): shown-but-inert
 *   answers "why isn't X in the list?", which a missing row does not. The click is
 *   refused here, in JS — never only in CSS.
 *
 *   **Filtering writes `style.display`, NOT the `hidden` attribute.** `[hidden]`'s
 *   UA rule is a plain `display:none`, which LOSES to the author rule
 *   `.ncm-burn-dialog .ncm-burn-row { display:flex }` — that is exactly why the
 *   Encoder config's blank-item search silently did not filter. Inline wins; keep
 *   it inline. (Same trap as the ActorImportPicker rows.)
 */

import { adminDialog } from './adminTheme.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** CPR sheet-abstraction item types — never carryable gear, so never offered. */
const NON_CARRIER_TYPES = new Set(['skill', 'role', 'criticalInjury', 'netarch']);

export const FALLBACK_ITEM_IMG = 'icons/svg/item-bag.svg';
export const FALLBACK_ROLE_IMG = 'icons/svg/upgrade.svg';

/** The common CPR roles, so a world with no role items still offers choices. */
const SEED_ROLES = ['Netrunner', 'Tech', 'Fixer', 'Solo', 'Media', 'Rockerboy', 'Nomad', 'Lawman', 'Exec', 'Medtech'];

/**
 * Distinct carryable item names across the world (world items + every actor's
 * inventory), each with a representative image.
 * @param {object} [opts]
 * @param {number} [opts.limit] cap the list (0 = no cap)
 * @returns {Array<{name: string, img: string}>} sorted by name
 */
export function worldItemEntries({ limit = 0 } = {}) {
  const seen = new Map();
  const add = (i) => {
    if (!i?.name || NON_CARRIER_TYPES.has(i.type)) return;
    const k = String(i.name).toLowerCase();
    if (!seen.has(k)) seen.set(k, { name: i.name, img: i.img || FALLBACK_ITEM_IMG });
  };
  for (const i of (game.items ?? [])) add(i);
  for (const a of (game.actors ?? [])) for (const i of (a.items ?? [])) add(i);
  const out = [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
  return limit > 0 ? out.slice(0, limit) : out;
}

/**
 * Distinct CPR role names across the world, seeded with the core ten.
 * @returns {Array<{name: string, img: string}>} sorted by name
 */
export function worldRoleEntries() {
  const seen = new Map();
  for (const a of (game.actors ?? [])) for (const i of (a.items ?? [])) {
    if (i.type !== 'role' || !i.name) continue;
    const k = String(i.name).toLowerCase();
    if (!seen.has(k)) seen.set(k, { name: i.name, img: i.img || FALLBACK_ROLE_IMG });
  }
  for (const r of SEED_ROLES) {
    const k = r.toLowerCase();
    if (!seen.has(k)) seen.set(k, { name: r, img: FALLBACK_ROLE_IMG });
  }
  return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/** Best-guess art for a name already stored in a config (substring match). */
export function itemImgFor(name, fallback = FALLBACK_ITEM_IMG) {
  const w = String(name || '').toLowerCase();
  if (!w) return fallback;
  const hit = (game.items ?? []).find((i) => String(i.name).toLowerCase().includes(w))
    || [...(game.actors ?? [])].flatMap((a) => [...(a.items ?? [])]).find((i) => String(i.name).toLowerCase().includes(w));
  return hit?.img || fallback;
}

/** Best-guess art for a stored CPR role name. */
export function roleImgFor(name) {
  const w = String(name || '').toLowerCase();
  if (!w) return FALLBACK_ROLE_IMG;
  const hit = [...(game.actors ?? [])].flatMap((a) => [...(a.items ?? [])])
    .find((i) => i.type === 'role' && String(i.name).toLowerCase().includes(w));
  return hit?.img || FALLBACK_ROLE_IMG;
}

/**
 * Open the picker.
 * @param {object} o
 * @param {string} o.title                            dialog title
 * @param {string} [o.hint]                           one line above the search box
 * @param {Array<{name, img, id?, tag?, note?}>} o.entries choices, pre-sorted
 * @param {Set<string>|Array<string>} [o.taken]       ids (or names, when an entry has no id)
 *   already chosen — rendered greyed with the click refused
 * @param {string} [o.takenLabel]                     what the grey chip says
 * @param {string} [o.emptyText]                      shown when `entries` is empty
 * @param {string} [o.closeLabel]
 * @param {(pick: {name: string, img: string, id: string}) => void} [o.onPick]
 * @returns {Promise<{name: string, img: string, id: string}|null>} the pick, or null if dismissed
 */
export function showNamePicker({
  title, hint = '', entries = [], taken, takenLabel = 'added',
  emptyText = 'nothing found in this world', closeLabel = 'Cancel', onPick,
} = {}) {
  const takenSet = taken instanceof Set ? taken : new Set(taken || []);

  // `taken` is matched on the id when an entry has one (two characters can share
  // a name; two ids cannot), and on the name otherwise.
  const isTaken = (e) => takenSet.has(e.id ?? e.name);

  const rows = entries.map((e) => `
    <div class="ncm-burn-row${isTaken(e) ? ' is-taken' : ''}" data-name="${esc(e.name)}" data-img="${esc(e.img || '')}"${e.id ? ` data-id="${esc(e.id)}"` : ''}>
      <img src="${esc(e.img || FALLBACK_ITEM_IMG)}" alt="">
      <span class="ncm-burn-name">${esc(e.name)}</span>
      ${e.note ? `<span class="ncm-burn-type">${esc(e.note)}</span>` : ''}
      ${e.tag ? `<span class="ncm-burn-tag">${esc(e.tag)}</span>` : ''}
      ${isTaken(e) ? `<span class="ncm-burn-type">${esc(takenLabel)}</span>` : ''}
    </div>`).join('');

  return new Promise((resolve) => {
    let picked = null;
    const dlg = adminDialog({
      title,
      content: `
        ${hint ? `<div class="ncm-burn-hint">${esc(hint)}</div>` : ''}
        <input type="text" class="ncm-burn-search" placeholder="search…">
        <div class="ncm-burn-list">${rows || `<div class="ncm-burn-hint" style="padding:8px">${esc(emptyText)}</div>`}</div>`,
      buttons: { cancel: { label: closeLabel } },
      render: (html) => {
        const root = html[0] ?? html;
        const list = root.querySelector('.ncm-burn-list');
        const search = root.querySelector('.ncm-burn-search');
        search?.addEventListener('input', (ev) => {
          const q = ev.target.value.trim().toLowerCase();
          list?.querySelectorAll('.ncm-burn-row').forEach((r) => {
            // Inline display — see the header note on why `hidden` cannot work here.
            r.style.display = (!q || r.dataset.name.toLowerCase().includes(q)) ? '' : 'none';
          });
        });
        setTimeout(() => search?.focus(), 30);
        list?.addEventListener('click', (ev) => {
          const row = ev.target.closest('.ncm-burn-row');
          if (!row || row.classList.contains('is-taken')) return;
          picked = { name: row.dataset.name, img: row.dataset.img || '', id: row.dataset.id || '' };
          try { onPick?.(picked); } catch (err) { console.warn('NCM | namePicker onPick failed', err); }
          dlg.close();
        });
      },
      close: () => resolve(picked),
    }, { classes: ['ncm-burn-dialog'] });
    dlg.render(true);
  });
}
