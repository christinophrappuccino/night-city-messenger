// NCM stage 2, step 10a-2 — the scene-control buttons and the chat-card hook on Foundry v12 AND v13.
// v13 changed both (controls became a record; renderChatMessage became renderChatMessageHTML); NCM now goes through
// utils/compat.js for each. Run as the GM on a scene. It opens the NCM control group, clicks Admin (the panel opens,
// then closes), and posts + deletes one test chat message. Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Step 10a-2 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gen = game.release?.generation;
  try {
    const all = ui.controls.controls;
    const group = Array.isArray(all) ? all.find((c) => c.name === 'night-city-messenger') : all?.['night-city-messenger'];
    const toolNames = group ? (Array.isArray(group.tools) ? group.tools.map((t) => t.name) : Object.keys(group.tools)) : [];
    check(`The NCM button group is in the scene controls (Foundry v${gen})`, !!group && toolNames.includes('ncm-admin'), toolNames.join(', '));
    const open = () => [...foundry.applications.instances.values()].filter((a) => a.rendered).map((a) => a.constructor.name);
    const before = open();
    if (gen >= 13) await ui.controls.activate({ control: 'night-city-messenger' });
    else ui.controls.initialize({ control: 'night-city-messenger' });
    await sleep(1000);
    check('Opening the group opens no window by itself', open().filter((n) => !before.includes(n)).length === 0, open().filter((n) => !before.includes(n)).join(', '));
    const btn = document.querySelector('[data-tool="ncm-admin"]');
    btn?.click();
    await sleep(1500);
    const opened = open().filter((n) => !before.includes(n));
    check('Clicking the Admin button opens the Admin Panel', opened.includes('AdminPanelApp'), opened.join(', ') || 'nothing opened');
    for (const a of [...foundry.applications.instances.values()]) if (a.constructor.name === 'AdminPanelApp') await a.close();
    const msg = await ChatMessage.create({ content: '<p>NCM step 10a-2 test (deleted at once)</p>', whisper: [game.user.id], flags: { 'night-city-messenger': { type: 'shared-message' } } });
    await sleep(1200);
    const el = document.querySelector(`[data-message-id="${msg.id}"]`);
    check('A chat card gets NCM\'s styling from the chat hook', !!el?.classList.contains('ncm-chat-card') && el.classList.contains('ncm-chat-card--message'), el ? [...el.classList].join(' ') : 'not found');
    await msg.delete();
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 10a-2: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: click each NCM toolbar button once (inbox, phone, compose, contacts, networks, admin) — each opens its window, and selecting the NCM group alone opens nothing.</p>` });
})();
