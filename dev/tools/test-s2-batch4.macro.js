// NCM stage 2, batch 4 — one player → GM round trip (utils/gmRequest.js). Shard pricing, shard unconvert and Shard
// Encoder conversions wait through ONE handler per answer, so two requests in flight each get their own answer, and
// only a GM's answer counts.
// Run as the GM. It uses throwaway op names on the live SocketManager and removes them afterwards; nothing is sent
// to other clients and nothing is saved. Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Batch 4 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sm = game.nightcity?.socketManager;
  const OPS = ['ncm-test:s2b4-result', 'ncm-test:s2b4-dup'];
  const realWarn = console.warn; const warns = [];
  try {
    const { awaitGmResult, pendingGmRequests } = await import('/modules/night-city-messenger/scripts/utils/gmRequest.js');
    check('The live SocketManager is running', !!sm?.isActive);
    // a stand-in for the network: requests are collected, answers are fed to the real handler as the server would
    const sent = [];
    const fake = { register: (op, fn) => sm.register(op, fn), emit: (op, data) => sent.push(data) };
    const answer = (data, from) => sm._handlers.get(OPS[0])?.(data, from);
    const a = awaitGmResult(fake, OPS[0], (id) => fake.emit('x', { requestId: id, n: 'a' }), { timeoutMs: 3000, timeoutValue: 'timeout' });
    const b = awaitGmResult(fake, OPS[0], (id) => fake.emit('x', { requestId: id, n: 'b' }), { timeoutMs: 3000, timeoutValue: 'timeout' });
    check('Two requests are waiting at once', pendingGmRequests(fake, OPS[0]) === 2);
    const player = game.users.find((u) => !u.isGM);
    if (player) answer({ requestId: sent[0].requestId, v: 'FORGED' }, player.id);
    check('An answer from a player does not count', pendingGmRequests(fake, OPS[0]) === 2, player ? `tried as ${player.name}` : 'no player in this world to try as');
    answer({ requestId: sent[1].requestId, v: 'B' }, game.user.id);
    answer({ requestId: sent[0].requestId, v: 'A' }, game.user.id);
    const [ra, rb] = [await a, await b];
    check('Answered out of order, each request gets its own answer', ra?.v === 'A' && rb?.v === 'B', `${ra?.v}, ${rb?.v}`);
    const t = await awaitGmResult(fake, OPS[0], () => {}, { timeoutMs: 50, timeoutValue: { decision: 'pending' } });
    check('No answer in time resolves (never hangs)', t?.decision === 'pending');

    console.warn = (...args) => { warns.push(args.join(' ')); realWarn(...args); };
    sm.register(OPS[1], () => 1); sm.register(OPS[1], () => 2);
    check('SocketManager now warns when a second handler replaces the first', warns.some((w) => /registered twice/.test(w)));

    const prices = String((await import('/modules/night-city-messenger/scripts/ui/ShardEncoder/ShardMarket.js')).requestShardPrice);
    check('Shard pricing waits through the shared helper', /awaitGmResult/.test(prices));
    check('Shard unconvert waits through the shared helper', /awaitGmResult/.test(String(game.nightcity?._shardSheetOverride?._requestPlayerUnconvert ?? (await import('/modules/night-city-messenger/scripts/integrations/ShardSheetOverride.js')).ShardSheetOverride.prototype._requestPlayerUnconvert)));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    console.warn = realWarn;
    for (const op of OPS) sm?._handlers?.delete(op);
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, batch 4: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check (two clients): with Player Authoring pricing on "propose", a player encodes two shards quickly and asks a price for each; approve both — each Encoder window shows its own verdict. Also: reload with F12 open; NCM should print no "was registered twice" warning at startup.</p>` });
})();
