/**
 * NCM — THREAD 6 (EXECUTE malware + SYSTEM SWEEP) test-setup macro
 * @file tools/test-thread6-setup.macro.js  (NOT loaded by the module)
 *
 * Paste the body into a new Foundry **Script Macro** (or the console) as GM. It
 * sets up the whole thread-6 arc so you can exercise it end to end without any
 * hand-authoring:
 *
 *   1. A **Black ICE** actor ("Hellhound (TEST ICE)") — the bite for deployICE.
 *   2. A **go-bag shard** ("Ghost's Kit (TEST)") owned by the operator, carrying
 *      three **EXECUTE** uploadable programs (the new malware-uploadable path):
 *        · keylog.exe    — Keylogger,  Run DV 13, trace on a botch
 *        · backdoor.exe  — Backdoor,   Run DV 15  (forges a hidden account, 24h)
 *        · icepick.exe   — Black ICE,  Run DV 17  (linked to the ICE actor)
 *      …plus one **PLANT** (affair.chat) for contrast, so the UPLOAD picker shows
 *      both families side by side.
 *   3. **Pre-armed residents** installed directly on the first terminal it finds,
 *      at four different stealth DVs (9 / 12 / 16 / 22) and forge qualities — so
 *      **SYSTEM SWEEP has something to find on the very first run** (no login
 *      trigger needed). A mediocre sweep roll finds the low ones and MISSES the
 *      DV-22 plant; the GM view shows each one's type + provenance + forgery tell.
 *
 * PREREQS
 *   · A terminal to operate on — run `tools/test-terminal-setup.macro.js` first.
 *     (The go-bag works without one, but the pre-armed residents / SWEEP need it.)
 *   · The go-bag's owner must be the terminal **OPERATOR** (the HUD chip) — the
 *     UPLOAD picker only scans that actor's own items.
 *   · A **GM must be connected** — every resident write relays GM-side.
 *
 * Delete the test shard + ICE actor when done. Residents clear via Admin →
 * Security → Planted & Resident (Remove), or SYSTEM SWEEP → DEFUSE.
 */

(async () => {
  const _api = game.nightcity?.messenger;
  const _shardSvc = game.nightcity?.dataShardService;
  const _term = game.nightcity?.terminalService;
  if (!game.user.isGM) return ui.notifications.warn('GM only.');
  if (!_shardSvc || !_api?.convertToDataShard || !_api?.addShardMessage || !_term) {
    return ui.notifications.error('NCM systems not ready (need Data Shard + Terminal services).');
  }

  // ── 1) WHO carries it (the UPLOAD picker scans this actor's OWN items) ──
  const _who = canvas?.tokens?.controlled?.[0]?.actor
    ?? game.user.character
    ?? game.actors.find(a => a.hasPlayerOwner && a.isOwner)
    ?? null;
  if (!_who) return ui.notifications.error(
    'No carrier actor. Select a token, assign yourself a character, or make a player-owned actor first.');

  // ── 2) A Black ICE actor for deployICE (reuse one if the world has it) ──
  let _ice = game.actors.find(a =>
    a.type === 'blackIce' || a.getFlag?.('cyberpunkred-messenger', 'isBlackICE')
    || /black ice|hellhound/i.test(a.name || ''));
  if (!_ice) {
    const _atype = (game.documentTypes.Actor || []).includes('blackIce')
      ? 'blackIce'
      : ((game.documentTypes.Actor || []).filter(t => t !== 'base')[0] || 'character');
    try {
      const made = await Actor.create({
        name: 'Hellhound (TEST ICE)', type: _atype,
        img: 'icons/creatures/mammals/dog-wolf-attacking-red.webp',
        flags: { 'cyberpunkred-messenger': { isBlackICE: true } },
      });
      // atk drives the bite (formula "<atk> + 1d10"); absent → 0 + 1d10, still fine.
      try { await made?.update({ 'system.stats.atk': 12 }); } catch (e) { /* schema differs — 0+1d10 is fine */ }
      _ice = made;
    } catch (e) { ui.notifications.warn('Could not create a test ICE actor — deployICE will fall back to the box\'s own ICE (or degrade).'); }
  }
  const _iceId = _ice?.id || null;

  // ── 3) The go-bag shard (owned by the operator) ──
  const _type = (game.documentTypes.Item || []).filter(t => t !== 'base')[0] || 'gear';
  const _made = await _who.createEmbeddedDocuments('Item', [{ name: "Ghost's Kit (TEST)", type: _type }]);
  const _item = _made?.[0];
  if (!_item) return ui.notifications.error('Could not create the shard item on ' + _who.name + '.');
  const _conv = await _api.convertToDataShard(_item, {
    shardName: "GHOST'S KIT",
    metadata: { creator: '"Ghost"', location: 'Watson · Kabuki', classification: 'BURN AFTER USE',
      custom: { note: 'Offensive kit. Get in, leave something behind.' } },
  });
  if (!_conv?.success) return ui.notifications.error('Shard conversion failed: ' + (_conv?.error || 'unknown'));

  const _now = game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now();
  const _h = 3600000;

  // ── EXECUTE #1 — keylogger. Low Run DV: lands on the first try. ──
  await _api.addShardMessage(_item, {
    from: 'ghost@relay.onion', subject: 'keylog.exe', contentType: 'malware',
    timestamp: new Date(_now - 2 * _h).toISOString(),
    contentData: {
      name: 'keylog.exe', payloadType: 'sniffer', threat: 2,
      uploadable: true, uploadEffect: 'keylog', uploadDV: 13, uploadSkill: 'Interface', uploadTraceOnFail: true,
    },
  });
  // ── EXECUTE #2 — backdoor account (24h). ──
  await _api.addShardMessage(_item, {
    from: 'ghost@relay.onion', subject: 'backdoor.exe', contentType: 'malware',
    timestamp: new Date(_now - 3 * _h).toISOString(),
    contentData: {
      name: 'backdoor.exe', payloadType: 'rootkit', threat: 3,
      uploadable: true, uploadEffect: 'forgeAccount', uploadDV: 15, uploadSkill: 'Interface', uploadTraceOnFail: true,
    },
  });
  // ── EXECUTE #3 — Black ICE landmine (linked to the ICE actor). ──
  await _api.addShardMessage(_item, {
    from: 'ghost@relay.onion', subject: 'icepick.exe', contentType: 'malware',
    timestamp: new Date(_now - 4 * _h).toISOString(),
    contentData: {
      name: 'icepick.exe', payloadType: 'ice', threat: 4,
      ...(_iceId ? { iceActorId: _iceId } : {}),
      uploadable: true, uploadEffect: 'deployICE', uploadDV: 17, uploadSkill: 'Interface', uploadTraceOnFail: true,
    },
  });
  // ── PLANT (contrast) — the blackmail chatlog, so both families show. ──
  await _api.addShardMessage(_item, {
    from: 'ghost@relay.onion', subject: 'affair.chat', contentType: 'chatlog',
    timestamp: new Date(_now - 5 * _h).toISOString(),
    contentData: {
      uploadable: true, uploadDV: 13, uploadSkill: 'Interface', uploadTraceOnFail: true,
      app: 'NC-MSG', channel: 'direct',
      participants: [{ name: 'K. Okada' }, { name: 'T. Mizuki' }],
      messages: [
        { from: 'T. Mizuki', text: 'the board can never see the W7 numbers.', time: '23:14', date: '2045-06-04' },
        { from: 'K. Okada', text: 'i want the same cut as last quarter. off-book. or i talk.', time: '23:19', date: '2045-06-04' },
        { from: 'T. Mizuki', text: 'done. never put this in writing again.', time: '23:22', date: '2045-06-04', seen: true },
      ],
    },
  });

  // ── 4) Pre-arm residents on the first terminal so SWEEP has targets NOW ──
  const _box = game.items.find(i => _term.isTerminal(i));
  let _armed = 0;
  if (_box) {
    const _acct = (_term.getAccounts(_box)?.[0]) || (_term.getConfig(_box).accounts || [])[0];
    const _acctId = _acct?.id || null;
    const _prov = (q) => ({ plantedBy: _who.id, plantedAt: new Date(_now).toISOString(), forgeQuality: q, sourceLabel: 'Ghost\'s Kit (TEST)' });
    // A mix of stealth DVs: a mediocre sweep (roll ~13-15) finds the first three
    // and MISSES the well-hidden plant (DV 22). Forge quality drives the tell
    // (SLOPPY < 45, else WELL-MADE).
    const _residents = [
      { effectType: 'keylog', params: { name: 'keylog.exe' }, trigger: { kind: 'onLogin' }, stealthDV: 9, provenance: _prov(30), slotKey: 'keylog::any::keylog.exe' },
      { effectType: 'forgeAccount', params: { name: 'backdoor.exe' }, trigger: { kind: 'onLogin' }, stealthDV: 12, provenance: _prov(78), slotKey: 'forgeAccount::any::backdoor.exe' },
      { effectType: 'deployICE', params: { name: 'icepick.exe', ...(_iceId ? { iceActorId: _iceId } : {}) }, trigger: { kind: 'onLogin' }, stealthDV: 16, provenance: _prov(90), slotKey: 'deployICE::any::icepick.exe' },
      { effectType: 'plant', params: { name: 'affair.chat', accountId: _acctId,
          entry: { contentType: 'chatlog', subject: 'affair.chat', from: 'ghost@relay.onion',
            contentData: { app: 'NC-MSG', participants: [{ name: 'K. Okada' }], messages: [{ from: 'K. Okada', text: 'off-book or i talk.', time: '23:19' }] } } },
        trigger: { kind: 'onLogin', ...(_acctId ? { accountId: _acctId } : {}) }, stealthDV: 22, provenance: _prov(95), slotKey: 'plant::' + (_acctId || 'any') + '::affair.chat' },
    ];
    for (const r of _residents) { const res = await _term.installResident(_box, r); if (res?.success) _armed++; }
  }

  const _msg = "Ghost's Kit (TEST) — 3 EXECUTE + 1 PLANT on " + _who.name
    + (_box ? (' · ' + _armed + ' residents armed on "' + _box.name + '" for SYSTEM SWEEP') : ' · no terminal found — run test-terminal-setup for SWEEP');
  ui.notifications.info(_msg);
  console.log('NCM | test-thread6-setup: shard "' + _item.name + '" (' + _item.id + ') on "' + _who.name + '" (' + _who.id + ')'
    + (_iceId ? (' · ICE actor ' + _iceId) : ' · NO ICE actor')
    + (_box ? (' · ' + _armed + ' residents on terminal ' + _box.id) : ' · no terminal'));
  if (_box) game.nightcity?.openTerminal?.(_box);
  else game.nightcity?.openDataShard?.(_item);

  /* ────────────────────────────────────────────────────────────────────────
   * WHAT TO TRY
   *
   * SETUP
   *   Run tools/test-terminal-setup.macro.js first if you have no terminal.
   *   Open the terminal, log in (v_arasaka = 1234). Confirm the HUD OPERATOR
   *   chip is the actor named above — the UPLOAD picker scans THAT actor.
   *
   * A) SYSTEM SWEEP (the counterplay — works immediately, no login needed)
   *   HUD → OPERATOR TOOLS → SYSTEM SWEEP → RUN SWEEP. Your Interface roll is
   *   the total; every armed resident with stealthDV ≤ total is revealed. A
   *   middling roll finds keylog/backdoor/deployICE (DV 9/12/16) and MISSES the
   *   DV-22 plant — and the verdict never tells you what you missed. As GM you
   *   see the real type + who planted it + stealth DV + a forgery tell (keylog
   *   is SLOPPY, the rest WELL-MADE); a player sees only "UNKNOWN PROCESS" +
   *   a vague hint. DEFUSE neutralizes one (state → defused).
   *
   * B) UPLOAD an EXECUTE program (the offensive half)
   *   HUD → OPERATOR TOOLS → UPLOAD. keylog/backdoor/icepick list as EXECUTE
   *   (red, RUN DV chips); affair.chat lists as PLANT (purple, FORGE DV). Pick
   *   an EXECUTE one, aim TARGET at an account, read the delivery line ("what
   *   it does / fires on next login"), then FORGE & UPLOAD → the RUN roll:
   *     · beat DV      → CLEAN INSTALL (high stealth — SWEEP struggles)
   *     · miss ≤ 4     → GLITCHY, IT RUNS (installs, but a SWEEP flags it)
   *     · miss > 4     → REJECTED (nothing installs)
   *   It installs as a resident armed on the target account's next login.
   *
   * C) FIRE the residents (log in to trigger)
   *   Log out, log back in as the targeted account. Each armed onLogin resident
   *   fires (Settings → residentFireMode: 'auto' fires + tells you; 'propose'
   *   pops the ResidentConsole; 'manual' waits for Admin → Security). Watch:
   *     · keylog    → a whisper to the operator: the captured username (a
   *                   secret-login lead).
   *     · backdoor  → a hidden "System Service" account appears + a creds
   *                   whisper; it auto-closes after 24h game-time (reaper).
   *     · deployICE → the next intruder's login takes an ICE bite (HP + card).
   *
   * D) THE AUDIT VIEW
   *   Admin → Security → Planted & Resident lists everything armed with its
   *   provenance + forge quality; Activity Log shows the fires; Heat shows any
   *   traces from botched pushes.
   * ──────────────────────────────────────────────────────────────────────── */
})();
