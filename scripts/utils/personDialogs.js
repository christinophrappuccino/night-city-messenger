/**
 * The Players → Edit dialog and the Add-an-alias dialog — pure markup (no Foundry globals).
 * @file scripts/utils/personDialogs.js
 *
 * Both open as themed dialogs (`THEMED_DIALOG_CLASSES` + their own class; styles in
 * styles/components/ncm-dialog.css, `ncm-pe-*`). 2026-10-29, dev: "Player edit dialog in contacts → players
 * → edit needs some design love." The header is a live card — picture, name, address, who plays them —
 * that repaints as the GM types (ContactsTab wires it), so the result is visible before Save.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Up to two initials for a portrait fallback. */
export function initialsOf(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}

/** A plain address check — something@something, no spaces. */
export function looksLikeAddress(s) {
  return /^[^\s@]+@[^\s@]+$/.test(String(s || '').trim());
}

/**
 * @param {object} o
 * @param {string} o.name
 * @param {string} o.email
 * @param {string} o.img
 * @param {string[]} [o.playedBy] — player names
 * @param {{name:string, email:string, main:boolean}[]} [o.aliases]
 */
export function playerEditHtml({ name = '', email = '', img = '', playedBy = [], aliases = [] } = {}) {
  const hasImg = !!img && !/mystery-man/.test(img);
  const aliasRows = aliases.length
    ? aliases.map(a => `<li class="ncm-pe__al${a.main ? ' is-main' : ''}">
        <span class="ncm-pe__alav">${esc(initialsOf(a.name))}</span>
        <span class="ncm-pe__altx"><b>${esc(a.name)}</b><small>${esc(a.email || 'no address')}</small></span>
        ${a.main ? '<span class="ncm-pe__main" data-tooltip="Main identity — what they send from by default"><i class="fas fa-star"></i>Main</span>' : ''}
      </li>`).join('')
    : '<li class="ncm-pe__none">No aliases yet — mail only reaches their own address.</li>';
  return `<div class="ncm-pe">
  <div class="ncm-pe__card">
    <button type="button" class="ncm-pe__face${hasImg ? '' : ' is-empty'}" data-pe-browse data-tooltip="Change the picture">
      <img src="${esc(hasImg ? img : '')}" alt=""${hasImg ? '' : ' hidden'}><span class="ncm-pe__ini"${hasImg ? ' hidden' : ''}>${esc(initialsOf(name))}</span>
      <span class="ncm-pe__cam"><i class="fas fa-camera"></i></span>
    </button>
    <div class="ncm-pe__who">
      <b data-pe-show="name">${esc(name || 'Unnamed')}</b>
      <span class="ncm-pe__addr" data-pe-show="email">${esc(email || 'no address yet')}</span>
      <span class="ncm-pe__by"><i class="fas fa-user"></i>${playedBy.length ? `played by ${esc(playedBy.join(', '))}` : 'no player owns them'}</span>
    </div>
    <span class="ncm-dlgb__kind">Player character</span>
  </div>
  <div class="ncm-pe__bd">
    <label class="ncm-pe__f"><span class="ncm-pe__k">Name</span><input type="text" name="ncmPcName" value="${esc(name)}" autocomplete="off"></label>
    <label class="ncm-pe__f"><span class="ncm-pe__k">Address</span><input type="text" name="ncmPcEmail" value="${esc(email)}" placeholder="e.g. v@nightcity.net" autocomplete="off"><span class="ncm-pe__err" data-pe-err hidden></span></label>
    <div class="ncm-pe__f"><span class="ncm-pe__k">Picture</span><span class="ncm-pe__pic"><input type="text" name="ncmPcImg" value="${esc(img)}" placeholder="an image path" autocomplete="off"><button type="button" class="ncm-pe__btn" data-pe-browse><i class="fas fa-folder-open"></i>Browse</button></span></div>
    <p class="ncm-pe__note"><i class="fas fa-circle-info"></i>Changes the character for everyone. Mail already sent keeps the address it was sent with.</p>
    <section class="ncm-pe__sec">
      <div class="ncm-pe__sk"><i class="fas fa-masks-theater"></i>Aliases<span>other names and addresses that reach them — players only see what you share</span></div>
      <ul class="ncm-pe__als">${aliasRows}</ul>
      <div class="ncm-pe__acts">
        <button type="button" class="ncm-pe__btn" data-pe-alias><i class="fas fa-plus"></i>Add an alias</button>
        <button type="button" class="ncm-pe__btn is-quiet" data-pe-sheet><i class="fas fa-up-right-from-square"></i>Open the character sheet</button>
      </div>
    </section>
  </div>
</div>`;
}

/** The Add-an-alias dialog body. */
export function aliasDialogHtml({ ofName = '' } = {}) {
  return `<div class="ncm-pe ncm-pe--alias">
  <div class="ncm-pe__card">
    <span class="ncm-pe__face is-empty is-static"><span class="ncm-pe__ini"><i class="fas fa-masks-theater"></i></span></span>
    <div class="ncm-pe__who"><b>New alias</b><span class="ncm-pe__by"><i class="fas fa-user"></i>of ${esc(ofName)}</span></div>
    <span class="ncm-dlgb__kind">Alias</span>
  </div>
  <div class="ncm-pe__bd">
    <p class="ncm-pe__note"><i class="fas fa-circle-info"></i>Another name and address for ${esc(ofName)}. Mail sent to it lands in their inbox, and they can reply from it.</p>
    <label class="ncm-pe__f"><span class="ncm-pe__k">Name</span><input type="text" name="ncmIdName" placeholder="e.g. Burner, Mr. Blue" autocomplete="off" autofocus></label>
    <label class="ncm-pe__f"><span class="ncm-pe__k">Address</span><input type="text" name="ncmIdEmail" placeholder="e.g. ghost99@darknet.nc" autocomplete="off"><span class="ncm-pe__err" data-pe-err hidden></span></label>
    <div class="ncm-pe__f"><span class="ncm-pe__k">Picture</span><span class="ncm-pe__pic"><input type="text" name="ncmIdPortrait" placeholder="optional — blank shows initials, never ${esc(ofName)}'s face" autocomplete="off"><button type="button" class="ncm-pe__btn" data-pe-browse><i class="fas fa-folder-open"></i>Browse</button></span></div>
  </div>
</div>`;
}
