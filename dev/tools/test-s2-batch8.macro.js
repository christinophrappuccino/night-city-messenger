// NCM stage 2, batch 8 — the startup report says what stopped working. scripts/core/serviceMap.js lists which service
// relies on which; when a startup step fails, the GM's notice names what is not running and what uses it.
// Run as the GM after a reload. It only reads (and builds a sample notice, without showing it). Results: whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Batch 8 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const { SERVICE_MAP, startupImpact } = await import('/modules/night-city-messenger/scripts/core/serviceMap.js');
    const ns = game.nightcity;
    const rep = ns?.startupReport;
    check('The startup report is on game.nightcity.startupReport', !!rep && Array.isArray(rep.failed), rep ? `failed: ${rep.failed.length}` : 'missing');
    check('This load had no failed startup step', rep?.failed?.length === 0, rep?.failed?.join(', '));
    const absent = Object.keys(SERVICE_MAP).filter((k) => !ns?.[k]);
    check('Every service in the table is running on this client', absent.length === 0, absent.join(', ') || `${Object.keys(SERVICE_MAP).length} services`);
    const sample = startupImpact({ failed: ['CallService'], missing: ['callService'] });
    check('A failed calls step would be explained in plain words', /calls and voicemail/.test(sample) && /payphones/.test(sample), sample);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, batch 8: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Also run it once as a PLAYER (it says "run as the GM" — instead paste <code>game.nightcity.startupReport</code> in the player's console): every service should be present there too.</p>` });
})();
