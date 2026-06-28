/**
 * NCM — Terminal test-setup macro (NOT loaded by the module)
 * @file tools/test-terminal-setup.macro.js
 *
 * Paste the body below into a new Foundry **Script Macro** (or run it in the
 * console) as GM. It creates a fully-authored "Arasaka Workstation (TEST)"
 * terminal — 4 accounts (open / password / password+skill admin / hidden) and
 * 3 priority-coded messages — then opens it so you can exercise the whole flow:
 * boot → login (cards + secret login) → SECURE SHELL auth → mailbox → exfil.
 *
 * Logins:  v_arasaka = 1234   ·   root = toor   ·   m_takeda = hidden (unlisted)
 * guest = open (no password).  Delete the test item when done.
 */

(async () => {
  const _svc = game.nightcity?.terminalService;
  const _api = game.nightcity?.messenger;
  if (!game.user.isGM) return ui.notifications.warn('GM only.');
  if (!_svc || !_api?.convertToTerminal) return ui.notifications.error('NCM Terminal system not ready.');

  // 1) Throwaway item to convert (first non-base item type the system offers).
  const _type = (game.documentTypes.Item || []).filter(t => t !== 'base')[0] || 'gear';
  const _item = await Item.create({ name: 'Arasaka Workstation (TEST)', type: _type });
  if (!_item) return ui.notifications.error('Could not create test item.');

  // 2) Convert + theme / boot / metadata.
  await _api.convertToTerminal(_item, { theme: { preset: 'arasaka-workstation' } });
  await _svc.updateConfig(_item, {
    terminalName: 'ARASAKA NET',
    metadata: { owner: 'Veronica Alvarez', org: 'Arasaka Corporation', location: 'Corpo Plaza · Tower B · 7F', classification: 'RESTRICTED' },
    boot: {
      enabled: true, title: 'ARASAKA NET', subtitle: 'Secure Workstation // Access Level: Restricted',
      banner: 'ARASAKA NET · WORKSTATION 7F-12', animationStyle: 'holographic-snap', speed: 'normal',
      logLines: ['ARASAKA-NET handshake ........ VERIFIED', 'Credential gateway .......... ONLINE', 'BLACK_ICE countermeasure .... ARMED'],
    },
    allowExfil: true,
  });

  // 3) Accounts (first added = login-screen default).
  const _v = await _api.addTerminalAccount(_item, {
    username: 'v_arasaka', displayName: 'Veronica A.', email: 'v.alvarez@arasaka.net', role: 'EXECUTIVE · FLOOR 7F',
    security: { requiresAuth: true, allowPassword: true, password: '1234', failureMode: 'damage', encryptionType: 'BLACK_ICE', maxAttempts: 3 },
  });
  await _api.addTerminalAccount(_item, {
    username: 'root', displayName: 'sysadmin', isAdmin: true, role: 'SYSTEM ADMINISTRATOR',
    security: { requiresAuth: true, allowPassword: true, password: 'toor', allowSkillCheck: true, authLogic: 'all', bypassSkills: ['Cryptography'], bypassDC: 20 },
  });
  await _api.addTerminalAccount(_item, {
    username: 'guest', displayName: 'guest', role: 'GUEST ACCESS', security: { requiresAuth: false },
  });
  await _api.addTerminalAccount(_item, {
    username: 'm_takeda', displayName: 'M. Takeda', hidden: true,
    security: { requiresAuth: true, allowPassword: true, password: 'hidden' },
  });

  // 4) Messages into Veronica's mailbox (priority-coded).
  const _acct = _v.accountId;
  const _now = game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now();
  const _h = 3600000, _d = 86400000;
  await _api.addTerminalMessage(_item, _acct, {
    from: 'hr@arasaka.net', subject: 'Q3 Restructuring', priority: 'critical',
    metadata: { classification: 'CONFIDENTIAL' },
    body: 'Per board directive, the following personnel are flagged for transition. Distribution restricted to executive tier. Do not forward outside ARASAKA-NET.',
    timestamp: new Date(_now - 2 * _d).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'finance@arasaka.net', subject: 'Wire authorization', priority: 'urgent',
    body: 'Authorization required for the transfer to offshore holding. Reply with your executive token.',
    timestamp: new Date(_now - 6 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'logistics@arasaka.net', subject: 'Shipment 4471', priority: 'normal',
    body: 'Convoy 4471 cleared customs at NCIA. ETA 0400. Manifest attached.',
    timestamp: new Date(_now - _d).toISOString(),
  });

  ui.notifications.info('Test Terminal ready — v_arasaka=1234 · root=toor · m_takeda=hidden. Opening…');
  game.nightcity.openTerminal(_item);
})();
