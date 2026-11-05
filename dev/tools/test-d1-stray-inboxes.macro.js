// NCM audit fix D1 — "does the unread badge still create an empty inbox journal for every actor?"
// Run as the GM. It:
//   1. counts the EMPTY inbox journals already in this world (made by the old badge) — nothing is deleted;
//   2. recounts every unread badge (and every actor's unread count) and checks no new journal appeared;
//   3. checks a burst of badge refreshes does one recount.
// Then: Admin → Tools → Orphan Audit lists those empty inboxes separately, deleted only if you tick the box.
// Results arrive as a chat card whispered to the GM.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('D1 test: run this as the GM.'); return; }
  const MOD = 'night-city-messenger';
  const ns = game.nightcity;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const Repo = ns.messageRepository?.constructor;

  // 1. what the old badge left behind
  const inboxes = game.journal.filter((j) => Repo?.identifyInbox?.(j));
  const empty = inboxes.filter((j) => !j.pages.some((p) => p.flags?.[MOD]?.messageId));
  const kinds = {};
  for (const j of empty) { const a = game.actors.get(Repo.identifyInbox(j).ownerId); const k = a ? (a.hasPlayerOwner ? 'player characters' : `${a.type} actors`) : 'contacts'; kinds[k] = (kinds[k] || 0) + 1; }
  check(`Empty inbox journals already in this world: ${empty.length} of ${inboxes.length}`, true, Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ') || 'none');

  // 2. recount everything; nothing may be created
  const before = game.journal.size;
  await ns.notificationService.refreshBadge();
  for (const a of game.actors) await ns.messageService.getUnreadCount(a.id);
  check('Recounting every badge and every actor creates no journal', game.journal.size === before, `${before} → ${game.journal.size}`);

  // 3. a burst recounts once
  const ps = [1, 2, 3, 4].map(() => ns.notificationService.refreshBadge());
  check('A burst of badge refreshes shares one recount', ps.every((p) => p === ps[0]));
  await Promise.all(ps);

  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM D1 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">To clear the empty inboxes: Admin → Tools → Orphan Audit, tick "Delete these empty inboxes too".</p>` });
})();
