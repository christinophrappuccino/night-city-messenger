// NCM batch (tester round 2026-11-07, calls + payphones). Run as a GM after reloading the world.
// Checks the rules in the running module (no world writes, except opening and closing windows), then whispers a
// result card with the by-hand list: the parts that need a player client, a voice, or a mouse.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const MID = 'night-city-messenger';
  const base = `/modules/${MID}/scripts`;
  try {
    if (!game.user.isGM) throw new Error('Run as a GM');
    const ns = game.nightcity;
    if (!ns?.callService) throw new Error('The call service is not loaded (Calls switched off?)');

    // 1. Interface on a non-Netrunner (a made-up character, nothing is written)
    const mode = game.settings.get(MID, 'roleAbilityRoll');
    const fake = { name: 'NCM test Solo', items: [{ type: 'role', name: 'Solo', system: { mainRoleAbility: 'Combat Awareness', rank: 4 } }], system: { stats: { tech: { value: 6 } } } };
    const d = ns.skillService._readSkillData(fake, game.settings.get(MID, 'anonTraceSkill') || 'Interface');
    if (mode === 'rank') check('Trace skill on a non-Netrunner adds no stat (Role Ability: Rank Only)', d.statName === 'none' && d.statValue === 0, `${d.statName} ${d.statValue}`);
    else check('Role Ability set to Stat + Rank here, so TECH is expected', d.statName === 'tech', `setting = ${mode}`);

    // 2. greetings
    const V = await import(`${base}/utils/voicemail.js`);
    check('A read-out greeting holds the tone until the voice ends (timer is only a cap)', V.greetTimerMs({ readOut: true, text: 'x'.repeat(300) }) >= 45000);
    check('The service has greetingDone', typeof ns.callService.greetingDone === 'function');

    // 3. the trace
    const PN = await import(`${base}/utils/phoneNumbering.js`);
    const burnerType = ns.callService.lineTypes.find((t) => t.id === 'burner');
    check('Burner line type: a trace gets the number only', !!PN.traceFinds(burnerType, { name: 'X' })?.numberOnly);
    const burner = Object.values(ns.callService.lines()).find((l) => l.kind === 'burner');
    if (burner) {
      const r = ns.callService._traceResult({ number: burner.number, name: burner.owner?.name || 'x', actorId: burner.owner?.actorId || null, realName: 'Real Name' });
      check(`Trace on a real burner (${burner.number}) returns the number, no name`, r?.number === burner.number && !r.name && !r.actorId, JSON.stringify(r));
    } else check('No burner in this world to trace (skipped)', true, 'give someone a burner to check it here');
    check('Only a mask left = a dead end (the player is told so)', ns.callService._traceResult({ name: 'Unknown caller', anon: true }) === null);

    // 4. the call log rule
    const T = await import(`${base}/ui/MessageViewer/callsTab.js`);
    const home = ns.callService.homeCode;
    const wasGM = Object.getOwnPropertyDescriptor(game.user, 'isGM');
    let o1, o2;
    try {
      Object.defineProperty(game.user, 'isGM', { value: false, configurable: true });   // read as a player would
      o1 = T.shownOther({ other: { number: '+1 NC WAT-9999', name: 'Rogue', contactId: 'ncmtest' } }, [], home, [{ id: 'k', name: 'Rogue', masterContactId: 'ncmtest', phone: '' }]);
      o2 = T.shownOther({ other: { number: '+1 NC WAT-9999', name: 'Dex', showOnly: 'name', img: 'd.webp' } }, [], home, []);
    } finally { if (wasGM) Object.defineProperty(game.user, 'isGM', wasGM); else delete game.user.isGM; }
    check('Call log: a call from a contact shows their name and offers Add this number', o1?.name === 'Rogue' && o1.addTo === 'k', JSON.stringify(o1));
    check('Call log: a line that shows its name offers a pre-filled Save', o2?.offerName === 'Dex' && o2.offerImg === 'd.webp');
    check('game.user.isGM restored', game.user.isGM === true);

    // 5. Looks right + whisper cards
    check('Looks right is a saved world setting', game.settings.settings.has(`${MID}.phoneFlagsOk`), JSON.stringify(game.settings.get(MID, 'phoneFlagsOk')).slice(0, 80));
    const H = await import(`${base}/utils/helpers.js`);
    check('A card whispered to a player has no "GM only" strip', !/ncm-cc__whisper/.test(H.whisperCardHtml({ lines: ['x'], strip: '' })));

    // 6. windows: the resize corner + the payphone buttons
    await ns.openAdminTab?.('phone'); await wait(1200);
    const app = [...foundry.applications.instances.values()].find((a) => a.constructor.name === 'AdminPanelApp' || a.constructor.name === 'AdminTabWindow');
    check('NCM windows grab the pointer on the resize corner', !!app?.element?.querySelector(':scope > .window-resize-handle[data-ncm-grab]'));
    const pp = ns.payphoneService?.getAll?.()?.[0];
    if (pp) {
      await ns.openAdminTab?.('phone', { select: `payphone:${pp.id}` }); await wait(1200);
      const el = [...foundry.applications.instances.values()].find((a) => a.element?.querySelector?.('[data-pph="callOut"]'))?.element;
      check('Payphone editor: Call from it… and Number → Change…', !!el?.querySelector('[data-pph="callOut"]') && !!el?.querySelector('[data-pph="setNumber"]'));
    } else check('No payphone in this world (skipped)', true, 'make one in Admin → Phone → Payphones to check the buttons');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM tester round 2026-11-07: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">By hand, with a player client:<br>
    1. Call the player Withheld from a burner; they Trace: a "Trace result" card in chat with the number and no name, right away. From a regular line: name + number.<br>
    2. Set a long Read out greeting (~250 characters); call it and let it ring out: the whole greeting plays before the tone.<br>
    3. Call a player as an NPC they have as a contact but without the number: their Calls log shows the name, and the person+ button adds the number to that contact.<br>
    4. Phone → Numbers → Needs you: Looks right, reload: it stays gone.<br>
    5. Resize the Agent fast from the corner and let go outside the window, as a player and as GM: it lets go.<br>
    6. Payphones: Number → Change… (district + digits); Call from it… to a player and to another payphone.</p>` });
})();
