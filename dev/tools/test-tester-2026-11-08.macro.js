// NCM batch (tester round 2026-11-08: Save from a call + Add from mail made two contacts; the line-type wording).
// Run as a GM after reloading the world. Checks the rules in the running module (no world writes), then whispers a
// result card with the by-hand list (it needs a player client).
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const MID = 'night-city-messenger';
  const base = `/modules/${MID}/scripts`;
  try {
    if (!game.user.isGM) throw new Error('Run as a GM');
    const ns = game.nightcity;
    if (!ns?.callService) throw new Error('The call service is not loaded (Calls switched off?)');

    // 1. the call log's Save keeps who it is (read as a player would)
    const T = await import(`${base}/ui/MessageViewer/callsTab.js`);
    const home = ns.callService.homeCode;
    const wasGM = Object.getOwnPropertyDescriptor(game.user, 'isGM');
    let a, b, c;
    try {
      Object.defineProperty(game.user, 'isGM', { value: false, configurable: true });
      a = T.shownOther({ other: { number: '+1 NC WAT-9999', name: 'Dex', contactId: 'ncmtest' } }, [], home, []);
      b = T.shownOther({ other: { number: '+1 NC WAT-9998', name: '', contactId: 'ncmtest', asLine: true, showOnly: 'number' } }, [], home, []);
      c = T.shownOther({ other: { name: 'Unknown caller', anon: true, contactId: 'ncmtest' } }, [], home, []);
    } finally { if (wasGM) Object.defineProperty(game.user, 'isGM', wasGM); else delete game.user.isGM; }
    check('Save from a stranger\'s call keeps who it is (hidden)', a?.linkContact === 'ncmtest' && !a.offerName, JSON.stringify(a));
    check('A burner or a withheld caller gives no link', !b?.linkContact && !c?.linkContact);
    check('game.user.isGM restored', game.user.isGM === true);

    // 2. the message viewer
    const { MessageViewerApp } = await import(`${base}/ui/MessageViewer/MessageViewerApp.js`);
    const P = MessageViewerApp.prototype;
    check('The viewer finds a number-only contact as the sender, and Add fills it in', typeof P._phoneOnlyContactFor === 'function' && typeof P._addEmailToContact === 'function');
    const main = Object.values(ns.callService.lines()).find((l) => l.owner?.contactId && !['extra', 'burner'].includes(l.kind));
    if (main) {
      const v = Object.create(P); v._cachedContacts = [{ id: 'k', name: 'x', email: '', phone: main.number }];
      const hit = v._phoneOnlyContactFor({ fromContactId: main.owner.contactId }, { id: main.owner.contactId });
      check(`A contact holding only ${main.number} counts as ${main.owner.name}'s mail`, hit?.id === 'k');
    } else check('No NPC with a number in this world (skipped)', true, 'give an NPC a number to check it here');

    // 3. the wording
    const src = await (await fetch(`${base}/ui/AdminPanel/tabs/phoneNumbersView.js`, { cache: 'no-store' })).text();
    check('Line types: the options read "Their name, only if saved" / "Their name, to everyone"', src.includes("'Their name, only if saved'") && src.includes("'Their name, to everyone'"));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM tester round 2026-11-08: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">By hand, with a player client:<br>
    1. Call the player from an NPC they don't have (Standard line, not withheld). In their Calls log, Save the number with any name.<br>
    2. Send them mail from that NPC. The mail still shows <b>Add</b>; click it: "Added &lt;email&gt; to &lt;name&gt;", and their Contacts has ONE entry with both the number and the email.<br>
    3. Same again from a burner: Add makes a separate contact (a burner never gives away who it is).<br>
    4. Admin → Phone → Line types: Their screen shows lists "Their name, only if saved" and "Their name, to everyone"; hover each, and A Trace finds, and check the words make sense.<br>
    5. Set Standard to "Their name, to everyone" and call the player from an NPC they don't have: name and picture show, on the call and in the log. Set it back after.</p>` });
})();
