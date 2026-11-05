// NCM audit fix D4 — "after a window redraws a few times, does one key press still do one thing?"
// Run as the GM. It:
//   • opens the composer, redraws it 3 times, presses Escape → it must close ONCE (not 4 times);
//   • opens Create Network, redraws it 3 times, types a name, presses Enter → it must create ONE network
//     (it used to create one per redraw). The test network is deleted again.
// Results arrive as a chat card whispered to the GM.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('D4 test: run this as the GM.'); return; }
  const ns = game.nightcity;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const apps = () => [...(foundry.applications?.instances?.values?.() || [])];
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  // ── composer ──
  try {
    await ns.composeMessage?.({});
    await sleep(800);
    const comp = apps().find((a) => a.constructor?.name === 'MessageComposerApp' && a.rendered);
    if (!comp) throw new Error('the composer did not open');
    for (let i = 0; i < 3; i++) { await comp.render(true); await sleep(250); }
    let closes = 0;
    const realClose = comp.close.bind(comp);
    comp.close = (o) => { closes += 1; return realClose(o); };
    key(comp.element, 'Escape');
    await sleep(800);
    check('Escape after 3 redraws closes the composer once', closes === 1, `close ran ${closes} time(s)`);
  } catch (err) { check('Composer test', false, err.message); }

  // ── create network ──
  const NAME = `NCM D4 Test ${foundry.utils.randomID(4)}`;
  let made = [];
  try {
    const svc = ns.networkService;
    const realCreate = svc.createNetwork.bind(svc);
    svc.createNetwork = async (d) => { const r = await realCreate(d); if (r?.network) made.push(r.network.id); return r; };
    try {
      // the module's own launcher (importing the class here would load a second copy of it)
      ns.createNetwork({ preset: 'blank' });
      let dlg = null;
      for (let t = 0; t < 4000 && !dlg; t += 200) { await sleep(200); dlg = foundry.applications?.instances?.get?.('ncm-create-network') || apps().find((a) => a.id === 'ncm-create-network'); if (dlg && !dlg.rendered) dlg = null; }
      if (!dlg) throw new Error('the dialog did not open');
      for (let i = 0; i < 3; i++) { await dlg.render(true); await sleep(250); }
      const input = dlg.element.querySelector('[name="name"]');
      input.value = NAME; input.dispatchEvent(new Event('input', { bubbles: true }));
      key(input, 'Enter');
      await sleep(1500);
      check('Enter after 3 redraws creates ONE network', made.length === 1, `${made.length} created`);
    } finally { svc.createNetwork = realCreate; }
  } catch (err) { check('Create Network test', false, err.message); }
  for (const id of made) { try { await ns.networkService.deleteNetwork(id); } catch { /* best effort */ } }
  if (made.length) check('Test network(s) removed', !made.some((id) => ns.networkService.getNetwork?.(id)), `${made.length} deleted`);

  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM D4 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>` });
})();
