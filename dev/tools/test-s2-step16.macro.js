// NCM stage 2, step 16 — the Trace consequences switch (live) and residents off the trace funnel.
// Run as the GM. It writes two TEST trace rows (on an object called "ncm-test-step16"), flips the switch off and on
// around them, then removes both rows and their heat and puts the switch back as it was. You may see one
// "tripped a trace" toast — that is the ON half of the test. Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Step 16 test: run this as the GM.'); return; }
  const MOD = 'night-city-messenger', KEY = 'traceConsequencesEnabled', OBJ = 'ncm-test-step16';
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const ns = game.nightcity, tr = ns.traceService;
  const was = game.settings.get(MOD, KEY);
  try {
    const f = ns.features.list().find((x) => x.name === 'traceConsequences');
    check('Trace consequences is a live feature in game.nightcity.features', !!f && f.live === true, f ? `on: ${f.on}` : 'missing');
    const listeners = ns.eventBus?._listeners?.get?.('trace:recorded');
    check('The terminal system listens for trace:recorded (residents)', !!listeners && listeners.size >= 1, `${listeners?.size ?? 0} listener(s)`);

    const row = (n) => ({ ts: new Date(tr._nowMs()).toISOString(), actorId: null, actorName: 'Step 16 test', action: `ncm-test-${n}`, source: '', objectId: OBJ, objectName: OBJ, targetKind: null, severity: 'major', outcome: 'failed' });
    await game.settings.set(MOD, KEY, false);
    check('Switching it off takes effect at once (no reload)', tr.consequencesOn === false);
    await tr.recordTrace(row('off'));
    const offRow = tr.getLog().find((r) => r.action === 'ncm-test-off');
    check('Off: a failure is still logged, with no heat', !!offRow && offRow.heatDelta === 0 && tr.getHeat(OBJ, 'unknown') === 0, offRow ? `heatDelta ${offRow.heatDelta}` : 'no row');

    await game.settings.set(MOD, KEY, true);
    await tr.recordTrace(row('on'));
    const onRow = tr.getLog().find((r) => r.action === 'ncm-test-on');
    check('On: the same failure adds heat', !!onRow && onRow.heatDelta === 20 && tr.getHeat(OBJ, 'unknown') === 20, onRow ? `heat ${Math.round(tr.getHeat(OBJ, 'unknown'))}` : 'no row');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    // clean up: the two test rows, their heat, the switch
    try {
      await game.settings.set(MOD, 'traceLog', tr.getLog().filter((r) => !String(r.action).startsWith('ncm-test-')));
      const heat = foundry.utils.deepClone(tr.getHeatMap()); delete heat[OBJ];
      await game.settings.set(MOD, 'traceHeat', heat);
      await game.settings.set(MOD, KEY, was);
      check('Cleaned up (test rows and heat removed, switch restored)', !tr.getLog().some((r) => String(r.action).startsWith('ncm-test-')) && game.settings.get(MOD, KEY) === was);
    } catch (err) { check('Clean-up', false, err.message); }
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 16: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check, with a player: switch Trace consequences off (Module Settings) and fail a terminal login — no TRACE splash for them, no toast for you, the row appears in Admin → Security → Activity. Switch it on and repeat: splash, toast, heat. A resident armed "on siphon" still fires after a successful siphon either way.</p>` });
})();
