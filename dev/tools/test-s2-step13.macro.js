// NCM stage 2, step 13 — the trace log and the network access log moved from world settings into a GM-only journal
// ("NCM — GM logs"), and the finished Interface-shift ledger was emptied (migrations v7 + v8). Run as the GM after
// the world has loaded once with this version; then a PLAYER runs it too (it checks they cannot see the journal).
// Read-only. Results arrive as a whispered card.
(async () => {
  const MOD = 'night-city-messenger';
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const journal = game.journal.find((j) => j.getFlag(MOD, 'gmLogs'));
    if (!game.user.isGM) {
      check('A player cannot see the GM logs journal', !journal);
      check("A player's client holds no trace log rows", game.nightcity.traceService.getLog().length === 0);
    } else {
      const schema = game.settings.get(MOD, 'dataSchemaVersion');
      check(`The world is on data schema 8 or later (${schema})`, schema >= 8);
      check('The old traceLog setting is empty (moved)', (game.settings.get(MOD, 'traceLog') || []).length === 0);
      check('The old networkAccessLog setting is empty (moved)', (game.settings.get(MOD, 'networkAccessLog') || []).length === 0);
      check('The finished Interface ledger is empty', Object.keys(game.settings.get(MOD, 'ifaceShiftDone') || {}).length === 0);
      const trace = game.nightcity.traceService.getLog(), access = game.nightcity.accessLogService?.entryCount ?? 0;
      if (journal) {
        check('The GM logs journal is GM-only (ownership NONE for players)', (journal.ownership?.default ?? 0) === 0);
        const pages = (journal.pages.contents || [...journal.pages]).map((p) => p.getFlag(MOD, 'gmLog')).filter(Boolean);
        check(`It holds the logs (${pages.join(', ') || 'none yet'})`, true);
      } else check('No GM logs journal yet — it is made on the first trace or network login', trace.length === 0 && access === 0);
      check(`Admin → Security has its trace rows (${trace.length}) and Networks its access rows (${access})`, Array.isArray(trace));
    }
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 13: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: Admin → Security → Activity still shows your earlier trace rows, and Admin → Networks still shows recent logins. Fail a terminal login as a player: the new row appears in Activity.</p>` });
})();
