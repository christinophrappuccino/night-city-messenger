# Shard Integrity — rework plan

Status: **BUILT 2026-10-18 (all phases + items 1–8), sim + headless-verified, NOT live-tested in Foundry.** See **As built** at the end.
Mocks (open through `node dev/tools/serve-mockups.cjs`):
- `dev/mockups/shard-integrity-mock.html` — GM config + the shard viewer, live. Real content types, real `enrichContent` + `content-body.hbs`, real `runSecurityConsole`.
- `dev/mockups/admin-shard-damage-mock.html` — Admin → Shards expanded row, rendered from the real `tab-shards.hbs`, with the new damage controls spliced in.

## Why (tester report, Discord 2026-10-17)

"Nothing I do ever makes the entries corrupted or look different" / "it fails at the threshold but no visual changes before that." Three causes:

1. **Cosmetic mode was never built.** `checkIntegrity()` computes a tier; only the bar's colour reads it. The config text promises scanlines and garbled text that don't exist.
2. **Mechanical corruption silently fails for players.** `degradeIntegrity()` runs on the rolling client. The item write lands (a player owns their shard) so bricking works, but `page.update()` on the GM-owned journal throws and is swallowed by the `.catch`. Solo-GM testing hides it.
3. **Corruption is all-or-nothing.** A corrupted entry is replaced wholesale by "DATA CORRUPTED", whatever its type — the system predates the 18 content types and never learned what "partly damaged" means for each.

Smaller bugs found alongside: saving the config resets `currentIntegrity` to max (`ItemInboxConfig.js` — fully heals the shard); `parseInt(x) || 40` / `|| 30` make 0 unsavable for threshold and chance; the threshold compares raw points to a percent (wrong when Max ≠ 100); "hide them entirely" is promised but unbuilt; nothing happens on screen when integrity drops.

## Decisions (dev, 2026-10-18)

- Cosmetic legibility is **configurable**, up to properly hard to read.
- Money protection and glitchy-not-destroyed programs: **yes, both configurable**.
- Recovery rolls ship **in this round**.
- Items 1–8 below are all in scope.

## The model

**Tiers** (unchanged): clean ≥75 · light 50–74 · heavy 25–49 · severe 1–24 · bricked 0. Shown as a state word on the bar: Degraded / Unstable / Critical.

**Per-entry damage is ONE number**: a page flag `corruption` (0–1, quarter steps). A failed breach below the threshold raises it (per-entry chance); RECONSTRUCT lowers it. Which units are lost is **derived, never stored**: every unit has a fixed seeded threshold (`rng(entryId:unitKey)`), and a unit is lost when its threshold < level. So damage only ever grows over the same set, reconstruct gives back the most-recently-lost first, and the garble never crawls between renders. The legacy boolean `corrupted: true` reads as `corruption: 1`.

**Pure logic goes in a new `scripts/ui/content/IntegrityModel.js`** (no Foundry globals → sim-testable): `rng`, `tierOf`, `garbleRate`, `isUnitLost`, `applyLoss(entry, level, cfg)`, `reconDV`, config sanitiser.

## Config (`config.integrity`, all GM-editable in Configure Shard → Systems)

| key | default | notes |
|---|---|---|
| enabled, mode (`cosmetic`/`mechanical`), maxIntegrity, degradePerFailure | existing | |
| corruptionThreshold, corruptionChance | 40 / 0.3 | **now 0-safe** |
| legibility | `rough` | `readable` / `rough` / `hard` → garble rates per tier (readable 2/5/9%, rough 4/12/22%, hard 7/24/45%) |
| effects `{scan, tear, garble, steady}` | all on | steady = hovering an entry holds it still (no roll) |
| loss | `parts` | `parts` (per-type units) / `whole` (old behaviour) |
| hideLost | false | fully lost entries drop out for players; GM sees them tagged |
| protectMoney | true | eddies/banking: visuals only, eb never lost (memo text may be) |
| programsGlitchy, glitchDV, misfire | true / 2 / 25 | payload/malware become unstable instead of destroyed |
| recon `{enabled, skill, dv, perStep, step, worsen}` | on / Electronics/Security Tech / 13 / +2 per 25% / 25% / on | |
| repairPts | 15 | cosmetic mode: the roll repairs integrity instead |
| dead `{list, salvage, salvageDV, salvagePct}` | `list` / on / 22 / 20 | what players see at 0, one salvage attempt each |

Existing shards: absent keys resolve to defaults — no migration.

## Scope

### Phase 1 — make it visible
- Stamp `data-integrity-tier` / `-legibility` / effect switches on `.ncm-item-inbox`. CSS layers on the shared entry card so **all 18 types** get them: scanlines + flicker (light+), tearing + colour fringe + seeded static blocks (heavy+), jitter (severe).
- **Cosmetic garble is paint-over**: the real character stays in the DOM (`-webkit-text-fill-color: transparent` + a `::before` glyph), so copy/paste and screen readers get the truth. Seeded by entry id. Skips buttons/actions.
- Hit effect + toast when integrity drops a tier (#3).
- Reduced motion: garble stays, motion goes.
- Bug fixes above; honest config copy.

### Phase 2 — mechanical, per type
- `applyLoss` runs **before `enrichContent`** so lost data never reaches a player's DOM (the locked-content rule). Units: spreadsheet cells → `#ERR!` · chat messages → "packet lost" · gallery frames → NO SIGNAL · syslog lines · document paragraphs/list items · record fields · calendar events · credentials · dossier sections · avlog transcript lines · schematic markers · banking ledger memos · message/note/location → data-level text garble. Level 1 → whole-entry lost.
- Each type gets a real "lost" branch in `content-body.hbs` (the mock writes `▒▒▒` strings into the data as a stand-in). **Order:** spreadsheet, chatlog, gallery, document, syslog, record first; the rest fall back to text garble until done.
- Damage bar under the entry header: meter, "N of M ⟨units⟩ unreadable", RECONSTRUCT, GM "Show original".
- Money/program exceptions per config. Hide-lost per config.
- **Writes relay to the GM** (`SOCKET_OPS` request, the standing player-write rule); no GM online → warn, never silently drop.

### Phase 3 — recovery
- RECONSTRUCT per entry via `runSecurityConsole` (DV = base + perStep × quarters damaged); success lowers the level by `step`, failure optionally raises it.
- Cosmetic mode: REPAIR on the integrity bar restores `repairPts`.
- **The bricked screen** replaces `.ncm-shard-destroyed`: cracked-chip hero, stats (integrity, entries lost, failed breaches, last breach), an integrity trace (one step per breach, then flatline — needs a small `integrity.history` array), the "what was on it" list (names scrambled for players, per `dead.list`), GM Restore, one player salvage attempt (comes back at `salvagePct`, entries heavily damaged). A death sequence plays when a breach takes it to 0.
- Reconstruct / repair / salvage log through `TraceService.logSuccess` / `fireTrace` (#4).

### The extra items
1. **Damage travels with copies** — `corruption` carried through `TerminalService._buildMessageFlags`, `MessageRepository.createMessage` + `_pageToMessage`, `DataShardService.addMessage` + `_pageToShardMessage`, and the edit-prefill openers. Exfil must not be a free repair.
2. **Garble cap** — sample large entries (e.g. ≤ 2,000 garbled chars, or visible rows only) so a 500-row spreadsheet stays fast.
3. **Tier toast** — on crossing into a worse tier.
4. **Activity Log** — recovery rolls report through the trace funnel.
5. **Defaults** — Rough + steady-on-hover for new shards.
6. **Hardened blanks** — Encoder tiers gain `hardening` (% less lost per breach; default Scrap 0 / Standard 0 / Premium 40), sanitised in `EncoderModel.js` the way `capacity` is, a field on the tier card, stamped onto the shard at encode. Shown as a "Hardened −40%" tag in Admin → Shards. Open question: whether a tier can also switch integrity ON for the shard it makes (integrity is off by default).
7. **GM Damage control** — Admin → Shards expanded row: Damage button + pts field + "roll data loss" toggle (`degradeIntegrity(item, {amount, rollLoss})`); MacroAPI `damageShard(item, amount)` + a GM pack macro (regen via `gen-macros.cjs`).
8. **Per-entry damage list** — same expanded row: one line per entry with a clickable 4-pip meter, %, units lost / Funds protected / Unstable / Entry lost + Hidden tags, Repair and "view as player". Repair-all in the header. GM writes directly. Depends on Phase 2's stored level.

## Verification plan

- `dev/tools/sims/test-integrity.mjs` — tiers, garble rates, seeded determinism, monotonic loss (raise ⊇ lower), reconstruct ordering, each type's `applyLoss` against the real `BUILTIN_EXAMPLES` through the real `enrichContent` + partial with **leak assertions** (lost values absent from the DOM), money/program exceptions, config sanitiser 0-safety, the four persistence builders carry `corruption`.
- Phase 6 suite gains an integrity block.
- Headless renders of the real viewer per tier/legibility; admin preview for the new row.
- Two-client live test: player fails a breach on a GM-owned shard → corruption lands via the relay.

## As built (2026-10-18)

Files: `scripts/ui/content/IntegrityModel.js` (pure rules) · `scripts/ui/content/IntegrityFX.js` (DOM paint) · `styles/components/shard-integrity.css` · DataShardService's integrity block · ItemInboxApp (`_enrichWithIntegrity` / `_integrityContext` / `_renderIntegrity` + 5 actions) · item-inbox.hbs · ItemInboxConfig (`_collectIntegrity` / `_wireIntegrity`) + item-inbox-config.hbs · ShardsTab + tab-shards.hbs/css · EncoderModel / EncoderConfigApp / ShardEncoderApp tiers · SiphonFlow (`unstable`) · ProgramDeck · TerminalViewerApp upload · MacroAPI `damageShard` + GM macro "Damage Selected Shard" · `SOCKET_OPS.SHARD_INTEGRITY_REQUEST` · Phase 6 check 6.16.

Verification: `node dev/tools/sims/test-integrity.mjs` (40 checks — config, tiers, seeded garble, monotonic loss, every built-in type at every level, money/program exceptions, the REAL service on a mocked shard including write ORDER and the player relay, leak assertions through the REAL content-body.hbs, the REAL item-inbox.hbs, wiring). Visual: `dev/mockups/shard-integrity-probe.html` imports the REAL ItemInboxApp + DataShardService and renders the real templates; `admin-shard-damage-mock.html?real=1` renders the real Shards-tab template with the new data.

Two deliberate deviations from the plan above:
- **Lost units use a marker, not 18 per-type template branches.** `applyLoss` rewrites each lost unit in the DATA to a `▒▒▒ … ▒▒▒` line (or `#ERR!` / NO SIGNAL / a "packet lost" system notice where the type already had that state), and `IntegrityFX` styles any text carrying it. Every type works today, the data is still genuinely gone before render, and there is no per-type branch to drift. A type can still get a bespoke lost look later without touching the model.
- **Item 1 (damage travels with copies) is handled at the exit, not in the four builders.** Terminal entries never carry integrity, so the only path that copies a shard entry elsewhere is UPLOAD. `DataShardService.exportEntry` bakes the loss into the copy (and refuses a fully lost entry), and the upload gatherer calls it. Programs run from the shard viewer or the Program Deck read `programInstability`.

Encoder tiers gained `integrity` (shards made on this blank track integrity; default off everywhere) and `hardening` (Scrap 0 / Standard 0 / Premium 40; an older world's stored tiers take the default for their id). The open question was answered yes — a per-tier checkbox.

**Index strip (added same day, dev ask).** The chips used to print each entry's stored subject, so a heavily damaged entry's real title showed in the strip while its card was garbled, and a lost entry kept its name. Chips now read the enriched entry (same garbled title as the card; "Sector lost" for a lost one), carry a 4-segment damage bar (red; amber for an unstable program; none for protected money), and show the GM the exact % on hover. From Unstable down, chip titles get the cosmetic paint-over garble at half the body rate.
