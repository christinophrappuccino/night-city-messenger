/**
 * Group editor — name, colour, members. One dialog for the player Contact
 * Manager and the Admin Contacts tab; only the member SOURCE differs.
 * @file scripts/ui/ContactGroups/GroupEditorDialog.js
 * @module night-city-messenger
 * @description An adminDialog (admin-preset themed, like the shared picker it
 *   opens) holding the group's name, a colour swatch row, and the member list.
 *   "Add members" opens showNamePicker in MULTI mode over the caller's source
 *   (the player's own contacts, or the GM's directory + player characters);
 *   members already in the group are greyed there, never offered twice.
 *   Resolves the edited group, or null when cancelled. Nothing is saved here —
 *   the caller owns the write (actor flag vs world setting).
 */
import { adminDialog } from '../../utils/adminTheme.js';
import { showNamePicker } from '../../utils/namePicker.js';
import { GROUP_COLORS, sanitizeGroup } from '../../services/ContactGroupService.js';
import { memberKey } from '../../utils/participants.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {Object} group                       existing group, or {} for a new one
 * @param {Object} o
 * @param {() => Promise<Array<{id: string, name: string, img?: string, sub?: string, group?: string, note?: string, member: Object}>>} o.memberSource
 *        the pickable people; each entry carries the member record it stands for
 * @param {string} [o.title]
 * @returns {Promise<Object|null>} the edited group (unsaved), or null
 */
export async function editGroupDialog(group = {}, { memberSource, title } = {}) {
  const draft = sanitizeGroup({ ...group, id: group.id });
  if (!group.name) draft.name = '';
  const isNew = !group.id;

  const memberRow = (m) => `
    <div class="ncm-cge__member" data-key="${esc(memberKey(m))}">
      <span class="ncm-cge__member-name">${esc(m.name || m.email || '?')}</span>
      <span class="ncm-cge__member-sub">${esc(m.email || (m.hint?.actorId ? 'character' : m.hint?.contactId ? 'directory entry' : 'no address'))}</span>
      <button type="button" class="ncm-cge__member-x" data-remove title="Remove"><i class="fas fa-xmark"></i></button>
    </div>`;
  const swatches = GROUP_COLORS.map(c => `<button type="button" class="ncm-cge__swatch${c === draft.color ? ' is-on' : ''}" data-color="${c}" style="--c:${c}" title="${c}"></button>`).join('');

  return new Promise((resolve) => {
    let result = null;
    const dlg = adminDialog({
      title: title || (isNew ? 'New Contact Group' : `Edit Group — ${draft.name}`),
      content: `
        <div class="ncm-cge">
          <label class="ncm-cge__lbl">Name</label>
          <input type="text" class="ncm-cge__name" value="${esc(draft.name)}" placeholder="The Crew" maxlength="60" autocomplete="off">
          <label class="ncm-cge__lbl">Colour</label>
          <div class="ncm-cge__swatches">${swatches}</div>
          <div class="ncm-cge__members-head">
            <label class="ncm-cge__lbl">Members <b class="ncm-cge__count">${draft.members.length}</b></label>
            <button type="button" class="ncm-cge__add" data-add><i class="fas fa-user-plus"></i> Add members</button>
          </div>
          <div class="ncm-cge__members">${draft.members.map(memberRow).join('') || '<div class="ncm-cge__empty">No one yet — add members to message them all at once.</div>'}</div>
          <label class="ncm-cge__lbl">Note <span class="ncm-cge__opt">optional</span></label>
          <input type="text" class="ncm-cge__note" value="${esc(draft.note)}" placeholder="What this group is for" maxlength="400" autocomplete="off">
        </div>`,
      buttons: {
        save: {
          label: '<i class="fas fa-check"></i> Save',
          callback: (html) => {
            const root = html[0] ?? html;
            draft.name = root.querySelector('.ncm-cge__name')?.value?.trim() || '';
            draft.note = root.querySelector('.ncm-cge__note')?.value?.trim() || '';
            result = sanitizeGroup(draft);
            if (!draft.name) result.name = 'Untitled group';
          },
        },
        cancel: { label: 'Cancel' },
      },
      default: 'save',
      render: (html) => {
        const root = html[0] ?? html;
        const list = root.querySelector('.ncm-cge__members');
        const count = root.querySelector('.ncm-cge__count');
        const repaint = () => {
          list.innerHTML = draft.members.map(memberRow).join('') || '<div class="ncm-cge__empty">No one yet — add members to message them all at once.</div>';
          if (count) count.textContent = String(draft.members.length);
        };
        root.querySelectorAll('.ncm-cge__swatch').forEach(b => b.addEventListener('click', () => {
          draft.color = b.dataset.color;
          root.querySelectorAll('.ncm-cge__swatch').forEach(x => x.classList.toggle('is-on', x === b));
        }));
        list.addEventListener('click', (ev) => {
          const x = ev.target.closest('[data-remove]');
          if (!x) return;
          const key = x.closest('.ncm-cge__member')?.dataset.key;
          draft.members = draft.members.filter(m => memberKey(m) !== key);
          repaint();
        });
        root.querySelector('[data-add]')?.addEventListener('click', async () => {
          let entries = [];
          try { entries = (await memberSource?.()) || []; } catch (err) { console.warn('NCM | group member source failed', err); }
          const taken = new Set(draft.members.map(memberKey));
          const picks = await showNamePicker({
            title: 'Add members',
            hint: 'Pick everyone who belongs in this group.',
            entries: entries.map(e => ({ ...e, id: e.id || memberKey(e.member) })),
            taken: new Set(entries.filter(e => taken.has(memberKey(e.member))).map(e => e.id || memberKey(e.member))),
            takenLabel: 'in group',
            multi: true,
            placeholder: 'search people or folders…',
            emptyText: 'no one to add',
          });
          if (!Array.isArray(picks) || !picks.length) return;
          const byId = new Map(entries.map(e => [e.id || memberKey(e.member), e.member]));
          for (const p of picks) {
            const m = byId.get(p.id);
            if (m && !draft.members.some(x => memberKey(x) === memberKey(m))) draft.members.push(m);
          }
          repaint();
        });
        setTimeout(() => root.querySelector('.ncm-cge__name')?.focus(), 30);
      },
      close: () => resolve(result),
    }, { classes: ['ncm-cge-dialog'], width: 460 });
    dlg.render(true);
  });
}
