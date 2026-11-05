// NCM stage 2 — every NCM dialog moved from Foundry's v1 Dialog to DialogV2 (NcmDialog, utils/ncmDialog.js). Nothing
// should look or behave differently. Run as the GM (then as a player for the player half). It opens real dialogs
// and presses their buttons / keys itself — leave the mouse alone for ~5 seconds. Changes nothing in the world.
// Results arrive as a whispered card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const top = () => [...document.querySelectorAll('dialog.ncm-dialog-v2')].pop();
  const errs = []; const onErr = (e) => errs.push(String(e?.message || e?.reason?.message || e));
  window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
  try {
    const A = await import('/modules/night-city-messenger/scripts/utils/adminTheme.js');
    const gm = game.user.isGM;
    const confirm = gm ? A.adminConfirm : A.playerConfirm;
    // confirm → Yes
    let p = confirm({ title: 'NCM test: confirm', content: '<p>Press nothing — the test answers.</p>' });
    await sleep(600); let d = top();
    check('A confirm opens on the new frame', !!d && d.classList.contains(gm ? 'ncm-admin-dialog' : 'ncm-player-dialog'), d?.className);
    if (gm) check('It wears your admin theme', !!d?.dataset.ncmAdminTheme, d?.dataset.ncmAdminTheme);
    check('Yes is the default button, and has focus', d?.querySelector('button.dialog-button.default')?.dataset.button === 'yes' && document.activeElement === d?.querySelector('button.dialog-button.default'));
    d?.querySelector('button[data-button="yes"]')?.click();
    check('Pressing Yes answers true', (await p) === true);
    // confirm → Escape
    p = confirm({ title: 'NCM test: escape', content: '<p>…</p>' }); await sleep(600); d = top();
    d?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    check('Escape closes it with no answer (null)', (await p) === null);
    // themed prompt → Enter
    p = A.themedPrompt({ title: 'NCM test: prompt', content: '<input type="text" name="n" value="old">', read: (root) => root.querySelector('input[name="n"]').value });
    await sleep(700); d = top(); const inp = d?.querySelector('input[name="n"]');
    check('A prompt focuses its field', document.activeElement === inp);
    if (inp) { inp.value = 'typed'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }
    check('Enter in the field saves it', (await p) === 'typed');
    await sleep(300);
    check('No NCM test dialog is left open', !document.querySelector('dialog.ncm-dialog-v2'));
    check('No errors', errs.length === 0, errs.join(' | '));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, DialogV2: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: delete something from an admin tab (confirm), rename a shard (prompt), post an access point to chat, and as a player try a shard breach (the breach dialog: pick a skill, Luck +/−, Execute). Each should look exactly as before.</p>` });
})();
