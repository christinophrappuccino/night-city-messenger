// NCM batch (R9b): services no longer import UI files. The roll panel + roll animation, the Data Drop overlay, the
// resident console and the content-saving helpers are handed to them by name (scripts/core/providers.js), registered
// at startup. Nothing should behave differently. Run as anyone. Read-only. Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const P = await import('/modules/night-city-messenger/scripts/core/providers.js');
    const names = Object.keys(P.PROVIDERS);
    const missing = names.filter((n) => typeof P.provided(n) !== 'function');
    check(`All ${names.length} UI providers are registered`, missing.length === 0, missing.join(', '));
    check('canPersistContent answers (a GM is online, or you are the GM)', P.need('canPersistContent')({ warn: false }) === !!(game.user.isGM || game.users.activeGM));
    const mods = ['ui/content/RollPanel.js', 'ui/content/RollReveal.js', 'ui/DataDropOverlay/DataDropOverlay.js', 'ui/content/ResidentConsole.js', 'ui/content/SiphonFlow.js'];
    const failed = (await Promise.all(mods.map((m) => import('/modules/night-city-messenger/scripts/' + m).then(() => null, (e) => `${m}: ${e.message}`)))).filter(Boolean);
    check('The UI files behind them load', failed.length === 0, failed.join(' | '));
    check('No startup step failed', !(game.nightcity.startupReport?.failed || []).length, (game.nightcity.startupReport?.failed || []).join(', '));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM UI providers: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: roll a skill check from a terminal login (the roll panel, then the reveal animation); share a contact to another player (the Data Drop animation); claim eddies from a shard; let a resident with "ask" fire mode trigger (its console).</p>` });
})();
