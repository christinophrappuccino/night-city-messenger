// NCM audit fix E5 — "do the waveform, conversations and payphone bell stay light?"
// Run as anyone. It only reads and counts; nothing is saved. For the waveform check, have your Agent inbox open on
// a network with WEAK signal (under 50%), so the signal strip with its moving wave shows; otherwise that check is
// skipped. Results arrive as a chat card whispered to you.
(async () => {
  const ns = game.nightcity;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    // 1. The weak-signal waveform
    const wave = document.querySelector('.ncm-viewer__signal-wave-path');
    if (wave) {
      let n = 0;
      const obs = new MutationObserver((m) => { n += m.filter((x) => x.attributeName === 'd').length; });
      obs.observe(wave, { attributes: true });
      await sleep(1000);
      obs.disconnect();
      check('The weak-signal wave redraws about 12 times a second, not 60', n <= 16, `${n} redraws in 1 s${n <= 1 ? ' (still — motion is off)' : ''}`);
    } else check('The weak-signal wave', true, 'skipped: no weak-signal strip on screen (open your inbox on a network under 50%)');

    // 2. Conversation lookups
    const cs = ns?.conversationService;
    if (cs?._indexWired) {
      const t0 = performance.now();
      for (let i = 0; i < 500; i++) cs.all();
      const ms = performance.now() - t0;
      check('Conversation lookups are kept instead of scanning every journal', !!cs._jIndex, `500 lookups in ${ms.toFixed(1)} ms over ${game.journal.size} journals`);
    } else check('Conversation lookups', true, 'skipped: conversations are switched off in this world');

    // 3. The payphone bell
    const { ringShouldStop } = await import('/modules/night-city-messenger/scripts/services/PayphoneService.js');
    check('A payphone bell stops once its call is no longer ringing', ringShouldStop({ state: 'ended' }, 0, 1) && !ringShouldStop({ state: 'ringing' }, 0, 1000, 30000));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM E5 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: on a weak network the inbox's signal wave should still look alive; it just redraws less often.</p>` });
})();
