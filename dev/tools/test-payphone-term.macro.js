// NCM batch (payphone name, 2026-11-05): Module Settings → "What Players Call a Payphone". Run as the GM. It sets the
// word to "Public Comm" for a moment, checks the booth label and every payphone map pin follow, then puts your word
// back (the pins follow it back). Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ID = 'night-city-messenger';
  const before = game.settings.get(ID, 'payphoneTerm');
  try {
    const { payphoneTerm } = await import(`/modules/${ID}/scripts/utils/payphoneTerm.js`);
    const { placeLabel } = await import(`/modules/${ID}/scripts/utils/payphones.js`);
    check('The setting exists', typeof before === 'string', JSON.stringify(before));
    await game.settings.set(ID, 'payphoneTerm', 'Public Comm');
    await sleep(1500);
    check('The word reads live', payphoneTerm() === 'Public Comm' && payphoneTerm('lower', { a: true }) === 'a public comm');
    check('A booth labels itself with it', placeLabel({ name: 'Kabuki' }) === 'Public Comm, Kabuki');
    const pins = game.scenes.contents.flatMap((s) => s.notes.filter((n) => n.getFlag(ID, 'accessPayphone')));
    check('Every payphone pin was renamed', pins.every((n) => String(n.text).startsWith('Public Comm, ')), `${pins.length} pins${pins.length ? '' : ' (place one in Admin → Phone to test this)'}`);
    await game.settings.set(ID, 'payphoneTerm', '');
    await sleep(800);
    check('Empty falls back to "Payphone"', payphoneTerm() === 'Payphone');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    await game.settings.set(ID, 'payphoneTerm', before);
    await sleep(1200);
  }
  const back = game.scenes.contents.flatMap((s) => s.notes.filter((n) => n.getFlag(ID, 'accessPayphone')));
  check('Your word is back, and the pins with it', game.settings.get(ID, 'payphoneTerm') === before && back.every((n) => !String(n.text).startsWith('Public Comm, ') || before === 'Public Comm'));
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM payphone name: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: set the word in Module Settings → Shards, terminals &amp; hacking, then as a player walk up to a booth and call out from it (the other end sees "&lt;word&gt;, &lt;place&gt;"), and ring a booth (the toast says "A &lt;word&gt; is ringing").</p>` });
})();
