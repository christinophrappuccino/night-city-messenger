// NCM batch (COMPAT-06): the Items sidebar's right-click entries (Open / Configure / "… options ▸" / Convert…) are now
// part of Foundry's own menu, through its hook, instead of rows added to the menu after it opened. They should look and
// work the same. Run as a GM. It creates a throwaway item "NCM menu probe", right-clicks it in the Items sidebar,
// reads the menu, then deletes the item. Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let probe = null;
  try {
    if (!game.user.isGM) throw new Error('run this as a GM');
    const types = game.documentTypes?.Item?.filter((t) => t !== 'base') || Object.keys(CONFIG.Item.dataModels || {});
    const type = types.includes('gear') ? 'gear' : types[0];
    probe = await Item.create({ name: 'NCM menu probe', type });
    if (ui.sidebar.changeTab) ui.sidebar.changeTab('items', 'primary'); else ui.sidebar.activateTab('items');
    await sleep(700);
    const read = async () => {
      const li = document.querySelector(`#items [data-entry-id="${probe.id}"], #items [data-document-id="${probe.id}"]`);
      if (!li) return null;
      const r = li.getBoundingClientRect();
      li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10 }));
      await sleep(500);
      const names = [...document.querySelectorAll('#context-menu .context-item')].map((x) => x.textContent.trim());
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(200);
      document.querySelector('#context-menu')?.remove();
      return names;
    };
    let names = await read();
    check('The probe item is in the Items sidebar', !!names, names ? '' : 'entry not found — is the Items tab showing?');
    names ||= [];
    check('A plain item: Convert to Shard / Terminal and the Malware Workshop', names.some((n) => /^Convert to /.test(n)) && names.includes('Convert to Terminal') && names.includes('Malware Workshop'), names.join(' | '));
    check('Foundry\'s own entries are still there', names.length > 3);
    await probe.setFlag('night-city-messenger', 'isTerminal', true);
    await sleep(600);
    names = (await read()) || [];
    check('A terminal: Open, Configure and "Terminal options ▸"', names.includes('Open Terminal') && names.includes('Configure Terminal') && names.includes('Terminal options ▸'), names.join(' | '));
    check('No convert entries on a converted item', !names.some((n) => /^Convert to /.test(n)));
    check('Each entry appears once', new Set(names).size === names.length, names.join(' | '));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    try { await probe?.delete(); } catch { /* gone */ }
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM Items menu: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: right-click a real shard and a real terminal in the Items sidebar — Open, Configure, and "… options ▸" (the grouped menu opens under the item and works); right-click a plain item and Convert it; as a player, right-click a shard you own (Open + options, no Configure).</p>` });
})();
