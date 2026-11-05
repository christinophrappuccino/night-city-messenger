// NCM stage 2, step 10a — Foundry v13 readiness: moved Foundry APIs go through scripts/utils/compat.js.
// On v12 every lookup must return the real v12 class (nothing namespaced exists yet). On v13 the same macro shows
// the namespaced classes in use. Run as the GM. It only reads (opens no window). Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Step 10a test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const C = await import('/modules/night-city-messenger/scripts/utils/compat.js');
    const gen = C.foundryGeneration();
    check('Foundry version read', gen >= 12, `v${gen} (build ${game.release?.build})`);
    const classes = { FilePicker: C.FilePickerClass(), ImagePopout: C.ImagePopoutClass(), DocumentOwnershipConfig: C.DocumentOwnershipConfigClass(), SettingsConfig: C.SettingsConfigClass(), InteractionLayer: C.InteractionLayerClass() };
    const missing = Object.entries(classes).filter(([, c]) => !c).map(([k]) => k);
    check('Every moved class is found', missing.length === 0, missing.join(', ') || Object.entries(classes).map(([k, c]) => `${k}→${c.name}`).join(', '));
    const html = await C.renderTemplate('modules/night-city-messenger/templates/partials/countermeasure-override.hbs', {});
    check('renderTemplate renders a real NCM template', typeof html === 'string' && html.length > 100, `${html?.length} chars`);
    const fp = C.newFilePicker({ type: 'image', current: '' });
    check('newFilePicker builds a real file picker (not opened)', !!fp && typeof fp.render === 'function', fp?.constructor?.name);
    const r = await C.browseFiles('data', 'modules/night-city-messenger/assets').catch((e) => ({ error: e.message }));
    check('browseFiles lists a folder', Array.isArray(r?.dirs), r?.error || `${r?.dirs?.length} folders`);
    check('htmlOf takes jQuery and elements', C.htmlOf($('<div><b>x</b></div>'))?.querySelector('b')?.textContent === 'x' && C.htmlOf(document.body) === document.body);
    check('The canvas layer for NCM\'s buttons exists', !!CONFIG.Canvas?.layers?.ncmControls);
    check('Startup had no failed step', (game.nightcity?.startupReport?.failed || []).length === 0, (game.nightcity?.startupReport?.failed || []).join(', '));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 10a: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real checks: pick a picture somewhere (Theme Customizer wallpaper, a contact portrait, Configure Terminal boot image) — the file picker opens as before. Share an image attachment to the popout. As GM, Admin → Shards → a world shard → Permissions opens.</p>` });
})();
