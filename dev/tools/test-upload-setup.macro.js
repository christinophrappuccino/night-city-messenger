/**
 * NCM — UPLOAD / PLANT test-setup macro (NOT loaded by the module)
 * @file dev/tools/test-upload-setup.macro.js
 *
 * Paste the body below into a new Foundry **Script Macro** (or run it in the
 * console) as GM. It builds the on-ramp from the design doc's §4f: an NPC hands
 * the player a **go-bag shard**, they carry it to a terminal, log in, and PUSH
 * forged content onto the box (`OPERATOR TOOLS → UPLOAD`). The forged file
 * installs as a **resident** that fires on the target account's next login.
 *
 * It creates ONE data shard — "Ghost's Go-Bag (TEST)" — **owned by an actor**
 * (this is load-bearing: the upload picker only scans `actor.items`, never world
 * items) carrying four **PLANT**-family forgeries, each with a different forge
 * difficulty so you can see the FORGE margin drive `forgeQuality` → `stealthDV`:
 *
 *   · affair.chat      — the blackmail chatlog (DV 13, trace on a botch)
 *   · evidence.img     — a doctored photo set (DV 15, trace on a botch)
 *   · dossier: subject — a forged target file (DV 17, pinned stealth DV 18)
 *   · memo.doc         — a forged corporate memo (DV 21, no trace — a quiet lie)
 *
 * ── This macro seeds PLANT only (by design) ──────────────────────────────
 * (Historical note: EXECUTE used to render disabled with a SOON chip. Thread #6
 * landed — EXECUTE programs upload for real now — so for EXECUTE examples use
 * `dev/tools/test-thread6-setup.macro.js`, which seeds keylog/backdoor/deployICE
 * uploadables plus pre-armed residents for SYSTEM SWEEP. This macro stays the
 * clean PLANT-only forgery kit.)
 *
 * PREREQS
 *   · A terminal to upload INTO — run `dev/tools/test-terminal-setup.macro.js` first.
 *   · The shard's owner must be the **OPERATOR** in the terminal viewer (the HUD
 *     OPERATOR chip). This macro tells you who it handed the shard to.
 *   · A **GM must be connected** — the resident install relays GM-side.
 *
 * Delete the test item when done.
 */

(async () => {
  const _api = game.nightcity?.messenger;
  const _shardSvc = game.nightcity?.dataShardService;
  if (!game.user.isGM) return ui.notifications.warn('GM only.');
  if (!_shardSvc || !_api?.convertToDataShard || !_api?.addShardMessage) {
    return ui.notifications.error('NCM Data Shard system not ready.');
  }

  // 1) WHO carries it. The upload picker scans the OPERATOR actor's OWN items
  //    (TerminalViewerApp._gatherCarriedPrograms → actor.items), so a world
  //    item is invisible to it. Prefer a selected token, then the assigned
  //    character, then the first player-owned actor we can write to.
  const _who = canvas?.tokens?.controlled?.[0]?.actor
    ?? game.user.character
    ?? game.actors.find(a => a.hasPlayerOwner && a.isOwner)
    ?? null;
  if (!_who) {
    return ui.notifications.error(
      'No carrier actor. Select a token, assign yourself a character, or make a player-owned actor first.');
  }

  // 2) The go-bag itself — an ordinary item on that actor, converted with the
  //    default shard config (unencrypted, so it opens straight up).
  const _type = (game.documentTypes.Item || []).filter(t => t !== 'base')[0] || 'gear';
  const _made = await _who.createEmbeddedDocuments('Item', [{ name: "Ghost's Go-Bag (TEST)", type: _type }]);
  const _item = _made?.[0];
  if (!_item) return ui.notifications.error('Could not create the shard item on ' + _who.name + '.');

  const _conv = await _api.convertToDataShard(_item, {
    shardName: "GHOST'S GO-BAG",
    metadata: {
      creator: '"Ghost"', location: 'Watson · Kabuki', classification: 'BURN AFTER USE',
      custom: { note: 'Forged intel. Plant it, walk away.' },
    },
  });
  if (!_conv?.success) return ui.notifications.error('Shard conversion failed: ' + (_conv?.error || 'unknown'));

  const _now = game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now();
  const _h = 3600000;

  // 3) The uploadable payloads.
  //
  //    THE UPLOAD CONTRACT — these five keys on `contentData` are the whole of
  //    it (they mirror the composer's ③ SECURITY & ACCESS "Uploadable" fieldset,
  //    and the gather strips them off the copy that actually gets planted):
  //
  //      uploadable        true → the entry shows in the UPLOAD picker
  //      uploadDV          the FORGE check DV (default 15)
  //      uploadSkill       the FORGE skill    (default 'Interface')
  //      uploadStealthDV   pin the ANALYZE DV (omit → derived from the margin)
  //      uploadTraceOnFail a botched forge fires a trace (heat + the log)
  //
  //    Everything ELSE on contentData is just the forged file — it's the normal
  //    authored content of that type, and it's what lands in the mailbox.
  //
  //    The FORGE roll's margin → forgeQuality (hit the DV exactly = 50) →
  //    stealthDV. So a clean forge is hard for the owner's ANALYZE to catch; a
  //    botch still lands, just sloppy and detectable. Committing the roll ALWAYS
  //    installs — cancelling is the only way out.

  // ── PLANT #1 — the blackmail chatlog (the doc's headline case). Low DV: this
  //    is the one you want landing on your first try.
  await _api.addShardMessage(_item, {
    from: 'ghost@relay.onion', subject: 'affair.chat',
    contentType: 'chatlog',
    timestamp: new Date(_now - 2 * _h).toISOString(),
    contentData: {
      uploadable: true, uploadDV: 13, uploadSkill: 'Interface', uploadTraceOnFail: true,
      // ── the forgery itself ──
      app: 'NC-MSG', channel: 'direct',
      participants: [{ name: 'K. Okada' }, { name: 'T. Mizuki' }],
      messages: [
        { from: 'T. Mizuki', text: 'the board can never see the W7 numbers. you understand that.', time: '23:14', date: '2045-06-04' },
        { from: 'K. Okada', text: 'then stop signing the night manifests yourself', time: '23:16', date: '2045-06-04' },
        { from: 'T. Mizuki', text: 'i pay you to make problems go away, not to lecture me', time: '23:17', date: '2045-06-04' },
        { from: 'K. Okada', text: 'i want the same cut as last quarter. off-book. or i talk.', time: '23:19', date: '2045-06-04' },
        { from: 'T. Mizuki', text: 'done. never put this in writing again.', time: '23:22', date: '2045-06-04', seen: true, seenTime: '23:22' },
      ],
    },
  });

  // ── PLANT #2 — doctored photos. Standard DV.
  await _api.addShardMessage(_item, {
    from: 'ghost@relay.onion', subject: 'evidence.img',
    contentType: 'gallery',
    timestamp: new Date(_now - 3 * _h).toISOString(),
    contentData: {
      uploadable: true, uploadDV: 15, uploadSkill: 'Interface', uploadTraceOnFail: true,
      // ── the forgery itself ──
      title: 'Warehouse 7 — night shift', source: 'SECCAM-B2',
      images: [
        { url: 'icons/environment/settlement/building-rubble.webp', label: 'IMG_001', time: '02:44', caption: 'Unmanifested crates, bay 3' },
        { url: 'icons/environment/people/cleric-grey.webp', label: 'IMG_002', time: '02:51', caption: 'Handler signing off — badge visible', flagged: true },
        { url: 'icons/environment/settlement/wagon-black.webp', label: 'IMG_003', time: '03:02', caption: 'Same plates as the 06.14 run' },
      ],
    },
  });

  // ── PLANT #3 — a forged target file. Harder forge; stealth DV PINNED, so the
  //    owner's ANALYZE difficulty is fixed no matter how the roll went.
  await _api.addShardMessage(_item, {
    from: 'ghost@relay.onion', subject: 'SUBJECT: K. Okada',
    contentType: 'dossier',
    timestamp: new Date(_now - 4 * _h).toISOString(),
    contentData: {
      uploadable: true, uploadDV: 17, uploadSkill: 'Forgery', uploadStealthDV: 18, uploadTraceOnFail: true,
      // ── the forgery itself ──
      targetName: 'Kenji Okada', targetAlias: '"the Bookkeeper"',
      classification: 'SECRET',
      sections: [
        { heading: 'Overview', body: 'Logistics Director, NC Branch. Flagged for unauthorized contact with a Militech cutout.', redacted: false },
        { heading: 'Assessment', body: 'Recommend immediate suspension of clearance pending counter-intel review.', redacted: false },
      ],
      stats: { threat: 'MEDIUM', affiliation: 'Arasaka Logistics', lastKnownLocation: 'Corpo Plaza · Tower B' },
    },
  });

  // ── PLANT #4 — a quiet lie. High DV, NO trace: if the forge botches you get a
  //    sloppy, easily-ANALYZEd memo, but nothing goes off in the night.
  await _api.addShardMessage(_item, {
    from: 'ghost@relay.onion', subject: 'memo.doc',
    contentType: 'document',
    timestamp: new Date(_now - 5 * _h).toISOString(),
    contentData: {
      uploadable: true, uploadDV: 21, uploadSkill: 'Forgery', uploadTraceOnFail: false,
      // ── the forgery itself ──
      title: 'DIRECTIVE — Warehouse 7 audit hold', docType: 'MEMO',
      author: 'T. Mizuki', org: 'Arasaka Logistics', date: '2077-06-14', revision: '1',
      classification: 'RESTRICTED', watermark: 'ARASAKA',
      signed: 'T. Mizuki — VP Logistics',
      paragraphs: [
        { heading: 'Directive', text: 'Internal audit of Warehouse 7 outbound manifests is suspended indefinitely by order of this office.' },
        { text: 'All variance reporting for Q2 routes to me personally. Do not copy legal. Do not copy the board.' },
      ],
    },
  });

  ui.notifications.info(
    "Ghost's Go-Bag (TEST) — 4 PLANT payloads on " + _who.name + '. Open a terminal as this operator → OPERATOR TOOLS → UPLOAD.');
  console.log('NCM | test-upload-setup: shard "' + _item.name + '" (' + _item.id + ') on actor "' + _who.name + '" (' + _who.id + ') — 4 uploadable PLANT entries.');
  game.nightcity?.openDataShard?.(_item);

  /* ────────────────────────────────────────────────────────────────────────
   * WHAT TO TRY
   *
   * SETUP
   *   Run dev/tools/test-terminal-setup.macro.js first if you have no terminal.
   *   Open the terminal, log in (v_arasaka = 1234). Check the HUD OPERATOR chip
   *   is the actor named above — the picker scans THAT actor's items, so an
   *   operator holding no shard is carrying nothing.
   *
   * THE UPLOAD
   *   HUD → OPERATOR TOOLS → UPLOAD. All four forgeries list as PLANT (purple)
   *   with their FORGE DV chips. Pick one, aim TARGET at an account (or "— any
   *   login —"), and read the live delivery line: what lands, in whose mailbox,
   *   and when it fires. FORGE & UPLOAD → the COMPILING beat → the FORGE roll.
   *
   * THE MARGIN IS THE POINT
   *   Beat the DV well → high forgeQuality → high stealthDV → the owner's
   *   ANALYZE probably never catches it. Botch it → it STILL installs (a
   *   committed roll always lands), just sloppy: low quality, low stealthDV,
   *   and on the trace-armed three, a trace fires — check Admin → Security for
   *   the log row + the heat bump. Only CANCEL aborts.
   *
   * THE PAYOFF
   *   The forged file is a RESIDENT now, armed on the target account's next
   *   login. Log out, log back in as that account: the GM gets the Fire /
   *   Defuse / Later proposal, and on Fire the forgery lands in the mailbox
   *   like it was always there. Admin → Security → Planted & Resident shows it
   *   armed beforehand (with provenance + forgeQuality) — that's the GM audit
   *   view for "what's forged where, by whom".
   *
   * NOTE: the install RELAYS to the GM. As a player with no GM connected, the
   * upload refuses up front rather than eating your roll.
   * ──────────────────────────────────────────────────────────────────────── */
})();
