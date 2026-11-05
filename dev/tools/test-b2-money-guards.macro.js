// NCM audit fix B2 — "with no GM online, can a player get paid without the game recording it?"
// and "does a program's charge count down?"
// Two parts; the macro knows which one by who runs it:
//   • A PLAYER runs it while NO GM is logged in → it tries a siphon and a program run, and checks
//     neither paid out nor spent anything. (Log the GM out first; this part cannot run with one online.)
//   • The GM runs it → it makes a test program with 2 charges in a temporary journal, runs it
//     three times through the real GM code, checks it stops after two, and deletes the journal.
// Results arrive as a chat card (the player part posts it to the player only).
(async () => {
  const MOD = 'night-city-messenger';
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const base = foundry.utils.getRoute('modules/night-city-messenger/scripts');
  let SF;
  try { SF = await import(`${base}/ui/content/SiphonFlow.js`); } catch (err) { ui.notifications.error(`B2 test: could not load NCM modules — ${err.message}`); return; }
  const report = (title) => {
    const all = results.every((r) => r.pass);
    const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(r.note)}</i>` : ''}</li>`).join('');
    ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM B2 test (${title}): ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>` });
  };

  // ── Player part: no GM online ──
  if (!game.user.isGM) {
    if (game.users.activeGM) { ui.notifications.warn('B2 test: log the GM out first — this part checks what happens with no GM online.'); return; }
    const actor = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
    if (!actor) { ui.notifications.warn('B2 test: this player owns no character.'); return; }
    const before = actor.system?.wealth?.value;
    await SF.runSiphon({ actor, raw: { balance: 50000, siphonMode: 'full', accountName: 'B2 test' }, messageId: 'b2-siphon' });
    check('A siphon with no GM online pays nothing', actor.system?.wealth?.value === before, `wealth ${before} → ${actor.system?.wealth?.value}`);
    const r = await SF.runPayloadExecute({ actor, raw: { name: 'B2.exe', executeRequire: true }, messageId: 'b2-prog' });
    check('A program run with no GM online is refused before any roll', r === null);
    report('player, no GM');
    return;
  }

  // ── GM part: charges ──
  const [j] = await JournalEntry.createDocuments([{ name: 'NCM B2 test (delete me)', ownership: { default: 0 }, pages: [{ name: 'B2.exe', type: 'text', text: { content: '' }, flags: { [MOD]: { type: 'shard-message', messageId: 'b2-prog', contentType: 'payload', contentData: { name: 'B2.exe', charges: 2, effect: { type: 'adjudicate' } } } } }] }]);
  const cd = () => j.pages.contents[0].getFlag(MOD, 'contentData') || {};
  try {
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      const allowed = SF.checkPayloadRequest({ messageId: 'b2-prog', outcome: 'success', actorId: null }, game.user.id).ok;
      runs.push(allowed);
      if (allowed) await SF.applyPayloadEffect({ messageId: 'b2-prog', actorId: null, outcome: i === 0 ? 'success' : 'fail' });
    }
    check('A program with 2 charges runs twice', runs[0] && runs[1], `allowed: ${runs.join(', ')}`);
    check('…and not a third time', runs[2] === false);
    check('A failed run spends a charge too', cd().charges === 0, `charges left ${cd().charges}`);
  } finally {
    await j.delete();
  }
  report('GM, charges');
})();
