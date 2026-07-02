/**
 * NCM — Terminal test-setup macro (NOT loaded by the module)
 * @file tools/test-terminal-setup.macro.js
 *
 * Paste the body below into a new Foundry **Script Macro** (or run it in the
 * console) as GM. It creates a fully-authored "Arasaka Workstation (TEST)"
 * terminal — 4 accounts (open / password / password+skill admin / hidden),
 * 3 priority-coded plain messages, and **one option-rich example of every
 * typed content format (all 11 types)** — then opens it so you can exercise
 * the whole flow: boot → login (cards + secret login) → SECURE SHELL auth →
 * mailbox → typed-content renderers → exfil. The root account gets its own
 * message so account switching shows distinct mail.
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

  // 3) Accounts (first added = login-screen default). The credential-badge
  //    fields (clearance/idNumber/classification/location/lastLogin) show on
  //    the ACCESS GRANTED card; blank ones fall back to terminal metadata.
  const _v = await _api.addTerminalAccount(_item, {
    username: 'v_arasaka', displayName: 'Veronica A.', email: 'v.alvarez@arasaka.net', role: 'EXECUTIVE · FLOOR 7F',
    clearance: 'TIER 3', idNumber: 'NC-8841-A', classification: 'SECRET', location: 'Corpo Plaza · Tower B · 7F',
    lastLogin: '2077.06.11 · 04:12',
    security: { requiresAuth: true, allowPassword: true, password: '1234', failureMode: 'damage', encryptionType: 'BLACK_ICE', maxAttempts: 3 },
  });
  const _root = await _api.addTerminalAccount(_item, {
    username: 'root', displayName: 'sysadmin', isAdmin: true, role: 'SYSTEM ADMINISTRATOR',
    clearance: 'OMEGA', idNumber: 'SYS-0000-R', classification: 'TOP SECRET', lastLogin: '2077.06.12 · 02:48',
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

  // 5) Typed content (design doc §8c) — one option-rich example of EVERY
  //    shared content type so you can eyeball all the renderers in-app. The
  //    same shapes work in a Data Shard via
  //    game.nightcity.messenger.addMessage(item, { contentType, contentData }).
  //    (Every optional field is shown; comments call out what each one does.)

  // ─── The original six (message is covered by the plain mail above) ───
  await _api.addTerminalMessage(_item, _acct, {
    from: 'fixer@afterlife.nc', subject: 'Payment — half up front', priority: 'urgent',
    contentType: 'eddies',
    // amount = what Claim credits to the claimer's CPR wealth; note = flavor line.
    contentData: { amount: 25000, claimed: false, claimedBy: null, claimedAt: null, note: 'Half now. The rest when the shard is in my hand.', splitEnabled: false },
    timestamp: new Date(_now - 8 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'counterintel@arasaka.net', subject: 'SUBJECT: R. Kovach', priority: 'critical',
    contentType: 'dossier',
    contentData: {
      targetName: 'Rachel Kovach', targetAlias: '"Ratchet"',
      targetImage: null,          // path to a portrait image (overrides linked actor)
      linkedActorId: null,        // set an Actor id to auto-pull their portrait
      classification: 'SECRET',   // '', CONFIDENTIAL, SECRET, TOP SECRET
      sections: [
        { heading: 'Overview', body: 'Ex-Arasaka counter-intel, burned after the Q1 leak. Now freelancing for a Militech cutout.', redacted: false },
        { heading: 'Current operation', body: 'Details sealed pending director approval.', redacted: true }, // redacted → blacked out
      ],
      stats: { threat: 'HIGH', affiliation: 'Arasaka (former)', lastKnownLocation: 'Japantown, mega-building H4' },
    },
    timestamp: new Date(_now - 9 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'unknown@relay.onion', subject: 'READ ME', priority: 'normal',
    contentType: 'payload',
    contentData: {
      payloadType: 'tracker',     // tracker | malware | worm | beneficial | custom
      name: 'BLOODHOUND.exe', description: 'Phones the reader\'s location home every hour. You probably should not run this.',
      effect: { type: 'tracker', duration: 24 * _h }, // tracker | damage | lockout | message | custom
      executed: false, executedBy: null, executedAt: null,
      disguised: false, disguiseType: 'message', // disguised:true → renders as the fake type until interacted with
    },
    timestamp: new Date(_now - 10 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'surveillance@arasaka.net', subject: 'Lobby intercept — 7F', priority: 'urgent',
    contentType: 'avlog',
    contentData: {
      mediaType: 'audio',         // audio | video
      mediaUrl: '',               // file path, direct .mp3/.mp4 URL, or YouTube/Vimeo link → inline player; blank = transcript-only
      duration: '00:41', source: 'lobby mic — Tower B · 7F',
      transcript: [
        { speaker: 'ALVAREZ', text: 'The convoy moves at 0400. No escort past the border checkpoint.' },
        { speaker: 'UNKNOWN', text: 'And the eddies?' },
        { speaker: 'ALVAREZ', text: 'Cleared this morning. Off-book, same as last time.' },
      ],
      corrupted: false, corruptionLevel: 0,
    },
    timestamp: new Date(_now - 11 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'logistics@arasaka.net', subject: 'Dead drop location', priority: 'normal',
    contentType: 'location',
    contentData: {
      locationName: 'Dead drop — Kabuki Market',
      locationImage: null,        // path to a location image (optional)
      coordinates: 'N 37.7793° W 122.4192°', district: 'Watson · Kabuki',
      description: 'South entrance, under the red neon dragon. Loose brick, third row from the vent.',
      linkedSceneId: null,        // set a Scene id → GM sees a "Go to Scene" button
      pinX: null, pinY: null,
    },
    timestamp: new Date(_now - 12 * _h).toISOString(),
  });

  // ─── The Phase-2 five ───
  await _api.addTerminalMessage(_item, _acct, {
    from: 'finance@arasaka.net', subject: 'Q3 Off-Book Disbursements', priority: 'urgent',
    contentType: 'spreadsheet',
    contentData: {
      format: 'disbursements.csv',
      // Typed columns drive align + status pills + which cols total.
      columns: [
        { label: 'Date', type: 'date' },
        { label: 'Payee', type: 'text' },
        { label: 'Account', type: 'text' },
        { label: 'Memo', type: 'text' },
        { label: 'Amount €$', type: 'currency' },
        { label: 'Status', type: 'status' },
      ],
      // Cells can be plain values OR { value, bold, color, bg } for formatting.
      rows: [
        ['06.02', { value: 'Maelstrom (proxy)', bold: true, color: 'red' }, '—', '"consulting"', '240,000', 'CLEARED'],
        ['06.09', 'R. Kovach', 'NC-8841-A', 'severance', '18,500', 'CLEARED'],
        ['06.14', '—', { value: 'NC-0007-Z', bg: 'amber' }, '"logistics"', '512,000', 'HELD'],
        ['06.21', 'Trauma Team', 'TT-GOLD', 'retainer', '75,000', 'CLEARED'],
        ['06.28', 'Petrov Imp/Exp', 'NC-3120-C', '"hardware"', '96,400', 'PENDING'],
      ],
      redacted: [[0, 2], [2, 1]],
      flagged: [[0, 4], [2, 4]],
      flagReasons: { '0:4': 'exceeds €$200k disclosure threshold', '2:4': 'held pending NetWatch review' },
      totals: [4],
      selected: [0, 4],
      note: 'Cross-ref account NC-0007-Z with NetWatch watchlist.',
    },
    timestamp: new Date(_now - 3 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'calendar@arasaka.net', subject: 'V. Arasaka — Schedule', priority: 'normal',
    contentType: 'calendar',
    contentData: {
      // categories → legend + per-event color (colors: green gold cyan red amber purple blue pink muted).
      categories: { Handoff: 'amber', Meeting: 'cyan', Payment: 'green' },
      events: [
        // time/location/who/note each render as a colored meta chip; <3 days out → urgency bar.
        { title: 'Handoff — Pacifica docks, pier 7', when: new Date(_now + 2 * _d).toISOString(), time: '21:00 NC', location: 'Pacifica', who: '"Tinman"', note: 'bring the shard', category: 'Handoff' },
        { title: 'Board review — Arasaka Tower 41F', when: new Date(_now + 5 * _d).toISOString(), time: '09:00', location: 'City Center', who: 'Exec floor', category: 'Meeting' },
        { title: 'Wire transfer confirm', when: new Date(_now - 4 * _d).toISOString(), time: '14:30', location: 'remote', who: 'R. Kovach', category: 'Payment' }, // past → dimmed
        { title: 'OFF-GRID — do not log', when: new Date(_now + 1 * _d).toISOString(), time: '03:00', color: 'red' }, // per-event color override beats category
      ],
    },
    timestamp: new Date(_now - 4 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'syslog@arasaka.net', subject: 'auth.log — access history', priority: 'normal',
    contentType: 'syslog',
    contentData: {
      host: 'arasaka-ws-04', path: '/var/log/auth.log', tz: 'UTC',
      // prompt: 'v_arasaka@ws04:~$',   // override the auto root@host:~# prompt
      // Display toggles (all default true — set false to strip the console chrome):
      showLineNumbers: true, showFilter: true, scanlines: true, showPrompt: true,
      lines: [
        { ts: '02:14:07', sev: 'info', actor: 'v_arasaka', msg: 'session opened from 10.4.x' },
        { ts: '02:31:55', sev: 'ok', actor: 'v_arasaka', msg: 'read: Q3-disbursements.csv' },
        { ts: '03:02:10', sev: 'warn', actor: 'guest', msg: '3 failed auth attempts' },
        { ts: '03:02:44', sev: 'error', actor: 'guest', msg: 'account locked — 60s' },
        { ts: '03:48:19', sev: 'info', actor: 'admin_root', msg: 'privilege escalation OK' },
        { ts: '03:49:02', sev: 'warn', actor: 'admin_root', msg: 'purged auth.log[0:40]', mark: true },
      ],
    },
    timestamp: new Date(_now - 5 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'vault@arasaka.net', subject: 'Recovered credentials', priority: 'critical',
    contentType: 'credentials',
    contentData: {
      autoReuse: true, // auto-flag the same secret on 2+ hosts with a REUSED ×N badge (the pivot signal)
      entries: [
        // strength 1–4 draws the meter; note renders under the row.
        { host: 'netwatch-relay.ncpd.gov', user: 'v.arasaka', secret: 'Hx9$kRel-2077', strength: 3, note: 'reused on tower mainframe → pivot' },
        { host: 'tower-mainframe.arasaka', user: 'v.arasaka', secret: 'Hx9$kRel-2077', strength: 3 },
        { host: 'cold-wallet.militech', user: 'treasury_07', secret: 'MTech-C0ldSt0re#7', encrypted: true, cracked: false, crackSkill: 'Interface', crackDV: 15 }, // locked → "CRACK TO REVEAL" (roll crackSkill vs crackDV; defaults Interface/15)
        { host: 'legacy-bbs.watson.nc', user: 'vee_2020', secret: 'password1', strength: 1 }, // weak → 1-bar meter
      ],
    },
    timestamp: new Date(_now - 6 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'bank@arasaka.net', subject: 'Ops account ledger', priority: 'urgent',
    contentType: 'banking',
    contentData: {
      // Bank identity / lore (letterhead) + the siphon affordance.
      bankName: 'Night City Trust', bankLogo: '', // path to a logo image (optional)
      bankLocation: 'City Center · Corpo Plaza',
      bankCode: 'SWIFT NCTBNCNX', bankTagline: 'Your eddies. Our silence.',
      // Siphon: roll Interface vs DV 17; mode cap (take up to siphonCap) |
      // percent (up to siphonPercent% of balance) | full (whole balance).
      allowSiphon: true, siphonSkill: 'Interface', siphonDV: 17,
      siphonMode: 'cap', siphonCap: 250000, // percent mode: siphonMode:'percent', siphonPercent: 25
      owner: 'V. Arasaka', accountType: 'checking',
      accountName: 'Arasaka Holdings — Ops', accountNumber: 'NC-8841-A-0007',
      balance: 2419650, currency: '€$', cleared: 1907650, held: 512000,
      // category → color-coded icon; type credit/debit; pending flag.
      transactions: [
        { date: '06.28', desc: 'Inbound — Petrov Imp/Exp', amount: 96400, type: 'credit', category: 'inbound' },
        { date: '06.21', desc: 'Retainer — Trauma Team', amount: 75000, type: 'debit', category: 'services' },
        { date: '06.14', desc: '"logistics"', amount: 512000, type: 'debit', category: 'wire', pending: true },
        { date: '06.08', desc: 'Payroll run', amount: 184200, type: 'debit', category: 'payroll' },
        { date: '06.05', desc: 'Transfer — offshore', amount: 600000, type: 'debit', category: 'transfer' },
        { date: '06.02', desc: '"consulting"', amount: 240000, type: 'debit', category: 'flagged' },
      ],
    },
    timestamp: new Date(_now - 7 * _h).toISOString(),
  });

  // 6) One message in root's mailbox so switching accounts shows distinct mail.
  await _api.addTerminalMessage(_item, _root.accountId, {
    from: 'ice-daemon@arasaka.net', subject: 'Countermeasure heartbeat', priority: 'normal',
    body: 'BLACK_ICE watchdog nominal. Last trigger: 72h ago (guest lockout). No exec-tier alerts pending.',
    timestamp: new Date(_now - 1 * _h).toISOString(),
  });

  ui.notifications.info('Test Terminal ready — v_arasaka=1234 · root=toor · m_takeda=hidden. Opening…');
  game.nightcity.openTerminal(_item);
})();
