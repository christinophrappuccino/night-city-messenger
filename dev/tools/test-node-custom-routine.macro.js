// NCM batch (tester 2026-11-05): CUSTOM network routines. The Workshop's Custom routine now goes on nodes too
// (Malware → Network → Custom routine): a description the GM rules on and/or a GM macro, fired when it is inserted,
// when someone else jacks in, or both. Run as a GM; needs two characters (the first two with a player owner).
// Self-contained: it makes a temporary GM macro, a temporary shard on the first character holding a routine built by
// the REAL Workshop mapping (Fires: both, runs that macro), and a temporary node; inserts, jacks in as the second
// character, checks, then deletes all three. Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const MID = 'night-city-messenger';
  let nodeId = null, item = null, macro = null;
  try {
    if (!game.user.isGM) throw new Error('Run as a GM');
    const NCM = game.nightcity, ns = NCM.networkService, api = NCM.messenger;
    const { PROGRAM_EFFECTS } = await import(`/modules/${MID}/scripts/ui/content/ContentRenderers.js`);
    const { abilitiesFor, programToEntry, defaultProgram } = await import(`/modules/${MID}/scripts/ui/content/ProgramModel.js`);
    check('The registry has the node Custom routine', PROGRAM_EFFECTS.nodeCustom?.modes?.join() === 'node');
    check('The Workshop offers it under malware', abilitiesFor('malware').some((a) => a.key === 'nodeCustom'));

    const pcs = game.actors.filter((a) => a.hasPlayerOwner);
    const [planter, runner] = pcs.length >= 2 ? pcs : game.actors.contents.slice(0, 2);
    if (!planter || !runner) throw new Error('Needs two characters');

    // a GM-written macro that records each run
    globalThis.__ncmRoutineRuns = [];
    macro = await Macro.create({ name: 'NCM test — routine macro', type: 'script',
      command: 'globalThis.__ncmRoutineRuns.push({ trigger: scope.trigger, node: scope.node?.id, runner: scope.runner?.id || null, planter: scope.planter?.id || null });' });

    // a shard on the planter carrying a routine built the way the Workshop builds it
    const type = (game.documentTypes.Item || []).includes('gear') ? 'gear' : (game.documentTypes.Item || []).filter((t) => t !== 'base')[0];
    [item] = await planter.createEmbeddedDocuments('Item', [{ name: 'Routine test shard (TEST)', type }]);
    const conv = await api.convertToDataShard(item, { shardName: 'ROUTINE TEST' });
    check('A test shard was made on ' + planter.name, !!conv?.success, conv?.error || '');
    const entry = programToEntry({ ...defaultProgram('malware'), verb: 'nodeCustom', progName: 'Ghostwire (TEST)', description: 'The lights on the floor flicker.',
      mode: 'macro', macroId: macro.id, params: { fireOn: 'both' } });
    const add = await NCM.dataShardService.addMessage(item, { ...entry, timestamp: new Date().toISOString() });
    const e = (NCM.dataShardService.getShardMessages(item) || []).find((m) => m.contentData?.uploadEffect === 'nodeCustom');
    check('The routine is on the shard', !!e && e.contentData?.effect?.macroId === macro.id, add?.error || '');
    if (!e) throw new Error('no routine on the shard');

    const net = ns.getAllNetworks()[0];
    const made = await ns.saveNode({ name: 'NCM test node', networkId: net.id, sceneId: canvas.scene?.id || null, kind: 'relay' });
    nodeId = made?.node?.id;
    check('A test node was made', !!nodeId, made?.error || '');

    const chats0 = game.messages.size;
    const r = await ns.insertProgram(nodeId, 'custom', { name: 'spoofed name', actorId: planter.id, actorName: planter.name, quality: 80, stealthDV: 14,
      params: { fireOn: 'insert' }, source: { itemUuid: item.uuid, entryId: e.id } });
    await wait(1000);
    const inf = ns.getNode(nodeId)?.infections?.find((x) => x.kind === 'custom');
    check('It installs as a custom routine', !!r?.success && !!inf, r?.error || '');
    check('Its name, words and "fires" come from the shard, not the request', inf?.name === 'Ghostwire (TEST)' && inf?.description === 'The lights on the floor flicker.' && inf?.fireOn === 'both', `${inf?.name} · ${inf?.fireOn}`);
    check('It fired on insert: a GM card', game.messages.size > chats0);
    const r1 = globalThis.__ncmRoutineRuns[0];
    check('…and the macro ran, told it was the insert', r1?.trigger === 'insert' && r1?.node === nodeId && r1?.planter === planter.id, JSON.stringify(r1 || {}));

    await ns.noteJackIn(nodeId, planter.id);
    await wait(500);
    check(`${planter.name} (its planter) jacking in does nothing`, globalThis.__ncmRoutineRuns.length === 1);
    const j = await ns.noteJackIn(nodeId, runner.id);
    await wait(1000);
    const r2 = globalThis.__ncmRoutineRuns[1];
    check(`${runner.name} jacking in fires it`, j?.fired === 1 && r2?.trigger === 'jackIn' && r2?.runner === runner.id, JSON.stringify(r2 || {}));
    check('…once', (await ns.noteJackIn(nodeId, runner.id))?.fired === 0);
    check('The inspector line says it fired on a jack-in', !!ns.getNode(nodeId)?.infections?.find((x) => x.kind === 'custom')?.jackFiredAt);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    try { if (nodeId) await game.nightcity.networkService.deleteNode(nodeId); } catch { /* gone */ }
    try {
      const jid = item?.getFlag?.(MID, 'journalId');
      if (item) await item.delete();
      if (jid) await game.journal.get(jid)?.delete();
    } catch { /* gone */ }
    try { if (macro) await macro.delete(); } catch { /* gone */ }
    delete globalThis.__ncmRoutineRuns;
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM custom network routine: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check, two clients: make a Custom routine in the Workshop (Malware → Network), save it to a shard a player carries; the player jacks into a node and uses Insert. You get the card (and its macro runs, if a GM wrote it). A second player jacks in: a jack-in routine fires once. A sweep can find it; Patch cleans it; the Node Inspector shows when it fires.</p>` });
})();
