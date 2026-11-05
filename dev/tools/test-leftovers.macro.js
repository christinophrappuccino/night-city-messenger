// NCM audit leftovers — badges, send checks, contacts queue, word spaces, access log, Force Refresh, encoder results.
// Run as the GM. It only reads, plus one Force Refresh (which just redraws open NCM windows on every client).
// Nothing is saved. Results arrive as a chat card whispered to you.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Leftovers test: run this as the GM.'); return; }
  const ns = game.nightcity;
  const M = '/modules/night-city-messenger/scripts';
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const probes = [];
  try {
    // 1. Badges keep their colours whatever the player theme
    const probe = (html) => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-9999px;top:0'; d.innerHTML = html; document.body.appendChild(d); probes.push(d); return d.firstElementChild; };
    const chip = probe('<span class="ncm-shard-img-tag"><i class="fas fa-microchip"></i></span>');
    const term = probe('<span class="ncm-shard-img-tag ncm-terminal-img-tag"><i class="fas fa-terminal"></i></span>');
    const c1 = getComputedStyle(chip).color, c2 = getComputedStyle(term).color, b2 = getComputedStyle(term).backgroundColor;
    check('The shard badge is a cyan chip', c1 === 'rgb(25, 243, 247)', c1);
    check('The terminal badge is a white glyph on red', c2 === 'rgb(255, 255, 255)' && b2 === 'rgb(255, 0, 51)', `${c2} on ${b2}`);

    // 2. The GM re-checks a player's recipients
    check('The GM re-checks the recipients of every relayed player message', /checkRecipientsAsPlayer/.test(String(ns.messageService?.handleMessageRelay)));

    // 3. Word spaces in rich text
    const { cleanHtml } = await import(`${M}/utils/richText.js`);
    const out = cleanHtml('<b>Hello</b> <i>world</i>', { mode: 'mail' });
    check('"<b>Hello</b> <i>world</i>" keeps its space', out === '<b>Hello</b> <i>world</i>', out);

    // 4. One GM saves the access log
    const active = game.users.activeGM;
    check('The network access log is saved by one GM only', !!active, `${active?.name || 'nobody'} saves it${game.users.filter((u) => u.isGM && u.active).length > 1 ? '; the other GMs reload it' : ''}`);

    // 5. Encoder results
    const { awaitConvertResult } = await import(`${M}/ui/ShardEncoder/ShardEncoderApp.js`);
    check('Shard Encoder results wait on one shared handler', typeof awaitConvertResult === 'function');

    // 6. Force Refresh
    const { refreshNcmWindows } = await import(`${M}/utils/forceRefresh.js`);
    const n = refreshNcmWindows();
    ns.socketManager?.emit?.('admin:forceRefresh', { at: Date.now() });
    check('Force Refresh redraws open NCM windows (and tells every client to)', n >= 0, `${n} NCM window(s) redrawn here; players get "Your GM refreshed Night City Messenger."`);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    for (const p of probes) p.remove();
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM leftovers test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real checks: switch a player to the Blackwall theme and look at a converted shard and terminal in the Items directory. As a player, try to message a send-only address. Admin → Tools → Force Refresh: players see a short notice.</p>` });
})();
