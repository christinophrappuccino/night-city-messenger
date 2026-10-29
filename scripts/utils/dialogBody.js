/**
 * One body for NCM's small dialogs (confirm / rename / remove), pure — no Foundry globals.
 * @file scripts/utils/dialogBody.js
 *
 * A dialog that wears it opens with the class `ncm-themed-dialog` (plus Foundry's own `dialog`): the
 * frame takes the admin preset for a GM tool and the player's theme for a player (styles/components/
 * ncm-dialog.css). Layout: a header row naming the THING (icon tile in the tone, name, a sub-line, a
 * kind tag), then a body with a lead sentence, optional "what goes" / "what stays" lists, an optional
 * text field, and a hint. Tone = meaning: act (cyan) for a neutral action, bad (red) for something
 * that destroys, attn (amber) for a caution.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The classes a themed dialog opens with — Foundry's `dialog` must stay or its layout goes. */
export const THEMED_DIALOG_CLASSES = Object.freeze(['dialog', 'ncm-themed-dialog']);

/**
 * @param {object} o
 * @param {string} [o.icon]  — a full FA class ("fas fa-microchip")
 * @param {string} [o.img]   — an image instead of the icon
 * @param {'act'|'bad'|'attn'} [o.tone]
 * @param {string} o.title   — the thing's name
 * @param {string} [o.sub]   — a sub-line (where / who holds it)
 * @param {string} [o.kind]  — a small tag ("Shard", "Terminal")
 * @param {string} [o.lead]  — the one sentence the dialog asks (plain text; `**x**` bolds)
 * @param {string[]} [o.goes] — what is lost
 * @param {string[]} [o.stays] — what is kept
 * @param {{name:string, label:string, value?:string, placeholder?:string}} [o.field]
 * @param {string} [o.hint]
 * @param {string} [o.extraHtml] — trusted markup appended to the body (callers own escaping)
 */
export function dialogBodyHtml(o = {}) {
  const tone = ['act', 'bad', 'attn'].includes(o.tone) ? o.tone : 'act';
  const bold = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const ico = o.img ? `<img src="${esc(o.img)}" alt="">` : `<i class="${esc(o.icon || 'fas fa-circle-info')}"></i>`;
  const list = (cls, head, icon, rows) => rows?.length
    ? `<div class="ncm-dlgb__list ncm-dlgb__list--${cls}"><div class="ncm-dlgb__lk">${head}</div><ul>${rows.map(r => `<li><i class="fas ${icon}"></i><span>${bold(r)}</span></li>`).join('')}</ul></div>` : '';
  const field = o.field ? `<label class="ncm-dlgb__field"><span class="ncm-dlgb__fk">${esc(o.field.label)}</span>
      <input type="text" name="${esc(o.field.name)}" value="${esc(o.field.value ?? '')}" placeholder="${esc(o.field.placeholder ?? '')}" autocomplete="off" autofocus></label>` : '';
  return `<div class="ncm-dlgb ncm-dlgb--${tone}">
  <div class="ncm-dlgb__hd">
    <span class="ncm-dlgb__ico">${ico}</span>
    <span class="ncm-dlgb__nm"><b>${esc(o.title || '')}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>
    ${o.kind ? `<span class="ncm-dlgb__kind">${esc(o.kind)}</span>` : ''}
  </div>
  <div class="ncm-dlgb__bd">
    ${o.lead ? `<p class="ncm-dlgb__lead">${bold(o.lead)}</p>` : ''}
    ${field}
    ${(o.goes?.length || o.stays?.length) ? `<div class="ncm-dlgb__lists">${list('goes', 'Removed', 'fa-xmark', o.goes)}${list('stays', 'Kept', 'fa-check', o.stays)}</div>` : ''}
    ${o.hint ? `<p class="ncm-dlgb__hint">${bold(o.hint)}</p>` : ''}
    ${o.extraHtml || ''}
  </div>
</div>`;
}
