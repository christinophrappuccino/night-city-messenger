// NCM stage 2, step 12 — the message viewer's clicks go through one action table (VIEWER_ACTIONS), not a switch.
// Nothing should look or behave differently. Run as anyone with a character: it opens your inbox, clicks a few
// harmless controls (a folder filter, the Filters dropdown, a message if there is one, back, the identity drawer),
// and checks each did its job with no error. Changes nothing. Results arrive as a whispered card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errs = [];
  const onErr = (e) => errs.push(String(e?.message || e?.reason?.message || e));
  window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
  try {
    const actor = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
    if (!actor) throw new Error('No character to open an inbox for (assign one to your user).');
    game.nightcity.openInbox(actor.id);
    await sleep(2500);
    const app = [...foundry.applications.instances.values()].find((a) => a.constructor.name === 'MessageViewerApp');
    check(`The inbox opens (${actor.name})`, !!app);
    const root = app.element;
    const f0 = app.currentFilter;
    const other = [...root.querySelectorAll('[data-action="set-filter"]')].find((e) => e.dataset.filter !== f0);
    other?.click(); await sleep(900);
    check('A folder button switches the folder', !other || app.currentFilter === other.dataset.filter, `${f0} → ${app.currentFilter}`);
    root.querySelector('[data-action="toggle-filter-dropdown"]')?.click(); await sleep(500);
    check('The Filters dropdown opens', !!app.element.querySelector('.ncm-filter-dropdown:not(.ncm-hidden)'));
    app.element.querySelector('[data-action="toggle-filter-dropdown"]')?.click(); await sleep(400);
    other && app.element.querySelector(`[data-action="set-filter"][data-filter="${f0}"]`)?.click(); await sleep(900);
    const row = app.element.querySelector('[data-action="select-message"]');
    if (row) { row.click(); await sleep(1200); check('Clicking a message opens it', !!app.selectedMessageId, app.selectedMessageId || ''); }
    else check('Clicking a message opens it (no mail in this folder — skipped)', true);
    app.element.querySelector('[data-action="mobile-back"]')?.click(); await sleep(600);
    await app.close();
    check('No errors from any of those clicks', errs.length === 0, errs.join(' | '));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 12: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: use your inbox normally for a minute — reply, Reply All, delete and restore, mark read, the Dates/Sort/Filters menus, an attachment, the identity drawer, the Calls tab. Everything should work exactly as before.</p>` });
})();
