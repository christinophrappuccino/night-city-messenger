/**
 * Network nodes — the GM's add / edit dialog.
 * @file scripts/ui/NetworkNodes/NodeDialogs.js
 * @module night-city-messenger
 *
 * One themed admin dialog (the placement dialog's look, `ncm-plc-*`): name, kind, the scene it stands on, where on
 * that scene in words, and the switches (hidden, discoverable, show traffic) plus optional flavour lines for the
 * console ticker. Resolves the edited node UNSAVED (or null); the caller writes it through NetworkService.saveNode.
 */

import { adminDialog } from '../../utils/adminTheme.js';
import { THEMED_DIALOG_CLASSES } from '../../utils/dialogBody.js';
import { showNamePicker, documentEntries } from '../../utils/namePicker.js';
import { NODE_KINDS, sanitizeNode, nodeHex } from '../../utils/networkNodes.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Pure markup for the dialog (the sim renders it). */
export function nodeEditHtml(node, { networkName = '', networkColor = '', sceneName = '' } = {}) {
  const n = sanitizeNode(node);
  const k = NODE_KINDS[n.kind];
  const kinds = Object.entries(NODE_KINDS).map(([key, v]) =>
    `<button type="button" class="ncm-nde__kind${key === n.kind ? ' is-on' : ''}" data-v="${key}" aria-pressed="${key === n.kind}"><i class="${v.icon}"></i><span>${esc(v.label)}</span></button>`).join('');
  const sw = (name, on, icon, label, hint) => `<label class="ncm-nde__sw"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span class="ncm-nde__swtx"><b><i class="fas ${icon}"></i>${esc(label)}</b><small>${esc(hint)}</small></span><span class="ncm-nde__tg" aria-hidden="true"></span></label>`;
  return `<div class="ncm-plc ncm-nde">
  <div class="ncm-dlgb__hd">
    <span class="ncm-dlgb__ico" style="${networkColor ? `color:${esc(networkColor)}` : ''}"><i class="${k.icon}" data-nde-icon></i></span>
    <span class="ncm-dlgb__nm"><b data-nde-title>${esc(n.name || k.label)}</b><small>${esc(networkName)}${n.id ? ` · ${esc(nodeHex(n.id))}` : ''}</small></span>
    <span class="ncm-dlgb__kind">Node</span>
  </div>
  <div class="ncm-plc__bd">
    <div class="ncm-plc__row"><span class="ncm-plc__k"><i class="fas fa-tag"></i>Name</span><input type="text" name="name" value="${esc(n.name)}" placeholder="e.g. Kabuki relay mast" autocomplete="off"></div>
    <div class="ncm-plc__row"><span class="ncm-plc__k"><i class="fas fa-microchip"></i>Kind</span><div class="ncm-nde__kinds" data-nde-kinds>${kinds}</div></div>
    <div class="ncm-plc__row"><span class="ncm-plc__k"><i class="fas fa-map"></i>Scene</span>
      <span class="ncm-plc__scene"><b data-plc-scene-name>${esc(sceneName || 'Pick a scene')}</b><button type="button" class="ncm-plc__link" data-plc-pick-scene><i class="fas fa-repeat"></i>${n.sceneId ? 'Change' : 'Pick'}</button></span>
      <input type="hidden" name="sceneId" value="${esc(n.sceneId)}"></div>
    <div class="ncm-plc__row"><span class="ncm-plc__k"><i class="fas fa-location-dot"></i>Where on it</span><input type="text" name="place" value="${esc(n.place)}" placeholder="e.g. rooftop, 4th &amp; Kabuki" autocomplete="off"></div>
    <div class="ncm-plc__row"><span class="ncm-plc__k"><i class="fas fa-plug"></i>Jack-in DV</span>
      <span class="ncm-plc__num"><input type="number" name="jackDV" min="0" max="40" step="1" value="${n.override?.dv ?? ''}" placeholder="—"><span>blank = the Jacking in rules (Admin → Security → Hacking rules)</span></span></div>
    <div class="ncm-nde__sws ncm-nde__sws--4">
      ${sw('boxLocked', !!n.security?.requiresAuth, 'fa-lock', 'Box locked', 'Players must jack in to switch it')}
      ${sw('hidden', n.hidden, 'fa-eye-slash', 'Hidden', 'Players can\'t see it until you reveal it')}
      ${sw('discoverable', n.discoverable, 'fa-magnifying-glass', 'Discoverable', 'A scan could find it (scan rules come later)')}
      ${sw('showTraffic', n.showTraffic, 'fa-wave-square', 'Show traffic', 'Its console shows packets going over it')}
    </div>
    <label class="ncm-nde__fl"><span class="ncm-plc__k"><i class="fas fa-terminal"></i>Flavour lines</span>
      <textarea name="flavour" rows="3" placeholder="One per line — mixed into its console ticker (call signs, keepalives…)">${esc(n.flavour.join('\n'))}</textarea></label>
    <p class="ncm-plc__hint">While it is up, ${esc(networkName || 'the network')} reaches its scene${n.sceneId ? '' : ' (once it has one)'}, even one you never wired it to. When every one of its nodes there is down, it doesn't.</p>
  </div>
</div>`;
}

/** Read the dialog back into a node patch (pure over the element it is handed). */
export function readNodeEdit(root, base = {}) {
  const v = (n) => root.querySelector(`[name="${n}"]`);
  return sanitizeNode({
    ...base,
    name: v('name')?.value,
    kind: root.querySelector('[data-nde-kinds] .is-on')?.dataset.v,
    sceneId: v('sceneId')?.value,
    place: v('place')?.value,
    hidden: !!v('hidden')?.checked,
    discoverable: !!v('discoverable')?.checked,
    showTraffic: !!v('showTraffic')?.checked,
    flavour: String(v('flavour')?.value || '').split(/\r?\n/),
    security: { ...(base.security || {}), requiresAuth: !!v('boxLocked')?.checked },
    override: { ...(base.override || {}), dv: Number(v('jackDV')?.value) > 0 ? Math.round(Number(v('jackDV').value)) : null },
  });
}

/**
 * Open the dialog. @returns {Promise<object|null>} the edited node, unsaved
 * @param {object} node — an existing node, or { networkId } for a new one
 * @param {object} network
 */
export function editNodeDialog(node, network) {
  let sceneName = node?.sceneId ? (game.scenes.get(node.sceneId)?.name || '') : '';
  const content = nodeEditHtml(node, { networkName: network?.name || '', networkColor: network?.theme?.color || '', sceneName });
  return new Promise((resolve) => {
    let out = null;
    const dlg = adminDialog({
      title: node?.id ? 'Edit node' : 'Add a node',
      content,
      buttons: {
        cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
        save: { icon: '<i class="fas fa-check"></i>', label: node?.id ? 'Save' : 'Add node', callback: (html) => { out = readNodeEdit(html[0] ?? html, node); } },
      },
      default: 'save',
      render: (html) => {
        const root = html[0] ?? html;
        root.querySelector('[data-nde-kinds]')?.addEventListener('click', (e) => {
          const b = e.target.closest('.ncm-nde__kind'); if (!b) return;
          root.querySelectorAll('.ncm-nde__kind').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
          root.querySelector('[data-nde-icon]')?.setAttribute('class', NODE_KINDS[b.dataset.v].icon);
        });
        const nm = root.querySelector('[name="name"]');
        nm?.addEventListener('input', () => { root.querySelector('[data-nde-title]').textContent = nm.value || 'Node'; });
        root.querySelector('[data-plc-pick-scene]')?.addEventListener('click', async () => {
          const cur = root.querySelector('[name="sceneId"]').value;
          const pick = await showNamePicker({ title: 'Which scene is it on?', entries: documentEntries(game.scenes.contents, { fallbackImg: 'icons/svg/village.svg' }), selected: cur, placeholder: 'find a scene…' });
          const s = pick?.id ? game.scenes.get(pick.id) : null;
          if (!s) return;
          root.querySelector('[name="sceneId"]').value = s.id;
          root.querySelector('[data-plc-scene-name]').textContent = s.name;
        });
        nm?.focus();
        requestAnimationFrame(() => dlg.setPosition({ height: 'auto' }));
      },
      close: () => resolve(out),
    }, { width: 540, classes: [...THEMED_DIALOG_CLASSES, 'ncm-plc-dialog', 'ncm-nde-dialog'] });
    dlg.render(true);
  });
}
