/**
 * NCM — SHARD ENCODER test-setup macro (NOT loaded by the module)
 * @file tools/test-encoder-setup.macro.js
 *
 * Paste the body below into a new Foundry **Script Macro** and run it as GM.
 * It puts everything the Shard Encoder needs in front of you in one click:
 *
 *   1. Switches player authoring ON (world setting `encoderConfig.enabled`).
 *   2. Creates three BLANKS on a carrier actor — one per tier — and registers
 *      each by name in the matching tier's item list, so the tier chips and the
 *      "on a botch" lines have something real to resolve against.
 *   3. Leaves the rest of the config at its shipped defaults (11 content types
 *      on, Propose pricing, both program families, lock allowed).
 *
 * The blanks it makes:
 *   · Blank Data Shard        → STANDARD · 50 eb  · a botch BRICKS it
 *   · Militech Hardened Shard → PREMIUM  · 200 eb · a botch only WIPES it, +1 craft
 *   · Braindance wafer        → SCRAP    · free   · a botch bricks it + trace
 *
 * PREREQS
 *   · A carrier actor: select a token, or assign yourself a character, or have
 *     any player-owned actor. The Encoder reads the OPERATOR's own items, so a
 *     world item is invisible to it.
 *   · The carrier needs SKILLS to roll: Forgery (content), Interface (programs),
 *     Cryptography (the lock ceiling), Electronics/Security Tech (lock hardware).
 *     A character with none of those still works — you'll just see honest 0% odds.
 *   · For a real player-side test, a GM must be CONNECTED: every write relays.
 *
 * Delete the test items when done. Re-running is safe (it reuses by name).
 */

(async () => {
  if (!game.user.isGM) return ui.notifications.warn('GM only.');
  const MODULE_ID = 'night-city-messenger';

  // 1) WHO carries the blanks. The Encoder scans the OPERATOR actor's own items.
  const _who = canvas?.tokens?.controlled?.[0]?.actor
    ?? game.user.character
    ?? game.actors.find(a => a.hasPlayerOwner && a.isOwner)
    ?? null;
  if (!_who) {
    return ui.notifications.error(
      'No carrier actor. Select a token, assign yourself a character, or make a player-owned actor first.');
  }

  // 2) The blanks — ordinary items, nothing converted. The Encoder converts one
  //    only when an encode actually succeeds.
  const _type = (game.documentTypes.Item || []).filter(t => t !== 'base').includes('gear')
    ? 'gear'
    : ((game.documentTypes.Item || []).filter(t => t !== 'base')[0] || 'gear');

  const _blanks = [
    { name: 'Blank Data Shard', tier: 'standard', img: 'icons/commodities/tech/blade-tool-green.webp' },
    { name: 'Militech Hardened Shard', tier: 'premium', img: 'icons/commodities/tech/tube-chip-gold.webp' },
    { name: 'Braindance wafer', tier: 'scrap', img: 'icons/commodities/tech/cog-steel.webp' },
  ];

  const _toMake = _blanks.filter(b => !_who.items.find(i => i.name === b.name));
  if (_toMake.length) {
    await _who.createEmbeddedDocuments('Item', _toMake.map(b => ({ name: b.name, type: _type, img: b.img })));
  }

  // 3) Switch authoring on, and register the blanks in their tiers by NAME
  //    (tier membership is by item name, so every copy in the world counts).
  const _stored = foundry.utils.deepClone(game.settings.get(MODULE_ID, 'encoderConfig') || {});
  const _tiers = _stored.tiers || [
    { id: 'scrap', name: 'Scrap', color: 'muted', price: 0, buyable: false, fallback: true, onRejected: 'bricked', onNat1: 'bricked-trace', perk: '', items: [] },
    { id: 'standard', name: 'Standard', color: 'cyan', price: 50, buyable: true, fallback: false, onRejected: 'bricked', onNat1: 'bricked-trace', perk: '', items: [] },
    { id: 'premium', name: 'Premium', color: 'gold', price: 200, buyable: true, fallback: false, onRejected: 'survives', onNat1: 'bricked', perk: 'craft+1', items: [] },
  ];
  for (const b of _blanks) {
    const t = _tiers.find(x => x.id === b.tier);
    if (!t) continue;
    t.items = t.items || [];
    if (!t.items.some(i => i.name === b.name)) {
      t.items.push({ name: b.name, img: _blanks.find(x => x.name === b.name).img });
    }
  }
  await game.settings.set(MODULE_ID, 'encoderConfig', { ..._stored, enabled: true, tiers: _tiers });

  // 4) Repaint anything that reads the setting (the item doors, the Agent pill).
  ui.items?.render();
  for (const w of Object.values(ui.windows)) if (w.actor || w.id === 'ncm-message-viewer') w.render(false);

  const _wealth = _who.system?.wealth?.value ?? 0;
  ui.notifications.info(
    'Shard Encoder ON. Three blanks on ' + _who.name + ' (' + _wealth + ' eb). Open their Agent → SHARDS → Encode new.');
  console.log('NCM | test-encoder-setup: carrier "' + _who.name + '" (' + _who.id + ')');
  console.table(_blanks.map(b => ({
    blank: b.name,
    tier: b.tier,
    onBotch: _tiers.find(t => t.id === b.tier)?.onRejected,
  })));

  /* ────────────────────────────────────────────────────────────────────────
   * WHAT TO TRY
   *
   * THE THREE DOORS (all three open the same window)
   *   · The Agent → SHARDS tab → the "Encode new" pill at the right of the
   *     filter track. This is the primary door.
   *   · Right-click one of the blanks in the actor's inventory → "Encode to
   *     Data Shard" (it reads "Convert to Data Shard" for a GM).
   *   · Program Deck on a shard that holds programs → the dashed NEW cartridge.
   *
   * A FORGERY (the content branch)
   *   Blank → pick "Blank Data Shard" → name it → Next.
   *   Content → pick Document. Watch the odds chip on every tile: it is that
   *   character's real chance with their real Forgery rank. Pick the other
   *   craft skill to see the DV rise and the odds fall.
   *   "Write the contents" opens the REAL composer in player mode — no security
   *   section, no template library. Write something and Save; it comes back to
   *   the Encoder instead of being written anywhere.
   *   Lock (optional) → roll Cryptography to see the ceiling, or skip it.
   *   Encode → one roll. Clean, sloppy or rejected.
   *
   * WHAT TO WATCH FOR
   *   · A CLEAN forgery: the blank becomes a shard in the actor's gear, and the
   *     Market card offers a price. Propose it and answer your own prompt.
   *   · A SLOPPY one: it still writes, tagged FORGED, with a scan DV of 8 — open
   *     it later and ANALYZE should catch it easily.
   *   · A REJECTED one: nothing is written. A Standard blank is renamed
   *     "(bricked)" and never offered as a blank again. Try it again on the
   *     Militech blank: that one SURVIVES a rejection, so you can retry on it.
   *   · A no-roll type (Message, Note, Eddies): no die, no ladder, no risk.
   *
   * A PROGRAM (the program branch)
   *   On the Content stage, pick the Payload or Malware tile — it switches to
   *   the Program branch. Ability chips grey out below the Interface rank the
   *   GM set (scanner 0 · keylog 4 · backdoor 7). The manifest names it.
   *
   * ACCESSIBILITY
   *   The DISPLAY button, bottom right. Text size multiplies the Agent's own
   *   text size; contrast is the same tone-map as the Theme Customizer; motion
   *   can only be lowered. Try "Maximum" mid-encode and watch the animation stop.
   *
   * THE GM SIDE
   *   Admin Panel → Shards → Player Authoring. Turn types off, retune a DV,
   *   add a tier, rename a blank's tier, or switch pricing to Free and watch
   *   the Market card change. Nothing saves until you press Save.
   *
   * THE TWO-CLIENT TEST (the one that matters)
   *   Log a player in on a second client as the carrier actor. Every write
   *   relays through the GM: the conversion, the entry, the price. With the GM
   *   disconnected the Encoder should REFUSE before the roll, not after it.
   * ──────────────────────────────────────────────────────────────────────── */
})();
