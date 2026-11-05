// NCM audit fix E6 — "would the GM hear about a failed startup step, and does the log show the right version?"
// Run as the GM after a reload. It only reads; nothing is saved. Results arrive as a chat card whispered to you.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('E6 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const failures = game.nightcity?.startupFailures;
    check('Startup failures are now collected', Array.isArray(failures), Array.isArray(failures) ? `${failures.length} step(s) failed this load` : 'not found — press F5 and run this again');
    if (Array.isArray(failures) && failures.length) {
      check('This load had failed steps (you should have seen a red notice)', false, failures.map((f) => `${f.phase} · ${f.name}: ${f.message}`).join(' | '));
    }
    const { ModuleInitializer } = await import('/modules/night-city-messenger/scripts/core/ModuleInitializer.js');
    const mi = new ModuleInitializer();
    const quiet = console.error; console.error = () => {};
    mi.register('ready', 1, 'E6 pretend step', () => { throw new Error('a pretend failure'); });
    await mi.runPhase('ready');
    console.error = quiet;
    check('A failing step is remembered with its reason', mi.failures.length === 1 && mi.failures[0].message === 'a pretend failure');
    const ver = game.modules.get('night-city-messenger')?.version;
    check('The console line now shows the installed version', !!ver, `look for "Initializing Night City Messenger v${ver}..." near the top of the F12 console`);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM E6 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>` });
})();
