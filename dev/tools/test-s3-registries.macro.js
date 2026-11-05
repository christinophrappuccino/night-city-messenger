// NCM batch (R16): three small "one list" changes. The access-point kinds (terminal, shard, inbox, message, node,
// payphone) are one table instead of two switches; the admin panel's tabs are one list (the bar, the number keys and
// the keys tooltip come from it); and the content types are guarded by a sim. One visible change: the keyboard icon's
// tooltip at the right of the admin tab bar now says which digit opens which tab (Phone has no key). Run as a GM.
// Opens the admin panel. Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const { ACCESS_KINDS } = await import('/modules/night-city-messenger/scripts/utils/accessPoints.js');
    const { ACCESS_OPENERS, describeAccess } = await import('/modules/night-city-messenger/scripts/integrations/AccessPoints.js');
    const a = Object.keys(ACCESS_KINDS).sort().join(), b = Object.keys(ACCESS_OPENERS).sort().join();
    check('Every access-point kind has a way to describe and open it', a === b, `${a} | ${b}`);
    const term = game.items.find((i) => i.getFlag('night-city-messenger', 'isTerminal'));
    const shard = game.items.find((i) => i.getFlag('night-city-messenger', 'isDataShard'));
    if (term) check(`A terminal is described ("${term.name}")`, describeAccess({ kind: 'terminal', id: term.uuid }).found);
    if (shard) check(`A shard is described ("${shard.name}")`, describeAccess({ kind: 'shard', id: shard.uuid }).found);
    const pc = game.actors.find((x) => x.hasPlayerOwner);
    if (pc) check(`An inbox is described ("${pc.name}")`, describeAccess({ kind: 'inbox', id: pc.id }).found);

    if (game.user.isGM) {
      await game.nightcity.openAdmin();
      await new Promise((r) => setTimeout(r, 1200));
      const root = document.getElementById('ncm-admin-panel');
      const tabs = [...(root?.querySelectorAll('.ncm-admin-tab') || [])].map((x) => x.dataset.tab);
      check('The admin bar shows all eleven tabs in order', tabs.join() === 'overview,messages,contacts,spam,phone,networks,security,terminals,shards,access,tools', tabs.join());
      const tip = root?.querySelector('.ncm-admin-tabs__keys')?.dataset.tooltip || '';
      check('The keys tooltip names each digit', tip.includes('5 Networks') && tip.includes('0 Tools') && !tip.includes('Phone'), tip);
      root?.querySelector('[data-tab="access"]')?.click();
      await new Promise((r) => setTimeout(r, 800));
      check('Clicking a tab still switches to it', document.querySelector('#ncm-admin-panel .ncm-admin-tab--active')?.dataset.tab === 'access');
    } else check('Run as a GM for the admin-panel checks', false);
    check('No startup step failed', !(game.nightcity.startupReport?.failed || []).length, (game.nightcity.startupReport?.failed || []).join(', '));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM registries: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: in the admin panel press 1–9 and 0 (each opens what the keyboard tooltip says), the Messages / Phone badges still count; post a terminal access card to chat and open it, open a journal @NCM link to a shard, use a payphone hotbar macro.</p>` });
})();
