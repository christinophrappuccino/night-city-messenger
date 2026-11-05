// NCM audit fix D2 — "when the GM edits the contact directory, do players see it without reloading?"
// Uses a test directory entry "NCM D2 Test" <d2test@nightcity.net>. Keep both clients open, DON'T reload in between:
//   1. GM runs it        → adds the test entry.
//   2. PLAYER runs it    → checks their client sees the entry (and can address it) right away.
//   3. GM runs it again  → removes the test entry.
//   4. PLAYER runs again → checks it is gone on their client too.
// Results arrive as a chat card whispered to whoever ran it.
(async () => {
  const EMAIL = 'd2test@nightcity.net';
  const mcs = game.nightcity?.masterContactService;
  if (!mcs) { ui.notifications.error('D2 test: NCM is not loaded.'); return; }
  const say = (title, rows, all) => ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM D2 test (${title}): ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('')}</ul>` });
  const have = () => mcs.getByEmail?.(EMAIL);

  if (game.user.isGM) {
    const cur = have();
    if (!cur) {
      const r = await mcs.addContact({ name: 'NCM D2 Test', email: EMAIL, notes: 'Audit test entry — the D2 macro removes it.' });
      const ok = !!(r?.success ?? r) && !!have();
      say('GM, step 1', [{ name: 'Test entry added to the directory', pass: ok, note: ok ? 'now run this macro on the PLAYER client (no reload)' : (r?.error || '') }], ok);
    } else {
      const r = await mcs.removeContact(cur.id);
      const ok = !have();
      say('GM, step 3', [{ name: 'Test entry removed', pass: ok, note: ok ? 'now run it on the PLAYER client once more' : (r?.error || '') }], ok);
    }
    return;
  }

  // player
  const found = have();
  const verified = game.nightcity?.contactRepository?.verifyContact?.(EMAIL)?.verified;
  if (found) {
    const rows = [
      { name: 'This client sees the entry the GM just added — no reload', pass: true, note: found.name },
      { name: '…and can address it (it is in the directory)', pass: !!verified },
    ];
    say('player, step 2', rows, rows.every((r) => r.pass));
  } else {
    say('player', [{ name: 'The test entry is not in this client\'s directory', pass: true, note: 'right after GM step 3 that is the PASS. Right after GM step 1 it is a FAIL (it should be there)' }], true);
  }
})();
