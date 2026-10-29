/**
 * NCM — NETWORK NODES test-setup macro (NOT loaded by the module)
 * @file dev/tools/test-network-nodes-setup.macro.js
 *
 * Paste into a new Foundry **Script Macro** and run it as GM, on the scene you want to test on. It builds everything
 * the network-node work needs (dev/design/NETWORK-NODES.md, steps 1–5):
 *
 *   · a test network, "NCM Test Mesh" (made once, reused after) — no login, so any player can connect;
 *   · three nodes of it:
 *       A  "Test relay (locked)"  on THIS scene, box LOCKED, jack-in DV 13 — placed as a map pin in the middle of
 *          your view, so a player double-clicks it to open the console;
 *       B  "Test router"          on another scene (no scene if this is the only one);
 *       C  "Test junction"        on a third scene (or no scene) — B and C give a worm somewhere to spread. They are
 *          kept OFF this scene on purpose: a network goes dark here only when every node of it here is off;
 *   · a data shard, "Network Toolkit (TEST)", on the character you pick, carrying one of every network program, each a
 *     different insert DV:
 *       GHOSTWORM.bin   Worm, every 1 h, up to 3 nodes, carries a Blackout bomb (fires 4 h after insert)   DV 13
 *       LISTEN.worm     Worm, every 2 h, up to 2 nodes, carries a Sniffer                               DV 15
 *       tap.exe         Tap                                                                               DV 12
 *       lights-out      Blackout bomb, 1 h fuse                                                           DV 15
 *       sniff.bin       Sniffer, keeps 10                                                                 DV 11
 *       patch.kit       Patch (cleans the node)                                                           DV 10
 *
 * Then it whispers you a what-to-try list. Run it again to add another toolkit; the network and nodes are reused.
 * Clean up: delete the shard item, the nodes (Admin → Networks → NCM Test Mesh → Nodes) and the network.
 */

(async () => {
  const NCM = game.nightcity;
  const ns = NCM?.networkService;
  const api = NCM?.messenger;
  if (!game.user.isGM) return ui.notifications.warn('GM only.');
  if (!ns?.saveNode || !api?.convertToDataShard || !api?.addShardMessage) return ui.notifications.error('NCM is not ready (network nodes or data shards missing).');
  const scene = canvas?.scene;
  if (!scene) return ui.notifications.warn('Open the scene you want to test on first.');

  // ── 1. Who gets the toolkit — pick a player character (a selected token is preselected) ──
  const pcs = game.actors.filter((a) => a.hasPlayerOwner && a.type !== 'container');
  if (!pcs.length) return ui.notifications.error('No player-owned characters in this world.');
  const pre = canvas.tokens?.controlled?.[0]?.actor?.id;
  const opts = pcs.map((a) => `<option value="${a.id}" ${a.id === pre ? 'selected' : ''}>${a.name}</option>`).join('');
  let pickedId = null;
  await new Promise((resolve) => new Dialog({
    title: 'Network nodes test — who carries the toolkit?',
    content: `<p>The shard goes in this character's inventory (Insert a shard only looks at what the jacking-in character carries).</p><select name="who" style="width:100%">${opts}</select>`,
    buttons: {
      ok: { icon: '<i class="fas fa-check"></i>', label: 'Set it up', callback: (html) => { pickedId = html[0].querySelector('[name="who"]').value; } },
      cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
    },
    default: 'ok',
    close: () => resolve(),
  }).render(true));
  const who = game.actors.get(pickedId);
  if (!who) return;

  // ── 2. The test network (made once) ──
  let net = ns.getAllNetworks().find((n) => n.name === 'NCM Test Mesh');
  if (!net) {
    const r = await ns.createNetwork({
      name: 'NCM Test Mesh', type: 'CUSTOM', description: 'A test network for network nodes. Delete it when done.',
      availability: { global: false, scenes: [] }, signalStrength: 82, reliability: 95,
      security: { requiresAuth: false }, theme: { icon: 'fa-tower-broadcast', color: '#5c9bff' },
    });
    if (!r?.success) return ui.notifications.error('Could not create the test network: ' + (r?.error || 'unknown'));
    net = r.network;
  }

  // ── 3. Three nodes (reused if they exist) — A here and pinned, B and C on other scenes for a worm to reach ──
  // B and C must NOT stand on the test scene: a network goes dark on a scene only when EVERY node of it there is off,
  // so a second node here would keep it up after you switch A off. No other scene → they stand on no scene (a worm
  // can still hop to them).
  const others = game.scenes.filter((s) => s.id !== scene.id);
  const sceneB = others[0] || null, sceneC = others[1] || others[0] || null;
  const mine = ns.getNodes({ networkId: net.id });
  const ensure = async (name, data) => mine.find((n) => n.name === name) || (await ns.saveNode({ networkId: net.id, name, ...data }))?.node;
  const A = await ensure('Test relay (locked)', { kind: 'relay', sceneId: scene.id, place: 'test pin, middle of the view', security: { requiresAuth: true }, override: { dv: 13 },
    flavour: ['TEST-MESH keepalive', 'unit-07 → relay · handshake ok'] });
  const B = await ensure('Test router', { kind: 'router', sceneId: sceneB?.id || '', place: 'worm hop #1' });
  const C = await ensure('Test junction', { kind: 'junction', sceneId: sceneC?.id || '', place: 'worm hop #2' });
  // an earlier run of this macro may have put B / C on the test scene — move them off it
  for (const n of [B, C]) if (n?.sceneId === scene.id) await ns.saveNode({ ...n, sceneId: (n === B ? sceneB?.id : sceneC?.id) || '' });
  if (!A || !B || !C) return ui.notifications.error('Could not create the test nodes.');
  const pinned = scene.notes.some((n) => n.getFlag('night-city-messenger', 'accessNode') === A.id);
  if (!pinned) await NCM.terminalScenePins?.placeNode?.(A.id, { how: 'pin', where: 'view', range: 0, hidden: false, size: 2, sceneId: scene.id });

  // ── 4. The toolkit shard on the character ──
  const type = (game.documentTypes.Item || []).includes('gear') ? 'gear' : (game.documentTypes.Item || []).filter((t) => t !== 'base')[0];
  const [item] = await who.createEmbeddedDocuments('Item', [{ name: 'Network Toolkit (TEST)', type, img: 'systems/cyberpunk-red-core/icons/compendium/gear/memory_chip.svg' }]);
  if (!item) return ui.notifications.error('Could not create the shard item on ' + who.name + '.');
  const conv = await api.convertToDataShard(item, { shardName: 'NETWORK TOOLKIT', metadata: { creator: 'NCM test macro', classification: 'TEST', custom: { note: 'One of every network program.' } } });
  if (!conv?.success) return ui.notifications.error('Shard conversion failed: ' + (conv?.error || 'unknown'));

  const now = NCM.timeService?.getCurrentTimeMs?.() ?? Date.now();
  const prog = (subject, verb, dv, params, description, threat = 2) => api.addShardMessage(item, {
    from: 'toolkit@test', subject, contentType: 'malware', timestamp: new Date(now).toISOString(),
    contentData: {
      name: subject, payloadType: verb.replace(/^node/, '').toLowerCase(), threat, description, sizeLabel: '42 kb',
      uploadable: true, uploadDV: dv, uploadSkill: 'Interface', uploadTraceOnFail: true, uploadEffect: verb, uploadParams: params,
    },
  });
  await prog('GHOSTWORM.bin', 'nodeWorm', 13, { every: 1, maxNodes: 3, carry: 'bomb', delay: 4 }, 'Spreads every hour (up to 3 nodes) carrying a blackout bomb that fires 4 hours after you insert it.', 4);
  await prog('LISTEN.worm', 'nodeWorm', 15, { every: 2, maxNodes: 2, carry: 'sniffer', cap: 20 }, 'Spreads every 2 hours (up to 2 nodes) carrying a sniffer.', 3);
  await prog('tap.exe', 'nodeTap', 12, {}, 'Mail sent over the network is copied to you.', 2);
  await prog('lights-out', 'nodeBomb', 15, { delay: 1 }, 'One hour after you insert it, this node goes dark.', 3);
  await prog('sniff.bin', 'nodeSniffer', 11, { cap: 10 }, 'Records the last 10 messages sent over the network. Jack in again to collect.', 1);
  await prog('patch.kit', 'nodePatch', 10, {}, 'Cleans every infection off the node it is inserted into.', 1);

  // ── 5. What to try ──
  const li = (t) => `<li style="margin:0 0 4px">${t}</li>`;
  await ChatMessage.create({
    whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
    speaker: { alias: 'NCM test setup' },
    content: `<div style="font-size:13px;line-height:1.45">
      <p><b>Network nodes — ready.</b> ${who.name} carries <b>Network Toolkit (TEST)</b>. Network <b>NCM Test Mesh</b>; nodes:
      <b>${A.name}</b> (here, pinned, box locked, DV 13), <b>${B.name}</b> (${sceneB?.name || 'no scene'}), <b>${C.name}</b> (${sceneC?.name || 'no scene'}).</p>
      <ol style="padding-left:18px;margin:6px 0">
        ${li('<b>Rules:</b> Admin → Security → Hacking rules → Jacking in. Leave the defaults, or set "Decided by" to <i>I decide</i> to see the lock wait for you.')}
        ${li('<b>As the player</b> (with ' + who.name + ' as their character), on this scene: double-click the pin → the node console. <b>Connect</b> joins NCM Test Mesh. <b>Switch off</b> is refused — the box is locked.')}
        ${li('<b>Jack in</b> (Interface vs DV 13): the three-ring lock. In → the session with moves; a miss raises the alert and traces.')}
        ${li('In the session: <b>Switch off</b> (the network drops for everyone on this scene — check the network selector shows it jammed/down), <b>Jam</b>, <b>Wipe your log line</b>.')}
        ${li('<b>Tap</b> or insert <b>tap.exe</b>, then have someone on NCM Test Mesh send mail — a copy lands in ' + who.name + '\'s Agent → EXFIL folder.')}
        ${li('<b>Backdoor</b>: lasts 24 h; meaningful on a network with a login (give NCM Test Mesh a password in Admin → Networks to see it skip the login).')}
        ${li('<b>Insert a shard</b> → <b>GHOSTWORM.bin</b>. Then advance the game clock 1 h at a time (Admin → Overview → +1 h): it hops to ' + B.name + ', then ' + C.name + '; at 4 h every node it reached goes dark. Watch the violet pills in Admin → Networks → NCM Test Mesh → Nodes.')}
        ${li('<b>System sweep</b> from another character (or after a clean insert) — finds what its roll beats; <b>Remove</b> cleans one node. The planter sees <i>Your programs here</i> with <b>Recall</b> / <b>Collect</b>.')}
        ${li('<b>sniff.bin</b>: insert, send some mail over the network, jack in again → <b>Collect</b>. <b>patch.kit</b> cleans the node.')}
      </ol>
      <p style="margin:0">Worms and bombs tick every 30 s on your (the GM's) client, on the game clock. Clean up: delete the shard item, the three nodes and the network.</p></div>`,
  });
  ui.notifications.info(`Network nodes test ready — ${who.name} has the toolkit. See the whisper in chat.`);
})();
