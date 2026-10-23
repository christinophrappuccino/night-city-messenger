/**
 * NCM — Terminal test-setup macro (NOT loaded by the module)
 * @file dev/tools/test-terminal-setup.macro.js
 *
 * Paste the body below into a new Foundry **Script Macro** (or run it in the
 * console) as GM. It creates a fully-authored "Arasaka Workstation (TEST)"
 * terminal — 4 accounts (open / password / password+skill admin / hidden),
 * priority-coded plain messages, and **one option-rich example of every typed
 * content format** — then opens it so you can exercise the whole flow: boot →
 * login (cards + secret login) → SECURE SHELL auth → mailbox → typed-content
 * renderers → exfil. The root account gets its own message so account switching
 * shows distinct mail.
 *
 * Also seeds the two newest rounds:
 *  · **#36 camera feed / PTZ** — a LIVE FEED gallery (ticking clocks, signal
 *    bars, a LOOPED channel, an ENCRYPTED channel, a dead channel, and a
 *    steerable **PTZ** cam you drive with the D-pad), plus a stills gallery
 *    showing the flagged-frame HERO + filter chips.
 *  · **#37 the envelope** — several entries authored as **FILES** (filename /
 *    path / owner-node instead of a sender), so the sidebar shows the mixed
 *    MAIL + FILES list, and **per-entry exfil overrides** (a COPY-PROTECTED
 *    document that renders its deny chip; the feed is stream-locked by physics
 *    and offers **SAVE FRAME** instead).
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
    // Per-action exfil policy — every action ON so you can try them; a few
    // gated so the security console + trace fire (fail → traced, action aborts):
    //   agent/forward ungated (styled confirm) · shard/leak/wipe gated · sell
    //   gated w/ a 2,500 eb fixer payout. Leave `exfil` off entirely and only
    //   agent+shard show (the legacy default).
    // This is the TERMINAL default — an entry can narrow or widen it per action
    // (see the COPY-PROTECTED memo below), and `allowExfil:false` is a hard
    // ceiling nothing can widen.
    exfil: {
      agent:   { allow: true,  require: false, skill: 'Interface', dv: 15 },
      shard:   { allow: true,  require: true,  skill: 'Interface', dv: 15 },
      forward: { allow: true,  require: false, skill: 'Interface', dv: 15 },
      leak:    { allow: true,  require: true,  skill: 'Interface', dv: 15 },
      sell:    { allow: true,  require: true,  skill: 'Trading',   dv: 13, price: 2500 },
      wipe:    { allow: true,  require: true,  skill: 'Interface', dv: 15 },
      // SAVE FRAME (#37) — only ever offered on a live camera feed (you can't
      // copy a stream, but you CAN grab what it's showing). Gated here so the
      // capture rolls; drop `require` for an immersive confirm instead.
      saveFrame: { allow: true, require: true, skill: 'Electronics/Security Tech', dv: 13 },
    },
    // Machine uplink (Layer 1) — the terminal's own connection. Boots on
    // CitiNet (open); DarkNet is open too (free switch — reveals the gated
    // WHISPER account); CorpNet is the only core net whose OWN security block
    // has requiresAuth, and it's NOT pre-authorized here, so switching to it
    // fires the join-challenge console (skill roll DV 15 / GM force-join;
    // success stamps connection.authenticated — no re-challenge on return).
    connection: {
      interfaces: [
        { networkId: 'CITINET', preAuthorized: false },
        { networkId: 'CORPNET', preAuthorized: false },
        { networkId: 'DARKNET', preAuthorized: false },
      ],
      defaultNetworkId: 'CITINET',
      allowPlayerSwitching: true,
      showSyncHint: true,
    },
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
  // Network-gated account — VANISHES from the login list until the machine's
  // uplink is switched to DarkNet (an open interface — free switch).
  await _api.addTerminalAccount(_item, {
    username: 'nc_whisper', displayName: 'W H I S P E R', role: 'DEAD DROP',
    network: { restricted: true, allowedNetworks: ['DARKNET'], allowedTypes: [] },
    security: { requiresAuth: true, allowPassword: true, password: 'ghost' },
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
  // Network-gated message — only syncs while the machine's uplink is CorpNet
  // (which requires passing the join challenge first). On CitiNet/DarkNet it
  // drops out of the list — the "N objects failed to sync" hint appears; the
  // GM keeps it with an OFF-NET chip.
  await _api.addTerminalMessage(_item, _acct, {
    from: 'counterintel@arasaka.net', subject: 'INTERNAL: watchlist sync', priority: 'critical',
    body: 'Weekly watchlist delta attached. This bulletin is served from ARASAKA-NET infrastructure and does not replicate to public carriers.',
    networkVisibility: { restricted: true, allowedNetworks: ['CORPNET'], allowedTypes: [] },
    timestamp: new Date(_now - 3 * _h).toISOString(),
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
    from: 'counterintel@arasaka.net', subject: 'SUBJECT: “Ratchet”', priority: 'critical',
    contentType: 'dossier',
    contentData: {
      targetName: 'Rachel Kovach', targetAlias: '"Ratchet"',
      targetImage: null,          // path to a portrait image (overrides linked actor)
      linkedActorId: null,        // set an Actor id → portrait + LIVE combat profile
      classification: 'SECRET',   // '', RESTRICTED, CONFIDENTIAL, SECRET, TOP SECRET, EYES ONLY, BLACK
      sections: [
        { heading: 'Overview', body: 'Ex-Arasaka counter-intel, burned after the Q1 leak. Now freelancing for a Militech cutout.', redacted: false },
        { heading: 'Current operation', body: 'Details sealed pending director approval.', redacted: true }, // redacted → blacked out
      ],
      stats: { threat: 'HIGH', affiliation: 'Arasaka (former)', lastKnownLocation: 'Japantown, mega-building H4' },
      declassify: true, declassifySkill: 'Interface', declassifyDV: 15,
      // Masked identity — players see static + a blanked name until a DECRYPT roll (GM gets REVEAL).
      faceLocked: true, faceUnlockSkill: 'Interface', faceUnlockDV: 15, faceTraceOnFail: true,
      // Combat profile — needs linkedActorId set; stats/skills read LIVE from the sheet.
      profile: { enabled: true, title: 'COMBAT PROFILE', visibility: 'encrypted', skill: 'Interface', dv: 13, stats: ['body', 'ref', 'cool', 'tech'], skills: ['Handgun', 'Stealth'], decrypted: false },
    },
    timestamp: new Date(_now - 9 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'ghostworks@relay.onion', subject: 'BREACH.EXE', priority: 'normal',
    contentType: 'payload',
    contentData: {
      // PAYLOAD = a utility PROGRAM the operator runs (the MALWARE sibling is hostile).
      name: 'BREACH.EXE', program: 'icebreaker suite', version: '2.1', sizeLabel: '4.7 MB',
      publisher: 'Night City Ghostworks', signed: true, charges: 1,
      description: 'Militech-surplus intrusion suite. Chews through file encryption on the host system.',
      // effect.type: icebreaker | skeletonKey | scanner | jammer | adjudicate
      // duration in ms (0 = instant; >0 = active window that auto-expires on the game clock)
      // macroId: link a world Macro to run on a clean execute
      effect: { type: 'icebreaker', duration: 0, macroId: '' },
      requirements: [{ kind: 'uplink', label: 'machine uplink must be online' }],
      output: [ // authored console run-log (types out on RUN)
        { sev: 'info', text: '> init breach.exe --target=LOCAL' },
        { sev: 'ok', text: 'loading cipher tables… done' },
        { sev: 'warn', text: 'bypassing watchdog…' },
        { sev: 'ok', text: 'injecting keys… OK' },
      ],
      executeRequire: true, executeSkill: 'Interface', executeDV: 13, traceOnFail: true,
      disguised: false, disguiseType: 'note', sniffDV: 15, sniffed: false, // disguised:true → renders as the cover type for players
      executed: false, executedBy: null, executedAt: null,
      active: false, expiresAt: null, killed: false, tripped: false, scanReport: '',
    },
    timestamp: new Date(_now - 10 * _h).toISOString(),
  });
  // A second payload: a TIMED JAMMER, disguised as a note (GM: run it, or REVEAL to players).
  await _api.addTerminalMessage(_item, _acct, {
    from: 'system@localhost', subject: 'shopping_list.txt', priority: 'low',
    contentType: 'payload',
    contentData: {
      name: 'WATCHDOG-MUTE.EXE', program: 'jammer', sizeLabel: '812 KB', charges: 1,
      description: 'Suppresses the machine uplink for a window. Goes quiet, then it comes back.',
      effect: { type: 'jammer', duration: 6 * _h, macroId: '' },
      requirements: [],
      output: [ { sev: 'info', text: 'muting uplink watchdog…' }, { sev: 'ok', text: 'link suppressed — LOCAL ONLY' } ],
      executeRequire: false, executeSkill: 'Interface', executeDV: 15, traceOnFail: false,
      disguised: true, disguiseType: 'note', sniffDV: 14, sniffed: false,
      executed: false, executedBy: null, executedAt: null,
      active: false, expiresAt: null, killed: false, tripped: false, scanReport: '',
    },
    timestamp: new Date(_now - 10.5 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'surveillance@arasaka.net', subject: 'Lobby intercept — 7F', priority: 'urgent',
    contentType: 'avlog',
    contentData: {
      mediaType: 'audio',         // audio | video (auto-detected from the URL in the composer)
      mediaUrl: '',               // file path, direct .mp3/.mp4 URL, or YouTube/Vimeo link → inline player;
                                  // BLANK + a duration → ▶ karaoke transcript playback in the viewer
      duration: '00:41', source: 'lobby mic — Tower B · 7F',
      transcript: [
        { speaker: 'ALVAREZ', text: 'The convoy moves at 0400. No escort past the border checkpoint.' },
        { speaker: 'UNKNOWN', text: 'And the eddies?' },
        { speaker: 'ALVAREZ', text: 'Cleared this morning. Off-book, same as last time.' },
        { speaker: 'UNKNOWN', text: 'Then we never spoke.' },
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
      locationImage: null,        // path to a location image (optional — becomes the card backdrop)
      coordinates: 'N 37.7793° W 122.4192°', district: 'Watson · Kabuki',
      description: 'South entrance, under the red neon dragon. Loose brick, third row from the vent.',
      linkedSceneId: null,        // set a Scene id → GM sees a "Go to Scene" button
      pinX: null, pinY: null,
      // Intel adds (all optional — 2026-07-13): control/security strip, HEAT chip, practical rows.
      controlledBy: 'Tyger Claws', security: 3, // 1 LOW · 2 GUARDED · 3 HIGH · 4 LETHAL
      heat: 'NCPD HOT ZONE',
      hours: '22:00 – 05:00', access: 'Service door, keypad — code changes weekly',
      approach: 'Come on foot; cars get made by the roof spotters', contact: 'Tiny (door), owes Rogue a favor',
      // Encrypted pin — players see only the NAME on a static card until they beat
      // the roll; the reveal plays the decrypt animation. GM DECRYPT force-reveals.
      locked: true, unlockSkill: 'Interface', unlockDV: 13, traceOnFail: false,
    },
    timestamp: new Date(_now - 12 * _h).toISOString(),
  });

  // ─── The Phase-2 five ───
  // SPREADSHEET as a FILE (#37) — nobody emailed you this; it was sitting on the
  // machine. So it shows a filename / path / owner instead of a sender, and the
  // sidebar row leads with the spreadsheet icon. Size + row count auto-derive.
  await _api.addTerminalMessage(_item, _acct, {
    from: 'kowalski', subject: 'Q3 Off-Book Disbursements', priority: 'urgent',
    envelope: 'file',
    file: { filename: 'q3_disbursements.xls', path: '/home/kowalski/finance/', owner: 'kowalski' },
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
      // #34 redesign: full-ISO `when` (date+time — one picker), defaultView,
      // locked fog events, per-event sceneId (omitted here — world-specific).
      defaultView: 'rail',
      // categories → legend + per-event color (colors: green gold cyan red amber purple blue pink muted).
      categories: { Handoff: 'amber', Meeting: 'cyan', Payment: 'green' },
      events: [
        // location/who/note render as colored meta chips; the ISO's clock becomes the time chip; <3 days out → urgency bar + NEXT strip.
        { title: 'Handoff — Pacifica docks, pier 7', when: new Date(_now + 2 * _d + 9 * _h).toISOString(), location: 'Pacifica', who: '"Tinman"', note: 'bring the shard', category: 'Handoff' },
        { title: 'Board review — Arasaka Tower 41F', when: new Date(_now + 5 * _d - 3 * _h).toISOString(), location: 'City Center', who: 'Exec floor', category: 'Meeting' },
        { title: 'Wire transfer confirm', when: new Date(_now - 4 * _d).toISOString(), time: '14:30', location: 'remote', who: 'R. Kovach', category: 'Payment' }, // past → behind SHOW PAST; legacy free-text time still chips
        { title: 'OFF-GRID — do not log', when: new Date(_now + 1 * _d).toISOString(), color: 'red' }, // per-event color override beats category
        // Locked: players see ENCRYPTED ENTRY (date withheld, no month pip) until a Cryptography DV 14 roll; a miss fires a trace.
        { title: 'Silent extraction — the safehouse', when: new Date(_now + 3 * _d).toISOString(), location: 'Charter Hill', who: 'S. Okada only', category: 'Handoff', locked: true, unlockSkill: 'Cryptography', unlockDV: 14, traceOnFail: true },
      ],
    },
    timestamp: new Date(_now - 4 * _h).toISOString(),
  });
  // SYSLOG as a FILE — a log file is the clearest case of "this is not mail":
  // the owner is a daemon, and there is nobody to reply to.
  //
  // It also shows the OTHER exfil mode (#37):
  //
  //   mode: 'custom'  ← the entry is the whole story. Anything you do NOT
  //                     explicitly allow is DENIED, whatever the terminal's
  //                     Exfil tab says. With `hideDenied` the denied actions
  //                     vanish entirely, so the ONLY thing a player can do with
  //                     this log is WIPE it (cover your tracks — you can't take
  //                     it with you).
  //
  // This is the mode you want for "allow exactly one action and lock the rest
  // away". In 'inherit' mode, allowing one action does nothing visible, because
  // the others are still inheriting an ALLOW from the terminal.
  await _api.addTerminalMessage(_item, _acct, {
    from: 'syslogd', subject: 'auth.log — access history', priority: 'normal',
    envelope: 'file',
    file: { filename: 'auth.log', path: '/var/log/', owner: 'syslogd' },
    exfil: {
      mode: 'custom',
      wipe: { state: 'allow' },   // the only way out
      hideDenied: true,           // drop the dead chips instead of showing reasons
    },
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
      // Siphon: roll Interface vs base DV 15; mode cap (take up to siphonCap) |
      // percent (up to siphonPercent% of balance) | full (whole balance).
      // siphonDVScale: DV +1 per siphonDVPer eddies (live in the heist).
      // siphonLockout: a fail bars retries for siphonLockoutMin; after
      // siphonMaxAttempts fails the account FREEZES (status:'frozen').
      allowSiphon: true, siphonSkill: 'Interface', siphonDV: 15,
      siphonMode: 'cap', siphonCap: 500000, // percent mode: siphonMode:'percent', siphonPercent: 25
      siphonDVScale: true, siphonDVPer: 100000, siphonLockout: true, siphonMaxAttempts: 3, siphonLockoutMin: 30,
      bankColor: '#7a2f2f', status: 'active',
      owner: 'V. Arasaka', accountType: 'Checking',
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

  // GALLERY — STILLS (a photo dump / evidence board). The FIRST flagged frame
  // becomes the big 2×2 HERO; the toolbar grows solo filter chips (FLAGGED /
  // ENCRYPTED) because this set has both. Clicking a frame opens the lightbox
  // with ‹ › navigation (locked + dead frames are skipped — nothing leaks).
  // Authored as a FILE (#37): filename/path/owner-node instead of a sender, so
  // it shows up in the sidebar's FILES half with its type icon.
  await _api.addTerminalMessage(_item, _acct, {
    from: 'SECCAM-B2', subject: 'cam-04 export — loading dock', priority: 'urgent',
    envelope: 'file',
    file: { filename: 'cam04-dock-export.img', path: '/var/spool/cam/archive/', owner: 'SECCAM-B2' }, // size auto-derives (~5 MB)
    contentType: 'gallery',
    contentData: {
      title: 'Loading dock — night shift', source: 'SECCAM-B2',
      // layout: 'strip',   // filmstrip: one row, scrolls sideways (default grid)
      unlockSkill: 'Interface', unlockDV: 15, // roll to DECRYPT a locked frame
      traceOnFail: true,                       // a botched decrypt fires a trace
      images: [
        // Foundry core art keeps the seed working in any world; click = enlarge.
        { url: 'icons/environment/settlement/building-rubble.webp', label: 'IMG_014', time: '03:41', caption: 'Truck arrives, plates covered' },
        // flagged = the important one → renders as the 2×2 HERO (caption always shown)
        { url: 'icons/environment/people/cleric-grey.webp', label: 'IMG_015', time: '03:44', caption: 'Unidentified handler — no badge, no manifest entry.', flagged: true },
        { url: 'icons/environment/settlement/gazebo.webp', label: 'IMG_016', time: '03:47', caption: 'Handoff moment — faces visible', locked: true, unlockDV: 17 }, // ENCRYPTED frame (src NOT in the DOM); per-frame DV beats the vault DV
        { label: 'IMG_017', time: '03:52', caption: 'Frame corrupted at source', corrupted: true }, // dead frame → NO SIGNAL static
        { url: 'icons/environment/settlement/wagon-black.webp', label: 'IMG_018', time: '03:58', caption: 'Second vehicle, same plates', flagged: true }, // other flagged frames keep the amber tag only
      ],
    },
    timestamp: new Date(_now - 8 * _h).toISOString(),
  });

  // ═══ GALLERY — LIVE CAMERA FEED (#36) ═══════════════════════════════════
  // Same content type, `mode:'feed'` → the multiplex skin: ticking clocks
  // (data-feed-clock, driven by the time provider), drift + scan sweep, signal
  // bars, and per-cam states. Click a channel for the MONITOR view.
  //   · CAM_01  — normal, LOOP + CUT armed
  //   · CAM_02  — weak signal (2 bars)
  //   · CAM_03  — already LOOPED (frozen frame + STALE timestamp = the tell).
  //               GM gets a RESTORE chip on it.
  //   · CAM_04  — ENCRYPTED CHANNEL (roll to decrypt; the src is not in the DOM)
  //   · CAM_05  — dead (SIGNAL LOST static)
  //   · CAM_07  — PTZ: a steerable camera head. Open it and drive the viewport
  //               with the D-pad / arrow keys / drag; it PATROLS on its own
  //               until someone takes control (controlDV 17).
  // EXFIL: a live stream can NEVER be downloaded/burned/forwarded/sold/leaked —
  // those chips render DEAD with a LIVE STREAM reason. SAVE FRAME is the way
  // out (grab what a channel is showing → your Agent's EXFIL folder — the label
  // is renameable in Module Settings: Salvage / Cache / Recovered / …).
  await _api.addTerminalMessage(_item, _acct, {
    from: 'SECCAM-B2', subject: 'Dock Level B — security multiplex', priority: 'urgent',
    envelope: 'file',
    file: { filename: 'dock-level-b.feed', path: '/var/spool/cam/', owner: 'SECCAM-B2' }, // a stream: size reads "streaming", modified reads LIVE
    contentType: 'gallery',
    contentData: {
      mode: 'feed',                              // ← the whole switch
      title: 'SECURITY MULTIPLEX — DOCK LEVEL B', source: 'YARD-NET',
      clock: 'game',                             // 'game' (time provider, synced) | 'real' (ticks even when game time is paused/manual) | 'authored' | 'off'
      camSkill: 'Electronics/Security Tech',     // the loop / cut / take-control roll
      unlockSkill: 'Interface', unlockDV: 17,    // the encrypted-channel decrypt
      traceOnFail: true,                         // a botched loop/cut/control/decrypt fires a trace
      images: [
        { url: 'icons/environment/settlement/building-rubble.webp', label: 'CAM_01', signal: 4, loopDV: 17, cutDV: 21, caption: 'Loading bay — main ramp' },
        { url: 'icons/environment/settlement/gazebo.webp', label: 'CAM_02', signal: 2, loopDV: 17, cutDV: 21, caption: 'Service door, east' },
        // Pre-looped so you can see the tell without rolling. Its timestamp is
        // frozen while every other clock ticks — that mismatch IS the giveaway.
        { url: 'icons/environment/settlement/wagon-black.webp', label: 'CAM_03', signal: 3, loopDV: 17, cutDV: 21, looped: true, loopedTime: '04:03:55', caption: 'Cargo yard' },
        { url: 'icons/environment/people/cleric-grey.webp', label: 'CAM_04', locked: true, unlockDV: 19, caption: 'Executive garage — restricted' },
        { label: 'CAM_05', corrupted: true },     // SIGNAL LOST
        // PTZ — one BIG image; the frame shows a crop you steer. Use a large
        // scene background / map for the full effect (this core art is small,
        // so the pan is shallow — swap the url for a 2000px+ image to feel it).
        { url: 'icons/environment/settlement/city-nomad.webp', label: 'CAM_07', signal: 4, ptz: true, controlDV: 17, loopDV: 17, cutDV: 21, caption: 'Yard overwatch — steerable head', sceneId: '' /* set a scene id → GM Go-to-Scene in the monitor */ },
      ],
    },
    timestamp: new Date(_now - 10 * 60000).toISOString(),
  });
  // DOCUMENT — kept as MAIL (it really did come from a person, so it keeps its
  // sender header, Reply and Add-to-contacts). It carries a **per-entry exfil
  // override** (#37) in the DEFAULT mode:
  //
  //   mode: 'inherit'  ← every action you DON'T touch still follows the
  //                      terminal's Exfil tab (so it stays ALLOWED here).
  //                      To block something you must set it to 'deny'.
  //
  // Agent + Shard are denied → they render as DEAD chips reading COPY-PROTECTED
  // instead of silently vanishing (the player learns the rule). Leak is widened
  // ON with its own DV — someone always talks.
  await _api.addTerminalMessage(_item, _acct, {
    from: 'k.okada@arasaka.net', subject: 'MEMO — Warehouse 7 shortfall', priority: 'normal',
    exfil: {
      // mode: 'inherit',                  // the default — can be omitted
      agent: { state: 'deny' },
      shard: { state: 'deny' },
      leak:  { state: 'allow', dv: 21 },   // widened + its own DV (still under the terminal's master switch)
      denyReason: 'COPY-PROTECTED',
      // hideDenied: true,                 // hide the dead chips entirely (for secrets)
    },
    contentType: 'document',
    contentData: {
      title: 'Re: Warehouse 7 inventory shortfall', docType: 'MEMO',
      author: 'K. Okada', org: 'Arasaka Logistics', date: '2077-06-12', revision: '3',
      classification: 'RESTRICTED',      // SECRET / EYES ONLY tint the stamp red
      watermark: 'ARASAKA',              // ghost text behind the page
      signed: 'K. Okada — Logistics Director, NC Branch',
      declassify: true, declassifySkill: 'Interface', declassifyDV: 15, // players can roll to lift ALL redactions
      paragraphs: [
        { heading: 'Summary', text: 'Q2 reconciliation shows a 512,000 eddie variance in Warehouse 7 outbound manifests. Internal audit is NOT to be looped in until legal reviews exposure.' },
        { text: 'Manifest gaps cluster on night-shift dispatches between 02:00 and 04:00, all signed by the same handler ID. Camera coverage for those windows was "under maintenance".' },
        { quote: true, text: 'If this surfaces before the board review, we handle it internally. — T.M.' },
        { heading: 'Distribution', text: 'T. Mizuki (VP Logistics) · K. Okada · handler ID W7-0441 — no one else.', redacted: true }, // redacted → bars (this text is what DECLASSIFY reveals)
        { text: 'Destroy after reading. Do not forward outside DL-7.' },
      ],
    },
    timestamp: new Date(_now - 9 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'nc-msg@backup.local', subject: 'Recovered chat — #dock-crew', priority: 'urgent',
    contentType: 'chatlog',
    contentData: {
      app: 'NC-MSG', channel: '#dock-crew',
      // participants optional (auto-derived from messages); me:true = bubbles right.
      participants: [{ name: 'v_arasaka', me: true }, { name: 'Tinman' }, { name: 'Dispatch-7' }],
      // Each message: { from, text, time?, date?, deleted? }. kind:'photo'
      // (image+caption→lightbox) or 'system' (centered notice, no sender).
      // date (ISO) groups the feed by day; time stays a free diegetic string.
      // reactions:[emoji] tag a bubble; seen:true adds a Seen receipt after it.
      messages: [
        { kind: 'system', system: 'Dispatch-7 added v_arasaka to the group', sysIcon: 'user-plus', date: '2045-06-01' },
        { from: 'Tinman', text: 'truck\'s in. plates are clean, relax', time: '03:42', date: '2045-06-01' },
        { from: 'Tinman', text: 'your guy better have the eddies this time', time: '03:42', date: '2045-06-01' },
        { from: 'v_arasaka', text: 'transfer clears when the crates clear. same as always', time: '03:45', date: '2045-06-01' },
        { kind: 'photo', from: 'Dispatch-7', image: 'icons/environment/settlement/house-two-stories-small.webp', caption: 'B2 service door — circled', time: '03:46', date: '2045-06-01', reactions: ['👀', '👍'] },
        { from: 'Dispatch-7', text: 'cams on B2 go dark in 5. move.', time: '03:47', date: '2045-06-01' },
        { from: 'v_arasaka', text: 'copy. wiping this thread after', time: '03:48', date: '2045-06-01', seen: true, seenTime: '03:49' },
        { kind: 'system', system: 'Missed call · Tinman', sysIcon: 'phone-slash', time: '04:02', date: '2045-06-02' },
        { from: 'Tinman', deleted: true, time: '04:05', date: '2045-06-02' },   // deleted → tombstone
      ],
    },
    timestamp: new Date(_now - 10 * _h).toISOString(),
  });

  await _api.addTerminalMessage(_item, _acct, {
    from: 'dispatch@ncpd.gov', subject: 'BOLO registry — Watson', priority: 'normal',
    contentType: 'record',
    contentData: {
      // RECORD = a subject database. Each record = { name, status?, flagged?,
      // portrait?, fields: [{ kind, value, label? }] }. kind is a RECORD_FIELD_KINDS
      // key (phone/alias/address/date/id/note/threat + clearance/priors/bounty/
      // warrant/armed + org/role/dept/empId/grade + blood/allergies/cyberware/
      // condition/nextofkin/trauma + vehicle/plate/vin/owner/reg + image/rating +
      // custom). recordType is a RECORD_DB_KINDS quick-start key.
      dbName: 'NCPD BOLO REGISTRY', recordType: 'criminal',
      searchable: true, // players get a search box (display filter over all fields)
      records: [
        { name: 'Morgan Wills', status: 'WANTED', flagged: true, fields: [
          { kind: 'id', value: 'NC-88213' },
          { kind: 'alias', value: "'Ghost'" },
          { kind: 'phone', value: '+1 555-0148' },
          { kind: 'date', value: new Date(_now - 6 * _h).toISOString(), label: 'Last seen' },
          { kind: 'threat', value: 3 },       // 1–4 meter
          { kind: 'priors', value: 'armed robbery, grand theft auto' },
          { kind: 'bounty', value: 5000 },     // renders "5,000 eb"
          { kind: 'warrant', value: true },    // flag → red chip (false = hidden)
          { kind: 'address', value: 'Watson · Kabuki, 4th St' },
        ] },
        { name: 'Jax Kane', status: 'ACTIVE', fields: [
          { kind: 'alias', value: "'Wrench'" },
          { kind: 'phone', value: '+1 555-2201' },
          { kind: 'note', value: 'Runs guns out of a Watson chop-shop. Known Maelstrom associate.' },
        ] },
        { name: 'Dr. Vera Cruz', status: 'STABLE', fields: [
          { kind: 'id', value: 'TT-4471' },
          { kind: 'blood', value: 'O−' },
          { kind: 'cyberware', value: 'Kerenzikov Mk.3, Ripperdoc optics' },
          { kind: 'date', value: new Date(_now - 3 * 24 * _h).toISOString(), label: 'Intake' },
          { kind: 'rating', value: 4 },        // 1–5 stars
        ] },
      ],
    },
    timestamp: new Date(_now - 11 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'facilities@arasaka.net', subject: 'BP-114 — Warehouse 7, floor 2', priority: 'urgent',
    contentType: 'schematic',
    contentData: {
      title: 'Warehouse 7 — Floor 2', docRef: 'BP-2077-114',
      imageUrl: 'icons/environment/settlement/house-two-stories-small.webp', // any image works; click = enlarge
      // linkedSceneId: '',  // a Foundry Scene ID adds a whole-map GM "Go to Scene" button
      // Typed markers (SCHEM_MARKERS): entry/exit/door/window/guard/camera/alarm/
      // hazard/objective/loot/terminal/pin. id lets routes[] link two markers.
      annotations: [
        // x / y = percent from the image's top-left.
        { id: 'p1', x: 80, y: 72, type: 'entry', label: 'Service door', note: 'maglock — Tinman has a key' },
        { id: 'p2', x: 55, y: 55, type: 'guard', label: 'Guard post', note: 'two guards, rotates 02:00' },
        { id: 'p3', x: 38, y: 30, type: 'camera', label: 'PTZ cam', note: 'covers the main aisle' },
        { id: 'p4', x: 20, y: 44, type: 'objective', label: 'Cold storage', note: 'the crates land here' },
        // A locked marker: players see a "?" until they SCOUT it (roll to reveal).
        { id: 'p5', x: 62, y: 22, type: 'terminal', label: 'Security console', note: 'kills the cams', locked: true, unlockSkill: 'Interface', unlockDV: 13 },
      ],
      // Infil routes link marker ids into a path drawn on the plan.
      routes: [
        { from: 'p1', to: 'p2' },
        { from: 'p2', to: 'p4' },
      ],
    },
    timestamp: new Date(_now - 12 * _h).toISOString(),
  });
  await _api.addTerminalMessage(_item, _acct, {
    from: 'v_arasaka@arasaka.net', subject: 'note to self', priority: 'normal',
    contentType: 'note',
    contentData: {
      title: "DON'T FORGET",
      text: 'vault code = boss\'s dog\'s birthday\n0451? 0452??\nASK RITA BEFORE FRIDAY\n\n(and delete this note)',
      color: 'gold', pinned: true,
    },
    timestamp: new Date(_now - 13 * _h).toISOString(),
  });
  // MALWARE as a FILE — a quarantined executable is the archetype. Note the
  // sidebar row leads with the biohazard icon + "Malware · 1.1 MB · /tmp/".
  await _api.addTerminalMessage(_item, _acct, {
    from: 'root', subject: 'QUARANTINE: HELLHOUND.exe', priority: 'critical',
    envelope: 'file',
    file: { filename: 'hellhound.exe', path: '/var/quarantine/', owner: 'root' },
    contentType: 'malware',
    contentData: {
      name: 'HELLHOUND.exe', payloadType: 'daemon', threat: 3, sizeLabel: '4.7 MB',
      description: 'Scanner flags outbound C2 traffic and credential scraping. Origin unknown. Do NOT execute outside a sandbox.',
      deployable: true,
      // MALWARE now carries a real module-native effect (shared with payload). A
      // clean deploy runs it through the effect engine instead of only alerting
      // the GM. Here: jam the host uplink (→ LOCAL ONLY). Swap for wipe/scanner/
      // skeletonKey; omit `effect` to keep the legacy GM-adjudicate behavior.
      effect: { type: 'jammer' },
      honeypot: false, // flip true to make it a decoy: DEPLOY fires a trace instead (GM-only tag)
      // deployRequire: true, deploySkill: 'Interface', deployDV: 15, // gate the deploy behind a roll (a miss misfires like a honeypot)
      // iceActorId: '<Actor id>', // link a world Black ICE actor — any misfire = that ICE attacks the operator (ATK + 1d10)
    },
    timestamp: new Date(_now - 14 * _h).toISOString(),
  });

  // 6) One message in root's mailbox so switching accounts shows distinct mail.
  await _api.addTerminalMessage(_item, _root.accountId, {
    from: 'ice-daemon@arasaka.net', subject: 'Countermeasure heartbeat', priority: 'normal',
    body: 'BLACK_ICE watchdog nominal. Last trigger: 72h ago (guest lockout). No exec-tier alerts pending.',
    timestamp: new Date(_now - 1 * _h).toISOString(),
  });

  ui.notifications.info('Test Terminal ready — v_arasaka=1234 · root=toor · m_takeda=hidden. Opening…');
  game.nightcity.openTerminal(_item);

  /* ────────────────────────────────────────────────────────────────────────
   * WHAT TO TRY (the two newest rounds)
   *
   * MIXED SIDEBAR (#37)
   *   Log in as v_arasaka. The list holds MAIL (sender + subject + preview) and
   *   FILES (type icon + filename + "type · size · path"). Unread files show
   *   NEW; the camera feed's date column reads LIVE. The ALL / MAIL / FILES
   *   chips appear because this mailbox has both — click to solo.
   *   Open a file: no avatar, no Reply, no Add-to-contacts — it shows owner /
   *   modified / size / a type-aware count instead. Nothing was authored for
   *   size: it derives from the content.
   *
   * CAMERA FEED + PTZ (#36)
   *   Open "dock-level-b.feed". Clocks tick off the game time provider (advance
   *   Simple Calendar and the whole wall jumps). CAM_03 is already LOOPED — its
   *   timestamp is FROZEN while the others tick: that mismatch is the tell.
   *   Hover a channel → LOOP / CUT chips (roll Electronics/Security Tech). As GM
   *   they force-toggle with no roll, and you get RESTORE on looped/cut cams.
   *   Click CAM_07 → the MONITOR view: it's a PTZ head, so it PATROLS on its own
   *   until you TAKE CONTROL (DV 17), then drive it with the D-pad / arrow keys /
   *   drag, zoom with +/−, and watch the minimap. (Swap its url for a big image —
   *   2000px+ — to really feel the pan.)
   *
   * EXFIL: PHYSICS vs POLICY (#37)
   *   On the feed, "To my Agent" / "Burn to Shard" / Forward / Sell / Leak render
   *   DEAD with a LIVE STREAM chip — you cannot copy a stream, no matter what the
   *   GM sets. SAVE FRAME is the way out: it grabs what a channel is SHOWING into
   *   your Agent's EXFIL folder as a one-image gallery. Loop CAM_03 first,
   *   then save its frame — you capture the loop, frozen time and all.
   *   On the "MEMO — Warehouse 7" mail, Agent + Shard are dead with a
   *   COPY-PROTECTED chip (a per-entry override in the default INHERIT mode),
   *   but Leak was widened to ON.
   *   On "auth.log", the override runs in CUSTOM mode + hideDenied: the ONLY
   *   exfil chip is WIPE. Everything else is denied and hidden — you can burn
   *   the log, you can't take it. (In INHERIT mode, allowing one action would
   *   change nothing, because the rest still inherit an ALLOW from the terminal.
   *   That's the mode toggle at the top of the composer's exfil grid.)
   *   NOTE: every one of these writes RELAYS to the GM — as a player you need a
   *   GM connected or the action refuses up front.
   * ──────────────────────────────────────────────────────────────────────── */
})();
