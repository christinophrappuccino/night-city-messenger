// NCM batch (tester round 2026-11-06, part 2): written call history + Select on Admin → Phone's Call log / Voicemail.
// Run as a GM after reloading the world (the reload runs migration v9). Needs one player character.
// It writes two test calls into the first player character's log (a read-out voicemail left for them and an outgoing
// call), checks they reach the same lists the player's Agent reads, drives Select on both admin lists by clicking the
// real buttons, then deletes everything it wrote. Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const MID = 'night-city-messenger';
  const ids = [];
  const svc = game.nightcity?.callService;
  try {
    if (!game.user.isGM) throw new Error('Run as a GM');
    if (!svc?.writeCalls) throw new Error('The call service is not loaded (reload the world)');
    check('Migration v9 ran (schema 9)', Number(game.settings.get(MID, 'dataSchemaVersion')) >= 9, String(game.settings.get(MID, 'dataSchemaVersion')));
    check('No written calls left in the old setting', !Object.values(game.settings.get(MID, 'phoneWrittenLogs') || {}).some((l) => l?.length));
    const pc = game.actors.find((a) => a.hasPlayerOwner);
    if (!pc) throw new Error('Needs a player character');
    const H = await import(`/modules/${MID}/scripts/utils/callHistory.js`);
    const t = Date.parse(game.nightcity.timeService?.getCurrentTime?.() || new Date().toISOString()) - 86400000;
    const me = { actorId: pc.id, name: pc.name, number: '' }, fixer = { name: 'NCM Test Fixer', number: '555-0199' };
    const vmE = H.sanitizeCall({ id: 'ncmtest' + foundry.utils.randomID(6), from: fixer, to: me, out: 'Voicemail', when: new Date(t).toISOString(), len: '0:30', vm: 'Test message. Delete me.', kind: 'tts', heard: false });
    const callE = H.sanitizeCall({ id: 'ncmtest' + foundry.utils.randomID(6), from: me, to: fixer, out: 'Answered', when: new Date(t - 3600000).toISOString(), len: '2:10', anon: false, scene: 'Test place',
      lines: H.parseScript('NCM Test Fixer: Got a job.\n' + pc.name + ': Who is paying?', { fromName: pc.name, toName: 'NCM Test Fixer' }) });
    ids.push(H.writtenCallId(vmE.id), H.writtenCallId(callE.id));
    const r = await svc.writeCalls([vmE, callE]);
    check(`Two calls written into ${pc.name}'s log`, r?.ok === true, r?.error || '');
    const log = await svc.getLog(pc.id);
    check('Both are in their call log (what the Agent reads)', ids.every((id) => log.some((l) => l.callId === id)));
    const vms = await svc.getVoicemails(pc.id);
    const mine = vms.find((v) => v.callId === ids[0]);
    check('The voicemail is in their Voicemail list, unheard, read out', !!mine && !mine.heard && mine.kind === 'tts');
    const said = log.find((l) => l.callId === ids[1]);
    check('The written call carries its transcript and place', said?.lines?.length === 2 && said.lines[0].side === 'callee' && said.scene === 'Test place', JSON.stringify(said?.lines || []));
    check('The editor reads them back', svc.historyEntries(pc.id).filter((e) => ids.includes(H.writtenCallId(e.id))).length === 2);

    // Admin → Phone: Select on Voicemail, then the Call log, by clicking
    await game.nightcity.openAdminTab?.('phone'); await wait(1200);
    const app = [...foundry.applications.instances.values()].find((a) => a.constructor.name === 'AdminPanelApp');
    const tab = app?.tabs?.phone;
    if (!tab) throw new Error('Admin → Phone did not open');
    tab._view = 'vm'; tab._vmQ = 'Test message. Delete me.'; await app.render(); await wait(900);
    app.element.querySelector('[data-op="pickMode"][data-which="vm"]')?.click(); await wait(800);
    const vmKey = `${pc.id}|${mine?.vmId}`;
    app.element.querySelector(`.is-picking[data-k="${vmKey}"]`)?.click(); await wait(800);
    check('Voicemail: Select, then clicking the row ticks it', tab._pick.vm.set.has(vmKey));
    app.element.querySelector('[data-op="pickHeard"][data-v="heard"]')?.click(); await wait(1200);
    check('Mark heard marks it heard', (await svc.getVoicemails(pc.id)).find((v) => v.callId === ids[0])?.heard === true);
    app.element.querySelector('[data-op="pickMode"][data-which="vm"]')?.click(); await wait(500);
    tab._vmQ = '';
    tab._view = 'log'; tab._logQ = 'NCM Test Fixer'; await app.render(); await wait(900);
    app.element.querySelector('[data-op="pickMode"][data-which="log"]')?.click(); await wait(800);
    app.element.querySelector('[data-op="pickAll"][data-which="log"]')?.click(); await wait(800);
    check('Call log: Select all ticks the two test calls', ids.every((id) => tab._pick.log.set.has(id)) && tab._pick.log.set.size === 2, `${tab._pick.log.set.size} ticked`);
    app.element.querySelector('[data-op="pickMode"][data-which="log"]')?.click(); await wait(500);
    tab._logQ = ''; await app.render();
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    try {
      if (ids.length) {
        const d = await svc.deleteCalls(ids);
        const pc = game.actors.find((a) => a.hasPlayerOwner);
        const gone = !(await svc.getLog(pc.id)).some((l) => ids.includes(l.callId)) && !(await svc.getVoicemails(pc.id)).some((v) => ids.includes(v.callId));
        check('Deleting the calls removes them and the written voicemail (clean-up)', d?.ok && gone);
      }
    } catch (err) { check('Clean-up', false, err.message); }
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM call history + Select: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">By hand: Phone → Call log → Edit a log, pick a character, write a Voicemail (Read out), Add it. Keep adding leaves the form filled an hour earlier. "Also add it to" copies it to others. Import a CSV (export one first for the layout). The player sees the voicemail in their Agent's Calls → Voicemail.</p>` });
})();
