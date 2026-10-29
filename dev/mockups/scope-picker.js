/*
 * SCOPE PICKER — the one control for "which network / scene / terminal does
 * this apply to" anywhere a list of world things can grow past a handful.
 * Mock implementation (2026-10-27), shared by the admin redesign mocks.
 *
 *   A chip-button that opens an anchored popover:
 *     search  ·  chips (All · Has activity · one per group, with counts)
 *     grouped list (sticky group heads; rows sort by activity, then A–Z)
 *     pinned rows on top (e.g. "Everyone online") for targets that are not a thing
 *     multi mode: checkboxes + "Only" per row + Clear / Done
 *     single mode: a click picks and closes
 *
 * Rule it replaces: a <select> is for a SHORT enum. A list of networks,
 * scenes, terminals or shards is not short in a real campaign.
 *
 * API (classic script, no imports — works off disk):
 *   ScopePicker.html(id, cfg)    cfg = { noun, nouns, icon, items:[{id,name,group,color,icon,count,meta}],
 *                                        pinned:[{id,name,icon,meta}], multi, allLabel, countLabel }
 *   ScopePicker.value(id)        → array of picked ids ([] = all)
 *   ScopePicker.set(id, ids)
 *   ScopePicker.on(id, fn)       fn(ids) after every change (host re-renders)
 *   ScopePicker.after()          call at the end of every host render (positions the open popover)
 */
(function () {
  const S = {};               // id → { value:[], open, q, chip }
  const CFG = {};             // id → last cfg
  const CB = {};
  const st = (id) => (S[id] ||= { value: [], open: false, q: '', chip: 'all' });
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const css = `
  .ncm-scope { position: relative; display: inline-flex; flex: none; }
  .ncm-app button.ncm-scope-btn { appearance: none; width: auto !important; height: 30px !important; min-height: 0 !important; margin: 0 !important;
    display: inline-flex !important; align-items: center; gap: 7px; padding: 0 9px !important; border-radius: 2px !important; cursor: pointer; max-width: 230px;
    background: var(--ncm-bg-base) !important; border: 1px solid var(--ncm-border) !important; box-shadow: none !important; white-space: nowrap;
    font: 600 12px var(--ncm-font-display) !important; color: var(--ncm-text-primary) !important; }
  .ncm-app button.ncm-scope-btn:hover, .ncm-app button.ncm-scope-btn.open { border-color: var(--ncm-secondary) !important; }
  .ncm-app button.ncm-scope-btn.set { border-color: color-mix(in srgb, var(--ncm-secondary) 60%, var(--ncm-border)) !important; background: color-mix(in srgb, var(--ncm-secondary) 8%, var(--ncm-bg-base)) !important; }
  .ncm-scope-btn .k { font: 700 10px var(--ncm-font-display); letter-spacing: .06em; text-transform: uppercase; color: var(--ncm-text-secondary); }
  .ncm-scope-btn .v { overflow: hidden; text-overflow: ellipsis; }
  .ncm-scope-btn .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; }
  .ncm-scope-btn .caret { font-size: 10px; color: var(--ncm-text-secondary); margin: 0 !important; }
  .ncm-scope-btn .x { margin-left: 2px; width: 16px; height: 16px; display: grid; place-items: center; border-radius: 2px; color: var(--ncm-text-secondary); font-size: 10px; }
  .ncm-scope-btn .x:hover { background: var(--ncm-bg-elevated); color: var(--ncm-text-primary); }

  .ncm-scope-pop { position: fixed; z-index: 200; width: 330px; max-height: 400px; display: flex; flex-direction: column; overflow: hidden;
    background: var(--ncm-bg-elevated); border: 1px solid var(--ncm-border-active, var(--ncm-border)); border-radius: 2px; box-shadow: 0 14px 34px rgba(0,0,0,.5); }
  .ncm-scope-pop .sr { display: flex; align-items: center; gap: 7px; padding: 8px 9px; border-bottom: 1px solid var(--ncm-border); flex: none; }
  .ncm-scope-pop .sr i { color: var(--ncm-text-muted); font-size: 12px; }
  .ncm-app .ncm-scope-pop .sr input, .ncm-scope-pop .sr input { width: auto !important; flex: 1; min-width: 0; height: 26px; border: 0 !important; background: transparent !important; box-shadow: none !important; padding: 0 !important; height: 26px !important;
    font: 13px var(--ncm-font-body); color: var(--ncm-text-primary); outline: none; }
  .ncm-scope-pop .sr .ct { font: 11px var(--ncm-font-mono); color: var(--ncm-text-secondary); white-space: nowrap; }
  .ncm-scope-pop .chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 7px 9px; border-bottom: 1px solid var(--ncm-border); flex: none; }
  .ncm-scope-pop .chip { flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border: 1px solid var(--ncm-border); border-radius: 2px; cursor: pointer; user-select: none;
    font: 700 10px var(--ncm-font-display); letter-spacing: .05em; text-transform: uppercase; color: var(--ncm-text-secondary); background: var(--ncm-bg-base); }
  .ncm-scope-pop .chip .n { font: 10px var(--ncm-font-mono); color: var(--ncm-text-muted); }
  .ncm-scope-pop .chip.on { border-color: var(--ncm-secondary); color: var(--ncm-text-primary); }
  .ncm-scope-pop .chip.on .n { color: var(--ncm-secondary); }
  .ncm-scope-pop .list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
  .ncm-scope-pop .gh { position: sticky; top: 0; z-index: 1; padding: 4px 10px; background: var(--ncm-bg-surface); border-bottom: 1px solid var(--ncm-border);
    font: 700 10px var(--ncm-font-display); letter-spacing: .08em; text-transform: uppercase; color: var(--ncm-text-secondary); display: flex; }
  .ncm-scope-pop .gh .n { margin-left: auto; font: 10px var(--ncm-font-mono); color: var(--ncm-text-muted); letter-spacing: 0; }
  .ncm-scope-pop .row { display: grid; grid-template-columns: 16px 22px 1fr auto; gap: 8px; align-items: center; padding: 5px 10px; cursor: pointer; position: relative; }
  .ncm-scope-pop.single .row { grid-template-columns: 22px 1fr auto; }
  .ncm-scope-pop .row:hover, .ncm-scope-pop .row.cur { background: color-mix(in srgb, var(--ncm-secondary) 8%, transparent); }
  .ncm-scope-pop .row.on { background: color-mix(in srgb, var(--ncm-secondary) 12%, transparent); }
  .ncm-scope-pop .row.quiet .nm { color: var(--ncm-text-secondary); }
  .ncm-scope-pop .cb { width: 14px; height: 14px; border: 1px solid var(--ncm-border-active, var(--ncm-border)); border-radius: 2px; display: grid; place-items: center; font-size: 9px; color: transparent; }
  .ncm-scope-pop .row.on .cb { border-color: var(--ncm-secondary); color: var(--ncm-secondary); background: color-mix(in srgb, var(--ncm-secondary) 12%, transparent); }
  .ncm-scope-pop .ic { width: 22px; height: 22px; border-radius: 2px; display: grid; place-items: center; font-size: 11px; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }
  .ncm-scope-pop .nm { font: 600 13px var(--ncm-font-display); color: var(--ncm-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ncm-scope-pop .nm b { color: var(--ncm-secondary); font-weight: 700; }
  .ncm-scope-pop .mt { font: 11px var(--ncm-font-body); color: var(--ncm-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ncm-scope-pop .cnt { font: 11px var(--ncm-font-mono); color: var(--ncm-text-secondary); }
  .ncm-scope-pop .row.quiet .cnt { color: var(--ncm-text-muted); }
  .ncm-scope-pop .only { display: none; font: 700 10px var(--ncm-font-display); letter-spacing: .05em; text-transform: uppercase; color: var(--ncm-secondary); padding: 0 4px; }
  .ncm-scope-pop .row:hover .only { display: inline; }
  .ncm-scope-pop .row:hover .cnt { display: none; }
  .ncm-scope-pop .pin { border-bottom: 1px solid var(--ncm-border); }
  .ncm-scope-pop .empty { padding: 18px 12px; text-align: center; font: 13px var(--ncm-font-body); color: var(--ncm-text-secondary); }
  .ncm-scope-pop .empty a { color: var(--ncm-secondary); cursor: pointer; }
  .ncm-scope-pop .ft { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-top: 1px solid var(--ncm-border); flex: none;
    font: 12px var(--ncm-font-body); color: var(--ncm-text-secondary); }
  .ncm-scope-pop .ft a { color: var(--ncm-secondary); cursor: pointer; }
  .ncm-scope-pop .ft .grow { flex: 1; }
  .ncm-scope-pop .ft .keys { font: 10px var(--ncm-font-mono); color: var(--ncm-text-muted); }
  `;
  if (!document.getElementById('ncm-scope-css')) {
    const s = document.createElement('style'); s.id = 'ncm-scope-css'; s.textContent = css; document.head.appendChild(s);
  }

  function rowHtml(id, it, s, cfg, q) {
    const on = s.value.includes(it.id);
    const name = q ? esc(it.name).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<b>$1</b>') : esc(it.name);
    const quiet = cfg.countLabel && !it.count;
    return `<div class="row ${on ? 'on' : ''} ${quiet ? 'quiet' : ''}" data-scope-row="${id}" data-v="${esc(it.id)}" data-g="${esc(it.group || '')}" data-a="${it.count ? 1 : 0}" data-s="${esc((it.name + ' ' + (it.meta || '') + ' ' + (it.group || '')).toLowerCase())}">
      ${cfg.multi ? '<span class="cb"><i class="fas fa-check"></i></span>' : ''}
      <span class="ic" style="--c:${it.color || 'var(--ncm-secondary)'}"><i class="fas ${it.icon || cfg.icon || 'fa-circle'}"></i></span>
      <div style="min-width:0"><div class="nm">${name}</div>${it.meta ? `<div class="mt">${esc(it.meta)}</div>` : ''}</div>
      ${cfg.multi ? `<span class="only" data-scope-only="${id}" data-v="${esc(it.id)}">Only</span>` : ''}${cfg.countLabel ? `<span class="cnt">${it.count || '—'}</span>` : '<span></span>'}
    </div>`;
  }

  function popHtml(id) {
    const cfg = CFG[id], s = st(id), q = s.q.trim().toLowerCase();
    const groups = [...new Set(cfg.items.map((i) => i.group || ''))];
    const chipDefs = [['all', 'All', cfg.items.length]];
    if (cfg.countLabel) chipDefs.push(['active', cfg.activeLabel || 'Has activity', cfg.items.filter((i) => i.count).length]);
    if (s.value.length && cfg.multi) chipDefs.push(['picked', 'Picked', s.value.length]);
    groups.filter(Boolean).forEach((g) => chipDefs.push([`g:${g}`, g, cfg.items.filter((i) => i.group === g).length]));
    const pass = (i) => (!q || (i.name + ' ' + (i.meta || '') + ' ' + (i.group || '')).toLowerCase().includes(q))
      && (s.chip === 'all' || (s.chip === 'active' && i.count) || (s.chip === 'picked' && s.value.includes(i.id)) || s.chip === `g:${i.group}`);
    const sorted = (arr) => [...arr].sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name));
    const shown = cfg.items.filter(pass);
    const flat = !!q || s.chip !== 'all';
    const body = shown.length === 0
      ? `<div class="empty">Nothing matches${q ? ` “${esc(s.q)}”` : ''}.<br>${q ? `<a data-scope-clearq="${id}">Clear search</a>` : ''}${s.chip !== 'all' ? `${q ? ' · ' : ''}<a data-scope-chip="${id}" data-c="all">Show all</a>` : ''}</div>`
      : flat ? sorted(shown).map((i) => rowHtml(id, i, s, cfg, q)).join('')
      : groups.map((g) => { const gi = shown.filter((i) => (i.group || '') === g); return gi.length ? `${g ? `<div class="gh">${esc(g)}<span class="n">${gi.length}</span></div>` : ''}${sorted(gi).map((i) => rowHtml(id, i, s, cfg, q)).join('')}` : ''; }).join('');
    const pinned = (cfg.pinned || []).filter((p) => !q || p.name.toLowerCase().includes(q));
    return `<div class="ncm-scope-pop ${cfg.multi ? 'multi' : 'single'}" data-scope-pop="${id}">
      <div class="sr"><i class="fas fa-magnifying-glass"></i><input type="text" data-scope-q="${id}" value="${esc(s.q)}" placeholder="Search ${esc(cfg.nouns)}…"><span class="ct">${shown.length} / ${cfg.items.length}</span></div>
      <div class="chips">${chipDefs.map(([k, l, n]) => `<span class="chip ${s.chip === k ? 'on' : ''}" data-scope-chip="${id}" data-c="${esc(k)}">${esc(l)}<span class="n">${n}</span></span>`).join('')}</div>
      <div class="list">${pinned.length ? `<div class="pin">${pinned.map((p) => rowHtml(id, p, s, { ...cfg, countLabel: '' }, q)).join('')}</div>` : ''}${body}</div>
      <div class="ft">${cfg.multi
        ? `<span>${s.value.length ? `${s.value.length} picked` : `All ${esc(cfg.nouns)}`}</span>${s.value.length ? `<a data-scope-clear="${id}">Clear</a>` : ''}<span class="grow"></span><a data-scope-close="${id}">Done</a>`
        : `<span class="keys">↑↓ move · ⏎ pick · esc close</span><span class="grow"></span>${cfg.countLabel ? `<span>${esc(cfg.countLabel)}</span>` : ''}`}</div>
    </div>`;
  }

  function btnHtml(id) {
    const cfg = CFG[id], s = st(id);
    const all = [...cfg.items, ...(cfg.pinned || [])];
    const picked = s.value.map((v) => all.find((i) => i.id === v)).filter(Boolean);
    let v;
    if (cfg.fixedLabel) v = `<span class="v">${esc(cfg.fixedLabel)}</span>`;
    else if (!picked.length) v = `<span class="v">${esc(cfg.allLabel || `All ${cfg.nouns}`)}</span>`;
    else if (picked.length === 1) v = `<span class="dot" style="--c:${picked[0].color || 'var(--ncm-secondary)'}"></span><span class="v">${esc(picked[0].name)}</span>`;
    else v = `<span class="v">${picked.length} ${esc(cfg.nouns)}</span>`;
    const clearable = picked.length && cfg.multi && !cfg.fixedLabel;
    return `<button type="button" class="ncm-scope-btn ${s.open ? 'open' : ''} ${clearable ? 'set' : ''}" data-scope-btn="${id}" title="${esc(picked.map((p) => p.name).join(', '))}">
      <i class="fas ${cfg.icon || 'fa-filter'}" style="font-size:11px;color:var(--ncm-text-secondary);margin:0"></i>${cfg.label ? `<span class="k">${esc(cfg.label)}</span>` : ''}${v}${clearable ? `<span class="x" data-scope-clear="${id}" title="Clear"><i class="fas fa-xmark" style="margin:0"></i></span>` : '<i class="fas fa-chevron-down caret"></i>'}</button>`;
  }

  function changed(id) { (CB[id] || (() => {}))([...st(id).value]); }
  function rerenderPop(id) {
    const old = document.querySelector(`[data-scope-pop="${id}"]`); if (!old) return;
    const pos = { left: old.style.left, top: old.style.top }, sc = old.querySelector('.list')?.scrollTop || 0;
    old.outerHTML = popHtml(id);
    const n = document.querySelector(`[data-scope-pop="${id}"]`); Object.assign(n.style, pos); n.querySelector('.list').scrollTop = sc;
    const b = document.querySelector(`[data-scope-btn="${id}"]`); if (b) b.outerHTML = btnHtml(id);
  }

  const API = {
    html(id, cfg) { CFG[id] = cfg; const s = st(id); return `<span class="ncm-scope" data-scope="${id}">${btnHtml(id)}</span>${s.open ? popHtml(id) : ''}`; },
    value: (id) => [...st(id).value],
    set(id, ids) { st(id).value = [...ids]; },
    on(id, fn) { CB[id] = fn; },
    open(id) { st(id).open = true; },
    after() {
      document.querySelectorAll('[data-scope-pop]').forEach((p) => {
        const b = document.querySelector(`[data-scope-btn="${p.dataset.scopePop}"]`); if (!b) return;
        const r = b.getBoundingClientRect(), w = 330, vw = document.documentElement.clientWidth;
        p.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px'; p.style.top = (r.bottom + 4) + 'px';
        const inp = p.querySelector('input'); if (inp && !API._noFocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      });
    },
  };

  document.addEventListener('click', (e) => {
    const t = e.target;
    const clr = t.closest('[data-scope-clear]'); if (clr) { e.stopPropagation(); const id = clr.dataset.scopeClear; st(id).value = []; changed(id); return; }
    const b = t.closest('[data-scope-btn]'); if (b) { e.stopPropagation(); const id = b.dataset.scopeBtn; Object.keys(S).forEach((k) => { if (k !== id) S[k].open = false; }); st(id).open = !st(id).open; changed(id); return; }
    const only = t.closest('[data-scope-only]'); if (only) { e.stopPropagation(); const id = only.dataset.scopeOnly; st(id).value = [only.dataset.v]; changed(id); return; }
    const row = t.closest('[data-scope-row]'); if (row) {
      e.stopPropagation(); const id = row.dataset.scopeRow, s = st(id), v = row.dataset.v;
      if (CFG[id].multi) { s.value = s.value.includes(v) ? s.value.filter((x) => x !== v) : [...s.value, v]; API._noFocus = true; changed(id); API._noFocus = false; }
      else { s.value = [v]; s.open = false; s.q = ''; changed(id); }
      return;
    }
    const chip = t.closest('[data-scope-chip]'); if (chip) { e.stopPropagation(); const id = chip.dataset.scopeChip; st(id).chip = chip.dataset.c; rerenderPop(id); return; }
    const cq = t.closest('[data-scope-clearq]'); if (cq) { e.stopPropagation(); st(cq.dataset.scopeClearq).q = ''; rerenderPop(cq.dataset.scopeClearq); return; }
    const done = t.closest('[data-scope-close]'); if (done) { e.stopPropagation(); st(done.dataset.scopeClose).open = false; changed(done.dataset.scopeClose); return; }
    if (t.closest('[data-scope-pop]')) { e.stopPropagation(); return; }
    const openId = Object.keys(S).find((k) => S[k].open); if (openId) { S[openId].open = false; changed(openId); }
  }, true);
  document.addEventListener('input', (e) => {
    const q = e.target.closest('[data-scope-q]'); if (!q) return;
    const id = q.dataset.scopeQ; st(id).q = q.value;
    const caret = q.selectionStart; rerenderPop(id);
    const n = document.querySelector(`[data-scope-q="${id}"]`); n.focus(); n.setSelectionRange(caret, caret);
  });
  document.addEventListener('keydown', (e) => {
    const pop = e.target.closest?.('[data-scope-pop]'); if (!pop) return;
    const id = pop.dataset.scopePop, rows = [...pop.querySelectorAll('.row')];
    let i = rows.findIndex((r) => r.classList.contains('cur'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[i]?.classList.remove('cur'); i = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1); rows[i]?.classList.add('cur'); rows[i]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); (rows[i] || rows[0])?.click(); }
    else if (e.key === 'Escape') { e.preventDefault(); st(id).open = false; changed(id); }
  });
  const reflow = () => { API._noFocus = true; API.after(); API._noFocus = false; };
  window.addEventListener('resize', reflow); document.addEventListener('scroll', reflow, true);
  requestAnimationFrame(reflow); setTimeout(reflow, 50);
  window.ScopePicker = API;
}());

/* Mock data only: extra networks so a picker can be judged at campaign scale. */
window.SCOPE_DEMO_EXTRA = [
  ['Biotechnica R&D', 'Corporate', '#5cd68a', 'fa-dna'], ['Petrochem grid', 'Corporate', '#c9a227', 'fa-oil-well'], ['Kang Tao armory', 'Corporate', '#e0703a', 'fa-gun'],
  ['Zetatech dev ring', 'Corporate', '#6a8cff', 'fa-microchip'], ['Trauma Team dispatch', 'Corporate', '#ff5577', 'fa-truck-medical'], ['Network 54 newsroom', 'Corporate', '#ffb03a', 'fa-video'],
  ['Night Corp civic', 'Government', '#9aa7ff', 'fa-city'], ['Max-Tac channel', 'Government', '#ff8a5c', 'fa-user-shield'], ['City Hall records', 'Government', '#c9b8ff', 'fa-landmark-dome'],
  ['Tyger Claws mesh', 'Underground', '#ff4fd8', 'fa-paw'], ['Valentinos line', 'Underground', '#ffd24d', 'fa-heart'], ['Voodoo Boys deep', 'Underground', '#4dffd2', 'fa-eye'],
  ['Mox safehouse', 'Underground', '#ff7ac0', 'fa-house-chimney'], ['6th Street post', 'Underground', '#d9d9d9', 'fa-flag'], ['Scav chop shop', 'Underground', '#a35c5c', 'fa-screwdriver-wrench'],
  ['Kabuki market wifi', 'Public', '#7fe0ff', 'fa-store'], ['Metro transit', 'Public', '#7fa8ff', 'fa-train-subway'], ['Combat Zone pirate', 'Public', '#c0c0c0', 'fa-satellite-dish'],
  ['Afterlife backroom', 'Custom', '#c76bff', 'fa-wine-glass'], ['Rocklin Augmentics', 'Custom', '#5cb8a8', 'fa-hand-fist'], ['Floor 7 local', 'Custom', '#4488ff', 'fa-server'],
];
