// NCM stage 2, batch 5 — dead code removed: 3 unused files, 2 socket broadcasts nobody received, 12 unused events,
// 4 listeners for events nothing sent, the "Shard expired" toast nothing could trigger, 2 public hooks that never fired.
// Run as the GM after a reload. It only reads. Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Batch 5 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const ns = game.nightcity;
    const fails = ns?.startupFailures || [];
    check('Startup finished with no failed step', fails.length === 0, fails.map((f) => f.name).join(', '));
    const { EVENTS, SOCKET_OPS } = await import('/modules/night-city-messenger/scripts/utils/constants.js');
    check('The removed events are gone from EVENTS', !['CONTACT_BURNED', 'CONTACT_VERIFIED', 'SHARD_EXPIRED', 'COMPOSER_OPEN', 'UI_VIEWER_OPENED'].some((k) => k in EVENTS));
    check('The two broadcasts nobody received are gone', !('SHARD_STATE_CHANGED' in SOCKET_OPS) && !('TERMINAL_STATE_CHANGED' in SOCKET_OPS));
    const bus = ns?.eventBus?._listeners;
    check('No module is offered the dead contacts:burned / contacts:verified hooks', !!bus && !bus.has('contacts:burned') && !bus.has('contacts:verified'));
    check('The live public hooks are still mirrored', !!bus?.has('message:sent') && !!bus?.has('groups:created'), 'message:sent, groups:created');
    check('The public API object is still there', !!game.modules.get('night-city-messenger')?.api?.apiVersion);
    check('The "Shard expired" toast method is gone', typeof ns?.notificationService?.showShardExpired === 'undefined');
    check('Composing a message still works from the API', typeof ns?.composeMessage === 'function');
    const gone = await Promise.all(['integrations/EmailSettingsIntegration.js', 'ui/dialogs/PlayerEmailSetup.js', 'utils/validators.js']
      .map((p) => fetch(`/modules/night-city-messenger/scripts/${p}`, { method: 'HEAD', cache: 'no-store' }).then((r) => r.status).catch(() => 0)));
    check('The three unused files are not on the server', gone.every((s) => s === 404), gone.join(', '));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, batch 5: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real checks: open a shard and a terminal and log in (both used to broadcast a state message nobody heard; they should behave as before). Let a timed shard self-destruct: the sound still plays.</p>` });
})();
