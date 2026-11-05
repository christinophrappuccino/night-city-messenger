// NCM audit fix E1 — "do these message fields survive being saved?"
// Run as the GM. It saves ONE test message into the inbox of the first player character, reads it back through the
// module's own reader, checks three fields that used to be thrown away, then deletes the test page again.
//   - signalDegradation (the low-signal garble + Reconstruct roll)
//   - isBroadcast (the broadcast icon in Admin → Messages)
//   - metadata.tapLog (a tapped conversation's running log)
// Results arrive as a chat card whispered to you.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('E1 test: run this as the GM.'); return; }
  const ns = game.nightcity;
  const repo = ns?.messageRepository;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const pc = game.actors.find((a) => a.hasPlayerOwner && a.type === 'character');
  if (!repo || !pc) { ui.notifications.warn('E1 test: needs NCM loaded and one player character.'); return; }

  const id = `e1-test-${foundry.utils.randomID()}`;
  let page = null;
  try {
    const res = await repo.createMessage(pc.id, {
      messageId: id, from: 'e1-test@nightcity.net', to: 'e1-test@nightcity.net', toActorId: pc.id,
      subject: '[E1 TEST — safe to delete]', body: '<p>E1 persistence test.</p>', timestamp: new Date().toISOString(),
      isBroadcast: true,
      signalDegradation: { originalSignal: 18, corruptionLevel: 'heavy', reconstructed: false, reconstructDC: 18, reconstructSkill: 'Electronics/Security Tech' },
      status: { read: true },
      metadata: { tapLog: [{ who: 'V', what: 'Meet at the Afterlife.' }] },
    });
    page = res?.page;
    check('The test message was saved', !!res?.success, res?.error || '');
    if (page) {
      const back = repo._pageToMessage(page);
      check('Low-signal garble survives', back.signalDegradation?.corruptionLevel === 'heavy' && back.signalDegradation?.reconstructDC === 18);
      check('A broadcast stays a broadcast', back.isBroadcast === true);
      check('A tapped conversation\'s log survives', back.metadata?.tapLog?.[0]?.what === 'Meet at the Afterlife.');
    }
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    try { await page?.delete(); } catch { /* best effort */ }
  }

  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM E1 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Optional real check: as a PLAYER on a network under 50% signal, send a message. The recipient should see it garbled, with a Reconstruct button. The GM's own sends never garble.</p>` });
})();
