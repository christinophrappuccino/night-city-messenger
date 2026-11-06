// NCM batch (tester 2026-11-06): (1) revealing a node's pin now reveals the node too (a player who walked up to a
// visible pin of a hidden node got "There is nothing there"); a GM opening such a pin from an older world is warned.
// (2) the call badge stands clear of Foundry's scene controls / scene bar, and has a drag grip (double-click resets).
// Run as a GM on a scene. It places a hidden test node pin, reveals it, checks, then deletes the pin and the node.
// Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const MID = 'night-city-messenger';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let nodeId = null, pinDoc = null;
  try {
    if (!game.user.isGM) throw new Error('Run as a GM');
    const ns = game.nightcity.networkService;
    const pins = game.nightcity.terminalScenePins;
    const net = ns.getAllNetworks?.()?.[0] || Object.values(ns.getNetworks?.() || {})[0];
    if (!net || !canvas.scene) throw new Error('Needs a network and a viewed scene');
    const made = await ns.saveNode({ name: 'NCM test node', networkId: net.id, sceneId: canvas.scene.id, kind: 'relay', hidden: true });
    nodeId = made?.node?.id;
    check('A hidden test node was made', !!nodeId && ns.getNode(nodeId)?.hidden === true, made?.error || '');
    const docs = await pins.placeNode(nodeId, { how: 'pin', where: 'view', hidden: true, sceneId: canvas.scene.id });
    pinDoc = docs?.[0];
    check('Its pin is placed hidden', !!pinDoc && pinDoc.getFlag(MID, 'accessHidden') === true);
    await pins.setHidden(pinDoc, false);
    await wait(300);
    check('Revealing the pin reveals the pin', pinDoc.getFlag(MID, 'accessHidden') === false);
    check('…and the node (players can now open it)', ns.getNode(nodeId)?.hidden === false);
    await pins.setHidden(pinDoc, true);
    await wait(300);
    check('Hiding the pin leaves the node visible', ns.getNode(nodeId)?.hidden === false && pinDoc.getFlag(MID, 'accessHidden') === true);

    const cs = getComputedStyle(document.documentElement);
    const left = parseFloat(cs.getPropertyValue('--ncm-ch-left')), top = parseFloat(cs.getPropertyValue('--ncm-ch-top'));
    check('The call spot is set', Number.isFinite(left) && Number.isFinite(top), `${left}px / ${top}px`);
    let right = 0;
    for (const el of document.querySelectorAll('#controls ol.control-tools, #scene-controls-layers, #scene-controls-tools')) {
      const r = el.getBoundingClientRect(); if (r.width && r.top < top + 220) right = Math.max(right, r.right);
    }
    check('It stands right of the scene controls', !(left < right) || !!localStorage.getItem('ncm.callHudPos'), `controls end at ${Math.round(right)}px, call at ${left}px`);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    try { if (pinDoc) await pinDoc.delete(); } catch { /* gone */ }
    try { if (nodeId) await game.nightcity.networkService.deleteNode?.(nodeId); } catch { /* gone */ }
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM node reveal + call spot: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: as a player, walk up to a revealed node pin and open it. Start a call with the token layer's tools open; the call sits right of them. With another module's toolbar down the left, the call sits right of that too. Drag it by the grip, the portrait or the name chip (the keys still click), reload, it stays; double-click the grip and it goes back.</p>` });
})();
