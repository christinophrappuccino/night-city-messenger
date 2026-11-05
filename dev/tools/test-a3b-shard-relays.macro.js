// NCM audit fix A3b — "can a player unlock, wipe or repair a shard they were never given?"
// One macro, three runs (it knows which step it is on):
//   1. GM runs it  → makes two world shards nobody has rights on: "NCM A3b — hidden" (no way in)
//      and "NCM A3b — handed out" (a public chat card is posted for it, which is a way in).
//   2. A PLAYER runs it (a GM must be logged in) → their client sends honest and forged
//      shard requests over the real socket.
//   3. GM runs it again → checks what landed, whispers PASS/FAIL, deletes the test shards + card.
//
// Convert / unconvert relays are covered by the sim (test-shard-relays): testing them for real
// would mean aiming a forged request at another player's real item.
(async () => {
  const MOD = 'night-city-messenger';
  const findShard = (tag) => game.items.find((i) => i.getFlag(MOD, 'a3bTest') === tag);
  const hidden = findShard('hidden'), handed = findShard('handed');
  const svc = game.nightcity?.dataShardService;

  // ── Step 1: GM setup ──
  if (game.user.isGM && !hidden) {
    const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    const mk = async (name, tag, cfg) => {
      const [item] = await Item.createDocuments([{ name, type: 'gear', ownership: { default: NONE }, flags: { [MOD]: { a3bTest: tag } } }]);
      const r = await svc.convertToDataShard(item, cfg);
      if (!r?.success) throw new Error(r?.error || 'convert failed');
      await svc.addMessage(item, { subject: 'Test entry', body: 'A3b test entry', from: 'test@nc', contentType: 'message' });
      return item;
    };
    try {
      const x = await mk('NCM A3b — hidden', 'hidden', { encrypted: true, failureMode: 'destroy', maxHackAttempts: 3 });
      const h = await mk('NCM A3b — handed out', 'handed', { encrypted: true, failureMode: 'lockout', integrity: { enabled: true, currentIntegrity: 50, maxIntegrity: 100, repairPts: 15 } });
      // The card is a way into the handed-out shard. It also carries the hidden shard's id as plain
      // data: knowing an id is not a way in, which is exactly what step 2 tests.
      await ChatMessage.create({ content: '<p>NCM A3b test card (delete me)</p>', speaker: { alias: 'Night City Messenger' }, flags: { [MOD]: { access: { kind: 'shard', id: h.uuid }, a3bTest: true, a3bHidden: x.uuid } } });
    } catch (err) { ui.notifications.error(`A3b test setup failed: ${err.message}`); return; }
    ui.notifications.info('A3b test: step 1 done. Now a PLAYER runs this macro (keep this GM logged in), then run it again here.');
    return;
  }

  // ── Step 2: the player's client sends requests ──
  if (!game.user.isGM) {
    if (!game.users.activeGM) { ui.notifications.warn('A3b test: a GM must be logged in for this step.'); return; }
    const mine = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
    const someoneElses = game.actors.find((a) => !a.isOwner && a.hasPlayerOwner);
    if (!mine) { ui.notifications.warn('A3b test: this player owns no character.'); return; }
    // The test shards are world items at None; this client may not even have them, so it sends by uuid,
    // read from the step-1 chat card.
    const card = game.messages.find((m) => m.getFlag(MOD, 'a3bTest'));
    const handedUuid = card?.getFlag(MOD, 'access')?.id, hiddenUuid = card?.getFlag(MOD, 'a3bHidden');
    if (!handedUuid || !hiddenUuid) { ui.notifications.warn('A3b test: the step-1 chat card is missing — run step 1 as the GM first.'); return; }
    const sm = game.nightcity.socketManager;
    const send = (op, data) => sm.emit(op, { ...data, userId: game.user.id });
    const ST = 'shard:stateRequest', IN = 'shard:integrityRequest';
    // honest: a decrypt and a session write on the shard they were handed
    send(ST, { op: 'decrypt', itemUuid: handedUuid });
    send(ST, { op: 'session', itemUuid: handedUuid, actorId: mine.id, updates: { loggedIn: true, gmBypassed: true } });
    // forged
    send(ST, { op: 'destroy', itemUuid: handedUuid });                               // it does not self-destruct
    send(IN, { op: 'repair', itemUuid: handedUuid, points: 1000 });                 // only the configured 15 may land
    if (someoneElses) send(ST, { op: 'session', itemUuid: handedUuid, actorId: someoneElses.id, updates: { loggedIn: true } });
    // the hidden shard: no way in, but the id is known
    send(ST, { op: 'decrypt', itemUuid: hiddenUuid });
    send(ST, { op: 'destroy', itemUuid: hiddenUuid });
    send(IN, { op: 'repair', itemUuid: hiddenUuid, points: 1000 });
    ui.notifications.info(`A3b test: step 2 sent as ${mine.name}. Now the GM runs the macro again.`);
    return;
  }

  // ── Step 3: GM checks and cleans up ──
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const st = (it) => it?.getFlag(MOD, 'state') || {};
  const pages = (it) => game.journal.get(it?.getFlag(MOD, 'journalId'))?.pages?.size ?? 0;
  const hs = st(handed), sessions = hs.sessions || {};
  const myId = Object.keys(sessions).find((id) => game.actors.get(id)?.hasPlayerOwner && sessions[id]?.loggedIn);
  const reached = hs.decrypted === true || !!myId;
  if (!reached) check('The player step reached this GM', false, 'nothing landed — did a player run step 2 with this GM logged in?');
  else {
    check('Honest: a shard handed out by chat card can be unlocked', hs.decrypted === true);
    check('Honest: the player writes their own session', !!myId);
    check('Forged: a session write cannot carry non-session fields', !!myId && !('gmBypassed' in (sessions[myId] || {})));
    check('Forged: a shard that does not self-destruct cannot be wiped', !hs.destroyed && pages(handed) > 0);
    const cur = handed?.getFlag(MOD, 'config')?.integrity?.currentIntegrity;
    check('Forged: a repair restores only the configured points', cur === 65, `integrity ${cur} (50 + 15 expected)`);
    const others = Object.keys(sessions).filter((id) => id !== myId && sessions[id]?.loggedIn);
    check('Forged: a session for someone else\'s character is refused', others.length === 0, game.actors.filter((a) => a.hasPlayerOwner).length > 1 ? '' : 'only one player character — check skipped');
    const ss = st(hidden);
    check('Forged: the hidden shard (no way in) stayed locked and whole', !ss.decrypted && !ss.destroyed && pages(hidden) > 0);
  }
  for (const it of [hidden, handed]) { if (it) { await svc.removeDataShard(it, true); await it.delete(); } }
  for (const m of game.messages.filter((m) => m.getFlag(MOD, 'a3bTest'))) await m.delete();
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(r.note)}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM A3b test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:11px;opacity:.75">Test shards and card deleted. The GM console lists each refused request ("relay refused: …").</p>` });
})();
