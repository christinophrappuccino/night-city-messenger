// NCM batch: 35 hand-written try/catch reads of a setting became getSetting(key, registered default). Nothing should
// behave differently. Run as the GM. It reads each converted setting both ways and opens the windows that read them
// (Admin → Tools / Contacts / Messages / Overview / Networks / Security, the composer), then closes them. Changes
// nothing. Whispered result card.
(async () => {
  const MOD = 'night-city-messenger';
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errs = []; const onErr = (e) => errs.push(String(e?.message || e?.reason?.message || e));
  window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
  try {
    if (!game.user.isGM) throw new Error('Run this as the GM.');
    const H = await import('/modules/night-city-messenger/scripts/utils/helpers.js');
    const keys = ['roleAbilityRoll', 'conversationGmBell', 'emailSetupRequired', 'emailAllowPlayerBurn', 'emailAllowCustomDomains', 'emailDefaultDomain',
      'notifyGmNpcMail', 'spamUnknownSenderExcludePlayers', 'spamUnknownSenderScope', 'deliveryFailures', 'payphones', 'residentFireMode', 'timeProvider',
      'traceCountdowns', 'securityAlertLevel', 'watchMode', 'contactsGroupBy', 'npcMailAnswered', 'scenePrewire', 'dateFormat', 'traceHeat', 'dateMonthStyle',
      'anonTraceEnabled', 'anonTraceSkill', 'subjectThreading', 'terminalPresetLibrary', 'terminalThemePresets', 'customPresets', 'adminTheme', 'countermeasureVisibility'];
    const differ = keys.filter((k) => { try { return JSON.stringify(H.getSetting(k, '__fb__')) !== JSON.stringify(game.settings.get(MOD, k)); } catch { return true; } });
    check(`Each converted setting reads the same through getSetting (${keys.length})`, differ.length === 0, differ.join(', '));
    const ns = game.nightcity;
    ns.openAdmin(); await sleep(1200);
    for (const t of ['tools', 'contacts', 'messages', 'overview', 'networks', 'security', 'phone']) { ns.openAdminTab(t); await sleep(900); }
    ns.composeMessage(); await sleep(1000);
    for (const a of [...foundry.applications.instances.values()]) if (/Admin|Composer/.test(a.constructor.name)) await a.close();
    check('The windows that read them open with no error', errs.length === 0, errs.join(' | '));
    check('The date format still formats', typeof H.formatCyberDate(new Date().toISOString()) === 'string');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM settings reads: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: change Date Format in Module Settings and see the inbox clock follow; toggle GM alert "Player Mail to NPCs" and see the toast stop.</p>` });
})();
