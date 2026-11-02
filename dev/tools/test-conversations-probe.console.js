/*
 * Conversations: can the storage plan work? Two-client probe. Changes nothing but its own two test journals.
 * dev/design/CONVERSATIONS.md → Gap tracker. Paste this whole file into the browser console (F12) on each client.
 *
 *   1. PLAYER: open the Journal tab in the sidebar, then paste. It says "listening".
 *   2. GM: open the Journal tab in the sidebar, then paste. It runs for about 25 seconds, then whispers results to chat.
 *   3. PLAYER: press F5, and when the world has loaded, paste again. This checks what a fresh load receives.
 *   4. GM: paste again. This deletes the test journals and prints the verdict.
 *
 * Copy the GM's final whisper back to Claude, or read the verdict lines.
 */
(async () => {
  const FLAG = 'ncmConvProbe';
  const M = 'night-city-messenger';
  const NAME = 'NCM conversation probe (safe to delete)';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const size = (x) => { try { return JSON.stringify(x).length; } catch { return -1; } };
  const findMain = () => game.journal.find((j) => j.getFlag(M, FLAG) === 'main');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const whisper = (title, rows) => ChatMessage.create({ whisper: game.users.filter((u) => u.isGM).map((u) => u.id), content: `<b>${esc(title)}</b><br>${rows.map(esc).join('<br>')}` });

  /* ═══ What this client actually holds ═══ */
  const holds = () => {
    const main = findMain();
    if (!main) return ['Main journal: NOT on this client'];
    const page = (k) => main.pages.find((p) => p.getFlag(M, 'pageKind') === k);
    const say = (k, label) => {
      const p = page(k);
      if (!p) return `${label}: page NOT on this client`;
      const lines = p.getFlag(M, 'probe')?.lines || {};
      const secret = Object.values(lines).some((l) => /SECRET/.test(l.text));
      return `${label}: page ON this client, ${Object.keys(lines).length} lines readable${secret ? ', SECRET text readable' : ''}, viewable in the UI: ${p.testUserPermission(game.user, 'OBSERVER')}`;
    };
    const otherId = main.getFlag(M, 'otherId');
    const other = game.journal.get(otherId);
    return [say('member', 'Page you are a member of'), say('never', 'Page you never had access to'), say('removed', 'Page you were removed from'),
      other ? `Journal you have no access to: ON this client, listed in the sidebar: ${other.visible}, lines readable: ${Object.keys(other.pages.contents[0]?.getFlag(M, 'probe')?.lines || {}).length}` : 'Journal you have no access to: NOT on this client'];
  };

  /* ═══ Player ═══ */
  if (!game.user.isGM) {
    if (findMain()) { await whisper(`Fresh load, as ${game.user.name}`, holds()); ui.notifications.info('Conversation probe: fresh-load report sent to the GM.'); return; }
    if (window.__ncmProbe) { ui.notifications.info('Conversation probe: already listening.'); return; }
    const S = window.__ncmProbe = { wire: [], pageHooks: {}, renders: 0, phase: {}, order: [] };
    const onWire = (res) => {
      try {
        if (res?.type !== 'JournalEntryPage' && res?.type !== 'JournalEntry') return;
        const blob = size(res);
        if (blob > 0) S.wire.push({ type: res.type, blob, action: res.action });
      } catch { /* a probe never gets in the way */ }
    };
    game.socket.on('modifyDocument', onWire);
    Hooks.on('updateJournalEntryPage', (p, changes) => {
      const k = p.getFlag(M, 'pageKind'); if (!k) return;
      S.pageHooks[k] = (S.pageHooks[k] || 0) + 1;
      if (k === 'member') { S.lastDiff = size(changes); S.keysInDiff = Object.keys(changes?.flags?.[M]?.probe?.lines || {}).length; }
    });
    Hooks.on('renderJournalDirectory', () => { S.renders += 1; });
    Hooks.on('updateJournalEntry', (j, changes) => {
      if (j.getFlag(M, FLAG) !== 'main') return;
      const ph = changes?.flags?.[M]?.phase;
      if (ph) S.phase[ph] = S.renders;
      if (ph === 'report') setTimeout(async () => {
        const member = j.pages.find((p) => p.getFlag(M, 'pageKind') === 'member');
        const lines = member?.getFlag(M, 'probe')?.lines || {};
        const single = S.wire.filter((w) => w.type === 'JournalEntryPage' && w.blob < 20000);
        await whisper(`Player report, ${game.user.name}`, [
          ...holds(),
          `Lines on the member page now: ${Object.keys(lines).length}`,
          `Burst lines that arrived: ${Object.values(lines).filter((l) => l.tag === 'burst').length} of 20`,
          `Removed line gone: ${!lines.gone1}`,
          `Page size here: ${size(member?.flags?.[M]?.probe)} characters`,
          `Biggest single update on the wire: ${Math.max(0, ...S.wire.filter((w) => w.type === 'JournalEntryPage').map((w) => w.blob))} characters; typical one-line update: ${single.length ? single[Math.floor(single.length / 2)].blob : 0}`,
          `Update hooks received, by page: ${JSON.stringify(S.pageHooks)}`,
          `Sidebar redraws while summary saved with render:false: ${(S.phase.render0 ?? 0) - (S.phase.norender0 ?? 0)}`,
          `Sidebar redraws while summary saved normally: ${(S.phase.report ?? 0) - (S.phase.render0 ?? 0)}`,
        ]);
      }, 1200);
    });
    ui.notifications.info('Conversation probe: listening. Now paste it on the GM client. Keep the Journal tab open.');
    console.log('NCM conversation probe: listening');
    return;
  }

  /* ═══ GM: second paste cleans up ═══ */
  const old = findMain();
  if (old) {
    const otherId = old.getFlag(M, 'otherId');
    await game.journal.get(otherId)?.delete();
    await old.delete();
    await whisper('Probe cleaned up', ['Both test journals are deleted. Nothing else was changed.']);
    ui.notifications.info('Conversation probe: cleaned up.');
    return;
  }

  /* ═══ GM: the run ═══ */
  const players = game.users.filter((u) => !u.isGM && u.active);
  if (!players.length) { ui.notifications.warn('Conversation probe: connect a player first, and paste it there first.'); return; }
  ui.notifications.info('Conversation probe: running, about 25 seconds.');
  const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER, NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  const member = Object.fromEntries(players.map((u) => [u.id, OBS]));
  const mk = (n, tag = 'seed', text = null) => { const lines = {}; for (let i = 0; i < n; i++) lines[`seed${i}`] = { seq: i, at: new Date().toISOString(), fromKey: 'a@nc.net', fromName: 'Tester', kind: 'text', text: text || `Seeded line ${i}: a line about as long as people write in a chat.`, tag }; return lines; };
  const pageData = (name, kind, ownership, lines) => ({ name, type: 'text', text: { content: '' }, ownership, flags: { [M]: { pageKind: kind, probe: { lines } } } });

  const other = await JournalEntry.create({ name: `${NAME} B`, ownership: { default: NONE }, flags: { [M]: { [FLAG]: 'other' } }, pages: [pageData('other', 'other', { default: NONE }, mk(3, 'other', 'SECRET in a journal you have no access to'))] });
  const main = await JournalEntry.create({ name: NAME, ownership: { default: NONE, ...member }, flags: { [M]: { [FLAG]: 'main', otherId: other.id } }, pages: [
    pageData('member', 'member', { default: NONE, ...member }, mk(150)),
    pageData('never', 'never', { default: NONE }, mk(3, 'never', 'SECRET on a page you never had')),
    pageData('removed', 'removed', { default: NONE, ...member }, mk(3, 'removed')),
  ] });
  await sleep(1500);
  const page = (k) => main.pages.find((p) => p.getFlag(M, 'pageKind') === k);
  const m = page('member');
  const key = (id) => `flags.${M}.probe.lines.${id}`;
  const row = (id, tag) => ({ seq: 1000, at: new Date().toISOString(), fromKey: 'a@nc.net', fromName: 'Tester', kind: 'text', text: `Line ${id}: a line about as long as people write in a chat.`, tag });

  // one line at a time, as a send would
  for (let i = 0; i < 5; i++) { await m.update({ [key(`one${i}`)]: row(`one${i}`, 'one') }); await sleep(250); }

  // twenty at once, with nothing queueing them: do any get lost?
  await Promise.all(Array.from({ length: 20 }, (_, i) => m.update({ [key(`burst${i}`)]: row(`burst${i}`, 'burst') })));
  await sleep(1200);

  // removing a line
  await m.update({ [key('gone1')]: row('gone1', 'one') }); await sleep(300);
  await m.update({ [`flags.${M}.probe.lines.-=gone1`]: null }); await sleep(600);

  // a removed member: lose access, then a secret line lands
  const rem = page('removed');
  const revoke = Object.fromEntries(players.map((u) => [u.id, NONE]));
  await rem.update({ ownership: { default: NONE, ...revoke } }); await sleep(800);
  await rem.update({ [key('after')]: { ...row('after', 'after'), text: 'SECRET written after you were removed' } }); await sleep(800);
  await page('never').update({ [key('later')]: { ...row('later', 'later'), text: 'SECRET written to a page you never had' } }); await sleep(800);

  // the summary on the journal: quiet, then normal
  let redraws = 0; const hook = Hooks.on('renderJournalDirectory', () => { redraws += 1; });
  await main.update({ [`flags.${M}.phase`]: 'norender0' }, { render: false }); await sleep(600);
  for (let i = 0; i < 4; i++) { await main.update({ [`flags.${M}.lastSeq`]: i }, { render: false }); await sleep(350); }
  const quiet = redraws; redraws = 0;
  await main.update({ [`flags.${M}.phase`]: 'render0' }, { render: false }); await sleep(600);
  for (let i = 0; i < 4; i++) { await main.update({ [`flags.${M}.lastSeq`]: 10 + i }); await sleep(350); }
  const loud = redraws;
  Hooks.off('renderJournalDirectory', hook);

  const lines = m.getFlag(M, 'probe')?.lines || {};
  const burst = Object.values(lines).filter((l) => l.tag === 'burst').length;
  await main.update({ [`flags.${M}.phase`]: 'report' }, { render: false });
  await sleep(2500);
  await whisper('GM report', [
    `Burst: ${burst} of 20 lines survived twenty writes at once`,
    `Removing a line: ${lines.gone1 ? 'FAILED, it is still there' : 'works'}`,
    `Sidebar redraws here, summary saved with render:false: ${quiet}; saved normally: ${loud}`,
    `Page size: ${size(m.flags?.[M]?.probe)} characters for ${Object.keys(lines).length} lines`,
    'NEXT: the player presses F5, waits for the world to load, and pastes again. Then paste here again to clean up.',
    'How to read the player report: one-line updates should be far smaller than the page. "ON this client" with SECRET text means a page\'s ownership hides it on screen only, which is what we planned for.',
  ]);
  ui.notifications.info('Conversation probe: done. See your whispers.');
})();
