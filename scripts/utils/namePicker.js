/**
 * Name picker — the shared "searchable list of world names, with art" dialog.
 * @file scripts/utils/namePicker.js
 * @module night-city-messenger
 * @description The burn-picker pattern, extracted. It had been written four times
 *   (burn-to-shard target, the Security tab's operator-gate gear + role choosers,
 *   the Encoder config's blank-item picker) and the copies had already drifted —
 *   so a new caller gets this instead of a fifth. (Second sweep, same day: the
 *   terminal burn target, both key-item pickers of the config sheets, the terminal
 *   account key item, the Security tab's gate choosers, the Encoder's key item and
 *   the network-auth credential picker all moved here too; itemPicker.js is gone.)
 *
 *   **`admin: false` for a PLAYER-FACING caller.** The default opens an
 *   `adminDialog` (GM tools follow the admin preset). A picker opened from an
 *   immersive window — the Encoder, the terminal viewer, the network-auth dialog —
 *   passes `admin: false` and gets a plain Dialog whose `--ncm-*` tokens resolve
 *   from `:root`, i.e. the player's own theme.
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
 *   `.ncm-pkr__row { display:flex }` — that is exactly why the Encoder config's
 *   blank-item search silently did not filter. Inline wins; keep it inline. (Same
 *   trap as the ActorImportPicker rows.)
 *
 *   **Redesign (same day; mock dev/mockups/name-picker-redesign-mock.html).** One
 *   file + one prefix — `styles/components/name-picker.css`, `ncm-pkr-*`, dialog
 *   class `ncm-pkr-dialog`. The old `.ncm-burn-dialog` was a CLASS COLLISION: the
 *   Email Setup burn-confirm uses it as its content wrapper, and its
 *   `* { margin:0 !important }` + literal greys bled into every picker. The list
 *   carries sticky folder HEADERS while "All" is active (hidden the moment a chip or
 *   query narrows it), the search bar shows a live shown/total count + a clear, chips
 *   are SPANS in one scrolling row (every <button> in an admin dialog is restyled by
 *   admin-theme.css with !important), ↑↓ walk a cursor and ⏎ picks it, the empty
 *   state offers "Clear search" / "Search all groups", and a status strip states the
 *   keys (+ "N selected · select all shown" in multi mode). The JS contract did not
 *   change — no caller was touched.
 */

import { adminDialog, playerDialog } from './adminTheme.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** CPR sheet-abstraction item types — never carryable gear, so never offered. */
export const NON_CARRIER_TYPES = new Set(['skill', 'role', 'criticalInjury', 'netarch']);

/** Whether an Item is something a character can physically carry (the picker's gear filter). */
export const isCarrier = (item) => !!item && !NON_CARRIER_TYPES.has(item.type);

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
 * "Folder / Subfolder" path of a Foundry document, '' when unfiled.
 * @param {object} doc  anything with a `folder` (Folder document, with `.folder` parents)
 * @returns {string}
 */
export function folderPathOf(doc) {
  const names = [];
  let f = doc?.folder ?? null;
  let guard = 0;
  while (f && guard++ < 12) {
    if (f.name) names.unshift(f.name);
    f = f.folder ?? null;
  }
  return names.join(' / ');
}

/** The chip a document with no folder sorts under. */
export const UNFILED_GROUP = 'Unfiled';

/**
 * Turn Foundry documents (items, actors, scenes, macros…) into picker entries.
 * The ROW shows the folder path under the name; the CHIPS group by top-level
 * folder (the "default directory" the tester asked for — click your "NPCs"
 * folder instead of scrolling past three hundred actors). Sorted by name.
 * @param {Iterable<object>} docs
 * @param {object} [o]
 * @param {'folder'|'type'|((doc) => string)} [o.group='folder']  chip key
 * @param {'folder'|'type'|((doc) => string)} [o.sub='folder']    sub-line
 * @param {(doc) => string} [o.note]                                right-hand mono note (e.g. the type)
 * @param {string} [o.fallbackImg]
 * @returns {Array<{id: string, name: string, img: string, sub: string, group: string, note?: string}>}
 */
export function documentEntries(docs, { group = 'folder', sub = 'folder', note, fallbackImg = FALLBACK_ITEM_IMG } = {}) {
  const topFolder = (d) => { let f = d?.folder ?? null; let g = 0; while (f?.folder && g++ < 12) f = f.folder; return f?.name || UNFILED_GROUP; };
  const pick = (how, d) => {
    if (typeof how === 'function') return String(how(d) ?? '');
    if (how === 'type') return String(d?.type ?? '');
    return how === 'folder' ? (d === undefined ? '' : folderPathOf(d)) : '';
  };
  const out = [];
  for (const d of docs ?? []) {
    if (!d?.name) continue;
    out.push({
      id: d.id ?? d._id ?? '',
      name: d.name,
      img: d.img || d.thumb || fallbackImg,
      sub: pick(sub, d),
      group: group === 'folder' ? topFolder(d) : pick(group, d),
      ...(note ? { note: String(note(d) ?? '') } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The picker's filter rule — pure, so the sim can drive it. A row shows when
 * the query matches its name OR its sub-line (so "arasaka" finds everything in
 * the Arasaka folder) AND it belongs to the active chip ('' = all).
 * @param {{name: string, sub?: string, group?: string}} e
 * @param {string} q      lowercased query
 * @param {string} group  active chip key, '' for all
 * @returns {boolean}
 */
export function matchesPicker(e, q, group) {
  if (group && (e.group ?? '') !== group) return false;
  if (!q) return true;
  return String(e.name ?? '').toLowerCase().includes(q) || String(e.sub ?? '').toLowerCase().includes(q);
}

/**
 * Open the picker.
 * @param {object} o
 * @param {string} o.title                            dialog title
 * @param {string} [o.hint]                           one line above the search box
 * @param {Array<{name, img, id?, tag?, note?, sub?, group?}>} o.entries choices, pre-sorted
 *   `sub` = a muted line under the name (folder path); `group` = the filter chip it belongs to
 * @param {boolean} [o.chips=true]                    render filter chips (+ folder headers while "All" is active) when entries carry ≥2 groups
 * @param {string} [o.chipAll='All']                  label of the everything-chip
 * @param {string|false} [o.allowNone=false]          label of a leading "none" row (resolves `{none:true, id:''}`)
 * @param {string} [o.selected]                       id of the current choice — highlighted + scrolled to
 * @param {boolean} [o.multi=false]                   checkbox rows + a Done button; resolves an ARRAY of picks (empty = cancelled)
 * @param {Set<string>|Array<string>} [o.preselected] multi: ids that start ticked, for editing a saved list. Done may then
 *   resolve an empty array (nothing ticked), and dismissing resolves null
 * @param {string} [o.doneLabel='Add selected']       multi: the Done button's words
 * @param {string} [o.placeholder='search…']
 * @param {Set<string>|Array<string>} [o.taken]       ids (or names, when an entry has no id)
 *   already chosen — rendered greyed with the click refused
 * @param {string} [o.takenLabel]                     what the grey label says
 * @param {string} [o.emptyText]                      shown when `entries` is empty
 * @param {string} [o.closeLabel]
 * @param {boolean} [o.admin=true]                    false = a plain Dialog on the player theme (immersive windows)
 * @param {number} [o.width=440]                      dialog width
 * @param {(pick: {name: string, img: string, id: string, none?: boolean}) => void} [o.onPick]
 * @returns {Promise<{name: string, img: string, id: string, none?: boolean}|null|Array>} the pick (null if dismissed); in multi mode an array
 */
export function showNamePicker({
  title, hint = '', entries = [], chips = true, chipAll = 'All', allowNone = false, selected = '',
  placeholder = 'search…', taken, takenLabel = 'added', multi = false, preselected = null, doneLabel = 'Add selected',
  emptyText = 'nothing found in this world', closeLabel = 'Cancel', onPick, admin = true, width = 440,
} = {}) {
  const takenSet = taken instanceof Set ? taken : new Set(taken || []);
  const startTicked = new Set(preselected || []);
  const open = admin ? adminDialog : playerDialog;

  // `taken` is matched on the id when an entry has one (two characters can share
  // a name; two ids cannot), and on the name otherwise.
  const isTaken = (e) => takenSet.has(e.id ?? e.name);

  // Groups in first-seen order (the caller's sort decides which comes first —
  // e.g. the GM Contact Manager puts Players ahead of the folders), with counts.
  const groups = [];
  const counts = new Map();
  for (const e of entries) {
    const g = e.group ?? '';
    if (!g) continue;
    if (!counts.has(g)) { counts.set(g, 0); groups.push(g); }
    counts.set(g, counts.get(g) + 1);
  }
  // Chips AND the folder headers both need something to choose between.
  const grouped = chips && groups.length >= 2;
  const chipsHtml = grouped ? `
    <div class="ncm-pkr__chips" role="tablist">
      <span class="ncm-pkr__chip is-on" role="tab" data-group="">${esc(chipAll)} <b>${entries.length}</b></span>
      ${groups.map((g) => `<span class="ncm-pkr__chip" role="tab" data-group="${esc(g)}">${esc(g)} <b>${counts.get(g)}</b></span>`).join('')}
    </div>` : '';

  const selIc = multi ? '' : '<i class="fas fa-check ncm-pkr__sel-ic"></i>';
  const rowHtml = (e) => `
    <div class="ncm-pkr__row${isTaken(e) ? ' is-taken' : ''}${selected && e.id === selected ? ' is-selected' : ''}${multi && e.id && startTicked.has(e.id) ? ' is-picked' : ''}" data-name="${esc(e.name)}" data-sub="${esc(e.sub || '')}" data-group="${esc(e.group || '')}" data-img="${esc(e.img || '')}"${e.id ? ` data-id="${esc(e.id)}"` : ''}>
      ${multi ? '<span class="ncm-pkr__check"><i class="fas fa-check"></i></span>' : ''}${(!e.img && e.icon) ? `<span class="ncm-pkr__art ncm-pkr__art--ic" style="--c:${esc(e.color || 'var(--ncm-secondary)')}"><i class="${esc(e.icon)}"></i></span>` : `<img class="ncm-pkr__art" src="${esc(e.img || FALLBACK_ITEM_IMG)}" alt="">`}
      <span class="ncm-pkr__main">
        <span class="ncm-pkr__name">${esc(e.name)}</span>
        ${e.sub ? `<span class="ncm-pkr__sub"><i class="fas fa-folder"></i>${esc(e.sub)}</span>` : ''}
      </span>
      ${isTaken(e) ? `<span class="ncm-pkr__taken">${esc(takenLabel)}</span>` : (e.note ? `<span class="ncm-pkr__note">${esc(e.note)}</span>` : '')}
      ${e.tag ? `<span class="ncm-pkr__tag">${esc(e.tag)}</span>` : ''}
      ${selIc}
    </div>`;
  const noneRow = allowNone ? `
    <div class="ncm-pkr__row ncm-pkr__row--none${!selected ? ' is-selected' : ''}" data-none="1" data-name="" data-sub="" data-group="" data-img="">
      <span class="ncm-pkr__none"><i class="fas fa-ban"></i></span>
      <span class="ncm-pkr__main"><span class="ncm-pkr__name">${esc(allowNone)}</span></span>
      ${selIc}
    </div>` : '';
  // Grouped: rows sit under a sticky folder header per group (the "default
  // directory" without clicking a chip); the headers hide as soon as a chip or a
  // query narrows the list. Ungrouped entries trail the groups.
  let rows = '';
  if (grouped) {
    for (const g of groups) rows += `<div class="ncm-pkr__group"><i class="fas fa-folder"></i>${esc(g)}<b>${counts.get(g)}</b></div>` + entries.filter((e) => (e.group ?? '') === g).map(rowHtml).join('');
    rows += entries.filter((e) => !(e.group ?? '')).map(rowHtml).join('');
  } else {
    rows = entries.map(rowHtml).join('');
  }

  return new Promise((resolve) => {
    let picked = null;
    const dlg = open({
      title,
      content: `
        <div class="ncm-pkr${multi ? ' ncm-pkr--multi' : ''}">
          ${hint ? `<div class="ncm-pkr__hint">${esc(hint)}</div>` : ''}
          <div class="ncm-pkr__bar"><i class="fas fa-magnifying-glass"></i><input type="text" class="ncm-pkr__q" placeholder="${esc(placeholder)}" autocomplete="off"><span class="ncm-pkr__count">${entries.length}</span><span class="ncm-pkr__clear" title="clear"><i class="fas fa-xmark"></i></span></div>
          ${chipsHtml}
          <div class="ncm-pkr__list">${noneRow}${rows || `<div class="ncm-pkr__hint ncm-pkr__hint--empty">${esc(emptyText)}</div>`}</div>
          <div class="ncm-pkr__empty"></div>
          <div class="ncm-pkr__foot"><span class="ncm-pkr__status"></span><span class="ncm-pkr__keys"><kbd>↑↓</kbd> move <kbd>⏎</kbd> ${multi ? 'toggle' : 'pick'} <kbd>esc</kbd> close</span></div>
        </div>`,
      buttons: multi
        ? {
          done: { label: `<i class="fas fa-check"></i> ${esc(doneLabel)}`, callback: (html) => {
            const root = html[0] ?? html;
            picked = [...root.querySelectorAll('.ncm-pkr__row.is-picked')]
              .map((row) => ({ name: row.dataset.name, img: row.dataset.img || '', id: row.dataset.id || '' }));
          } },
          cancel: { label: closeLabel },
        }
        : { cancel: { label: closeLabel } },
      render: (html) => {
        const root = html[0] ?? html;
        const pkr = root.querySelector('.ncm-pkr');
        const list = root.querySelector('.ncm-pkr__list');
        const bar = root.querySelector('.ncm-pkr__bar');
        const search = root.querySelector('.ncm-pkr__q');
        const countEl = root.querySelector('.ncm-pkr__count');
        const emptyEl = root.querySelector('.ncm-pkr__empty');
        const statusEl = root.querySelector('.ncm-pkr__status');
        let activeGroup = '';
        let cursor = -1;
        let shown = entries.length;

        const allRows = () => [...(list?.querySelectorAll('.ncm-pkr__row') ?? [])];
        // The rows the keyboard can land on: visible, real, not taken.
        const liveRows = () => allRows().filter((r) => r.style.display !== 'none' && r.dataset.none !== '1' && !r.classList.contains('is-taken'));

        const highlight = (row, q) => {
          const nameEl = row.querySelector('.ncm-pkr__name');
          const name = row.dataset.name || '';
          const i = q ? name.toLowerCase().indexOf(q) : -1;
          if (i < 0) { if (nameEl.querySelector('mark')) nameEl.textContent = name; return; }
          nameEl.innerHTML = `${esc(name.slice(0, i))}<mark>${esc(name.slice(i, i + q.length))}</mark>${esc(name.slice(i + q.length))}`;
        };
        const setCursor = (i) => {
          const live = liveRows();
          allRows().forEach((r) => r.classList.remove('is-cursor'));
          cursor = (i < 0 || !live.length) ? -1 : Math.max(0, Math.min(live.length - 1, i));
          if (cursor >= 0) { live[cursor].classList.add('is-cursor'); live[cursor].scrollIntoView?.({ block: 'nearest' }); }
        };
        const status = () => {
          if (!statusEl) return;
          statusEl.innerHTML = multi
            ? `<span class="ncm-pkr__sel">${root.querySelectorAll('.ncm-pkr__row.is-picked').length} selected</span><span class="ncm-pkr__link" data-act="all-shown">select all shown</span>`
            : `${shown} shown`;
        };
        const applyFilter = () => {
          const q = (search?.value || '').trim().toLowerCase();
          const filtered = !!q || !!activeGroup;
          pkr?.classList.toggle('is-filtered', filtered);
          bar?.classList.toggle('has-query', !!q);
          shown = 0;
          for (const r of allRows()) {
            const none = r.dataset.none === '1';
            // The "none" row is a choice, not a search hit: it stays unless you are typing.
            const show = none ? !q : matchesPicker({ name: r.dataset.name, sub: r.dataset.sub, group: r.dataset.group }, q, activeGroup);
            // Inline display — `[hidden]` loses to the row's own display rule (see the header note).
            r.style.display = show ? '' : 'none';
            if (!none) { if (show) shown++; highlight(r, show ? q : ''); }
          }
          if (countEl) countEl.innerHTML = filtered ? `<b>${shown}</b> / ${entries.length}` : `${entries.length}`;
          const isEmpty = shown === 0 && entries.length > 0;
          pkr?.classList.toggle('is-empty', isEmpty);
          if (list) list.style.display = isEmpty ? 'none' : '';
          if (isEmpty && emptyEl) {
            emptyEl.innerHTML = `Nothing matches${q ? ` <b>“${esc(search.value.trim())}”</b>` : ''}${activeGroup ? ` in <b>${esc(activeGroup)}</b>` : ''}.<br>`
              + (q ? '<span class="ncm-pkr__btn" data-act="clear">Clear search</span>' : '')
              + (activeGroup ? '<span class="ncm-pkr__btn" data-act="all">Search all groups</span>' : '');
          }
          setCursor(-1);
          status();
        };
        const setGroup = (g) => {
          activeGroup = g || '';
          root.querySelectorAll('.ncm-pkr__chip').forEach((c) => c.classList.toggle('is-on', (c.dataset.group || '') === activeGroup));
          applyFilter();
          search?.focus();
        };

        const choose = (row) => {
          if (!row || row.classList.contains('is-taken')) return;
          if (multi) {
            // Toggle; the Done button collects. A pick never closes the dialog.
            if (row.dataset.none === '1') return;
            row.classList.toggle('is-picked');
            status();
            return;
          }
          picked = row.dataset.none === '1'
            ? { name: '', img: '', id: '', none: true }
            : { name: row.dataset.name, img: row.dataset.img || '', id: row.dataset.id || '' };
          try { onPick?.(picked); } catch (err) { console.warn('NCM | namePicker onPick failed', err); }
          dlg.close();
        };

        search?.addEventListener('input', applyFilter);
        // ↑↓ walk a cursor; Enter picks it (or the first live row when none is set —
        // type three letters, Enter, done). Escape is the Dialog's own close.
        search?.addEventListener('keydown', (ev) => {
          if (ev.key === 'ArrowDown') { ev.preventDefault(); setCursor(cursor + 1); }
          else if (ev.key === 'ArrowUp') { ev.preventDefault(); setCursor(cursor - 1); }
          else if (ev.key === 'Enter') { ev.preventDefault(); const live = liveRows(); choose(live[cursor >= 0 ? cursor : 0]); }
        });
        root.querySelector('.ncm-pkr__clear')?.addEventListener('click', () => { if (search) search.value = ''; applyFilter(); search?.focus(); });
        root.querySelectorAll('.ncm-pkr__chip').forEach((c) => c.addEventListener('click', () => setGroup(c.dataset.group)));
        list?.addEventListener('click', (ev) => choose(ev.target.closest('.ncm-pkr__row')));
        emptyEl?.addEventListener('click', (ev) => {
          const act = ev.target.closest('[data-act]')?.dataset.act;
          if (act === 'clear') { if (search) search.value = ''; applyFilter(); search?.focus(); }
          else if (act === 'all') setGroup('');
        });
        statusEl?.addEventListener('click', (ev) => {
          if (ev.target.closest('[data-act]')?.dataset.act !== 'all-shown') return;
          liveRows().forEach((r) => { if (!r.classList.contains('is-picked')) choose(r); });
        });

        status();
        setTimeout(() => {
          search?.focus();
          list?.querySelector('.ncm-pkr__row.is-selected')?.scrollIntoView?.({ block: 'center' });
        }, 30);
      },
      close: () => resolve(multi ? (Array.isArray(picked) ? picked : (preselected ? null : [])) : picked),
    }, { classes: ['ncm-pkr-dialog'], width });
    dlg.render(true);
  });
}
