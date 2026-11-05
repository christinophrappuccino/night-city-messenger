// NCM audit fix C1 — "does everything NCM sets up at start-up really get set up, even on a slow host?"
// Run it as anyone after a normal load. It checks what the start-up should have registered:
//   • the call keybindings (they used to fail on a slow host: "You cannot register a Keybinding after the init hook"),
//   • NCM's canvas layer, the @NCM journal-link enricher, the settings,
//   • the templates loaded, and the rewritten empty-list template rendering the right icon for each folder.
// For the real test, reload with the browser's cache disabled and the network throttled (see the report) and run it again.
// Results arrive as a chat card whispered to whoever ran it.
(async () => {
  const MOD = 'night-city-messenger';
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });

  const binds = [...(game.keybindings?.actions?.keys?.() || [])].filter((k) => k.startsWith(`${MOD}.`));
  check('The call keybindings are registered', binds.length >= 1, binds.length ? `${binds.length}: ${binds.slice(0, 4).map((k) => k.slice(MOD.length + 1)).join(', ')}` : 'none — init ran too late');
  check('NCM\'s canvas layer is in CONFIG', !!CONFIG.Canvas?.layers?.ncmControls);
  check('The @NCM journal-link enricher is registered', (CONFIG.TextEditor?.enrichers || []).some((e) => /NCM/.test(String(e.pattern))));
  let settingsOk = true;
  try { game.settings.get(MOD, 'debugMode'); game.settings.get(MOD, 'callsEnabled'); } catch { settingsOk = false; }
  check('NCM settings are registered', settingsOk);

  const T = 'modules/night-city-messenger/templates/message-viewer/partials/empty-state-list.hbs';
  check('Templates were preloaded', !!Handlebars.partials?.[T] || !!globalThis._templateCache?.[T], 'the empty-list template is cached');
  const want = { inbox: 'fa-inbox', unread: 'fa-check-double', sent: 'fa-paper-plane', saved: 'fa-bookmark', spam: 'fa-shield-alt', trash: 'fa-recycle' };
  let rendered = true; const wrong = [];
  for (const [f, icon] of Object.entries(want)) {
    try {
      const html = await renderTemplate(T, { currentFilter: f });
      if (!html.includes(icon) || (html.match(/<i class="fas /g) || []).length !== 1) wrong.push(f);
    } catch (err) { rendered = false; wrong.push(`${f} (${err.message})`); }
  }
  check('The empty-list template shows the right icon for every folder', rendered && !wrong.length, wrong.join(', '));
  const sn = game.modules.get('social-navigator')?.active;
  if (sn) check('…with social-navigator\'s helpers active too', rendered && !wrong.length);

  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  const how = '<p style="font-size:12px">Slow-host test: F12 → Network → tick <b>Disable cache</b>, set throttling to <b>Slow 3G</b>, reload, wait for the game to load, run this again. Then set throttling back.</p>';
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM C1 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>${how}` });
})();
