// NCM hotfix 2.2.1 (tester CptWashu, 2026-11-06): the Line types and Corporations screens saved nothing. Colours,
// dial, checkboxes, greetings, art and extensions were refused and the screen redrew the old value.
// Run as a GM. It changes a line type and a corporation through the same service call the screens use, reads both
// back, then puts your settings back exactly as they were. Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const MID = 'night-city-messenger';
  let before = null;
  try {
    if (!game.user.isGM) throw new Error('Run as a GM');
    const svc = game.nightcity.callService;
    if (!svc) throw new Error('Calls are off in this world (Module Settings), so the phone screens are not there');
    const PN = await import(`/modules/${MID}/scripts/utils/phoneNumbering.js`);
    before = { types: foundry.utils.deepClone(game.settings.get(MID, 'phoneLineTypes')), offices: foundry.utils.deepClone(game.settings.get(MID, 'phoneOffices')) };

    // line types: a colour, the dial, a checkbox, a new type
    const types = PN.lineTypes(before.types);
    const corp = types.find((t) => t.id === 'corp') || types[0];
    corp.color = corp.color === 'var(--ncm-good)' ? 'var(--ncm-money)' : 'var(--ncm-good)';
    corp.ring = corp.ring === 'fast' ? 'slow' : 'fast';
    corp.burn = !corp.burn;
    types.push(PN.sanitizeLineType({ id: 'tncmtest', name: 'Test line (TEST)', word: 'Test' }));
    const r1 = await svc.saveNumberSetting('phoneLineTypes', PN.lineTypesDiff(types.map(PN.sanitizeLineType)));
    check('A line type saves', r1?.ok === true, r1?.error || '');
    const back = PN.lineTypes(game.settings.get(MID, 'phoneLineTypes'));
    const c2 = back.find((t) => t.id === corp.id);
    check('Its colour, dial and checkbox read back', c2?.color === corp.color && c2?.ring === corp.ring && c2?.burn === corp.burn);
    check('A new line type reads back', back.some((t) => t.id === 'tncmtest'));

    // a corporation: who answers, greeting, an extension
    const key = 'NCMTEST:XXX';
    const office = PN.sanitizeOffice({ answers: 'recording', greet: 'Test switchboard.', exts: [{ x: '17', who: 'Test desk', listed: true }] });
    const r2 = await svc.saveNumberSetting('phoneOffices', { ...(before.offices || {}), [key]: office });
    check('A corporation saves', r2?.ok === true, r2?.error || '');
    const o = PN.sanitizeOffice(game.settings.get(MID, 'phoneOffices')?.[key]);
    check('Who answers and the greeting read back', o.answers === 'recording' && o.greet === 'Test switchboard.');
    check('An added extension reads back', o.exts.length === 1 && o.exts[0].x === '17');

    check('Other settings are still refused', (await svc.saveNumberSetting('debugMode', true))?.ok === false);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    try {
      if (before) {
        await game.settings.set(MID, 'phoneLineTypes', before.types);
        await game.settings.set(MID, 'phoneOffices', before.offices);
        check('Your line types and corporations are back as they were', JSON.stringify(game.settings.get(MID, 'phoneLineTypes')) === JSON.stringify(before.types)
          && JSON.stringify(game.settings.get(MID, 'phoneOffices')) === JSON.stringify(before.offices));
      }
    } catch (err) { check('Restoring your settings', false, err.message); }
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM phone setup saves: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">By hand: Admin → Phone → Setup → Line types, pick Corporate, click a colour and a dial. They stay picked. Numbers → Corporations → Extensions: add one; it appears in the list.</p>` });
})();
