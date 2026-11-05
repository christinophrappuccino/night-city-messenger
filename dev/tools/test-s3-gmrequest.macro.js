// NCM batch: the three hand-written player → GM round trips (message delivery answer, scheduled-mail requests, the
// netrun verdict) moved onto the shared one (utils/gmRequest.js), which also means only a GM's answer counts — the
// netrun verdict accepted anyone's before. Run as a PLAYER while the GM is online. It schedules a message from your
// character to itself for next year, then cancels it — two requests the GM answers. Nothing is left behind.
// Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    if (game.user.isGM) throw new Error('Run this as a player (the GM path has no round trip).');
    if (!game.users.activeGM) throw new Error('A GM must be online.');
    const actor = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
    if (!actor) throw new Error('No character.');
    const G = await import('/modules/night-city-messenger/scripts/utils/gmRequest.js');
    check('The shared round trip loads', typeof G.awaitGmResult === 'function' && typeof G.withdrawGmRequest === 'function');
    const svc = game.nightcity.schedulingService;
    const when = new Date(Date.now() + 365 * 86400000).toISOString();
    const t0 = Date.now();
    const add = await svc.scheduleMessage({ fromActorId: actor.id, toActorId: actor.id, subject: 'NCM round-trip test (cancelled at once)', body: '<p>test</p>' }, when, { useGameTime: false });
    check('Scheduling: the GM answered the add', add?.success === true && !!add.scheduleId, `${Date.now() - t0} ms${add?.error ? ' — ' + add.error : ''}`);
    if (add?.scheduleId) {
      const t1 = Date.now();
      const c = await svc.cancelScheduled(add.scheduleId);
      check('Scheduling: the GM answered the cancel', c?.success === true, `${Date.now() - t1} ms${c?.error ? ' — ' + c.error : ''}`);
    }
    check('Nothing is left waiting', G.pendingGmRequests(game.nightcity.socketManager, 'schedule:result') === 0);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM round trips (gmRequest): ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check, as a player: send a message to an NPC (the composer says "Delivered" — that is the delivery answer); with netrunning set to GM-called (Admin → Security → Hacking rules), try a login roll and pick PASS on the GM's prompt; then try again and withdraw on the player side.</p>` });
})();
