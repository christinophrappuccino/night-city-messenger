// NCM audit fix A3a — "can a player rewrite content they don't own through the relay?"
// One macro, three runs (it knows which step it is on):
//   1. GM runs it  → creates two test journals ("NCM A3a test …") with a few typed entries.
//   2. A PLAYER runs it (give them the macro, or paste it as a player) → their client sends
//      honest and forged requests over the real socket, exactly as a modified client could.
//      A GM must be logged in for this step.
//   3. GM runs it again → checks what landed, whispers PASS/FAIL, deletes the test journals.
//
// Side effects: two temporary journals, deleted in step 3. The player's wealth is not touched
// (the requests are sent directly; nothing is credited).
(async () => {
  const MOD = 'night-city-messenger';
  const NAME = 'NCM A3a test (delete me)';
  const PRIVATE = 'NCM A3a test — private (delete me)';
  const shared = game.journal.find((j) => j.getFlag(MOD, 'a3aTest') === 'shared');
  const priv = game.journal.find((j) => j.getFlag(MOD, 'a3aTest') === 'private');
  const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER, NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  const pg = (id, contentType, contentData) => ({ name: id, type: 'text', text: { content: '' }, flags: { [MOD]: { type: 'shard-message', messageId: id, contentType, contentData } } });

  // ── Step 1: GM setup ──
  if (game.user.isGM && !shared) {
    await JournalEntry.create({ name: NAME, ownership: { default: OBS }, flags: { [MOD]: { a3aTest: 'shared' } },
      pages: [
        pg('a3a-edd', 'eddies', { amount: 500 }),
        pg('a3a-edd2', 'eddies', { amount: 200 }),
        pg('a3a-claimed', 'eddies', { amount: 500, claimed: true, claimedBy: 'someone' }),
        pg('a3a-bank', 'banking', { balance: 10000, siphonMode: 'cap', siphonCap: 2000, accountName: 'A3a Ops', transactions: [] }),
        pg('a3a-bank2', 'banking', { balance: 10000, siphonMode: 'cap', siphonCap: 2000, accountName: 'A3a Reserve', transactions: [] }),
        pg('a3a-mal', 'malware', { deployable: true, honeypot: true, name: 'Bait.exe' }),
        pg('a3a-creds', 'credentials', { entries: [{ host: 'arasaka', encrypted: true }] }),
      ] });
    await JournalEntry.create({ name: PRIVATE, ownership: { default: NONE }, flags: { [MOD]: { a3aTest: 'private' } },
      pages: [pg('a3a-private', 'eddies', { amount: 100 })] });
    ui.notifications.info('A3a test: step 1 done. Now a PLAYER runs this macro (keep this GM logged in), then run it again here.');
    return;
  }

  // ── Step 2: the player's client sends requests ──
  if (!game.user.isGM) {
    if (!game.users.activeGM) { ui.notifications.warn('A3a test: a GM must be logged in for this step.'); return; }
    const mine = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
    const someoneElses = game.actors.find((a) => !a.isOwner && a.hasPlayerOwner);
    if (!mine) { ui.notifications.warn('A3a test: this player owns no character.'); return; }
    const sm = game.nightcity.socketManager;
    const send = (op, data) => sm.emit(op, { ...data, userId: game.user.id });
    const OPS = { CU: 'content:updateRequest', BS: 'bank:siphonRequest' };
    // honest requests
    send(OPS.CU, { messageId: 'a3a-edd', intent: { action: 'claim' }, actorId: mine.id });
    send(OPS.CU, { messageId: 'a3a-creds', intent: { action: 'crack', index: 0 }, actorId: mine.id });
    send(OPS.BS, { outcome: 'success', messageId: 'a3a-bank', amount: 1500, actorId: mine.id });
    // forged requests
    send(OPS.CU, { messageId: 'a3a-claimed', newContentData: { amount: 999999, claimed: false }, gmToast: 'A3A forged toast' });
    send(OPS.CU, { messageId: 'a3a-private', intent: { action: 'claim' }, actorId: mine.id });
    send(OPS.BS, { outcome: 'success', messageId: 'a3a-bank2', amount: 9000, actorId: mine.id, newContentData: { balance: 99999999 } });
    send(OPS.CU, { messageId: 'a3a-mal', intent: { action: 'deploy', tripped: false }, actorId: mine.id });
    if (someoneElses) send(OPS.CU, { messageId: 'a3a-edd2', intent: { action: 'claim' }, actorId: someoneElses.id });
    ui.notifications.info(`A3a test: step 2 sent as ${mine.name}. Now the GM runs the macro again.`);
    return;
  }

  // ── Step 3: GM checks and cleans up ──
  const cd = (id) => [shared, priv].flatMap((j) => j?.pages.contents || []).find((p) => p.getFlag(MOD, 'messageId') === id)?.getFlag(MOD, 'contentData') || {};
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const edd = cd('a3a-edd'), claimed = cd('a3a-claimed'), bank = cd('a3a-bank'), bank2 = cd('a3a-bank2'), mal = cd('a3a-mal'), creds = cd('a3a-creds'), pv = cd('a3a-private');
  const sent = !!edd.claimed || !!creds.entries?.[0]?.cracked;
  if (!sent) check('The player step reached this GM', false, 'nothing landed — did a player run step 2 with this GM logged in?');
  else {
    check('Honest: a player claims eddies they can see', edd.claimed === true && !!edd.claimedBy);
    check('Honest: a player cracks a login', creds.entries?.[0]?.cracked === true);
    check('Honest: a siphon drains within the account\'s cap', bank.balance === 8500 && bank.siphoned === true, `balance ${bank.balance}`);
    check('Forged: a whole new contentData is ignored', claimed.claimed === true && claimed.amount === 500, `claimed ${claimed.claimed}, amount ${claimed.amount}`);
    check('Forged: a forged GM toast was not shown', ![...document.querySelectorAll('#notifications li')].some((li) => li.textContent.includes('A3A forged toast')));
    check('Forged: a claim on a journal the player cannot see is refused', !pv.claimed);
    check('Forged: a siphon over the cap (with a sent balance) is refused', bank2.balance === 10000 && !bank2.siphoned, `balance ${bank2.balance}`);
    check('Forged: a honeypot cannot be deployed "clean"', mal.deployed === true && mal.tripped === true);
    const edd2 = cd('a3a-edd2');
    const otherPc = game.actors.filter((a) => a.hasPlayerOwner).length > 1;
    check('Forged: claiming as someone else\'s character is refused', !edd2.claimed, otherPc ? '' : 'skipped — the world has only one player character');
  }
  await shared?.delete();
  await priv?.delete();
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(r.note)}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM A3a test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:11px;opacity:.75">Test journals deleted. The GM console lists each refused request ("refused: …").</p>` });
})();
