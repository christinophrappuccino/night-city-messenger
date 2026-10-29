/**
 * Role Manager
 * @file scripts/ui/GMContactManager/RoleManagerDialog.js
 * @module night-city-messenger
 * @description The GM's role table, in one window that never closes on you
 *   (dev-approved mock dev/mockups/admin-roles-filter-mock.html, frame A).
 *   Left: every role — search, Built-in / Custom / In use chips, how many contacts
 *   use each. Right: the selected role. A custom role is edited in place (name,
 *   colour from the admin palette or any hex, a searchable icon grid, a preview);
 *   a built-in role is read-only, shows who uses it, and offers a custom copy.
 *
 *   It is a v1 Dialog (body-mounted, admin-themed via adminDialog) whose content
 *   is re-painted in place — the old version closed and reopened itself on every
 *   click, which flashed and lost its scroll. Service layer:
 *   MasterContactService.getCustomRoles / addCustomRole / updateCustomRole / deleteCustomRole.
 *   CSS: styles/components/role-manager.css (`ncm-rmgr-*`).
 */

import { log } from '../../utils/helpers.js';
import { adminDialog, adminConfirm } from '../../utils/adminTheme.js';
import { BUILT_IN_ROLES } from '../../utils/contactVocab.js';

/** The admin palette a custom role can wear (tokens follow the admin preset). */
export const ROLE_PALETTE = [
  'var(--ncm-hue-1)', 'var(--ncm-hue-2)', 'var(--ncm-hue-3)', 'var(--ncm-hue-4)',
  'var(--ncm-hue-5)', 'var(--ncm-hue-6)', 'var(--ncm-hue-7)', 'var(--ncm-hue-8)',
  'var(--ncm-good)', 'var(--ncm-attn)', 'var(--ncm-bad)', 'var(--ncm-money)',
];

/** Curated FA6-free solid glyphs (an invalid class renders an empty square). */
export const ROLE_ICONS = [
  'crosshairs', 'terminal', 'gear', 'briefcase', 'shield-halved', 'guitar', 'syringe', 'podcast',
  'truck-monster', 'building-columns', 'staff-snake', 'users-line', 'user', 'landmark', 'microchip',
  'jet-fighter', 'box-open', 'satellite-dish', 'ghost', 'skull', 'binoculars', 'bolt-lightning', 'car',
  'hand-fist', 'mask', 'money-bill-wave', 'bomb', 'robot', 'wand-magic-sparkles', 'flask', 'warehouse',
  'helicopter', 'handshake', 'crown', 'eye', 'fire', 'gun', 'anchor', 'dragon', 'user-secret', 'user-tie',
  'tag', 'person', 'star', 'heart', 'scale-balanced', 'gavel', 'hammer', 'wrench', 'motorcycle', 'plane', 'ship',
  'church', 'graduation-cap', 'microphone', 'camera', 'newspaper', 'people-group', 'person-rifle',
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (l) => (/s$/i.test(l) ? l : `${l}s`);

export class RoleManagerDialog {
  _svc = null;
  _dialog = null;
  _root = null;
  _sel = null;          // selected role id
  _isNew = false;
  _q = '';
  _chip = 'all';        // all | builtin | custom | used
  _iq = '';
  _draft = null;        // { label, icon, color } for the custom role being edited
  _busy = false;

  constructor(masterContactService) {
    this._svc = masterContactService;
  }

  async open(selectId = null) {
    this._sel = selectId;
    const self = this;
    this._dialog = adminDialog({
      title: 'Role Manager',
      content: '<div class="ncm-rmgr" data-rmgr></div>',
      buttons: { close: { icon: '<i class="fas fa-times"></i>', label: 'Close' } },
      default: 'close',
      render: (html) => {
        self._root = (html?.[0] ?? html)?.querySelector?.('[data-rmgr]')
          ?? (html?.[0] ?? html)?.closest?.('.app')?.querySelector?.('[data-rmgr]');
        self._wire();
        self._paint();
      },
      close: () => { self._root = null; },
    }, { classes: ['ncm-app', 'ncm-rmgr-dialog'], width: 700, height: 'auto', resizable: true });
    this._dialog.render(true);
  }

  // ─── data ───────────────────────────────────────────────

  _roles() {
    const contacts = this._svc?.getAll?.() || [];
    const usersOf = (id) => contacts.filter((c) => String(c.role || '').toLowerCase() === id).map((c) => c.name).sort((a, b) => a.localeCompare(b));
    const custom = (this._svc?.getCustomRoles?.() || []).map((r) => ({ id: r.id, label: r.label, icon: r.icon || 'tag', color: r.color || 'var(--ncm-hue-6)', builtin: false }));
    const builtin = Object.entries(BUILT_IN_ROLES).map(([id, r]) => ({ id, label: r.label, icon: r.icon, color: r.color, builtin: true }));
    return [...custom, ...builtin].map((r) => { const who = usersOf(r.id); return { ...r, who, n: who.length }; });
  }

  // ─── paint ──────────────────────────────────────────────

  _paint() {
    const root = this._root;
    if (!root) return;
    const keepList = root.querySelector('.ncm-rmgr__rows')?.scrollTop ?? 0;
    const keepEd = root.querySelector('.ncm-rmgr__ed')?.scrollTop ?? 0;
    const roles = this._roles();
    if (!this._isNew && !roles.some((r) => r.id === this._sel)) this._sel = roles[0]?.id ?? null;
    const q = this._q.trim().toLowerCase();
    const pass = (r) => (!q || r.label.toLowerCase().includes(q) || r.id.includes(q))
      && (this._chip === 'all' || (this._chip === 'builtin' ? r.builtin : this._chip === 'custom' ? !r.builtin : r.n > 0));
    const list = roles.filter(pass);
    const counts = { all: roles.length, builtin: roles.filter((r) => r.builtin).length, custom: roles.filter((r) => !r.builtin).length, used: roles.filter((r) => r.n).length };
    const row = (r) => `<div class="ncm-rmgr__r${this._sel === r.id && !this._isNew ? ' is-sel' : ''}" data-rsel="${esc(r.id)}" style="--rc:${esc(r.color)}" role="button" tabindex="0">
        <span class="ncm-rmgr__ic"><i class="fas fa-${esc(r.icon)}"></i></span>
        <span class="ncm-rmgr__nmw"><span class="ncm-rmgr__nm">${esc(r.label)}</span><span class="ncm-rmgr__sub${r.n ? '' : ' is-zero'}">${r.n ? `${r.n} contact${r.n === 1 ? '' : 's'}` : 'not used'}</span></span>
        <span class="ncm-rmgr__lock">${r.builtin ? '<i class="fas fa-lock"></i>' : ''}</span></div>`;
    const grp = (b) => list.filter((r) => r.builtin === b);
    const gh = (b) => grp(b).length ? `<div class="ncm-rmgr__gh">${b ? '<i class="fas fa-lock"></i>Built-in' : 'Custom'}<span class="n">${grp(b).length}</span></div>${grp(b).map(row).join('')}` : '';

    root.innerHTML = `
      <div class="ncm-rmgr__head"><i class="fas fa-user-tag"></i>Roles <span>${counts.all} · ${counts.custom} custom</span></div>
      <div class="ncm-rmgr__body">
        <div class="ncm-rmgr__list">
          <div class="ncm-rmgr__tools">
            <label class="ncm-rmgr__srch"><i class="fas fa-magnifying-glass"></i><input type="text" placeholder="Find a role…" value="${esc(this._q)}" data-rq></label>
            <div class="ncm-rmgr__chips">${[['all', 'All'], ['builtin', 'Built-in'], ['custom', 'Custom'], ['used', 'In use']].map(([k, l]) => `<span class="ncm-rmgr__chip${this._chip === k ? ' is-on' : ''}" data-rchip="${k}">${l}<span class="n">${counts[k]}</span></span>`).join('')}</div>
          </div>
          <div class="ncm-rmgr__rows">${gh(false)}${gh(true)}${list.length ? '' : '<div class="ncm-rmgr__empty">No role matches.</div>'}</div>
          <button type="button" class="ncm-rmgr__btn ncm-rmgr__new" data-rnew><i class="fas fa-plus"></i> New role</button>
        </div>
        <div class="ncm-rmgr__ed">${this._editorHtml(roles)}</div>
      </div>`;
    const rows = root.querySelector('.ncm-rmgr__rows'); if (rows) rows.scrollTop = keepList;
    const ed = root.querySelector('.ncm-rmgr__ed'); if (ed) ed.scrollTop = keepEd;
  }

  _preview(d) {
    return `<div class="ncm-rmgr__pv" style="--rc:${esc(d.color)}">
      <span class="ncm-rmgr__tag"><i class="fas fa-${esc(d.icon)}"></i>${esc(d.label || 'Role')}</span><span class="cap">on a contact</span>
      <span class="ncm-rmgr__band"><i class="fas fa-${esc(d.icon)}"></i>${esc(plural(d.label || 'Role'))}</span><span class="cap">as a Directory group</span></div>`;
  }

  _who(r) {
    return `<div><div class="ncm-rmgr__lbl">Used by <small>${r.n} contact${r.n === 1 ? '' : 's'}</small></div>
      <div class="ncm-rmgr__who">${r.who.map((w) => `<span>${esc(w)}</span>`).join('') || '<i>nobody yet</i>'}</div></div>`;
  }

  _editorHtml(roles) {
    const cur = this._isNew ? { id: '', label: '', icon: 'user', color: 'var(--ncm-hue-6)', n: 0, who: [] } : roles.find((r) => r.id === this._sel);
    if (!cur) return '<div class="ncm-rmgr__empty">Pick a role, or make a new one.</div>';
    if (cur.builtin) {
      return `<h4 class="ncm-rmgr__h"><span class="ncm-rmgr__ic" style="--rc:${esc(cur.color)}"><i class="fas fa-${esc(cur.icon)}"></i></span>${esc(cur.label)} <small>built-in</small></h4>
        <div class="ncm-rmgr__ro"><i class="fas fa-lock"></i> Built-in roles come with the module and can't be renamed or recoloured. Make a custom copy if you need a variant.</div>
        <div><div class="ncm-rmgr__lbl">Looks like</div>${this._preview(cur)}</div>
        ${this._who(cur)}
        <div class="ncm-rmgr__foot"><span class="grow"></span><button type="button" class="ncm-rmgr__btn ncm-rmgr__btn--q" data-rdup><i class="fas fa-copy"></i> Make a custom copy</button></div>`;
    }
    if (!this._draft) this._draft = { label: cur.label, icon: cur.icon, color: cur.color };
    const d = this._draft;
    const isHex = /^#[0-9a-f]{6}$/i.test(d.color);
    const iq = this._iq.trim().toLowerCase();
    const icons = ROLE_ICONS.includes(d.icon) ? ROLE_ICONS : [d.icon, ...ROLE_ICONS];
    return `<h4 class="ncm-rmgr__h"><span class="ncm-rmgr__ic" style="--rc:${esc(d.color)}"><i class="fas fa-${esc(d.icon)}"></i></span><span data-rhead>${esc(this._isNew ? 'New role' : (d.label || 'Untitled'))}</span> <small>${this._isNew ? 'not saved yet' : 'custom'}</small></h4>
      <div><div class="ncm-rmgr__lbl">Name</div><input type="text" class="ncm-rmgr__inp" value="${esc(d.label)}" placeholder="e.g. Smuggler" data-rname></div>
      <div><div class="ncm-rmgr__lbl">Colour <small>from the theme, or pick any</small></div>
        <div class="ncm-rmgr__sw">${ROLE_PALETTE.map((c) => `<span style="--c:${c}" data-rcol="${c}" class="${d.color === c ? 'is-on' : ''}" title="Theme colour"></span>`).join('')}
          <input type="color" value="${isHex ? d.color : '#8a9cf0'}" data-rhex title="Any colour"><span class="hex">${isHex ? esc(d.color) : 'theme'}</span></div></div>
      <div><div class="ncm-rmgr__lbl">Icon</div>
        <label class="ncm-rmgr__srch"><i class="fas fa-magnifying-glass"></i><input type="text" placeholder="Find an icon…" value="${esc(this._iq)}" data-iq></label>
        <div class="ncm-rmgr__ig" style="--rc:${esc(d.color)}">${icons.filter((i) => !iq || i.includes(iq)).map((i) => `<span class="${d.icon === i ? 'is-on' : ''}" data-ric="${esc(i)}" title="${esc(i)}"><i class="fas fa-${esc(i)}"></i></span>`).join('') || '<em>No icon matches.</em>'}</div></div>
      <div><div class="ncm-rmgr__lbl">Looks like</div><div data-rpv>${this._preview(d)}</div></div>
      ${this._isNew ? '' : this._who(cur)}
      <div class="ncm-rmgr__foot">${this._isNew ? '' : `<button type="button" class="ncm-rmgr__btn ncm-rmgr__btn--bad" data-rdel><i class="fas fa-trash"></i> Delete${cur.n ? ` (${cur.n} use it)` : ''}</button>`}
        <span class="grow"></span><button type="button" class="ncm-rmgr__btn ncm-rmgr__btn--q" data-rcancel>Cancel</button>
        <button type="button" class="ncm-rmgr__btn ncm-rmgr__btn--solid" data-rsave><i class="fas fa-check"></i> ${this._isNew ? 'Create role' : 'Save'}</button></div>`;
  }

  /** Repaint just the bits a typed name/colour changes, so the input keeps focus. */
  _repaintDraft() {
    const root = this._root, d = this._draft;
    if (!root || !d) return;
    const pv = root.querySelector('[data-rpv]'); if (pv) pv.innerHTML = this._preview(d);
    const head = root.querySelector('[data-rhead]'); if (head && !this._isNew) head.textContent = d.label || 'Untitled';
  }

  // ─── events (delegated once on the stable root) ────────

  _wire() {
    const root = this._root;
    if (!root) return;
    root.addEventListener('click', (e) => this._onClick(e));
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-rsel]')) { e.preventDefault(); this._select(e.target.closest('[data-rsel]').dataset.rsel); }
      if (e.key === 'Enter' && e.target.matches('[data-rname]')) { e.preventDefault(); this._save(); }
    });
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('[data-rq]')) { this._q = t.value; this._paintKeepFocus('[data-rq]'); }
      else if (t.matches('[data-iq]')) { this._iq = t.value; this._paintKeepFocus('[data-iq]'); }
      else if (t.matches('[data-rname]')) { this._draft.label = t.value; this._repaintDraft(); }
      else if (t.matches('[data-rhex]')) { this._draft.color = t.value; this._repaintDraft(); this._paintSwatches(); }
    });
    root.addEventListener('change', (e) => { if (e.target.matches('[data-rhex]')) this._paintKeepFocus(); });
  }

  _paintKeepFocus(sel) {
    const el = sel && this._root?.querySelector(sel);
    const pos = el?.selectionStart;
    this._paint();
    if (sel) { const n = this._root?.querySelector(sel); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ok */ } } }
  }

  _paintSwatches() {
    const root = this._root, d = this._draft;
    root?.querySelectorAll('[data-rcol]').forEach((s) => s.classList.toggle('is-on', s.dataset.rcol === d.color));
    const hex = root?.querySelector('.ncm-rmgr__sw .hex'); if (hex) hex.textContent = /^#/.test(d.color) ? d.color : 'theme';
    root?.querySelectorAll('.ncm-rmgr__h .ncm-rmgr__ic, .ncm-rmgr__ig').forEach((el) => el.style.setProperty('--rc', d.color));
  }

  _dirty() {
    if (!this._draft) return false;
    if (this._isNew) return !!this._draft.label.trim();
    const cur = this._roles().find((r) => r.id === this._sel);
    return !!cur && !cur.builtin && (cur.label !== this._draft.label || cur.icon !== this._draft.icon || cur.color !== this._draft.color);
  }

  async _select(id) {
    if (id === this._sel && !this._isNew) return;
    if (this._dirty() && !(await adminConfirm({ title: 'Unsaved changes', content: '<p>Leave this role without saving your changes?</p>' }))) return;
    this._sel = id; this._isNew = false; this._draft = null; this._iq = '';
    this._paint();
  }

  async _onClick(e) {
    const t = e.target;
    const sel = t.closest('[data-rsel]'); if (sel) return this._select(sel.dataset.rsel);
    const chip = t.closest('[data-rchip]'); if (chip) { this._chip = chip.dataset.rchip; return this._paint(); }
    if (t.closest('[data-rnew]')) {
      if (this._dirty() && !(await adminConfirm({ title: 'Unsaved changes', content: '<p>Start a new role without saving your changes?</p>' }))) return;
      this._isNew = true; this._draft = { label: '', icon: 'user', color: 'var(--ncm-hue-6)' }; this._iq = '';
      this._paint(); this._root?.querySelector('[data-rname]')?.focus(); return;
    }
    const col = t.closest('[data-rcol]'); if (col) { this._draft.color = col.dataset.rcol; this._repaintDraft(); return this._paintSwatches(); }
    const ic = t.closest('[data-ric]'); if (ic) {
      this._draft.icon = ic.dataset.ric;
      this._root.querySelectorAll('[data-ric]').forEach((s) => s.classList.toggle('is-on', s === ic));
      const hi = this._root.querySelector('.ncm-rmgr__h .ncm-rmgr__ic i'); if (hi) hi.className = `fas fa-${this._draft.icon}`;
      return this._repaintDraft();
    }
    if (t.closest('[data-rcancel]')) { this._isNew = false; this._draft = null; return this._paint(); }
    if (t.closest('[data-rsave]')) return this._save();
    if (t.closest('[data-rdel]')) return this._delete();
    if (t.closest('[data-rdup]')) {
      const cur = this._roles().find((r) => r.id === this._sel);
      if (!cur) return;
      this._isNew = true; this._draft = { label: `${cur.label} (custom)`, icon: cur.icon, color: cur.color }; this._iq = '';
      this._paint(); const n = this._root?.querySelector('[data-rname]'); n?.focus(); n?.select(); return;
    }
  }

  async _save() {
    if (this._busy || !this._draft) return;
    const d = this._draft;
    if (!d.label.trim()) { ui.notifications.warn('A role needs a name.'); return; }
    this._busy = true;
    try {
      const res = this._isNew
        ? await this._svc.addCustomRole({ label: d.label, icon: d.icon, color: d.color })
        : await this._svc.updateCustomRole(this._sel, { label: d.label, icon: d.icon, color: d.color });
      if (!res?.success) { ui.notifications.warn(res?.error || 'Could not save the role.'); return; }
      if (this._isNew) this._sel = res.role?.id ?? this._sel;
      ui.notifications.info(`Role "${d.label.trim()}" ${this._isNew ? 'created' : 'saved'}.`);
      this._isNew = false; this._draft = null;
      this._paint();
    } catch (err) {
      log.error('RoleManager save failed:', err);
      ui.notifications.error('Could not save the role — see the console.');
    } finally { this._busy = false; }
  }

  async _delete() {
    const cur = this._roles().find((r) => r.id === this._sel);
    if (!cur || cur.builtin) return;
    const ok = await adminConfirm({
      title: 'Delete role',
      content: `<p>Delete <b>${esc(cur.label)}</b>?</p>${cur.n ? `<p>${cur.n} contact${cur.n === 1 ? '' : 's'} will lose this role: ${esc(cur.who.slice(0, 8).join(', '))}${cur.n > 8 ? '…' : ''}.</p>` : '<p>No contact uses it.</p>'}`,
    });
    if (!ok) return;
    const res = await this._svc.deleteCustomRole(cur.id);
    if (!res?.success) { ui.notifications.warn(res?.error || 'Could not delete the role.'); return; }
    ui.notifications.info(`Role "${cur.label}" deleted${res.affectedContacts ? ` — cleared from ${res.affectedContacts} contact(s)` : ''}.`);
    this._sel = null; this._draft = null;
    this._paint();
  }
}
