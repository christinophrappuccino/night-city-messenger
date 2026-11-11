// NCM batch (tester round 2026-11-10: the Hacking rules checkbox that made the card jump and "didn't save", the
// unsaved-edits warning on closing the Admin window, and a player character's Speed dial showing every number when a
// GM opened it). Run as a GM after reloading the world. No world writes. Whispers a PASS/FAIL card + a by-hand list.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass: !!pass, note });
  const MID = 'night-city-messenger';
  const base = `/modules/${MID}/scripts`;
  try {
    if (!game.user.isGM) throw new Error('Run as a GM');

    // 1. the labels are positioned in the LIVE cascade (core + system + module), so a hidden input stays inside them
    const host = document.createElement('div');
    host.className = 'ncm-app ncm-admin-panel';
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px';
    host.innerHTML = `<label class="ncm-cmv-check"><input type="checkbox"><span class="ncm-cmv-box"></span><span>x</span></label>
      <label class="ncm-cmv-dvtoggle"><input type="checkbox"><span class="ncm-cmv-knob"></span></label>
      <label class="ncm-cmv-mode"><input type="radio"></label>
      <div class="ncm-jkr-who__seg"><label><input type="radio"><span>x</span></label></div>
      <div class="ncm-jkr-who__roles"><label><input type="checkbox"><span>x</span></label></div>`;
    document.body.append(host);
    for (const lb of host.querySelectorAll('label')) {
      const inp = lb.querySelector('input'), a = lb.getBoundingClientRect(), b = inp.getBoundingClientRect();
      const inside = Math.abs(b.top - a.top) < 4 && Math.abs(b.left - a.left) < 4;
      check(`${lb.className || lb.parentElement.className}: the hidden input sits at its label`, getComputedStyle(lb).position === 'relative' && inside, `label ${getComputedStyle(lb).position}, input ${Math.round(b.top - a.top)}px from it`);
    }
    host.remove();

    // 2. closing the Admin window with unsaved rule edits asks first
    const { SecurityTab } = await import(`${base}/ui/AdminPanel/tabs/SecurityTab.js`);
    const t = Object.create(SecurityTab.prototype); t._dirty = new Set(['cmv']);
    check('An edited rule card is reported by name', typeof t.unsavedEdits === 'function' && t.unsavedEdits()[0] === 'Countermeasure visibility');
    const { AdminPanelApp } = await import(`${base}/ui/AdminPanel/AdminPanelApp.js`);
    check('The Admin window asks before closing over unsaved edits', typeof AdminPanelApp.prototype._confirmUnsaved === 'function');

    // 3. a player character's Messenger: only their numbers, even for a GM
    const { phoneBook } = await import(`${base}/ui/MessageViewer/callsTab.js`);
    const pc = game.actors.find((a) => a.hasPlayerOwner && a.type === 'character');
    if (pc) {
      const book = phoneBook({ actorId: pc.id });
      const own = (pc.getFlag(MID, 'contacts') || []).filter((c) => c.phone).length;
      const all = Object.keys(game.nightcity?.callService?.lines?.() || {}).length;
      check(`${pc.name}'s Speed dial book, opened by you: ${book.length} number(s) — their own ${own}, not the directory's ${all}`, book.length <= own);
    } else check('No player character to check (skipped)', true);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${Handlebars.escapeExpression(r.name)}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM tester round 2026-11-10: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">By hand:<br>
    1. Admin → Security → Hacking rules → open Countermeasure visibility, scroll down, tick "A failed scan counts as a traced action", then "Hide the DV": the card does not jump, both tick. Same in Jacking in (who may jack in, the role ticks).<br>
    2. Tick a box and close the Admin window without Save: it asks "Unsaved changes". No keeps it open; Save; close: no question. Reopen: the box is still ticked.<br>
    3. As GM, open a player character's Messenger → Calls: Speed dial and the Book list only that character's contacts. Log in as the player: the same list.<br>
    4. Ask the tester which account they used "as player" and its role (Configure Players). An Assistant GM counts as a GM in Foundry.</p>` });
})();
