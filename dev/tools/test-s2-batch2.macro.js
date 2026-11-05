// NCM stage 2, batch 2 — every template NCM preloads really exists (10 entries that pointed at files never in the
// repo were removed), and nothing NCM asks the server for comes back "not found".
// Run as the GM. It only reads (HTTP HEAD requests for NCM's own template files). Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Batch 2 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const { TEMPLATES } = await import('/modules/night-city-messenger/scripts/utils/constants.js');
    const gone = ['SHARD_BOOT_SCREEN', 'SHARD_ENTRY_MESSAGE', 'SHARD_ENTRY_EDDIES', 'SHARD_ENTRY_DOSSIER', 'SHARD_ENTRY_PAYLOAD',
      'SHARD_ENTRY_AVLOG', 'SHARD_ENTRY_LOCATION', 'SHARD_INDEX_STRIP', 'SHARD_IDENTITY_HEADER', 'ADMIN_SHARD_CARD'];
    const left = gone.filter((k) => k in TEMPLATES);
    check('The 10 entries for templates that never existed are gone', left.length === 0, left.join(', '));

    const paths = Object.values(TEMPLATES);
    const missing = [];
    await Promise.all(paths.map(async (p) => {
      try { const r = await fetch(`/${p}`, { method: 'HEAD', cache: 'no-store' }); if (!r.ok) missing.push(`${p} (${r.status})`); }
      catch (e) { missing.push(`${p} (${e.message})`); }
    }));
    check(`Every one of the ${paths.length} preloaded templates is on the server`, missing.length === 0, missing.slice(0, 5).join(', '));

    // what the startup preload registered
    const cached = paths.filter((p) => !!Handlebars.partials?.[p] || !!(globalThis._templateCache?.[p])).length;
    check('The startup preload registered the templates', cached > 0, `${cached} of ${paths.length} are in Foundry's template cache`);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, batch 2: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: reload the world with the browser console open (F12). There should be no "Template preloading had errors" warning from NCM and no 404 for a file under templates/.</p>` });
})();
