// NCM audit fix E3 — "are copies quiet, and do flag writes touch only what changed?"
// Run as the GM. It saves ONE test message into the first player character's inbox, marks it read the way the
// module does, watches exactly which fields Foundry is asked to change, then deletes the test page. The toast rules
// are checked directly. Results arrive as a chat card whispered to you.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('E3 test: run this as the GM.'); return; }
  const ns = game.nightcity;
  const repo = ns?.messageRepository;
  const pc = game.actors.find((a) => a.hasPlayerOwner && a.type === 'character');
  if (!repo || !pc) { ui.notifications.warn('E3 test: needs NCM loaded and one player character.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const MOD = 'night-city-messenger';
  let page = null, hook = null;
  try {
    // 1. The toast rules
    const { isNewMailPage } = await import('/modules/night-city-messenger/scripts/integrations/DocumentSyncBridge.js');
    check('New mail still toasts', isNewMailPage({ status: {} }));
    check('Tap and exfil copies, read tap logs and files do not', !isNewMailPage({ status: {}, metadata: { recovered: true } }) && !isNewMailPage({ status: { read: true } }) && !isNewMailPage({ status: {}, envelope: 'file' }));

    // 2. A flag write touches only what changed
    const id = `e3-test-${foundry.utils.randomID()}`;
    const res = await repo.createMessage(pc.id, { messageId: id, from: 'e3-test@nightcity.net', to: 'e3-test@nightcity.net', toActorId: pc.id,
      subject: '[E3 TEST — safe to delete]', body: '<p>E3 test.</p>', timestamp: new Date().toISOString(), eddies: 50, status: { read: false, eddiesClaimed: true } });
    page = res?.page;
    if (!page) throw new Error(res?.error || 'the test message was not saved');
    let asked = null;
    hook = Hooks.on('preUpdateJournalEntryPage', (doc, changes) => { if (doc.id === page.id) asked = foundry.utils.flattenObject(changes); });
    await repo.updateMessageFlags(pc.id, id, { status: { read: true } });
    const keys = Object.keys(asked || {}).filter((k) => k.startsWith(`flags.${MOD}`));
    check('Marking read asks Foundry to change only the read flag', keys.length === 1 && keys[0] === `flags.${MOD}.status.read`, keys.join(', ') || 'nothing was written');
    const after = page.getFlag(MOD, 'status') || {};
    check('…and the claimed eddies stay claimed', after.read === true && after.eddiesClaimed === true);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    if (hook !== null) Hooks.off('preUpdateJournalEntryPage', hook);
    try { await page?.delete(); } catch { /* best effort */ }
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM E3 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Optional real checks (two clients): a player with a live tap on a node gets NO "new message" toast when a tapped mail is copied to them. With a second GM logged in, that GM is not toasted for players' mail.</p>` });
})();
