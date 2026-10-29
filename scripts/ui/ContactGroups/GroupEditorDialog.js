/**
 * Group editor — name, colour, picture, members. One dialog for the player Contact
 * Manager and the Admin Contacts tab; only the member SOURCE differs.
 * @file scripts/ui/ContactGroups/GroupEditorDialog.js
 * @module night-city-messenger
 * @description A dialog holding the group's name, a colour swatch row, and the
 *   member list. The GM's Admin tab opens it as an adminDialog (admin preset +
 *   admin text size); the player Contact Manager passes `admin: false` and gets
 *   a playerDialog (Foundry look, zoomed by the player's own Text Size — the
 *   standing player-window rule), and the picker it opens follows suit.
 *   "Add members" opens showNamePicker in MULTI mode over the caller's source
 *   (the player's own contacts, or the GM's directory + player characters);
 *   members already in the group are greyed there, never offered twice.
 *   Resolves the edited group, or null when cancelled. Nothing is saved here —
 *   the caller owns the write (actor flag vs world setting).
 */
import { adminDialog, playerDialog } from '../../utils/adminTheme.js';
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
 * @param {boolean} [o.admin=true]  false = a player-facing dialog (player Text Size, Foundry look)
 * @returns {Promise<Object|null>} the edited group (unsaved), or null
 */
export async function editGroupDialog(group = {}, { memberSource, title, admin = true } = {}) {
  const openDialog = admin ? adminDialog : playerDialog;
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
    const dlg = openDialog({
      title: title || (isNew ? 'New Contact Group' : `Edit Group — ${draft.name}`),
      content: `
        <div class="ncm-cge">
          <label class="ncm-cge__lbl">Name</label>
          <input type="text" class="ncm-cge__name" value="${esc(draft.name)}" placeholder="The Crew" maxlength="60" autocomplete="off">
          <label class="ncm-cge__lbl">Colour</label>
          <div class="ncm-cge__swatches">${swatches}</div>
          <label class="ncm-cge__lbl">Picture <span class="ncm-cge__opt">optional — shows on the group's chips and when you message it</span></label>
          <div class="ncm-cge__pic">
            <span class="ncm-cge__face" style="--c:${draft.color}">${draft.img ? `<img src="${esc(draft.img)}" alt="">` : '<i class="fas fa-users"></i>'}</span>
            <input type="text" class="ncm-cge__img" value="${esc(draft.img)}" placeholder="an image path or URL" autocomplete="off">
            <button type="button" class="ncm-cge__add" data-browse-img><i class="fas fa-folder-open"></i> Browse</button>
            <button type="button" class="ncm-cge__add ncm-cge__clear" data-clear-img data-tooltip="No picture"${draft.img ? '' : ' hidden'}><i class="fas fa-xmark"></i></button>
          </div>
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
            draft.img = root.querySelector('.ncm-cge__img')?.value?.trim() || '';
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
          root.querySelector('.ncm-cge__face')?.style.setProperty('--c', draft.color);
        }));
        // the picture: a path box, the FilePicker (a player without file-browser rights can still paste a path), a live preview
        const imgIn = root.querySelector('.ncm-cge__img');
        const face = root.querySelector('.ncm-cge__face');
        const clear = root.querySelector('[data-clear-img]');
        const paintFace = () => {
          const v = imgIn?.value?.trim();
          if (face) face.innerHTML = v ? `<img src="${esc(v)}" alt="">` : '<i class="fas fa-users"></i>';
          if (clear) clear.hidden = !v;
        };
        imgIn?.addEventListener('input', paintFace);
        clear?.addEventListener('click', () => { if (imgIn) imgIn.value = ''; paintFace(); });
        root.querySelector('[data-browse-img]')?.addEventListener('click', () => {
          const FP = (typeof FilePicker !== 'undefined') ? FilePicker : foundry.applications?.apps?.FilePicker;
          try {
            if (FP) new FP({ type: 'image', current: imgIn?.value || '', callback: (path) => { if (imgIn) { imgIn.value = path; paintFace(); } } }).render(true);
          } catch (err) { ui.notifications.warn('You can\'t browse files here — paste an image path or URL instead.'); }
        });
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
            admin,
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
