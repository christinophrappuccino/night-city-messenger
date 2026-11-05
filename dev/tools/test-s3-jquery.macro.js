// NCM batch (v13 jQuery sweep): about fifty dialog buttons now read their fields with plain DOM calls instead of jQuery
// (lockouts / heat / countdowns in Security, the broadcast and schedule editors in Messages, the time & domain dialogs
// in Tools, preset names, link / map / eddies inserts in the composer, terminal mail edits…). Nothing should look or
// act differently. Run as a GM. It opens one small test dialog, fills it, presses its button and closes it.
// Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const { htmlOf } = await import('/modules/night-city-messenger/scripts/utils/compat.js');
    const { adminDialog } = await import('/modules/night-city-messenger/scripts/utils/adminTheme.js');
    let got = null;
    const d = adminDialog({
      title: 'NCM jQuery sweep test', default: 'ok',
      content: '<input type="number" name="by" value="0"><input type="checkbox" name="tp"><select name="pick"><option value="a">A</option><option value="b">B</option></select>',
      buttons: { ok: { label: 'OK', callback: (html) => { got = { by: Number(htmlOf(html).querySelector('[name="by"]')?.value), tp: !!htmlOf(html).querySelector('[name="tp"]')?.checked, pick: htmlOf(html).querySelector('[name="pick"]')?.value, none: htmlOf(html).querySelector('[name="none"]')?.value }; } } },
    });
    d.render(true);
    await sleep(700);
    const root = [...document.querySelectorAll('.ncm-dialog-v2, .dialog')].find((x) => x.querySelector('[name="by"]'));
    check('The test dialog opened', !!root);
    if (root) {
      root.querySelector('[name="by"]').value = '7';
      root.querySelector('[name="tp"]').checked = true;
      root.querySelector('[name="pick"]').value = 'b';
      root.querySelector('[data-button="ok"]')?.click();
      await sleep(500);
      check('Its button read a number field', got?.by === 7, JSON.stringify(got));
      check('…a checkbox', got?.tp === true);
      check('…a dropdown', got?.pick === 'b');
      check('…and a missing field reads as empty, not an error', got && got.none === undefined);
    }
    const mods = ['core/MigrationRunner.js', 'ui/MessageComposer/MessageComposerApp.js', 'ui/ThemeCustomizer/ThemeCustomizerApp.js', 'ui/ItemInbox/DataShardComposer.js', 'ui/ItemInbox/ItemInboxApp.js',
      'ui/Terminal/TerminalViewerApp.js', 'ui/Terminal/TerminalConfigApp.js', 'ui/AdminPanel/tabs/MessagesTab.js', 'ui/AdminPanel/tabs/NetworksTab.js', 'ui/AdminPanel/tabs/SecurityTab.js',
      'ui/AdminPanel/tabs/ToolsTab.js', 'ui/NetworkNodes/JackInLock.js', 'ui/ShardEncoder/ShardIconBuilder.js'];
    const failed = (await Promise.all(mods.map((m) => import('/modules/night-city-messenger/scripts/' + m).then(() => null, (e) => `${m}: ${e.message}`)))).filter(Boolean);
    check(`The ${mods.length} changed files load`, !failed.length, failed.join(' | '));
    check('No startup step failed', !(game.nightcity.startupReport?.failed || []).length, (game.nightcity.startupReport?.failed || []).join(', '));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM dialog field reads: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: Admin → Security, lock out a terminal for a few minutes with "tell the player" ticked, then set someone's heat; Messages → Broadcast to everyone; Tools → Time Config, set a manual date; Tools → Email Domains, add one and save; in the composer insert a link and an eddies amount; save a theme preset under a name; Data Shards → the Breach skill/luck dialog and JackIn animation still work.</p>` });
})();
