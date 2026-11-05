// NCM audit fix D5 — "does Admin → Messages stop re-scanning all mail on every redraw, and is the recycle bin sane?"
// Run as the GM after a reload (F5). It:
//   1. checks the recycle-bin migration ran (the old world setting is empty);
//   2. opens Admin → Messages and checks two redraws with no mail change reuse one scan, and a mail change rescans;
//   3. wipes a test page: ONE page goes into the GM-only bin journal (with no message id of its own), the file is
//      gone, the Security tab's bin can see it; then Restore brings it back and it leaves the bin;
//   4. checks heat that has cooled to 0 is dropped instead of kept.
// Everything it makes (a test journal, a heat entry) is removed at the end.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('D5 test: run this as the GM.'); return; }
  const MOD = 'night-city-messenger';
  const ns = game.nightcity;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = foundry.utils.getRoute('modules/night-city-messenger/scripts');
  let SF;
  try { SF = await import(`${base}/ui/content/SiphonFlow.js`); } catch (err) { ui.notifications.error(`D5 test: could not load NCM modules — ${err.message}`); return; }
  let test = null;

  try {
    // 1. migration
    let legacy = [];
    try { legacy = game.settings.get(MOD, 'recycleBin') || []; } catch { /* gone */ }
    check('The old recycle-bin setting is empty (moved into the bin journal)', !legacy.length, legacy.length ? `${legacy.length} entries still there — did the reload run the v6 migration?` : `${SF.getRecycleBin().length} file(s) in the bin`);

    // 2. the scan cache
    await ns.openAdminTab?.('messages');
    await sleep(1200);
    const app = [...(foundry.applications?.instances?.values?.() || [])].find((a) => a.constructor?.name === 'AdminPanelApp' && a.tabs?.messages);
    const tab = app?.tabs?.messages;
    if (!tab) throw new Error('Admin → Messages did not open');
    const s1 = tab._scanInboxes(), s2 = tab._scanInboxes();
    check('Two redraws with no mail change reuse one scan', s1 === s2);
    [test] = await JournalEntry.createDocuments([{ name: 'NCM D5 test (delete me)', ownership: { default: 0 }, pages: [{ name: 'Wipe me', type: 'text', text: { content: '' }, flags: { [MOD]: { messageId: `d5${foundry.utils.randomID(6)}`, contentType: 'message', subject: 'Wipe me' } } }] }]);
    await sleep(300);
    check('A mail change makes it scan again', tab._scanInboxes() !== s2);

    // 3. the bin
    const before = SF.getRecycleBin().length;
    const msgId = test.pages.contents[0].getFlag(MOD, 'messageId');
    await SF._applyNativeEffect('wipe', { page: { id: 'carrier', parent: test }, hostItem: null, actor: null, cd: { effect: { params: { messageIds: [msgId] } } } });
    await sleep(300);
    const bin = SF.recycleJournal();
    const rec = SF.getRecycleBin().find((r) => r.pageName === 'Wipe me');
    check('A wipe puts ONE page in the GM-only bin journal and removes the file', !!rec && SF.getRecycleBin().length === before + 1 && test.pages.size === 0 && bin?.ownership?.default === 0);
    check('…and the bin page carries no message id of its own', !(bin?.pages?.contents || []).some((p) => p.flags?.[MOD]?.messageId === msgId));
    if (rec) {
      const okRestore = await SF.restoreWiped(rec.id);
      await sleep(300);
      check('Restore puts it back and it leaves the bin', okRestore && test.pages.size === 1 && !SF.getRecycleBin().some((r) => r.id === rec.id));
    }

    // 4. heat
    const tag = `d5heat${foundry.utils.randomID(4)}`;
    await ns.traceService.setHeat(tag, 'd5', 0);
    check('Heat set to 0 is dropped instead of kept', !ns.traceService.getHeatMap()?.[tag]);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    try { if (test && game.journal.get(test.id)) await test.delete(); } catch { /* best effort */ }
  }

  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM D5 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Also look at Admin → Security → Recycle Bin: earlier wipes should be listed now (the card used to always read empty).</p>` });
})();
