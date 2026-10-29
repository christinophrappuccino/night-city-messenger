/**
 * Scope picker — the one control for "which network / scene / person / identity
 * does this apply to" anywhere a list of world things can outgrow a <select>.
 * @file scripts/utils/scopePicker.js
 * @module night-city-messenger
 *
 * A chip-button that opens an anchored popover:
 *   search · chips (All · Has activity · Picked · one per group, with counts)
 *   grouped list (sticky group heads; rows sort by activity, then A–Z)
 *   pinned rows on top (e.g. "Everyone online") for targets that are not a thing
 *   multi mode: checkboxes + "Only" per row + Clear / Done
 *   single mode: a click picks and closes
 *
 * Rule it serves: a <select> is for a SHORT enum. A list of networks, scenes,
 * people or identities is not short in a real campaign. (The bigger world
 * pickers — every item/actor in the world — stay on showNamePicker.)
 *
 * Usage from a tab (AppV2 re-renders the whole part, so state lives HERE):
 *
 *   const id = this.scopeId('netlog');                 // namespaced per window
 *   ScopePicker.on(id, () => this.app.render());       // re-render on change
 *   ctx.netPicker = ScopePicker.html(id, { noun: 'network', nouns: 'networks',
 *     multi: true, items: [...], countLabel: 'entries' });
 *   // template: {{{netPicker}}}   — read the value with ScopePicker.value(id)
 *   // and call ScopePicker.after() from the tab's onRender (positions the popover).
 *
 * cfg: { noun, nouns, icon, label, allLabel, fixedLabel, multi, countLabel, activeLabel,
 *        items:[{id, name, group, color, icon, count, meta}], pinned:[{id, name, icon, meta}] }
 * Styles: styles/components/scope-picker.css (ncm-scope-*, tokens only).
 */

const S = {};      // id → { value:[], open, q, chip }
const CFG = {};    // id → last cfg
const CB = {};     // id → change callback
const st = (id) => (S[id] ||= { value: [], open: false, q: '', chip: 'all' });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rowHtml(id, it, s, cfg, q) {
  const on = s.value.includes(it.id);
  const name = q ? esc(it.name).replace(new RegExp(`(${reEsc(esc(q))})`, 'ig'), '<b>$1</b>') : esc(it.name);
  const quiet = cfg.countLabel && !it.count;
  return `<div class="row ${on ? 'on' : ''} ${quiet ? 'quiet' : ''}" data-scope-row="${id}" data-v="${esc(it.id)}">
    ${cfg.multi ? '<span class="cb"><i class="fas fa-check"></i></span>' : ''}
    <span class="ic" style="--c:${esc(it.color || 'var(--ncm-secondary)')}">${it.img ? `<img src="${esc(it.img)}" alt="">` : `<i class="fas ${esc(it.icon || cfg.icon || 'fa-circle')}"></i>`}</span>
    <div style="min-width:0"><div class="nm">${name}</div>${it.meta ? `<div class="mt">${esc(it.meta)}</div>` : ''}</div>
    ${cfg.multi ? `<span class="only" data-scope-only="${id}" data-v="${esc(it.id)}">Only</span>` : ''}${cfg.countLabel ? `<span class="cnt">${it.count || '—'}</span>` : '<span></span>'}
  </div>`;
}

function popHtml(id) {
  const cfg = CFG[id], s = st(id), q = s.q.trim().toLowerCase();
  const items = cfg.items || [];
  const groups = [...new Set(items.map((i) => i.group || ''))];
  const chipDefs = [['all', 'All', items.length]];
  if (cfg.countLabel) chipDefs.push(['active', cfg.activeLabel || 'Has activity', items.filter((i) => i.count).length]);
  if (s.value.length && cfg.multi) chipDefs.push(['picked', 'Picked', s.value.length]);
  if (groups.filter(Boolean).length > 1) groups.filter(Boolean).forEach((g) => chipDefs.push([`g:${g}`, g, items.filter((i) => i.group === g).length]));
  const hay = (i) => `${i.name} ${i.meta || ''} ${i.group || ''}`.toLowerCase();
  const pass = (i) => (!q || hay(i).includes(q))
    && (s.chip === 'all' || (s.chip === 'active' && i.count) || (s.chip === 'picked' && s.value.includes(i.id)) || s.chip === `g:${i.group}`);
  const sorted = (arr) => [...arr].sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.name).localeCompare(String(b.name)));
  const shown = items.filter(pass);
  const flat = !!q || s.chip !== 'all';
  const body = shown.length === 0
    ? `<div class="empty">Nothing matches${q ? ` “${esc(s.q)}”` : ''}.<br>${q ? `<a data-scope-clearq="${id}">Clear search</a>` : ''}${s.chip !== 'all' ? `${q ? ' · ' : ''}<a data-scope-chip="${id}" data-c="all">Show all</a>` : ''}</div>`
    : flat ? sorted(shown).map((i) => rowHtml(id, i, s, cfg, q)).join('')
      : groups.map((g) => {
        const gi = shown.filter((i) => (i.group || '') === g);
        return gi.length ? `${g ? `<div class="gh">${esc(g)}<span class="n">${gi.length}</span></div>` : ''}${sorted(gi).map((i) => rowHtml(id, i, s, cfg, q)).join('')}` : '';
      }).join('');
  const pinned = (cfg.pinned || []).filter((p) => !q || p.name.toLowerCase().includes(q));
  return `<div class="ncm-scope-pop ${cfg.multi ? 'multi' : 'single'}" data-scope-pop="${id}">
    <div class="sr"><i class="fas fa-magnifying-glass"></i><input type="text" data-scope-q="${id}" value="${esc(s.q)}" placeholder="Search ${esc(cfg.nouns || 'items')}…" autocomplete="off"><span class="ct">${shown.length} / ${items.length}</span></div>
    ${chipDefs.length > 1 ? `<div class="chips">${chipDefs.map(([k, l, n]) => `<span class="chip ${s.chip === k ? 'on' : ''}" data-scope-chip="${id}" data-c="${esc(k)}">${esc(l)}<span class="n">${n}</span></span>`).join('')}</div>` : ''}
    <div class="list">${pinned.length ? `<div class="pin">${pinned.map((p) => rowHtml(id, p, s, { ...cfg, countLabel: '' }, q)).join('')}</div>` : ''}${body}</div>
    <div class="ft">${cfg.multi
      ? `<span>${s.value.length ? `${s.value.length} picked` : `All ${esc(cfg.nouns || 'items')}`}</span>${s.value.length ? `<a data-scope-clear="${id}">Clear</a>` : ''}<span class="grow"></span><a data-scope-close="${id}">Done</a>`
      : `<span class="keys">↑↓ move · ⏎ pick · esc close</span><span class="grow"></span>${cfg.countLabel ? `<span>${esc(cfg.countLabel)}</span>` : ''}`}</div>
  </div>`;
}

function btnHtml(id) {
  const cfg = CFG[id], s = st(id);
  const all = [...(cfg.items || []), ...(cfg.pinned || [])];
  const picked = s.value.map((v) => all.find((i) => i.id === v)).filter(Boolean);
  let v;
  if (cfg.fixedLabel) v = `<span class="v">${esc(cfg.fixedLabel)}</span>`;
  else if (!picked.length) v = `<span class="v">${esc(cfg.allLabel || `All ${cfg.nouns || 'items'}`)}</span>`;
  else if (picked.length === 1) v = `<span class="dot" style="--c:${esc(picked[0].color || 'var(--ncm-secondary)')}"></span><span class="v">${esc(picked[0].name)}</span>`;
  else v = `<span class="v">${picked.length} ${esc(cfg.nouns || 'items')}</span>`;
  const clearable = picked.length && cfg.multi && !cfg.fixedLabel;
  return `<button type="button" class="ncm-scope-btn ${s.open ? 'open' : ''} ${clearable ? 'set' : ''}" data-scope-btn="${id}" aria-haspopup="listbox" aria-expanded="${s.open}" title="${esc(picked.map((p) => p.name).join(', '))}">
    <i class="fas ${esc(cfg.icon || 'fa-filter')}" style="font-size:11px;color:var(--ncm-text-secondary);margin:0"></i>${cfg.label ? `<span class="k">${esc(cfg.label)}</span>` : ''}${v}${clearable ? `<span class="x" data-scope-clear="${id}" title="Clear"><i class="fas fa-xmark" style="margin:0"></i></span>` : '<i class="fas fa-chevron-down caret"></i>'}</button>`;
}

/** Re-place popovers soon after a change, whether or not the host tab remembers to call after(). */
let afterTimer = null;
function queueAfter() {
  if (typeof window === 'undefined') return;
  clearTimeout(afterTimer);
  afterTimer = setTimeout(() => ScopePicker.after(), 40);
}

function changed(id) {
  // A pick must show at once: the host's callback usually re-renders its WINDOW, which replaces the button but never
  // the body-mounted popover, so a multi-pick's rows kept the checks they were born with until the popover was
  // reopened (dev 2026-10-28: "selecting works but it doesn't appear checked / selected"). Repaint it first.
  if (st(id).open && (typeof document !== 'undefined') && document.querySelector(`[data-scope-pop="${id}"]`)) rerenderPop(id);
  try { (CB[id] || (() => {}))([...st(id).value]); } catch (e) { console.error('NCM | scope picker callback', e); }
  queueAfter();
}

/** Repaint only the open popover (search, chips) so typing never loses focus. */
function rerenderPop(id) {
  const pop = document.querySelector(`[data-scope-pop="${id}"]`); if (!pop) return;
  const sc = pop.querySelector('.list')?.scrollTop || 0;
  const tmp = document.createElement('div'); tmp.innerHTML = popHtml(id);
  const fresh = tmp.firstElementChild;
  if (fresh) { pop.innerHTML = fresh.innerHTML; pop.classList.toggle('multi', fresh.classList.contains('multi')); pop.classList.toggle('single', fresh.classList.contains('single')); }
  const l = pop.querySelector('.list'); if (l) l.scrollTop = sc;
  const b = document.querySelector(`[data-scope-btn="${id}"]`); if (b) b.outerHTML = btnHtml(id);
}

let noFocus = false;

export const ScopePicker = {
  /** Markup for the button (and the popover when open). Embed with {{{triple}}}. */
  html(id, cfg) {
    CFG[id] = cfg;
    const s = st(id);
    // A pick that no longer exists (deleted network, renamed scene) is dropped quietly.
    const known = new Set([...(cfg.items || []), ...(cfg.pinned || [])].map((i) => i.id));
    if (s.value.some((v) => !known.has(v))) s.value = s.value.filter((v) => known.has(v));
    // The popover is NOT rendered here: after() mounts it on document.body (a "portal"),
    // so no window's stacking order, overflow or zoom can bury it (tester 2026-10-27:
    // Send as "flashes behind the app").
    return `<span class="ncm-scope" data-scope="${id}">${btnHtml(id)}</span>`;
  },
  value: (id) => [...st(id).value],
  set(id, ids) { st(id).value = [...(ids || [])]; },
  on(id, fn) { CB[id] = fn; },
  open(id) { st(id).open = true; },
  close(id) { st(id).open = false; },
  isOpen: (id) => !!st(id).open,
  /** Position any open popover under its button. Call after every render. */
  after() {
    // Drop popovers whose picker closed or whose button is gone.
    document.querySelectorAll('[data-scope-pop]').forEach((p) => {
      const id = p.dataset.scopePop;
      if (!S[id]?.open || !document.querySelector(`[data-scope-btn="${id}"]`)) p.remove();
    });
    // Mount each open popover on <body>, wearing the theme of the window its button sits in.
    for (const id of Object.keys(S)) {
      if (!S[id].open || !CFG[id]) continue;
      const b = document.querySelector(`[data-scope-btn="${id}"]`);
      if (!b) { S[id].open = false; continue; }
      if (document.querySelector(`[data-scope-pop="${id}"]`)) continue;
      const tmp = document.createElement('div'); tmp.innerHTML = popHtml(id);
      const pop = tmp.firstElementChild; if (!pop) continue;
      pop.classList.add('ncm-app');   // the token scope + typography; .ncm-app is position:fixed, as the popover is
      const themed = b.closest('[data-ncm-admin-theme]');
      if (themed) pop.setAttribute('data-ncm-admin-theme', themed.getAttribute('data-ncm-admin-theme'));
      pop.setAttribute('data-ncm-scanlines', 'false');
      document.body.appendChild(pop);
    }
    document.querySelectorAll('[data-scope-pop]').forEach((p) => {
      const b = document.querySelector(`[data-scope-btn="${p.dataset.scopePop}"]`);
      if (!b) { p.remove(); return; }
      const r = b.getBoundingClientRect(), w = 330, vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      p.style.left = `${Math.max(8, Math.min(r.left, vw - w - 8))}px`;
      const below = r.bottom + 4, ph = Math.min(400, p.offsetHeight || 400);
      p.style.top = `${below + ph > vh - 8 && r.top - ph - 4 > 8 ? r.top - ph - 4 : below}px`;
      const inp = p.querySelector('input');
      if (inp && !noFocus && !p.dataset.focused) { p.dataset.focused = '1'; inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    });
  },
};

// ── One set of document listeners for every picker on the page ──
if (typeof document !== 'undefined' && !globalThis.__ncmScopePickerWired) {
  globalThis.__ncmScopePickerWired = true;
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const clr = t.closest('[data-scope-clear]'); if (clr) { e.stopPropagation(); e.preventDefault(); const id = clr.dataset.scopeClear; st(id).value = []; changed(id); return; }
    const b = t.closest('[data-scope-btn]'); if (b) {
      e.stopPropagation(); e.preventDefault(); const id = b.dataset.scopeBtn;
      Object.keys(S).forEach((k) => { if (k !== id) S[k].open = false; });
      st(id).open = !st(id).open; changed(id); return;
    }
    const only = t.closest('[data-scope-only]'); if (only) { e.stopPropagation(); const id = only.dataset.scopeOnly; st(id).value = [only.dataset.v]; changed(id); return; }
    const row = t.closest('[data-scope-row]'); if (row) {
      e.stopPropagation(); const id = row.dataset.scopeRow, s = st(id), v = row.dataset.v;
      if (CFG[id]?.multi) { s.value = s.value.includes(v) ? s.value.filter((x) => x !== v) : [...s.value, v]; noFocus = true; changed(id); noFocus = false; }
      else { s.value = [v]; s.open = false; s.q = ''; changed(id); }
      return;
    }
    const chip = t.closest('[data-scope-chip]'); if (chip) { e.stopPropagation(); const id = chip.dataset.scopeChip; st(id).chip = chip.dataset.c; rerenderPop(id); return; }
    const cq = t.closest('[data-scope-clearq]'); if (cq) { e.stopPropagation(); st(cq.dataset.scopeClearq).q = ''; rerenderPop(cq.dataset.scopeClearq); return; }
    const done = t.closest('[data-scope-close]'); if (done) { e.stopPropagation(); st(done.dataset.scopeClose).open = false; changed(done.dataset.scopeClose); return; }
    if (t.closest('[data-scope-pop]')) { e.stopPropagation(); return; }
    const openId = Object.keys(S).find((k) => S[k].open);
    if (openId) { S[openId].open = false; changed(openId); }
  }, true);
  document.addEventListener('input', (e) => {
    const q = e.target.closest?.('[data-scope-q]'); if (!q) return;
    const id = q.dataset.scopeQ; st(id).q = q.value;
    const caret = q.selectionStart; rerenderPop(id);
    const n = document.querySelector(`[data-scope-q="${id}"]`); if (n) { n.focus(); n.setSelectionRange(caret, caret); }
  });
  document.addEventListener('keydown', (e) => {
    const pop = e.target.closest?.('[data-scope-pop]'); if (!pop) return;
    const id = pop.dataset.scopePop, rows = [...pop.querySelectorAll('.row')];
    let i = rows.findIndex((r) => r.classList.contains('cur'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); rows[i]?.classList.remove('cur');
      i = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
      rows[i]?.classList.add('cur'); rows[i]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); (rows[i] || rows[0])?.click(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); st(id).open = false; changed(id); }
  }, true);
  const reflow = () => { noFocus = true; ScopePicker.after(); noFocus = false; };
  window.addEventListener('resize', reflow);
  document.addEventListener('scroll', reflow, true);
}
