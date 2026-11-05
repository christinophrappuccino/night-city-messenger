// NCM stage 2, batch 3 — one eddies helper. Every change to a character's money goes through utils/wealth.js,
// which queues changes per character so two at once can't erase each other.
// Run as the GM. It creates a throwaway character "NCM wealth test (delete me)", changes its eddies, reads the
// CPR ledger back, then deletes the character. Nothing else is touched. Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Batch 3 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  let actor = null;
  try {
    const { adjustWealth } = await import('/modules/night-city-messenger/scripts/utils/wealth.js');
    actor = await Actor.create({ name: 'NCM wealth test (delete me)', type: 'character' });
    const w0 = actor.system?.wealth;
    check('A Cyberpunk RED character has a wealth block', !!w0 && typeof w0 === 'object', JSON.stringify(w0)?.slice(0, 80));
    const start = Number(w0?.value) || 0;
    const lines0 = Array.isArray(w0?.transactions) ? w0.transactions.length : 0;

    // three changes at the same moment (a claim, a refund, a payment)
    await Promise.all([
      adjustWealth(actor, 500, 'NCM test: claim'),
      adjustWealth(actor, 250, 'NCM test: refund'),
      adjustWealth(actor, -100, 'NCM test: payment'),
    ]);
    const w1 = actor.system.wealth;
    check('Three changes at once all count', w1.value === start + 650, `${start} + 500 + 250 − 100 = ${w1.value}`);
    const added = (w1.transactions || []).slice(lines0);
    check('Each change wrote one CPR ledger line', added.length === 3, added.map((t) => t[0]).join(' · '));
    check('Ledger lines read like Cyberpunk RED\'s own', added[0]?.[0] === `Increased by 500 to ${start + 500}` && added[2]?.[0] === `Decreased by 100 to ${start + 650}`, added[0]?.[0]);

    // the composer's floor
    await adjustWealth(actor, -(start + 10000), 'NCM test: overspend', { floor: 0 });
    check('The message composer\'s rule still holds: a payment never goes below 0', actor.system.wealth.value === 0, `balance ${actor.system.wealth.value}`);

    // the real flows use it
    const ms = game.nightcity?.messageService, ss = game.nightcity?.schedulingService;
    check('Undelivered-message refunds use the helper', /adjustWealth/.test(String(ms?._refundHeld)));
    check('Scheduled-message refunds use the helper', /adjustWealth/.test(String(ss?._refund)));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    if (actor) { try { await actor.delete(); } catch (e) { check('The test character was deleted', false, e.message); } }
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, batch 3: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real checks: send a message with eddies attached, then Claim it as the recipient (both balances and both ledgers move once). In a terminal, sell a file; on a shard, claim a cred drop; in the Shard Encoder, buy a blank. Each ledger line should read as before.</p>` });
})();
