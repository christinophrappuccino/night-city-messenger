// NCM audit fix D6 — "does a watched node console still flood the socket?"
// Run as a PLAYER (a GM's windows are never shared). Needs at least one network node that is switched ON and not
// hidden (Admin → Networks → a network → Nodes). It opens that node's console, shares it with a pretend watcher,
// counts the watch messages sent over 3 seconds while the traffic wave animates, then stops sharing.
// Before the fix that was ~30 messages (one per wave redraw); now it should be a handful at most.
// Results arrive as a chat card whispered to you.
(async () => {
  if (game.user.isGM) { ui.notifications.warn('D6 test: run this as a PLAYER — a GM\'s windows are never shared.'); return; }
  const ns = game.nightcity;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ws = ns.watchService;
  const node = (ns.networkService?.getNodes?.() || []).find((n) => !n.hidden && n.state === 'on');
  if (!ws || !node) { ui.notifications.warn('D6 test: needs NCM loaded and one network node that is ON and not hidden.'); return; }

  let app = null, rec = null;
  const realEmit = ns.socketManager.emit.bind(ns.socketManager);
  let count = 0;
  try {
    ns.openNode(node.id);
    for (let t = 0; t < 3000 && !app?.rendered; t += 200) { await sleep(200); app = foundry.applications?.instances?.get?.(`ncm-node-${node.id}`); }
    if (!app?.rendered) throw new Error('the node console did not open');
    check('The node console has its traffic wave marked "don\'t watch"', !!app.element.querySelector('[data-watch-ignore] [data-ndc-wave]'));
    if (!ws.canShare(app)) throw new Error('this window cannot be shared (is watching switched off in the module settings?)');
    rec = ws.shares.get(app.id) || ws.startShare(app);
    rec.watchers.add('d6-pretend-watcher');
    ws._syncObserver(rec);
    await sleep(500);   // the first picture goes out
    ns.socketManager.emit = (op, data) => { if (data?.shareId === rec.shareId) count += 1; return realEmit(op, data); };
    await sleep(3000);
    check('3 s of the animated wave sends only a handful of watch messages', count <= 4, `${count} sent (it used to be ~30)`);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    ns.socketManager.emit = realEmit;
    if (rec) { rec.watchers.delete('d6-pretend-watcher'); try { ws._syncObserver(rec); ws.stopShare(app); } catch { /* best effort */ } }
  }

  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM D6 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Optional real check: share the console for real (eye button) and watch it from another client; it should still look and update right.</p>` });
})();
