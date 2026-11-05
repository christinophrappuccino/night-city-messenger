// NCM audit fix B5 — "can a cancelled scheduled message still be paid out, and does scheduled mail follow the player's rules?"
// Two parts; the macro knows which one by who runs it:
//   • A PLAYER runs it (with a GM online). It schedules mail from their own character to itself an hour from now:
//       1. a plain one → the GM saves it, then a cancel removes it;
//       2. one carrying 1 eb (taken from the character the way the composer does) → cancelling gives the 1 eb
//          back only after the GM confirms; the character ends where it started;
//       3. one to a send-only address (if the GM has one) → refused at once.
//   • The GM runs it → a scheduled message marked "being delivered" cannot be cancelled; then it is removed.
// Nothing is delivered. Results arrive as a chat card whispered to whoever ran it.
(async () => {
  const MOD = 'night-city-messenger';
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const report = (title) => {
    const all = results.every((r) => r.pass);
    const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
    ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM B5 test (${title}): ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>` });
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sched = game.nightcity?.schedulingService;
  if (!sched) { ui.notifications.error('B5 test: NCM is not loaded.'); return; }
  const SUBJECT = 'NCM B5 test (cancelled, never sent)';
  const later = new Date(Date.now() + 3600000).toISOString();

  // ── GM part ──
  if (game.user.isGM) {
    const id = `b5${foundry.utils.randomID(8)}`;
    sched._scheduled.push({ scheduleId: id, createdBy: game.user.id, messageData: { subject: SUBJECT }, deliveryTime: later, useGameTime: false, status: 'pending', eddiesHeld: 0, delivering: true });
    const r = await sched.cancelScheduled(id);
    check('A message being delivered cannot be cancelled', !r.success && /being delivered/.test(r.error || ''), r.error || 'it was cancelled');
    sched._scheduled = sched._scheduled.filter((e) => e.scheduleId !== id);
    report('GM');
    return;
  }

  // ── Player part ──
  if (!game.users.activeGM) { ui.notifications.warn('B5 test: a GM must be online for this part.'); return; }
  const actor = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
  if (!actor) { ui.notifications.warn('B5 test: this player owns no character.'); return; }
  const email = actor.getFlag(MOD, 'email');
  if (!email) { ui.notifications.warn('B5 test: this character has no NCM address yet (set one up in the Agent first).'); return; }
  const mail = (extra = {}) => ({ fromActorId: actor.id, toActorId: actor.id, to: email, subject: SUBJECT, body: '', ...extra });
  const waitFor = async (fn, ms = 5000) => { for (let t = 0; t < ms; t += 250) { if (fn()) return true; await sleep(250); } return fn(); };

  // 1. plain
  const r1 = await sched.scheduleMessage(mail(), later, { useGameTime: false });
  check('Scheduling waits for the GM and succeeds', r1?.success, r1?.error || '');
  const seen = await waitFor(() => sched.getPending().some((e) => e.messageData?.subject === SUBJECT));
  check('…and the GM saved it (it shows in this player\'s list)', seen);
  const e1 = sched.getPending().find((e) => e.messageData?.subject === SUBJECT);
  if (e1) {
    const c1 = await sched.cancelScheduled(e1.scheduleId);
    check('Cancel is confirmed by the GM', c1?.success, c1?.error || '');
    check('…and it leaves the list', await waitFor(() => !sched.getPending().some((e) => e.scheduleId === e1.scheduleId)));
  }

  // 2. with 1 eb: taken the way the composer takes it, given back only after the GM confirms
  const start = actor.system?.wealth?.value;
  const w = foundry.utils.deepClone(actor.system.wealth);
  w.value -= 1;
  w.transactions.push([`Decreased by 1 to ${w.value}`, 'NCM: Sent 1 eb via message']);
  await actor.update({ 'system.wealth': w });
  const r2 = await sched.scheduleMessage(mail({ eddies: 1 }), later, { useGameTime: false, eddiesHeld: 1 });
  check('A scheduled message carrying 1 eb is accepted', r2?.success, r2?.error || '');
  await waitFor(() => sched.getPending().some((e) => e.messageData?.subject === SUBJECT));
  const e2 = sched.getPending().find((e) => e.messageData?.subject === SUBJECT);
  if (e2) {
    const c2 = await sched.cancelScheduled(e2.scheduleId);
    check('Cancelling it refunds the 1 eb after the GM confirms', c2?.success && c2.refunded === 1, c2?.error || `refunded ${c2?.refunded}`);
  } else check('Cancelling it refunds the 1 eb after the GM confirms', false, 'it never appeared in the list');
  check('The character ends with the money it started with', actor.system?.wealth?.value === start, `${start} → ${actor.system?.wealth?.value}`);

  // 3. send-only
  const sys = game.nightcity.masterContactService?.getAll?.().find((c) => c.sendOnly && c.email);
  if (sys) {
    const r3 = await sched.scheduleMessage(mail({ toActorId: null, to: sys.email }), later, { useGameTime: false });
    check(`Scheduling to the send-only address ${sys.email} is refused`, !r3?.success && r3?.errorCode === 'SEND_ONLY', r3?.error || 'it was accepted');
  } else check('Send-only check skipped', true, 'the GM has no send-only contact in the directory');

  report('player');
})();
