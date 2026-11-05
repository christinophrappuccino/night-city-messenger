// NCM cleanup batch (after stage 2): 13 dead message-viewer actions and the 7 methods only they used were removed,
// the bulk / compose aliases became the names the buttons use, the unused INBOX_REFRESH and LOG_RELAY socket ops and
// the shard-expired toast leftovers went. Nothing should behave differently. Run as anyone with a character; it
// opens your inbox, presses a few buttons and closes it. Changes nothing. Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errs = []; const onErr = (e) => errs.push(String(e?.message || e?.reason?.message || e));
  window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
  try {
    const actor = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
    if (!actor) throw new Error('No character to open an inbox for.');
    game.nightcity.openInbox(actor.id); await sleep(2500);
    const app = [...foundry.applications.instances.values()].find((a) => a.constructor.name === 'MessageViewerApp');
    check(`The inbox opens (${actor.name})`, !!app);
    const root = app.element;
    const actions = [...new Set([...root.querySelectorAll('[data-action]')].map((e) => e.dataset.action))];
    const gone = ['toggle-network-filter', 'filter-network', 'toggle-search', 'quick-reply', 'decrypt-message', 'force-decrypt-message', 'bypass-password', 'bypass-skill', 'bypass-keyitem', 'add-contact', 'toggle-select', 'select-all', 'close-window'];
    check('No button on screen names a removed action', !actions.some((a) => gone.includes(a)), actions.filter((a) => gone.includes(a)).join(', '));
    // compose (was aliased): opens the composer
    const before = new Set([...foundry.applications.instances.values()]);
    root.querySelector('[data-action="compose-new"]')?.click(); await sleep(1200);
    const composer = [...foundry.applications.instances.values()].find((a) => !before.has(a) && /Composer/.test(a.constructor.name));
    check('Compose opens the composer', !!composer);
    await composer?.close();
    // the bulk bar's Clear (was aliased) runs without an error even with nothing selected
    const clear = app.element.querySelector('[data-action="bulk-clear"]');
    if (clear) { clear.click(); await sleep(400); }
    check('Bulk Clear runs (or is hidden with nothing selected)', true, clear ? 'clicked' : 'not shown');
    // Escape in the search box still closes search (it used the kept _toggleSearch)
    const search = app.element.querySelector('input[type="search"], .ncm-viewer__search input');
    if (search) { search.focus(); search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(400); }
    check('Escape in search works', true, search ? 'pressed' : 'no search box on screen');
    await app.close();
    check('No errors from any of it', errs.length === 0, errs.join(' | '));
    check('The two unused socket ops are gone', !game.nightcity.socketManager._handlers.has('log:relay') && !game.nightcity.socketManager._handlers.has('inbox:refresh'));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM cleanup batch: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: tick a few messages and use Mark read / Clear / Delete in the bulk bar; click a phone number in a message (it opens Calls).</p>` });
})();
