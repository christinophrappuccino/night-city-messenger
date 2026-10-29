/**
 * contactsMap — Admin → Contacts → Who knows whom → MAP: the context builder + DOM wiring.
 * @file scripts/ui/AdminPanel/tabs/contactsMap.js
 * @module night-city-messenger
 *
 * The geometry rules live in contactsMapModel.js (pure). This file reads the world through the
 * tab instance (its who-knows index, characters, mail index, groups) and builds the view-model the
 * partial templates/admin-panel/partials/contacts-map.hbs renders: highlight chips, readout strip,
 * the map, the information panel, and the nobody-knows dock. Every button is
 * data-action="tabAct" data-owner="contacts" data-op="…" and reuses an existing op
 * (whoToggle, replyAs, sendAs, pOpenContact, pInbox, pMessage, pContacts, pGroupUpdate) except the
 * three map ops (mapPick / mapHi / mapShareAll), which ContactsTab forwards here.
 */

import { formatCyberDate } from '../../../utils/helpers.js';
import { identityRole } from '../../../utils/identities.js';
import { getRoleIcon, getInitials } from '../../../utils/designHelpers.js';
import { tagHue } from '../../../utils/tagHue.js';
import { trustInfo } from './contactsModel.js';
import { mapView } from './contactsMapModel.js';
import { ScopePicker } from '../../../utils/scopePicker.js';

const lc = (s) => String(s ?? '').trim().toLowerCase();
const roleHue = (r) => (r ? tagHue(`role:${r}`) : 'var(--ncm-text-hint)');

/** Contacts a master group's members point at (by directory id hint, else by address). */
function groupContactIds(group, contacts) {
  const ids = new Set();
  for (const m of group?.members ?? []) {
    const hit = contacts.find((c) => (m.hint?.contactId && c.id === m.hint.contactId) || (m.email && lc(c.email) === lc(m.email)));
    if (hit) ids.add(hit.id);
  }
  return ids;
}

/**
 * @param {object} tab   the ContactsTab
 * @param {object} w     { all, npcs, pcs, kx, mail, groups } — what _buildContext already read
 */
export function buildMapContext(tab, { all, npcs, pcs, kx, mail, groups }) {
  const contacts = npcs.filter((c) => !identityRole(all, c)?.isAlias);
  const knowers = (c) => pcs.filter((p) => kx.knows(c, p.actorId)).map((p) => p.actorId);
  const rows = contacts.map((c) => ({ c, knows: knowers(c) }));
  const groupSets = (groups || []).map((g) => ({ g, ids: groupContactIds(g, contacts) })).filter((x) => x.ids.size);
  const several = Math.min(3, Math.max(2, pcs.length));

  // highlight chips: none / known by several / known by one / each GM group
  const hiKey = tab._mapHi || '';
  const hiOf = (key) => {
    if (key === 'several') return rows.filter((r) => r.knows.length >= several).map((r) => r.c.id);
    if (key === 'one') return rows.filter((r) => r.knows.length === 1).map((r) => r.c.id);
    if (key.startsWith('group:')) { const gs = groupSets.find((x) => x.g.id === key.slice(6)); return gs ? [...gs.ids] : []; }
    return null;
  };
  const hi = hiKey ? hiOf(hiKey) : null;
  const chips = [['', 'None'], ['several', `Known by ${several}+`], ['one', 'Known by one']]
    .map(([key, label]) => ({ key, label, on: key === hiKey, n: key ? hiOf(key).length : '' }))
;
  // Groups: ONE searchable picker instead of a chip per group (dev 2026-10-28: "there might be a lot of groups").
  // Picking one highlights its members (the 'group:<id>' key the chips used); None clears it.
  const gid = tab.scopeId('maphi');
  const hiGroup = hiKey.startsWith('group:') ? groupSets.find((x) => x.g.id === hiKey.slice(6)) : null;
  if (!ScopePicker.isOpen(gid)) ScopePicker.set(gid, hiGroup ? [hiGroup.g.id] : []);
  // The picker calls back on EVERY change, opening it included — act only when the picked group changes
  // (the first cut closed + re-rendered on the open click, so the list vanished the moment it appeared).
  ScopePicker.on(gid, (v) => {
    const next = v?.length ? `group:${v[0]}` : '';
    if (next === (tab._mapHi || '')) return;
    tab._mapHi = next; tab._mapSel = null; tab.render(true);
  });
  const groupPicker = groupSets.length ? ScopePicker.html(gid, {
    noun: 'group', nouns: 'groups', icon: 'fa-users', label: 'Group', allLabel: 'Pick a group',
    items: groupSets.map(({ g, ids }) => ({ id: g.id, name: g.name, color: g.color || 'var(--ncm-secret)', icon: 'fa-users', img: g.img || undefined, meta: `${ids.size} on the map` })),
  }) : '';
  const groupOn = hiGroup ? { name: hiGroup.g.name, n: hiGroup.ids.size, color: hiGroup.g.color || 'var(--ncm-secret)' } : null;

  const sel = tab._mapSel && (pcs.some((p) => p.actorId === tab._mapSel) || contacts.some((c) => c.id === tab._mapSel)) ? tab._mapSel : null;
  const view = mapView({
    pcs: pcs.map((p) => ({ id: p.actorId, name: p.name, initials: p.initials || getInitials(p.name) })),
    contacts: rows.map(({ c, knows }) => ({ id: c.id, name: c.name, hue: roleHue(c.role), knows,
      tip: `${c.name}${c.role ? ` — ${tab._roleLabel(c.role)}` : ''} · known by ${knows.length} of ${pcs.length}` })),
    sel, hi, framed: hiKey.startsWith('group:') ? hi : [],
  });

  const onMap = rows.filter((r) => r.knows.length);
  const dark = rows.filter((r) => !r.knows.length).map(({ c }) => ({ id: c.id, name: c.name, initials: getInitials(c.name), hue: tagHue(c.name), on: c.id === sel }));
  const roles = [...new Set(onMap.map((r) => r.c.role || ''))].map((r) => ({ label: r ? tab._roleLabel(r) : 'No role', hue: roleHue(r), n: onMap.filter((x) => (x.c.role || '') === r).length }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const fresh = tab._mapPanelFor !== (sel || null); tab._mapPanelFor = sel || null;

  return {
    on: true, empty: !pcs.length, noContacts: !contacts.length, uid: String(tab.scopeId?.('map') || 'map').replace(/[^a-z0-9_-]/gi, '-'),
    chips, groupPicker, groupOn, roles, view, dark,
    readout: {
      nodes: onMap.length, links: onMap.reduce((n, r) => n + r.knows.length, 0),
      several: rows.filter((r) => r.knows.length >= several).length, severalLabel: `Known by ${several}+`,
      one: rows.filter((r) => r.knows.length === 1).length, dark: dark.length,
      focus: focusReadout(sel, pcs, rows),
    },
    panel: { fresh, ...panelContext(tab, { sel, all, pcs, rows, mail, groupSets }) },
  };
}

function focusReadout(sel, pcs, rows) {
  if (!sel) return null;
  const pc = pcs.find((p) => p.actorId === sel);
  if (pc) { const mine = rows.filter((r) => r.knows.includes(sel)); return { label: pc.name, a: `${mine.length}`, aL: 'known', b: `${mine.filter((r) => r.knows.length === 1).length}`, bL: 'only them' }; }
  const r = rows.find((x) => x.c.id === sel);
  return r ? { label: r.c.name, a: `${r.knows.length}/${pcs.length}`, aL: 'know them' } : null;
}

function panelContext(tab, { sel, all, pcs, rows, mail, groupSets }) {
  if (!sel) return { legend: true };
  const pc = pcs.find((p) => p.actorId === sel);
  if (pc) {
    const mine = rows.filter((r) => r.knows.includes(pc.actorId));
    const only = mine.filter((r) => r.knows.length === 1).map((r) => ({ id: r.c.id, name: r.c.name }));
    const byRole = new Map();
    for (const r of mine) { const k = r.c.role || ''; if (!byRole.has(k)) byRole.set(k, []); byRole.get(k).push({ id: r.c.id, name: r.c.name }); }
    const svc = game.nightcity?.contactGroupService;
    let held = [];
    try { held = (svc?.getActorGroups?.(pc.actorId) ?? []).map((g) => ({ name: g.name, shared: !!g.sharedFrom, color: g.color || 'var(--ncm-secret)' })); } catch { held = []; }
    const missing = groupSets.map(({ g, ids }) => {
      const miss = [...ids].filter((id) => !rows.find((r) => r.c.id === id)?.knows.includes(pc.actorId))
        .map((id) => rows.find((r) => r.c.id === id)?.c.name).filter(Boolean);
      return { id: g.id, actorId: pc.actorId, name: g.name, n: miss.length, names: miss.join(', '), color: g.color || 'var(--ncm-secret)' };
    }).filter((x) => x.n);
    return {
      isPc: true, actorId: pc.actorId, name: pc.name, initials: pc.initials || getInitials(pc.name), img: pc.img || '', player: pc.player || '',
      known: mine.length, total: rows.length, onlyN: only.length, only,
      byRole: [...byRole.entries()].map(([r, list]) => ({ label: r ? tab._roleLabel(r) : 'No role', icon: r ? getRoleIcon(r) : 'fas fa-circle-question', hue: roleHue(r), list }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      held, missing,
    };
  }
  const row = rows.find((r) => r.c.id === sel);
  if (!row) return { legend: true };
  const c = row.c, m = mail?.byContact?.get(c.id);
  const last = m?.recent?.[0];
  const t = trustInfo(c.trust ?? 0);
  return {
    isContact: true, id: c.id, name: c.name, first: String(c.name).split(' ')[0], email: c.email || '',
    role: c.role ? { label: tab._roleLabel(c.role), icon: getRoleIcon(c.role), hue: roleHue(c.role) } : null,
    org: c.organization || '', hue: roleHue(c.role),
    trust: { label: t.label, color: t.color },
    knownN: row.knows.length, pcN: pcs.length,
    who: pcs.map((p) => {
      const k = row.knows.includes(p.actorId), own = c.relationships?.[p.actorId]?.trust;
      const ti = trustInfo(own != null ? own : (c.trust ?? 0));
      return { cid: c.id, actorId: p.actorId, name: p.name, initials: p.initials || getInitials(p.name), knows: k, trust: ti.label, color: ti.color, own: own != null };
    }),
    groups: groupSets.filter((x) => x.ids.has(c.id)).map(({ g }) => ({ name: g.name, color: g.color || 'var(--ncm-secret)' })),
    last: last ? { sent: !!last.sent, subject: last.subject, when: last.ts ? formatCyberDate(last.ts, { dateOnly: true }) : '' } : null,
    waiting: m?.waiting || 0,
    missingN: pcs.length - row.knows.length,
  };
}

/** Share one contact with every character who doesn't know them yet. */
export async function shareWithEveryone(tab, cid) {
  const pcs = tab._pcs();
  let n = 0;
  for (const p of pcs) {
    if (tab._knowsNow(cid, p.actorId)) continue;
    const r = await tab._setKnows(cid, p.actorId, true);
    if (r?.success !== false) n++;
  }
  ui.notifications.info(n ? `Shared with ${n} more character${n === 1 ? '' : 's'}.` : 'Everyone already knows them.');
}

/**
 * Hover is DOM-only (a re-render per mouse move would rebuild the whole panel): it lights the
 * hovered node's traces and dims the rest. Click is what changes the view (tabAct mapPick).
 */
/** The ROLES key is one button that opens a small list under it (over the map, so the row never moves).
 *  Closed by default; open/closed is remembered for this client's session and re-applied on every render. */
let keyOpen = false;
let keyCloser = null;
function wireMapKey(root) {
  const key = root?.querySelector?.('.ncm-ct2-mapkey');
  const btn = key?.querySelector('[data-mapkey-toggle]');
  if (!key || !btn) return;
  const paint = () => { key.classList.toggle('is-open', keyOpen); btn.setAttribute('aria-expanded', String(keyOpen)); };
  paint();
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); keyOpen = !keyOpen; paint(); });
  // A click anywhere else, or Esc, closes it. One document listener per page, re-pointed at the live key.
  if (keyCloser) { document.removeEventListener('pointerdown', keyCloser, true); document.removeEventListener('keydown', keyCloser, true); }
  keyCloser = (e) => {
    if (!keyOpen || !key.isConnected) return;
    if (e.type === 'keydown' ? e.key !== 'Escape' : key.contains(e.target)) return;
    keyOpen = false; paint();
  };
  document.addEventListener('pointerdown', keyCloser, true);
  document.addEventListener('keydown', keyCloser, true);
}

export function wireContactsMap(root) {
  wireMapKey(root);
  const svg = root?.querySelector?.('.ncm-ct2-map__svg');
  if (!svg || svg.dataset.wired) return;
  svg.dataset.wired = '1';
  let cur = null;
  const clear = () => {
    svg.classList.remove('is-hovering'); cur = null;
    svg.querySelectorAll('.is-hov').forEach((el) => el.classList.remove('is-hov'));
  };
  svg.addEventListener('pointerover', (e) => {
    const n = e.target.closest?.('[data-map-node]');
    if (!n) { if (svg.classList.contains('is-hovering')) clear(); return; }
    const id = n.dataset.mapNode;
    if (id === cur) return;
    clear(); cur = id;
    svg.classList.add('is-hovering');
    n.classList.add('is-hov');
    for (const tr of svg.querySelectorAll('[data-tr]')) {
      if (tr.dataset.contact === id || tr.dataset.pc === id) {
        tr.classList.add('is-hov');
        svg.querySelector(`[data-map-node="${CSS.escape(tr.dataset.contact === id ? tr.dataset.pc : tr.dataset.contact)}"]`)?.classList.add('is-hov');
      }
    }
    for (const b of svg.querySelectorAll('[data-bus]')) if (b.dataset.bus === id) b.classList.add('is-hov');
  });
  svg.addEventListener('pointerleave', clear);
  wireZoom(svg);
}

/** Zoom levels the − / + buttons step through (1 = the whole map fits the stage width). */
export const MAP_ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3, 4];
/** Smooth zoom range (wheel / pinch / double-click), 1 = Fit. */
export const MAP_ZOOM_MIN = 1;
export const MAP_ZOOM_MAX = 4;
/** Pure: clamp a zoom to the range. */
export const clampZoom = (z) => Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, Number(z) || 1));
/** Pure: the next button step above / below a (possibly in-between) zoom. */
export function stepZoom(z, dir) {
  if (dir > 0) return MAP_ZOOMS.find((x) => x > z + 1e-6) ?? MAP_ZOOM_MAX;
  return [...MAP_ZOOMS].reverse().find((x) => x < z - 1e-6) ?? MAP_ZOOM_MIN;
}
/**
 * Pure: where to scroll so the map point under (px, py) — viewport coords inside the scroller — stays under it
 * when the zoom goes from `from` to `to`.
 */
export function anchorScroll({ scrollLeft, scrollTop, px, py, from, to }) {
  const k = to / from;
  return { left: (scrollLeft + px) * k - px, top: (scrollTop + py) * k - py };
}

const _zoom = new Map();   // per map uid (panel vs pop-out), survives re-renders; DOM-only
const _left = new Map();   // horizontal pan per uid (the tab's scroll memo only keeps scrollTop)

/**
 * Navigation (2026-10-29, dev: "zoom in and out and drag and move and navigate"): the − / Fit / + buttons; the
 * mouse WHEEL zooms about the cursor; DRAG anywhere pans (a drag never counts as a click, so it never picks a
 * node); DOUBLE-CLICK zooms in on the spot; with the map focused, arrows pan, + / − zoom, 0 fits. All DOM-only:
 * the SVG is 100% × zoom wide inside its own scroller, and panning is that scroller's scroll position.
 */
function wireZoom(svg) {
  const scroller = svg.closest('.ncm-ct2-map__scroll'), stage = svg.closest('.ncm-ct2-map__stage');
  if (!scroller || !stage) return;
  const uid = svg.dataset.mapUid || 'map';
  const label = stage.querySelector('[data-map-zoom-label]');
  const zoomOf = () => _zoom.get(uid) || 1;
  const apply = (zIn, anchor = null) => {
    const old = zoomOf();
    const z = clampZoom(zIn);
    const px = anchor ? anchor.x : scroller.clientWidth / 2;
    const py = anchor ? anchor.y : scroller.clientHeight / 2;
    const want = anchorScroll({ scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop, px, py, from: old, to: z });
    _zoom.set(uid, z);
    scroller.style.setProperty('--ncm-map-zoom', String(z));
    if (label) label.textContent = z <= 1.0001 ? 'Fit' : `${Math.round(z * 100)}%`;
    stage.querySelector('[data-map-zoom="out"]')?.toggleAttribute('disabled', z <= MAP_ZOOM_MIN + 1e-6);
    stage.querySelector('[data-map-zoom="in"]')?.toggleAttribute('disabled', z >= MAP_ZOOM_MAX - 1e-6);
    scroller.classList.toggle('is-zoomed', z > 1.0001);
    if (z !== old) { scroller.scrollLeft = want.left; scroller.scrollTop = want.top; }
  };
  const at = (e) => { const r = scroller.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  // first paint: the remembered zoom + pan, no anchoring
  const z0 = zoomOf();
  _zoom.set(uid, z0); scroller.style.setProperty('--ncm-map-zoom', String(z0));
  apply(z0);
  scroller.scrollLeft = _left.get(uid) || 0;
  scroller.addEventListener('scroll', () => { _left.set(uid, scroller.scrollLeft); }, { passive: true });
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', 'Map — drag to move, wheel to zoom, arrows to pan');

  stage.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-map-zoom]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    if (btn.dataset.mapZoom === 'fit') return apply(1);
    return apply(stepZoom(zoomOf(), btn.dataset.mapZoom === 'in' ? 1 : -1));
  });

  // wheel: zoom about the cursor (a trackpad's small deltas zoom finely)
  scroller.addEventListener('wheel', (e) => {
    if (e.shiftKey) return;   // shift + wheel keeps scrolling sideways
    e.preventDefault();
    const f = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004);
    apply(zoomOf() * f, at(e));
  }, { passive: false });

  // drag to pan — the click that ends a drag is swallowed so it never picks a node
  let drag = null, swallow = false;
  scroller.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    drag = { x: e.clientX, y: e.clientY, l: scroller.scrollLeft, t: scroller.scrollTop, id: e.pointerId, moved: false };
    if (e.button === 1) e.preventDefault();
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; scroller.classList.add('is-panning'); try { scroller.setPointerCapture(e.pointerId); } catch { /* ok */ } }
    scroller.scrollLeft = drag.l - dx;
    scroller.scrollTop = drag.t - dy;
  });
  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    if (drag.moved) { swallow = true; setTimeout(() => { swallow = false; }, 0); }
    scroller.classList.remove('is-panning');
    try { scroller.releasePointerCapture(drag.id); } catch { /* ok */ }
    drag = null;
  };
  scroller.addEventListener('pointerup', end);
  scroller.addEventListener('pointercancel', end);
  scroller.addEventListener('click', (e) => { if (swallow) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } }, true);

  // double-click: zoom in on the spot (not on a node — that is a pick)
  scroller.addEventListener('dblclick', (e) => {
    if (e.target.closest?.('[data-map-node]')) return;
    e.preventDefault();
    apply(stepZoom(zoomOf(), 1), at(e));
  });

  // keyboard, while the map has focus
  scroller.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 160 : 60;
    switch (e.key) {
      case 'ArrowLeft': scroller.scrollLeft -= step; break;
      case 'ArrowRight': scroller.scrollLeft += step; break;
      case 'ArrowUp': scroller.scrollTop -= step; break;
      case 'ArrowDown': scroller.scrollTop += step; break;
      case '+': case '=': apply(stepZoom(zoomOf(), 1)); break;
      case '-': case '_': apply(stepZoom(zoomOf(), -1)); break;
      case '0': apply(1); break;
      default: return;
    }
    e.preventDefault(); e.stopPropagation();
  });
}
