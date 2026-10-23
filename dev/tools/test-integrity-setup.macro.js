/**
 * NCM — SHARD INTEGRITY test-setup macro (NOT loaded by the module)
 * @file dev/tools/test-integrity-setup.macro.js
 *
 * Paste the body below into a new Foundry **Script Macro** and run it as GM.
 * It builds four shards on a carrier actor, each set up to show one part of the
 * integrity system (dev/design/SHARD-INTEGRITY.md):
 *
 *   1. "Integrity Test — Breach Me"    Data loss · 60% · ENCRYPTED at DV 30
 *        Fail breaches on it: every failure costs 15, and below 50% each entry
 *        has a 50% chance to take damage per failure. Watch it glitch harder,
 *        then burn out at 0.
 *   2. "Integrity Test — Pre-damaged"  Data loss · 30% · open
 *        Every entry already damaged at a different level — the per-type loss,
 *        the damage bars, RECONSTRUCT, money protected, an unstable program.
 *   3. "Integrity Test — Visual Only"  Visual only · 20% · Hard to read · open
 *        Pure glitching, nothing lost; REPAIR on the integrity bar.
 *   4. "Integrity Test — Bricked"      Data loss · 0%
 *        The dead screen, the integrity trace, and the one salvage attempt.
 *
 * PREREQS
 *   · A carrier actor: select a token, assign yourself a character, or have a
 *     player-owned actor. The shards go in ITS inventory, so a player who owns
 *     it can open them from the sheet / their Agent's SHARDS tab.
 *   · For rolls (breach, reconstruct, salvage) the operator needs Interface and
 *     Electronics/Security Tech — zero ranks still work, they just fail more.
 *   · For the player-side test a GM must be CONNECTED: every integrity write
 *     relays to the GM.
 *
 * Re-running is safe: it deletes the previous test shards (and their journals)
 * first, so every run starts from the same state.
 */

(async () => {
  if (!game.user.isGM) return ui.notifications.warn('GM only.');
  const MODULE_ID = 'night-city-messenger';
  const ds = game.nightcity?.dataShardService;
  if (!ds?.getIntegrityConfig) return ui.notifications.error('This NCM build has no integrity rework — update the module first.');

  // 1) WHO carries the shards.
  const _who = canvas?.tokens?.controlled?.[0]?.actor
    ?? game.user.character
    ?? game.actors.find(a => a.hasPlayerOwner && a.isOwner)
    ?? null;
  if (!_who) return ui.notifications.error('No carrier actor. Select a token, assign yourself a character, or make a player-owned actor.');

  // 2) Clear the last run.
  const TAG = 'integrityTest';
  for (const it of _who.items.filter(i => i.getFlag(MODULE_ID, TAG))) {
    try { await ds.removeDataShard(it, true); } catch { /* not a shard any more */ }
    await it.delete();
  }

  const { BUILTIN_EXAMPLES } = await import(`/modules/${MODULE_ID}/scripts/ui/content/EntryTemplates.js`);
  const _type = (game.documentTypes.Item || []).filter(t => t !== 'base').includes('gear')
    ? 'gear' : ((game.documentTypes.Item || []).filter(t => t !== 'base')[0] || 'gear');

  /** One example entry, with the locks lifted so the DAMAGE is what you see. */
  const entryOf = (t) => {
    const e = foundry.utils.deepClone(BUILTIN_EXAMPLES[t]);
    const cd = e.contentData || {};
    if (t === 'gallery') cd.images.forEach(im => { im.locked = false; });
    if (t === 'calendar') cd.events.forEach(ev => { ev.locked = false; });
    if (t === 'dossier') { cd.faceLocked = false; cd.declassify = false; if (cd.profile) cd.profile.enabled = false; }
    if (t === 'document') cd.declassify = false;
    if (t === 'location') cd.locked = false;
    if (t === 'schematic') cd.annotations.forEach(a => { a.locked = false; });
    if (t === 'credentials') cd.entries.forEach(c => { c.encrypted = false; });
    return { ...e, timestamp: new Date().toISOString() };
  };

  /** Make one shard: item → convert with an integrity block → entries → damage. */
  const makeShard = async ({ name, img, integrity, security = {}, types, levels = {} }) => {
    const [item] = await _who.createEmbeddedDocuments('Item', [{
      name, type: _type, img, flags: { [MODULE_ID]: { [TAG]: true } },
    }]);
    const res = await ds.convertToDataShard(item, {
      shardName: name, preset: 'blank',
      encrypted: false, ...security,
      integrity: { enabled: true, maxIntegrity: 100, currentIntegrity: 100, ...integrity },
    });
    if (!res.success) throw new Error(`${name}: ${res.error}`);
    const live = _who.items.get(item.id);
    for (const t of types) {
      const r = await ds.addMessage(live, entryOf(t));
      if (r.success && levels[t] != null) await ds.setEntryCorruption(live, r.messageId, levels[t]);
    }
    return live;
  };

  const CHIP = 'systems/cyberpunk-red-core/icons/compendium/gear/memory_chip.svg';
  const ALL = ['spreadsheet', 'chatlog', 'gallery', 'document', 'syslog', 'record', 'calendar', 'credentials', 'eddies', 'banking', 'payload', 'note'];

  try {
    await makeShard({
      name: 'Integrity Test — Breach Me', img: CHIP,
      integrity: { mode: 'mechanical', currentIntegrity: 60, degradePerFailure: 15, corruptionThreshold: 50, corruptionChance: 0.5, legibility: 'rough' },
      // A DV no one makes, and no lockout — so you can fail as often as you like.
      security: { encrypted: true, encryptionType: 'ICE', encryptionDC: 30, failureMode: 'nothing', maxHackAttempts: 99, allowedSkills: ['Interface'] },
      types: ['spreadsheet', 'chatlog', 'gallery', 'document', 'syslog', 'eddies', 'payload'],
    });

    await makeShard({
      name: 'Integrity Test — Pre-damaged', img: CHIP,
      integrity: { mode: 'mechanical', currentIntegrity: 30, corruptionThreshold: 50, legibility: 'rough', hideLost: false },
      types: ALL,
      levels: { spreadsheet: 0.5, chatlog: 0.25, gallery: 0.75, document: 1, syslog: 0.5, record: 0.5, calendar: 0.25,
        credentials: 0.75, eddies: 0.75, banking: 0.5, payload: 0.5, note: 0.5 },
    });

    await makeShard({
      name: 'Integrity Test — Visual Only', img: CHIP,
      integrity: { mode: 'cosmetic', currentIntegrity: 20, legibility: 'hard', repairPts: 15 },
      types: ['document', 'chatlog', 'syslog', 'note'],
    });

    await makeShard({
      name: 'Integrity Test — Bricked', img: CHIP,
      integrity: { mode: 'mechanical', currentIntegrity: 0, history: [100, 85, 70, 55, 40, 25, 10, 0],
        lastHit: { by: _who.name, at: new Date().toISOString() }, dead: { list: 'list', salvage: true, salvageDV: 22, salvagePct: 20 } },
      types: ['spreadsheet', 'chatlog', 'document', 'eddies'],
    });
  } catch (err) {
    console.error(err);
    return ui.notifications.error(`NCM | Integrity test setup failed: ${err.message}`);
  }

  ui.notifications.info(`NCM | Four integrity test shards are on ${_who.name}. Open them from the actor sheet or Admin → Shards.`);
  console.log(`NCM | test-integrity-setup: carrier "${_who.name}" (${_who.id})`);

  /* ────────────────────────────────────────────────────────────────────────
   * WHAT TO TRY
   *
   * BREACH ME (the bug the testers hit)
   *   Open it and fail the breach (DV 30). Each failure: integrity −15, a jolt,
   *   and a toast when it crosses into a worse state. Above 50% it only GLITCHES;
   *   below 50% entries start losing parts. At 0 the entries burn out one by
   *   one and the dead screen draws in.
   *   → Do this AS A PLAYER on a second client. That's the path that used to
   *     fail silently; it should now land through the GM.
   *
   * PRE-DAMAGED
   *   Every type at a different damage level. Look for:
   *   · spreadsheet #ERR! cells · chat "packet lost" · gallery NO SIGNAL
   *   · the document fully LOST (Reconstruct DV 21) · "Funds intact" on the
   *     cred drop and the bank · "Unstable program" on BREACH.EXE (run it: +2 DV,
   *     25% misfire)
   *   · RECONSTRUCT an entry: success gives back a quarter, failure makes it worse
   *   · as GM: "Show original" on any damaged entry; the % on each bar
   *   · hover a card: the glitch holds still (no roll)
   *
   * VISUAL ONLY
   *   Critical + Hard to read: barely legible, but nothing is lost — copy a
   *   garbled line and paste it somewhere: you get the real text. REPAIR on the
   *   integrity bar restores 15.
   *
   * BRICKED
   *   The dead screen: cracked chip, the integrity trace, what was on it (names
   *   scrambled for players). As a player: one Attempt Salvage (DV 22) — success
   *   brings it back at 20% with everything badly damaged; failure is final for
   *   that character. As GM: Restore shard.
   *
   * THE GM TOOLS
   *   · Configure Shard → Systems → Integrity: every option, live.
   *   · Admin → Shards → expand a test shard: the Damage button (+ "roll data
   *     loss"), the Entry damage list (click pips to set damage, wrench to
   *     repair), Repair all, and the 100/75/50/25/0 presets.
   *   · Macro: the GM pack's "Damage Selected Shard", or
   *     game.nightcity.messenger.damageShard(item, 15)
   *   · Admin → Security → Activity Log: reconstruct / repair / salvage
   *     successes are recorded there.
   *
   * ENCODER (hardened blanks)
   *   Admin → Shards → Player Authoring → Blanks: each tier now has
   *   "Tracks integrity" and "Hardened %". Premium defaults to 40% less damage.
   * ──────────────────────────────────────────────────────────────────────── */
})();
