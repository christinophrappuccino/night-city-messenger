// NCM batch (tester round 2026-11-06): caller pictures, adding a corporation, mass delete in the inbox.
// Run as a GM. Needs one character with a few messages in their inbox.
//  1. Calls: a contact saved from mail (email only) counts as knowing the caller; a line type can show the holder's
//     picture to people who don't have them saved (it saves, and is put back).
//  2. Corporations: the New corporation form, driven by clicking its real Add it button; the new row is checked, then
//     the Places table is put back exactly as it was.
//  3. Inbox: Select mode, tick two messages, Move to Trash, then the strip's Undo, by clicking the real buttons.
//     The two messages end where they started.
// Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const MID = 'night-city-messenger';
  const appOf = (n) => [...foundry.applications.instances.values()].find((a) => a.constructor.name === n);
  let before = null, inbox = null;
  try {
    if (!game.user.isGM) throw new Error('Run as a GM');
    const svc = game.nightcity.callService;
    const PN = await import(`/modules/${MID}/scripts/utils/phoneNumbering.js`);
    before = { types: foundry.utils.deepClone(game.settings.get(MID, 'phoneLineTypes')), places: foundry.utils.deepClone(game.settings.get(MID, 'phonePlaces')) };

    // ── 1. calls ──
    const caller = { contactId: 'x', number: '+72 NC WAT-0150' };
    check('A contact saved from mail knows the caller', !!PN.savedContactFor([{ name: 'R', email: 'r@x.net' }], caller, { email: 'R@x.net' }));
    check('A stranger stays a stranger', !PN.savedContactFor([{ name: 'Q', email: 'q@x.net' }], caller, { email: 'r@x.net' }));
    if (svc) {
      const types = PN.lineTypes(before.types).map((t) => (t.id === 'std' ? { ...t, face: true } : t));
      await svc.saveNumberSetting('phoneLineTypes', PN.lineTypesDiff(types.map(PN.sanitizeLineType)));
      check('Standard can show the picture to strangers (saves)', PN.lineTypes(game.settings.get(MID, 'phoneLineTypes')).find((t) => t.id === 'std')?.face === true);
      await game.settings.set(MID, 'phoneLineTypes', before.types);

      // ── 2. a corporation, through the real form ──
      await game.nightcity.openAdminTab?.('phone'); await wait(1200);
      const app = appOf('AdminPanelApp'), tab = app?.tabs?.phone;
      if (!tab) throw new Error('Admin → Phone did not open');
      tab._view = 'numbers'; tab._pn.f = 'corp'; tab._pn.addCorp = null;
      await app.render(); await wait(800);
      app.element.querySelector('[data-do="acOpen"]')?.click(); await wait(800);
      check('Numbers → Corporations → New corporation opens the form', !!app.element.querySelector('#ac-name'));
      const code = 'Q' + String.fromCharCode(65 + Math.floor(Math.random() * 26)) + 'Z';
      tab._pn.addCorp.name = 'NCM Test Corp'; tab._pn.addCorp.code = code;
      await app.render(); await wait(800);
      app.element.querySelector('[data-do="acGo"]')?.click(); await wait(1500);
      const row = svc.numberContext.rows.find((r) => r.District === 'NCM Test Corp');
      check('Add it writes a Corporate row', row?.Category === 'Corporate' && row?.Code === code, row ? '' : 'no row');
      check('…and opens it on the Corporations screen', tab._pn.f === 'corp' && tab._pn.off === PN.officeKey(row || {}) && /NCM Test Corp/.test(app.element.querySelector('.ncm-pn-detail h3')?.textContent || ''));
      await game.settings.set(MID, 'phonePlaces', before.places);
      check('The Places table is back as it was', !svc.numberContext.rows.some((r) => r.District === 'NCM Test Corp'));
      app.close();
    } else check('Calls are on (needed for parts 1b and 2)', false, 'turn Calls on in Module Settings');

    // ── 3. inbox: select, Move to Trash, Undo ──
    const ms = game.nightcity.messageService;
    let actor = null, mail = [];
    for (const a of game.actors.filter((x) => x.hasPlayerOwner)) {
      const list = (await ms.getMessages?.(a.id)) || [];
      mail = list.filter((m) => !m.status?.deleted && !m.status?.spam && !m.messageId?.endsWith('-sent'));
      if (mail.length >= 2) { actor = a; break; }
    }
    if (!actor) throw new Error('No character has two messages in their inbox');
    game.nightcity.openInbox(actor.id); await wait(2500);
    inbox = appOf('MessageViewerApp');
    if (!inbox) throw new Error('the inbox did not open');
    inbox._setFilter('inbox'); await wait(1000);
    inbox.element.querySelector('[data-action="toggle-select"]')?.click(); await wait(800);
    check('The Select pill turns Select mode on', inbox.selectMode && !!inbox.element.querySelector('.ncm-viewer__bulk-bar'));
    // each tick re-renders the list, so find each row again before clicking it (a row kept from before is detached)
    const ids = [...inbox.element.querySelectorAll('.ncm-viewer__msg--picking')].slice(0, 2).map((r) => r.dataset.messageId);
    for (const id of ids) { inbox.element.querySelector(`.ncm-viewer__msg--picking[data-message-id="${id}"]`)?.click(); await wait(800); }
    check('Clicking two rows ticks them', ids.length === 2 && ids.every((id) => inbox.bulkSelected.has(id)), ids.join(', '));
    inbox.element.querySelector('[data-action="bulk-delete"]')?.click(); await wait(2000);
    const after = (await ms.getMessages?.(actor.id, { filter: 'all', includeDeleted: true })) || [];
    check('Move to Trash puts both in Trash', ids.every((id) => after.find((m) => m.messageId === id)?.status?.deleted === true));
    check('The strip says where they went, with Open Trash', /2 moved to Trash/.test(inbox.element.querySelector('.ncm-viewer__trash-note')?.textContent || '') && !!inbox.element.querySelector('.ncm-viewer__trash-note [data-filter="trash"]'));
    inbox.element.querySelector('[data-action="trash-undo"]')?.click(); await wait(2000);
    const back = (await ms.getMessages?.(actor.id, { filter: 'all', includeDeleted: true })) || [];
    check('Undo puts both back', ids.every((id) => back.find((m) => m.messageId === id)?.status?.deleted === false));
    inbox._toggleSelectMode(false);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    try {
      if (before) {
        if (JSON.stringify(game.settings.get(MID, 'phoneLineTypes')) !== JSON.stringify(before.types)) await game.settings.set(MID, 'phoneLineTypes', before.types);
        if (JSON.stringify(game.settings.get(MID, 'phonePlaces')) !== JSON.stringify(before.places)) await game.settings.set(MID, 'phonePlaces', before.places);
      }
    } catch (err) { check('Restoring your settings', false, err.message); }
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM tester round 2026-11-06: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Two clients, by hand: a player calls a character who never saved them: number and a question mark. Tick "People who don't have them saved still see their picture" on Standard (Setup → Line types) and call again: the picture shows, still no name. In the player's inbox: Select, Shift-click a range, Move to Trash, then Open Trash from the strip: Restore and Delete forever are there.</p>` });
})();
