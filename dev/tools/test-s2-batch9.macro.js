// NCM stage 2, batch 9 — the events NCM publishes to other modules are one table (publicEvents.js), on the API as
// `publicEvents`, and message:received now fires its hook once per message.
// Run as the GM. It listens to NCM's own hooks for a moment and sends test events on this client only (you'll see one
// "New message" toast for the test; nothing reaches other clients, nothing is saved). Results: a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Batch 9 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const ids = [];
  try {
    const api = game.modules.get('night-city-messenger')?.api;
    check('The API is version 1.1.0 and carries the event table', api?.apiVersion === '1.1.0' && Array.isArray(api?.publicEvents), api?.apiVersion);
    check('The table lists the 14 published events', api?.publicEvents?.length === 14, (api?.publicEvents || []).map((e) => e.name).join(', '));
    let got = 0;
    ids.push(['night-city-messenger.message:received', Hooks.on('night-city-messenger.message:received', () => { got++; })]);
    const bus = game.nightcity.eventBus;
    const testId = `s2b9-test-${Date.now()}`;
    bus.emit('message:received', { messageId: testId, subject: 'test (socket)' });
    bus.emit('message:received', { messageId: testId, subject: 'test (journal sync)' });
    check('Two copies of one delivery fire the public hook once', got === 1, `${got} hook call(s)`);
    let sent = 0;
    ids.push(['night-city-messenger.message:sent', Hooks.on('night-city-messenger.message:sent', () => { sent++; })]);
    bus.emit('message:sent', { messageId: testId });
    check('Other events are still passed on', sent === 1);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    for (const [hook, id] of ids) Hooks.off(hook, id);
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, batch 9: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Expected side effect: ONE "New message — test (socket)" toast on your screen. NCM's own toast listens to the same event and also shows it once. The test events touched only your client; nothing was saved or sent.</p>` });
})();
