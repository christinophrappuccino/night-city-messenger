// NCM stage 2, step 11 — pure rules moved out of ui/ into scripts/rules/ (encoder, integrity, content types) and
// utils/dictation.js; the old paths re-export them; the operator picker moved next to its window. Nothing should
// behave differently. Run as anyone. It loads each old and new path and checks they hand out the very same
// functions, and opens the operator picker (it changes nothing unless you pick someone). Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const M = '/modules/night-city-messenger/scripts/';
    for (const [o, n] of [['ui/content/EncoderModel.js', 'rules/encoder.js'], ['ui/content/IntegrityModel.js', 'rules/integrity.js'], ['ui/Calls/dictation.js', 'utils/dictation.js'], ['ui/content/ContentRenderers.js', 'rules/contentTypes.js']]) {
      const A = await import(M + o), B = await import(M + n);
      const names = Object.keys(B);
      check(`${n} loads, and ${o.split('/').pop()} gives the same ${names.length} exports`, names.length > 0 && names.every((k) => A[k] === B[k]));
    }
    const OS = await import(M + 'ui/content/OperatorSelect.js');
    check('The operator picker opens from its new home', typeof OS.openOperatorPicker === 'function');
    const owned = game.actors.filter((a) => a.isOwner && a.type === 'character');
    if (owned.length > 1) {
      ui.notifications.info('Step 11 test: the operator picker is open — pick the character you already use, or close it.');
      const changed = await OS.openOperatorPicker(null);
      check('The picker ran (and closed)', typeof changed === 'boolean', changed ? 'you switched character' : 'no change');
    } else check(`The picker says you control one character (${owned.length})`, (await OS.openOperatorPicker(null)) === false);
    const enc = await import(M + 'rules/encoder.js');
    check('The Encoder rules answer (resolveEncoderConfig)', typeof enc.resolveEncoderConfig({}) === 'object');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 11: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: open the Shard Encoder (it uses the encoder rules), damage and repair a shard's integrity, open a terminal file and copy it (file names), and switch character with the OPERATOR chip on a terminal.</p>` });
})();
