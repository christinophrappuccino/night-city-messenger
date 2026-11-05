// NCM audit fix A3e — "can a player jam a node, forge a trace, write a call log, or trigger an
// emergency arrival without the game allowing it?"
// One macro, three runs (it knows which step it is on):
//   1. GM runs it  → adds a test node "NCM A3e test node" (box locked, nobody jacked in) to the first
//      network, on a scene of its own.
//   2. A PLAYER runs it (a GM must be logged in) → their client sends honest and forged requests over
//      the real socket. Watch the GM's screen during this step: no arrival banner should appear.
//   3. GM runs it again → checks what landed, whispers PASS/FAIL, deletes the node and the test rows.
(async () => {
  const MOD = 'night-city-messenger';
  const NS = game.nightcity;
  const NAME = 'NCM A3e test node';
  const node = () => NS.networkService?.getNodes?.().find((n) => n.name === NAME);

  // ── Step 1: GM setup ──
  if (game.user.isGM && !node()) {
    const net = NS.networkService?.getAllNetworks?.()[0];
    if (!net) { ui.notifications.warn('A3e test: make a network first (Admin → Networks).'); return; }
    const r = await NS.networkService.saveNode({ name: NAME, networkId: net.id, kind: 'router', sceneId: 'a3e-no-scene', state: 'on', security: { requiresAuth: true } });
    if (!r?.success) { ui.notifications.error(`A3e test setup failed: ${r.error}`); return; }
    ui.notifications.info('A3e test: step 1 done. Now a PLAYER runs this macro (keep this GM logged in, and watch for an arrival banner — none should appear), then run it again here.');
    return;
  }

  // ── Step 2: the player's client sends requests ──
  if (!game.user.isGM) {
    if (!game.users.activeGM) { ui.notifications.warn('A3e test: a GM must be logged in for this step.'); return; }
    const n = node();
    if (!n) { ui.notifications.warn('A3e test: run step 1 as the GM first.'); return; }
    const mine = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
    const other = game.actors.find((a) => !a.isOwner && a.hasPlayerOwner && a.type === 'character');
    if (!mine) { ui.notifications.warn('A3e test: this player owns no character.'); return; }
    const sm = NS.socketManager;
    const send = (op, data) => sm.emit(op, { ...data, userId: game.user.id });
    // nodes — no session yet, so these are refused
    send('network:nodeRequest', { op: 'state', nodeId: n.id, state: 'jammed', minutes: 600, who: 'Saburo' });
    send('network:nodeRequest', { op: 'state', nodeId: n.id, state: 'damaged' });
    send('network:nodeRequest', { op: 'effect', nodeId: n.id, kind: 'backdoors', effect: { actorId: mine.id, minutes: 99999 } });
    // a session with absurd numbers: allowed (the jack-in roll is the client's), but clamped
    send('network:nodeRequest', { op: 'run', nodeId: n.id, run: { actorId: mine.id, moves: 99, used: 0, minutes: 99999, rank: 99 } });
    if (other) send('network:nodeRequest', { op: 'run', nodeId: n.id, run: { actorId: other.id, moves: 3, minutes: 60 } });
    // traces
    send('trace:request', { actorId: mine.id, actorName: 'Saburo Arasaka', action: 'a3etest', source: 'A3E honest', outcome: 'success', severity: 'minor' });
    if (other) send('trace:request', { actorId: other.id, actorName: other.name, action: 'a3etest', source: 'A3E forged', outcome: 'failed', severity: 'hostile' });
    // a call log for a call that never happened
    send('call:logRequest', { summary: { callId: 'a3e-fake-call', from: { actorId: mine.id, name: 'A3E' }, to: { actorId: other?.id || mine.id, name: 'A3E' }, outcome: 'answered', lines: [{ text: 'A3E forged' }] } });
    // an arrival banner and an automatic Trauma call, from a player
    send('call:emergency', { op: 'arrive', show: { kind: 'backup', sceneId: '', name: 'A3E', org: 'A3E forged arrival', arriveTitle: 'A3E — this banner should NOT appear' } });
    send('call:emergency', { op: 'auto', userId: game.users.activeGM.id, actorId: mine.id });
    ui.notifications.info(`A3e test: step 2 sent as ${mine.name}. Now the GM runs the macro again.`);
    return;
  }

  // ── Step 3: GM checks and cleans up ──
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const n = node();
  const traceRows = (game.settings.get(MOD, 'traceLog') || []).filter((r) => r.action === 'a3etest');
  const runs = n?.runs || [];
  const pcs = game.actors.filter((a) => a.hasPlayerOwner && a.type === 'character');
  const reached = traceRows.length > 0 || runs.length > 0;
  if (!reached) check('The player step reached this GM', false, 'nothing landed — did a player run step 2 with this GM logged in?');
  else {
    check('Forged: a node cannot be jammed or damaged without a session', n?.state === 'on', `state ${n?.state}`);
    check('Forged: no backdoor without a session', !(n?.backdoors || []).length);
    const run = runs.find((r) => game.actors.get(r.actorId)?.hasPlayerOwner);
    check('A session is held to the rules (moves and minutes)', !!run && run.moves <= 6 && (run.until - run.since) <= 60 * 60000 + 1000, run ? `${run.moves} moves, ${Math.round((run.until - run.since) / 60000)} min` : 'no session saved');
    check('Forged: no session for someone else\'s character', runs.length <= 1, pcs.length > 1 ? '' : 'only one player character — check skipped');
    const honest = traceRows.find((r) => r.source === 'A3E honest');
    check('Honest: a trace for their own character is logged under its real name', !!honest && honest.actorName !== 'Saburo Arasaka', honest ? `named ${honest.actorName}` : 'not logged');
    check('Forged: no trace in someone else\'s name', !traceRows.some((r) => r.source === 'A3E forged'), pcs.length > 1 ? '' : 'only one player character — check skipped');
    let fakeLog = false;
    for (const j of game.journal) for (const p of j.pages) if (p.getFlag(MOD, 'callLog')?.callId === 'a3e-fake-call') { fakeLog = true; await p.delete(); }
    check('Forged: no call log for a call that never happened', !fakeLog);
  }
  // clean up: the node, the test trace rows
  if (n) await NS.networkService.deleteNode(n.id);
  const all = game.settings.get(MOD, 'traceLog') || [];
  if (all.some((r) => r.action === 'a3etest')) await game.settings.set(MOD, 'traceLog', all.filter((r) => r.action !== 'a3etest'));
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(r.note)}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM A3e test: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:11px;opacity:.75">Also check: no arrival banner appeared on this screen during step 2, and no Trauma Team call opened on the player's. Test node and trace rows deleted.</p>` });
})();
