// NCM audit fix B4 — "when two things are saved at the same moment, does one undo the other?"
// Run as the GM. It fires pairs of writes at the same instant through the real services and checks both stay:
//   • two Activity-log rows, two heat bumps, two Outbox failure rows;
//   • two wipes into the recycle bin (from a temporary journal);
//   • two plants + an uplink switch on a temporary terminal item;
//   • two characters' hack sessions + a decrypt on a temporary shard item.
// Everything it makes is removed at the end (test rows, heat, bin records, the journal and both items).
// Results arrive as a chat card whispered to the GM.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('B4 test: run this as the GM.'); return; }
  const MOD = 'night-city-messenger';
  const ns = game.nightcity;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const base = foundry.utils.getRoute('modules/night-city-messenger/scripts');
  let SF;
  try { SF = await import(`${base}/ui/content/SiphonFlow.js`); } catch (err) { ui.notifications.error(`B4 test: could not load NCM modules — ${err.message}`); return; }
  const tag = `b4-${foundry.utils.randomID(6)}`;
  const made = { items: [], journals: [] };

  try {
    // ── Activity log + heat ──
    await Promise.all([
      ns.traceService.recordTrace({ outcome: 'success', action: tag, objectName: 'B4 test' }),
      ns.traceService.recordTrace({ outcome: 'success', action: tag, objectName: 'B4 test' }),
    ]);
    check('Two Activity-log rows at once: both kept', ns.traceService.getLog().filter((r) => r.action === tag).length === 2);
    const before = ns.traceService.getHeat(tag, 'b4');
    await Promise.all([ns.traceService.bumpHeat(tag, 'b4', 10), ns.traceService.bumpHeat(tag, 'b4', 5)]);
    const after = ns.traceService.getHeat(tag, 'b4');
    check('Two heat bumps at once: both count', after - before === 15, `${before} → ${after}`);

    // ── Outbox failure rows ──
    await Promise.all([
      ns.messageService.recordDeliveryFailure({ data: { messageId: `${tag}a`, subject: tag }, result: { error: 'test' } }),
      ns.messageService.recordDeliveryFailure({ data: { messageId: `${tag}b`, subject: tag }, result: { error: 'test' } }),
    ]);
    check('Two Outbox failure rows at once: both kept', ns.messageService.getDeliveryFailures().filter((r) => r.subject === tag).length === 2);

    // ── Recycle bin ──
    const [j] = await JournalEntry.createDocuments([{ name: `NCM B4 test (delete me)`, ownership: { default: 0 }, pages: ['one', 'two', 'three'].map((n) => ({ name: n, type: 'text', text: { content: '' }, flags: { [MOD]: { messageId: `${tag}-${n}` } } })) }]);
    made.journals.push(j);
    const carrier = { id: 'carrier', parent: j };
    await Promise.all([
      SF._applyNativeEffect('wipe', { page: carrier, hostItem: null, actor: null, cd: { effect: { params: { messageIds: [`${tag}-one`, `${tag}-two`] } } } }),
      SF._applyNativeEffect('wipe', { page: carrier, hostItem: null, actor: null, cd: { effect: { params: { messageIds: [`${tag}-three`] } } } }),
    ]);
    const binned = SF.getRecycleBin().filter((r) => r.journalId === j.id);
    check('Two wipes at once: every file is in the recycle bin', binned.length === 3, `${binned.length} of 3 binned`);
    check('…and only binned files were deleted', j.pages.size === 0, `${j.pages.size} page(s) left`);
    await SF.emptyRecycleBin(binned.map((r) => r.id));

    // ── Terminal state ──
    const [term] = await Item.createDocuments([{ name: 'NCM B4 test terminal (delete me)', type: 'gear', flags: { [MOD]: { isTerminal: true, terminalState: {} } } }]);
    made.items.push(term);
    await Promise.all([
      ns.terminalService.installResident(term, { effectType: 'plant', trigger: { kind: 'onLogin' } }),
      ns.terminalService.setUplink(term, null),
      ns.terminalService.installResident(term, { effectType: 'keylog', trigger: { kind: 'onLogin' } }),
    ]);
    const st = term.getFlag(MOD, 'terminalState') || {};
    check('Two plants beside an uplink switch: both plants stay', (st.residents || []).length === 2, `${(st.residents || []).length} of 2`);
    check('…and the uplink switch stays', st.connection?.currentNetworkId === null);

    // ── Shard state ──
    const [shard] = await Item.createDocuments([{ name: 'NCM B4 test shard (delete me)', type: 'gear', flags: { [MOD]: { isDataShard: true, state: {} } } }]);
    made.items.push(shard);
    const ds = ns.dataShardService;
    await Promise.all([ds._updateActorSession(shard, 'b4a', { hackAttempts: 2 }), ds._updateActorSession(shard, 'b4b', { hackAttempts: 1 }), ds._writeDecrypted(shard)]);
    const ss = shard.getFlag(MOD, 'state') || {};
    check('Two hack sessions and a decrypt at once: all stay', ss.sessions?.b4a?.hackAttempts === 2 && ss.sessions?.b4b?.hackAttempts === 1 && ss.decrypted === true);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    // ── clean up ──
    try {
      await game.settings.set(MOD, 'traceLog', ns.traceService.getLog().filter((r) => r.action !== tag));
      const heat = foundry.utils.deepClone(ns.traceService.getHeatMap()); delete heat[tag];
      await game.settings.set(MOD, 'traceHeat', heat);
      await game.settings.set(MOD, 'deliveryFailures', ns.messageService.getDeliveryFailures().filter((r) => r.subject !== tag));
      for (const i of made.items) await i.delete();
      for (const j of made.journals) await j.delete();
    } catch (err) { check('Clean-up', false, err.message); }
  }

  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM B4 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>` });
})();
