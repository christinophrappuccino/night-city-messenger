// NCM stage 2, step 14 — the feature registry. An optional system switched off by its world setting is not
// installed: its startup steps are skipped (and listed), its socket requests get a "switched off" answer instead of a
// handler. Conversations is the first feature on it. Read-only. Run as the GM; run it ONCE with Conversations off
// and ONCE with it on (Module Settings → Conversations; the world reloads). Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Step 14 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const F = game.nightcity?.features;
    check('game.nightcity.features exists (isOn / list / off)', !!F && typeof F.isOn === 'function' && typeof F.list === 'function' && typeof F.off === 'function');
    const setting = !!game.settings.get('night-city-messenger', 'conversationsEnabled');
    const on = F.isOn('conversations');
    check(`Conversations reads ${on ? 'ON' : 'OFF'}, matching its setting`, on === setting);
    check('The feature list has Conversations with its state', F.list().some((x) => x.name === 'conversations' && x.on === on), F.list().map((x) => `${x.name}:${x.on ? 'on' : 'off'}`).join(', '));
    const svc = game.nightcity.conversationService;
    check('The Conversations service object exists either way, and says the same', !!svc && svc.enabled === on);
    const skipped = game.nightcity.startupReport?.skipped || [];
    const convSkipped = skipped.filter((s) => s.includes('conversations off'));
    check(on ? 'Nothing of Conversations was skipped at startup' : 'Its two startup steps were skipped (not failed)', on ? convSkipped.length === 0 : convSkipped.length === 2, skipped.join(', ') || 'none');
    check('No startup step failed', (game.nightcity.startupReport?.failed || []).length === 0, (game.nightcity.startupReport?.failed || []).join(', '));
    const h = game.nightcity.socketManager?._handlers?.get('conversation:request');
    check(on ? 'The real request handler is installed' : 'A "switched off" stand-in answers requests instead', !!h && (on ? !h.ncmFeatureOff : h.ncmFeatureOff === 'conversations'));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 14: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: with Conversations ON, a player starts a group chat and posts a line (the GM must be online). With it OFF, no Conversations tab shows in the Agent or Admin → Messages.</p>` });
})();
