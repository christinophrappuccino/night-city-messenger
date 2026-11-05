// NCM audit fix B6 — "what happens when someone leaves, or a GM arrives?"
// The macro can't make anyone really leave, so it plays the same "user left" / "user connected" signal Foundry
// sends (Hooks.callAll('userConnected', …)) and checks what NCM does with it:
//   • GM: a call with someone who "left" ends as dropped (another call carries on), their payphone handset goes
//     back on the hook, and a client can't claim a handset for someone else.
//   • PLAYER (GM online): a message held as if no GM were online is sent by itself a few seconds after a GM
//     "connects". Then the GM runs the macro once more to delete the test mail.
// Results arrive as a chat card whispered to whoever ran it.
(async () => {
  const MOD = 'night-city-messenger';
  const SUBJECT = 'NCM B6 test (delete me)';
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const report = (title) => {
    const all = results.every((r) => r.pass);
    const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
    ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM B6 test (${title}): ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>` });
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ns = game.nightcity;

  // ── GM part ──
  if (game.user.isGM) {
    // clean up the player part's mail, if any
    let removed = 0;
    for (const j of game.journal) {
      const ids = j.pages.filter((p) => p.flags?.[MOD]?.subject === SUBJECT).map((p) => p.id);
      if (ids.length) { await j.deleteEmbeddedDocuments('JournalEntryPage', ids); removed += ids.length; }
    }
    // a pretend player who "leaves" (an id no real user has, so nothing real is affected)
    const ghost = { id: `b6ghost${foundry.utils.randomID(6)}`, name: 'B6 Ghost', isGM: false, active: false };
    const cs = ns.callService;
    const base = { state: 'live', startedAt: Date.now(), to: { kind: 'player', userIds: [] } };
    cs._store({ ...base, id: 'b6-a', from: { userId: ghost.id, name: 'Ghost' }, answeredBy: game.user.id });
    cs._store({ ...base, id: 'b6-b', from: { userId: game.user.id, name: 'GM' }, answeredBy: 'b6-someone-else' });
    const pp = ns.payphoneService;
    pp.inUse.set('b6-booth', { userId: ghost.id, name: 'Ghost', at: Date.now() });
    Hooks.callAll('userConnected', ghost, false);
    check('A call with someone who left ends as dropped', cs.calls.get('b6-a')?.state === 'ended', cs.calls.get('b6-a')?.dropReason || cs.calls.get('b6-a')?.state);
    check('…and a call with someone still here carries on', cs.calls.get('b6-b')?.state === 'live');
    check('Their payphone handset goes back on the hook', !pp.inUse.has('b6-booth'));
    pp.handleSocket({ type: 'use', id: 'b6-booth2', entry: { userId: 'b6-victim', name: 'Victim' } }, 'b6-forger');
    check('A client cannot put someone else on a handset', !pp.inUse.has('b6-booth2'));
    cs.calls.delete('b6-a'); cs.calls.delete('b6-b');
    if (removed) check('Player-part test mail removed', true, `${removed} page(s)`);
    report('GM');
    return;
  }

  // ── Player part ──
  if (!game.users.activeGM) { ui.notifications.warn('B6 test: a GM must be online for this part.'); return; }
  const actor = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
  const email = actor?.getFlag(MOD, 'email');
  if (!actor || !email) { ui.notifications.warn('B6 test: this player needs a character with an NCM address.'); return; }
  const ms = ns.messageService;
  // hold a message exactly as if no GM were online
  const users = game.users;
  const realFind = users.find;
  const ownFind = Object.prototype.hasOwnProperty.call(users, 'find');
  users.find = function (fn) { return realFind.call(this, (u, i, a) => !u.isGM && fn(u, i, a)); };
  let r;
  try { r = await ms.sendMessage({ fromActorId: actor.id, toActorId: actor.id, to: email, subject: SUBJECT, body: '' }); }
  finally { if (ownFind) users.find = realFind; else delete users.find; }
  check('With "no GM online" the message is held', r?.success && r.queued && r.reason === 'gm_offline', r?.error || r?.reason || '');
  const id = r?.messageId;
  Hooks.callAll('userConnected', game.users.activeGM, true);
  let sent = false;
  for (let t = 0; t < 15000 && !sent; t += 500) { await sleep(500); sent = !ms._messageQueue.some((d) => d.messageId === id); }
  check('A GM "connecting" sends it by itself within a few seconds', sent);
  await sleep(1500);
  const arrived = game.journal.some((j) => j.pages.some((p) => p.flags?.[MOD]?.messageId === id));
  check('…and it arrived', arrived);
  report('player');
  ui.notifications.info('B6 test: done. Ask the GM to run this macro too (it also deletes the test mail).');
})();
