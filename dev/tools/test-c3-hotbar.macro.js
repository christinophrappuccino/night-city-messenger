// NCM audit fix C3 — "with the Cyberpunk RED system loaded, does dragging a terminal / shard to the hotbar make NCM's macro?"
// Run as the GM with the CPR system. Needs at least one converted terminal or shard in the Items directory.
// It drops a real browser drag event (the same data Foundry's drag carries) onto an empty hotbar slot and checks NCM's
// "open this" macro landed there, not CPR's item-sheet macro. Then it opens a terminal's item sheet and checks the
// terminal opens instead. Anything it puts on the hotbar is taken off again; a macro it made is deleted.
// Afterwards, try it by hand: drag a terminal, a shard, and an Admin → Terminals rack row onto the hotbar.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('C3 test: run this as the GM.'); return; }
  const MOD = 'night-city-messenger';
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const pick = (flag) => game.items.find((i) => i.getFlag(MOD, flag));
  const subjects = [pick('isTerminal'), pick('isDataShard')].filter(Boolean);
  if (!subjects.length) { ui.notifications.warn('C3 test: convert at least one item into a terminal or a shard first.'); return; }

  for (const item of subjects) {
    const free = [...document.querySelectorAll('#hotbar li[data-slot]')].find((li) => !game.user.hotbar?.[li.dataset.slot]);
    if (!free) { check('A free hotbar slot on the current page', false, 'clear one slot and run again'); break; }
    const slot = Number(free.dataset.slot);
    const before = new Set(game.macros.map((m) => m.id));
    const dt = new DataTransfer();
    dt.setData('text/plain', JSON.stringify({ type: 'Item', uuid: item.uuid }));
    free.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    let macro = null;
    for (let t = 0; t < 3000 && !macro; t += 200) { await sleep(200); macro = game.macros.get(game.user.hotbar?.[slot]); }
    const kind = item.getFlag(MOD, 'isTerminal') ? 'terminal' : 'shard';
    check(`Dropping a ${kind} ("${item.name}") puts NCM's macro on slot ${slot}`, !!macro?.getFlag(MOD, 'access'), macro ? `got "${macro.name}"${macro.getFlag(MOD, 'access') ? '' : ' — not NCM\'s (the system took the drop)'}` : 'nothing landed');
    // tidy up
    await game.user.assignHotbarMacro(null, slot);
    if (macro && !before.has(macro.id)) await macro.delete();
  }

  const term = pick('isTerminal');
  if (term) {
    term.sheet.render(true);
    await sleep(800);
    const open = [...Object.values(ui.windows), ...(foundry.applications?.instances?.values?.() || [])];
    const viewer = open.find((a) => /terminal/i.test(a.constructor?.name || '') && (a.item?.id === term.id || a.itemId === term.id || a.options?.item?.id === term.id || a.document?.id === term.id));
    const sheet = open.find((a) => (a.document ?? a.object) === term && a.rendered && !/terminal/i.test(a.constructor?.name || ''));
    check('Opening a terminal\'s item sheet opens the terminal instead', !sheet && !!viewer, sheet ? 'the raw item sheet stayed open' : viewer ? '' : 'no terminal window found (it may have opened under another name — check by eye)');
    viewer?.close?.();
  } else check('Terminal sheet check skipped', true, 'no converted terminal in the Items directory');

  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM C3 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Then by hand: drag a terminal, a shard and an Admin → Terminals rack row onto the hotbar; click each macro.</p>` });
})();
