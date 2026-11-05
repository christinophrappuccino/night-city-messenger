// NCM audit fix A3c — "can a player wipe, copy or plant on a terminal outside the account they're in?"
// One macro, three runs (it knows which step it is on):
//   1. GM runs it  → makes a world terminal "NCM A3c test terminal" with two accounts (ops, boss),
//      a file in each, and records every player character as logged into "ops" (as if they had
//      logged in), so step 2 needs no login.
//   2. A PLAYER runs it (a GM must be logged in) → their client sends honest and forged terminal
//      requests over the real socket.
//   3. GM runs it again → checks what landed, whispers PASS/FAIL, deletes the terminal and any
//      copies made in players' inboxes.
(async () => {
  const MOD = 'night-city-messenger';
  const term = game.items.find((i) => i.getFlag(MOD, 'a3cTest'));
  const svc = game.nightcity?.terminalService;
  const SUBJ = 'A3C test file';

  // ── Step 1: GM setup ──
  if (game.user.isGM && !term) {
    try {
      const [item] = await Item.createDocuments([{ name: 'NCM A3c test terminal', type: 'gear', ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, flags: { [MOD]: { a3cTest: true } } }]);
      const r = await svc.convertToTerminal(item, {
        allowExfil: true,
        exfil: { agent: { allow: true }, wipe: { allow: true } },
        accounts: [{ id: 'ops', username: 'ops', displayName: 'Ops' }, { id: 'boss', username: 'boss', displayName: 'Boss' }],
      });
      if (!r?.success) throw new Error(r?.error || 'convert failed');
      await svc.addAccountMessage(item, 'ops', { messageId: 'a3c-ops', subject: SUBJ, body: 'ops file', from: 'ops@test' });
      await svc.addAccountMessage(item, 'ops', { messageId: 'a3c-ops2', subject: `${SUBJ} (wipe me)`, body: 'ops file 2', from: 'ops@test' });
      await svc.addAccountMessage(item, 'boss', { messageId: 'a3c-boss', subject: `${SUBJ} (boss)`, body: 'boss file', from: 'boss@test' });
      const sessions = {};
      for (const a of game.actors.filter((x) => x.hasPlayerOwner)) sessions[a.id] = { loggedInAccounts: ['ops'], activeAccountId: 'ops' };
      const state = foundry.utils.deepClone(item.getFlag(MOD, 'terminalState') || {});
      await item.setFlag(MOD, 'terminalState', { ...state, sessions });
    } catch (err) { ui.notifications.error(`A3c test setup failed: ${err.message}`); return; }
    ui.notifications.info('A3c test: step 1 done. Now a PLAYER runs this macro (keep this GM logged in), then run it again here.');
    return;
  }

  // ── Step 2: the player's client sends requests ──
  if (!game.user.isGM) {
    if (!game.users.activeGM) { ui.notifications.warn('A3c test: a GM must be logged in for this step.'); return; }
    if (!term) { ui.notifications.warn('A3c test: run step 1 as the GM first (and make sure players can see the test terminal).'); return; }
    const mine = game.user.character || game.actors.find((a) => a.isOwner && a.hasPlayerOwner);
    const someoneElses = game.actors.find((a) => !a.isOwner && a.hasPlayerOwner);
    if (!mine) { ui.notifications.warn('A3c test: this player owns no character.'); return; }
    const sm = game.nightcity.socketManager;
    const send = (op, data) => sm.emit(op, { ...data, userId: game.user.id });
    const EX = 'terminal:exfilRequest', SE = 'terminal:sessionRequest', RE = 'terminal:residentRequest';
    const base = { requestId: foundry.utils.randomID(), itemUuid: term.uuid, accountId: 'ops' };
    // honest
    send(EX, { ...base, dest: 'inbox', messageIds: ['a3c-ops'], targetActorId: mine.id });
    send(EX, { ...base, dest: 'wipe', messageIds: ['a3c-ops2'] });
    send(RE, { itemUuid: term.uuid, resident: { effectType: 'plant', params: { accountId: 'ops', name: 'A3C honest plant' }, trigger: { kind: 'onLogin', accountId: 'ops' }, provenance: { plantedBy: mine.id, forgeQuality: 70 }, stealthDV: 12 } });
    // forged
    send(EX, { ...base, dest: 'wipe', messageIds: ['a3c-boss'] });                            // another account's file
    send(EX, { ...base, accountId: 'boss', dest: 'wipe', messageIds: ['a3c-boss'] });         // an account they never logged into
    if (someoneElses) send(EX, { ...base, dest: 'inbox', messageIds: ['a3c-ops'], targetActorId: someoneElses.id });
    send(SE, { itemUuid: term.uuid, actorId: mine.id, updates: { loggedInAccounts: ['ops', 'ghost'], activeAccountId: 'ops', gmBypassed: true } });
    if (someoneElses) send(SE, { itemUuid: term.uuid, actorId: someoneElses.id, updates: { loggedInAccounts: ['boss'], activeAccountId: 'boss' } });
    send(RE, { itemUuid: term.uuid, resident: { effectType: 'logicBomb', params: { name: 'A3C bomb' }, provenance: { plantedBy: mine.id } } });
    if (someoneElses) send(RE, { itemUuid: term.uuid, resident: { effectType: 'plant', params: { accountId: 'ops', name: 'A3C framed plant' }, provenance: { plantedBy: someoneElses.id } } });
    ui.notifications.info(`A3c test: step 2 sent as ${mine.name}. Now the GM runs the macro again.`);
    return;
  }

  // ── Step 3: GM checks and cleans up ──
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const ids = new Set(svc.getAllMessages?.(term)?.map((m) => m.messageId) ?? game.journal.get(term.getFlag(MOD, 'journalId'))?.pages.map((p) => p.getFlag(MOD, 'messageId')));
  const state = term.getFlag(MOD, 'terminalState') || {};
  const residents = state.residents || [];
  // copies of the test file in inboxes (recovered from the terminal)
  const copies = [];
  for (const j of game.journal) for (const p of j.pages) {
    if (p.getFlag(MOD, 'subject') === SUBJ && j.getFlag(MOD, 'type') !== 'terminal' && j.id !== term.getFlag(MOD, 'journalId')) copies.push({ j, p, owner: j.getFlag(MOD, 'actorId') });
  }
  const pcs = game.actors.filter((a) => a.hasPlayerOwner);
  const twoPcs = pcs.length > 1;
  const honest = !ids.has('a3c-ops2') || copies.length > 0;
  if (!honest) check('The player step reached this GM', false, 'nothing landed — did a player run step 2 with this GM logged in, and can they see the test terminal?');
  else {
    check('Honest: a file copied to the player\'s own Agent', copies.length >= 1);
    check('Honest: a file in their account wiped', !ids.has('a3c-ops2'));
    check('Honest: a plant by their own character installed', residents.some((r) => r.params?.name === 'A3C honest plant'));
    check('Forged: another account\'s file was not wiped', ids.has('a3c-boss'));
    check('Forged: no copy went to someone else\'s character', copies.length <= 1, twoPcs ? `${copies.length} copies` : 'only one player character — check skipped');
    const sessions = state.sessions || {};
    check('Forged: a session write kept to real accounts and session fields', !Object.values(sessions).some((s) => (s.loggedInAccounts || []).includes('ghost') || 'gmBypassed' in s));
    check('Forged: a session for someone else\'s character was refused', !Object.values(sessions).some((s) => (s.loggedInAccounts || []).includes('boss')), twoPcs ? '' : 'only one player character — check skipped');
    check('Forged: a logic bomb was not installed', !residents.some((r) => r.effectType === 'logicBomb'));
    check('Forged: a plant framed on someone else was not installed', !residents.some((r) => r.params?.name === 'A3C framed plant'), twoPcs ? '' : 'only one player character — check skipped');
  }
  for (const c of copies) await c.p.delete();
  await svc.removeTerminal(term, true);
  await term.delete();
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(r.note)}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM A3c test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:11px;opacity:.75">Test terminal and copies deleted. The GM console lists each refused request ("refused: …").</p>` });
})();
