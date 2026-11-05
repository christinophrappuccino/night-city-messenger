// NCM stage 2, batch 6 — one settings reader (getSetting) with fallbacks equal to the registered defaults, and one
// "am I the GM who acts" check (isPrimaryGM) everywhere calls, conversations, eavesdropping and map pins decide it.
// Run as the GM. It only reads. Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Batch 6 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const H = await import('/modules/night-city-messenger/scripts/utils/helpers.js');
    const ns = game.nightcity;
    const live = game.settings.get('night-city-messenger', 'anonSendEnabled');
    check('getSetting reads the live value', H.getSetting('anonSendEnabled', true) === live, `Anonymous Send is ${live ? 'on' : 'off'}`);
    check('Calls read their settings through it', ns?.callService?.enabled === game.settings.get('night-city-messenger', 'callsEnabled'));
    const iAct = game.users.activeGM?.id === game.user.id;
    check('isPrimaryGM() agrees with who Foundry says is the active GM', H.isPrimaryGM() === iAct, iAct ? 'you are the active GM' : `${game.users.activeGM?.name} is the active GM`);
    check('Conversations decide their writer with isPrimaryGM()', /isPrimaryGM/.test(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ns?.conversationService ?? {}), '_iAmWriter')?.get?.toString() || ''));
    check('Map pins decide who cleans up with isPrimaryGM()', /isPrimaryGM/.test(Object.getOwnPropertyNames(Object.getPrototypeOf(ns?.terminalScenePins ?? {})).map((n) => { try { return String(Object.getPrototypeOf(ns.terminalScenePins)[n]); } catch { return ''; } }).join('\n')));
    const { EmailSetupFlow } = await import('/modules/night-city-messenger/scripts/ui/dialogs/EmailSetupFlow.js');
    check('Email setup has no minimize button (mid-flow)', EmailSetupFlow.DEFAULT_OPTIONS?.window?.minimizable === false);
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, batch 6: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real checks: open the composer as GM — the Anonymous option shows when Module Settings → Anonymous Send is on, and Admin → Messages agrees. With two GMs online, a call's log is written once.</p>` });
})();
