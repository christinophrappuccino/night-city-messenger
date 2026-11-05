// NCM audit fix B3 — "can a slow GM, a retry or a lost answer make a message arrive twice, or give money back
// for a message that arrived anyway?"
// Two parts; the macro knows which one by who runs it:
//   • A PLAYER runs it (with a GM online). It mails their own character three times through the real relay:
//       1. a normal send, then the SAME message again (a Retry) → it must arrive once;
//       2. a send whose wait is cut to 1 ms, so it "times out" before the GM answers → it must be HELD
//          (not failed, nothing refunded), then settle by itself when the GM's answer comes in.
//   • The GM runs it afterwards → it deletes the test mail ("NCM B3 test (delete me)") from every inbox.
// Results arrive as a chat card whispered to whoever ran it.
(async () => {
  const MOD = 'night-city-messenger';
  const SUBJECT = 'NCM B3 test (delete me)';
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const report = (title) => {
    const all = results.every((r) => r.pass);
    const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
    ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM B3 test (${title}): ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>` });
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const svc = game.nightcity?.messageService;
  if (!svc) { ui.notifications.error('B3 test: NCM is not loaded.'); return; }

  // ── GM part: clean up ──
  if (game.user.isGM) {
    let n = 0;
    for (const j of game.journal) {
      const ids = j.pages.filter((p) => p.flags?.[MOD]?.subject === SUBJECT).map((p) => p.id);
      if (ids.length) { await j.deleteEmbeddedDocuments('JournalEntryPage', ids); n += ids.length; }
    }
    check('Test mail removed', true, `${n} page(s) deleted`);
    report('GM, clean-up');
    return;
  }

  // ── Player part ──
  if (!game.users.activeGM) { ui.notifications.warn('B3 test: a GM must be online for this part.'); return; }
  const actor = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
  if (!actor) { ui.notifications.warn('B3 test: this player owns no character.'); return; }
  const count = (id) => {
    let got = 0, sent = 0;
    for (const j of game.journal) for (const p of j.pages) {
      const m = p.flags?.[MOD]?.messageId;
      if (m === id) got += 1; else if (m === `${id}-sent`) sent += 1;
    }
    return { got, sent };
  };
  const mail = (sendKey, body) => svc.sendMessage({ fromActorId: actor.id, toActorId: actor.id, subject: SUBJECT, body, sendKey });
  const wealthBefore = actor.system?.wealth?.value;

  // 1. send, then the same message again
  const key1 = foundry.utils.randomID();
  const r1 = await mail(key1, 'First send.');
  check('The first send is delivered', r1?.success && !r1.queued, r1?.error || (r1?.queued ? `held: ${r1.reason}` : ''));
  const r2 = await mail(key1, 'The same message again (a Retry).');
  check('Sending the same message again reports success', r2?.success && !r2.queued, r2?.error || '');
  await sleep(1500);
  const c1 = count(key1);
  check('…but it arrived only once', c1.got === 1 && c1.sent === 1, `received ${c1.got}, sent copies ${c1.sent}`);

  // 2. the answer comes too late: held, then settled
  const Cls = svc.constructor;
  const keep = Cls.RELAY_ACK_TIMEOUT_MS;
  const key2 = foundry.utils.randomID();
  let r3;
  try {
    Cls.RELAY_ACK_TIMEOUT_MS = 1;
    r3 = await mail(key2, 'A send whose answer comes late.');
  } finally { Cls.RELAY_ACK_TIMEOUT_MS = keep; }
  check('No answer in time → held as "no answer", not failed', r3?.success && r3.queued && r3.reason === 'no_answer', r3?.error || (r3?.queued ? r3.reason : 'not held'));
  let settled = false;
  for (let i = 0; i < 20 && !settled; i += 1) { await sleep(500); settled = !svc._messageQueue.some((d) => d.messageId === key2); }
  check('The GM\'s late answer settles it by itself', settled, settled ? '' : 'still held after 10 s');
  const c2 = count(key2);
  check('It arrived once', c2.got === 1, `received ${c2.got}`);
  check('Nothing was refunded or charged', actor.system?.wealth?.value === wealthBefore, `wealth ${wealthBefore} → ${actor.system?.wealth?.value}`);

  report('player');
  ui.notifications.info('B3 test: done. Ask the GM to run this macro once to delete the test mail.');
})();
