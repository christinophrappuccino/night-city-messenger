// NCM audit fix C2 — "after the GM looks at a call-screen preview, is the GM still a GM?" (+ a stray CSS rule)
// Run as the GM, AFTER opening Admin → Phone and a screen with the call-screen preview (Line types, or a
// corporation's Calls). The preview used to overwrite game.user.isGM, which froze it for every module until a reload.
// Checks: game.user.isGM is still Foundry's own (not overwritten), a preview copy draws the player's view, and a
// `.mt` element outside NCM is no longer turned into a flex box.
// Results arrive as a chat card whispered to the GM.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('C2 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const base = foundry.utils.getRoute('modules/night-city-messenger/scripts');

  check('game.user.isGM is still Foundry\'s own check, not overwritten', !Object.prototype.hasOwnProperty.call(game.user, 'isGM') && game.user.isGM === true,
    Object.prototype.hasOwnProperty.call(game.user, 'isGM') ? 'it has been overwritten — reload, then open the preview again' : '');

  try {
    const { CallHud } = await import(`${base}/ui/Calls/CallHud.js`);
    const svc = { calls: new Map(), usableModes: ['loud'], offeredModes: ['loud'], modeFor: () => 'loud', homeCode: null, _get: (k, d) => d };
    const call = { id: 'c2', from: { name: 'Unknown', number: '', anon: true }, to: { userId: 'u', name: 'V', number: 'WAT-4471', kind: 'player' }, mode: 'loud', state: 'ringing', startedAt: Date.now() - 2000 };
    const player = Object.assign(new CallHud(svc), { asPlayer: true })._callHtml({ call, role: 'callee' }, {});
    const gm = new CallHud(svc)._callHtml({ call, role: 'callee' }, {});
    check('A preview copy draws what the player sees', /Incoming call/.test(player) && !/is calling/.test(player));
    check('…while the GM\'s own call screen keeps the GM view', /is calling/.test(gm));
    check('…and drawing it changed nothing on game.user', !Object.prototype.hasOwnProperty.call(game.user, 'isGM') && game.user.isGM === true);
  } catch (err) { check('The call screen loads', false, err.message); }

  const probe = document.createElement('div');
  probe.className = 'mt';
  document.body.appendChild(probe);
  const display = getComputedStyle(probe).display;
  probe.remove();
  check('A `.mt` element outside NCM is left alone', display !== 'flex', `display: ${display}`);

  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM C2 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>` });
})();
