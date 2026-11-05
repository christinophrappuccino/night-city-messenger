// NCM audit fix A3d — "can a player send mail as someone else, attach money they never paid,
// cancel someone else's scheduled mail, push a fake contact, or unmask someone else's mail?"
// One macro, three runs (it knows which step it is on):
//   1. GM runs it  → puts a traceable anonymous test message in every player character's inbox
//      and schedules one test message (from the GM) for next year.
//   2. A PLAYER runs it (a GM must be logged in) → their client sends honest and forged requests
//      over the real socket. Test mail goes to their OWN character only.
//   3. GM runs it again → checks what landed, whispers PASS/FAIL, deletes every test message and
//      the scheduled one.
(async () => {
  const MOD = 'night-city-messenger';
  const NS = game.nightcity;
  const pcs = game.actors.filter((a) => a.hasPlayerOwner && a.type === 'character');
  const STAMP = 'a3dTest';
  const scheduled = () => (NS.schedulingService?._scheduled || []).find((e) => e.messageData?.subject === 'A3D scheduled');
  const testPages = () => {
    const out = [];
    for (const j of game.journal) for (const p of j.pages) if (/^A3D /.test(p.getFlag(MOD, 'subject') || '')) out.push(p);
    return out;
  };
  // Removes everything any earlier run left behind: test mail, the scheduled message, the fake contact.
  const cleanUp = async () => {
    for (const p of testPages()) await p.delete();
    for (const e of (NS.schedulingService?._scheduled || []).filter((x) => x.messageData?.subject === 'A3D scheduled')) await NS.schedulingService.cancelScheduled(e.scheduleId);
    for (const a of pcs) {
      const list = a.getFlag(MOD, 'contacts') || [];
      const keep = list.filter((c) => c.name !== 'A3D Evil Contact');
      if (keep.length !== list.length) await a.setFlag(MOD, 'contacts', keep);
    }
  };
  // Which step: the GM's set-up leaves an anonymous test message in each character's inbox.
  const setUp = testPages().some((p) => /^a3d-anon-/.test(p.getFlag(MOD, 'messageId') || ''));

  // ── Step 1: GM setup (starts from a clean slate every time) ──
  if (game.user.isGM && !setUp) {
    try {
      await cleanUp();
      for (const a of pcs) {
        await NS.messageRepository.createMessage(a.id, {
          messageId: `a3d-anon-${a.id}`, subject: 'A3D anon test', body: 'traceable anonymous test',
          from: 'masked@anon.nc', fromActorId: '', fromContactId: '', toActorId: a.id, to: '',
          anonymous: { enabled: true, alias: 'A3D', traceable: true, traceDV: 99, style: 'scrambled' },
          timestamp: new Date().toISOString(), status: { read: true }, metadata: { [STAMP]: true },
        });
      }
      const next = new Date(Date.now() + 365 * 86400000).toISOString();
      const r = await NS.schedulingService.scheduleMessage({ fromActorId: pcs[0]?.id, toActorId: pcs[0]?.id, subject: 'A3D scheduled', body: 'test' }, next, { useGameTime: false });
      if (!r?.success) throw new Error(r?.error || 'schedule failed');
    } catch (err) { ui.notifications.error(`A3d test setup failed: ${err.message}`); return; }
    ui.notifications.info('A3d test: step 1 done. Now a PLAYER runs this macro (keep this GM logged in), then run it again here.');
    return;
  }

  // ── Step 2: the player's client sends requests ──
  if (!game.user.isGM) {
    if (!game.users.activeGM) { ui.notifications.warn('A3d test: a GM must be logged in for this step.'); return; }
    const mine = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
    const other = game.actors.find((a) => !a.isOwner && a.hasPlayerOwner && a.type === 'character');
    if (!mine) { ui.notifications.warn('A3d test: this player owns no character.'); return; }
    const sm = NS.socketManager;
    const send = (op, data) => sm.emit(op, { ...data, userId: game.user.id });
    const mail = (id, extra) => ({ messageId: id, toActorId: mine.id, to: '', subject: id, body: 'A3D test mail', timestamp: new Date().toISOString(), status: { read: false }, priority: 'normal', fromActorId: mine.id, ...extra });
    // honest: a plain message to themselves
    send('message:relay', mail('A3D honest'));
    // forged
    send('message:relay', mail('A3D forged from', { from: 'ceo@arasaka.corp', fromName: 'Saburo Arasaka', anonymous: { enabled: true, alias: 'X' }, isBroadcast: true }));
    if (other) send('message:relay', mail('A3D as other', { fromActorId: other.id }));
    send('message:relay', mail('A3D free money', { eddies: 5000 }));
    const sch = (game.settings.get(MOD, 'scheduledMessages') || []).find((e) => e.messageData?.subject === 'A3D scheduled');
    if (sch) send('schedule:sync', { action: 'cancel', scheduleId: sch.scheduleId });
    if (sch) send('schedule:sync', { action: 'edit', scheduleId: sch.scheduleId, updates: { messageData: { eddies: 99999 } } });
    if (other) {
      send('anon:traceRequest', { messageId: `a3d-anon-${other.id}`, inboxActorId: other.id, success: true });
      send('contact:shareRelay', { shareId: 'a3d', senderActorId: mine.id, sourceContactId: 'no-such-contact', contact: { name: 'A3D Evil Contact', email: 'evil@a3d' }, recipientActorIds: [other.id] });
      send('contact:shareRelay', { shareId: 'a3d2', senderActorId: other.id, sourceContactId: 'x', contact: { name: 'A3D Evil Contact', email: 'evil@a3d' }, recipientActorIds: [mine.id] });
    }
    ui.notifications.info(`A3d test: step 2 sent as ${mine.name}. Now the GM runs the macro again.`);
    return;
  }

  // ── Step 3: GM checks and cleans up ──
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const pages = [];
  for (const j of game.journal) for (const p of j.pages) {
    const s = p.getFlag(MOD, 'subject') || '';
    if (/^A3D /.test(s)) pages.push({ j, p, s, f: p.flags?.[MOD] || {} });
  }
  const got = (s) => pages.filter((x) => x.s === s && !x.f.status?.sent && !String(x.f.messageId || '').endsWith('-sent'));
  const twoPcs = pcs.length > 1;
  const reached = got('A3D honest').length > 0;
  if (!reached) check('The player step reached this GM', false, 'nothing landed — did a player run step 2 with this GM logged in?');
  else {
    check('Honest: a player\'s own mail is delivered', true);
    const forged = got('A3D forged from')[0]?.f;
    check('Forged: a fake "from" is replaced by the sender\'s real address', !!forged && !/arasaka/.test(forged.from || ''), forged ? `from ${forged.from}` : 'not delivered');
    check('Forged: a player cannot send anonymously', !!forged && !forged.anonymous?.enabled);
    check('Forged: mail as someone else\'s character is refused', got('A3D as other').length === 0, twoPcs ? '' : 'only one player character — check skipped');
    check('Forged: eddies nobody paid for are refused', got('A3D free money').length === 0);
    const sch = scheduled();
    check('Forged: someone else\'s scheduled mail cannot be cancelled or edited', !!sch && !sch.messageData.eddies);
    const other = pcs.find((a) => (game.journal.find((j) => j.getFlag(MOD, 'actorId') === a.id)?.pages || []).some((p) => p.getFlag(MOD, 'messageId') === `a3d-anon-${a.id}` && p.getFlag(MOD, 'anonymous')?.traced));
    check('Forged: anonymous mail in someone else\'s inbox cannot be unmasked', !other, twoPcs ? '' : 'only one player character — check skipped');
    const evil = pcs.some((a) => (a.getFlag(MOD, 'contacts') || []).some((c) => c.name === 'A3D Evil Contact'));
    check('Forged: a made-up contact is never pushed into anyone\'s list', !evil);
  }
  await cleanUp();
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(r.note)}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM A3d test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:11px;opacity:.75">Test mail and the scheduled message deleted. The GM console lists each refused request ("Refused: …").</p>` });
})();
