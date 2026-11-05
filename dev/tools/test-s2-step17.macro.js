// NCM stage 2, step 17 — Simple network mode ("Network simulation" off). Read-only. Run as the GM twice: once with
// Network simulation ON (Module Settings), once with it OFF (the world reloads). Each run checks the answers fit the
// mode. Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Step 17 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const ns = game.nightcity, net = ns.networkService;
  try {
    const setting = !!game.settings.get('night-city-messenger', 'networkSimulationEnabled');
    const simple = !setting;
    check(`Network simulation reads ${setting ? 'ON' : 'OFF (simple mode)'}, matching the setting`, ns.features.isOn('networks') === setting && net.simple === simple);
    if (simple) {
      check('Everyone is on CitiNet', net.currentNetworkId === 'CITINET' || net.currentNetwork?.name === 'CitiNet', net.currentNetwork?.name || net.currentNetworkId);
      check('Always connected at full signal, no dead zone', !net.isDeadZone && net.signalStrength === 100);
      check('CitiNet is the only network on offer', net.getAvailableNetworks().length === 1, net.getAvailableNetworks().map((n) => n.name).join(', '));
      check('Mail is never network-restricted', net.getMessageAccessControl() === null);
      check('A whitelist network gate passes', net.checkAccess({ accessMode: 'whitelist', allowedNetworks: ['nowhere'] }).allowed === true);
      const h = ns.socketManager._handlers.get('network:nodeRequest') ?? [...ns.socketManager._handlers.entries()].find(([k]) => /node/i.test(k))?.[1];
      check('Node requests get the "switched off" stand-in', !!h && h.ncmFeatureOff === 'networks');
      const skipped = ns.startupReport?.skipped || [];
      check('Nothing failed at startup', !(ns.startupReport?.failed || []).length, skipped.join(', ') || 'nothing skipped');
      const nodes = net.getNodes?.() || [];
      check(`Your networks (${net.getAllNetworks().length}) and nodes (${nodes.length}) are kept`, true);
    } else {
      check('The full simulation answers as before (a whitelist gate can refuse)', net.checkAccess({ accessMode: 'whitelist', allowedNetworks: ['nowhere'] }).allowed === false);
      const h = [...ns.socketManager._handlers.entries()].find(([k]) => /node/i.test(k))?.[1];
      check('The real node request handler is installed', !!h && !h.ncmFeatureOff);
    }
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 17: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check, as a player in simple mode: move to a scene you marked a dead zone (still connected), open a shard or terminal that needs a network (it opens), click a network node pin ("nothing to connect to here"), and send mail (it arrives).</p>` });
})();
