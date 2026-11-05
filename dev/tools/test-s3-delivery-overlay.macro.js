// NCM batch (R19 + R17): what happens after a message is delivered (the terminal mirror, network-node taps) is now a
// list the terminal and network systems register into, instead of MessageService calling them by name. And the
// framework-free pop-ups share one frame (scripts/ui/overlay.js); the operator picker uses it. Nothing should behave
// differently. Run as anyone. Read-only (a test overlay opens and closes itself). Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const hooks = (game.nightcity.messageService?._afterDelivery || []).map((h) => h.name);
    check('After-delivery list has the terminal mirror, then the network taps', hooks.join() === 'terminal-mirror,node-taps', hooks.join(', ') || 'empty');

    const { mountOverlay } = await import('/modules/night-city-messenger/scripts/ui/overlay.js');
    let got = 'unset';
    const o = mountOverlay({ className: 'ncm-test-overlay', onClose: (v) => { got = v; } });
    const mounted = document.body.contains(o.root);
    o.root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check('A test overlay mounts and a backdrop click closes it', mounted && o.closed && got === null && !document.body.contains(o.root));
    const o2 = mountOverlay({ className: 'ncm-test-overlay' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape closes it', o2.closed && !document.querySelector('.ncm-test-overlay'));

    const failed = await import('/modules/night-city-messenger/scripts/ui/content/OperatorSelect.js').then(() => null, (e) => e.message);
    check('The operator picker loads', !failed, failed || '');
    check('No startup step failed', !(game.nightcity.startupReport?.failed || []).length, (game.nightcity.startupReport?.failed || []).join(', '));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM after-delivery + overlay: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: send mail to a character who has a linked terminal account (it should show on the terminal too); with a node tapped, send mail over that network (the runner's EXFIL folder gets a copy); as a player with two characters, open a terminal action that asks "who's operating" — the picker opens, Escape and clicking outside cancel it, picking a character works.</p>` });
})();
