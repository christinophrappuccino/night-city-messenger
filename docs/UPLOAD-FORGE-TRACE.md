# Upload / Forge · Program Model · Trace Overhaul — Design

**Status:** design, not built. Supersedes backlog items #4 (Upload/Forge) and #5 (Trace teeth + log) in the terminal-expansion plan. Companion mock: `docs/mockups/eddies-and-upload-mock.html`.

This doc covers three interlocking arcs designed together on purpose, because they share one spine:

1. **The program model** — unifying `payload` + `malware` (+ future program types) over one effect engine, and drawing the hard line between them.
2. **Upload / Forge** — the missing player→machine direction (PLANT + EXECUTE), which is mostly *composition* of what exists once the program model is clean.
3. **The trace overhaul** — a single `fireTrace`, a durable log, and per-target **heat** with GM-gated escalation, so failure finally has teeth.

---

## 0 · The one-sentence frame

**Exfil and Upload are mirror verbs.** Exfil is the payload-era move — *take data off a machine*. Upload is the malware-era move — *put an attack on a machine*. Everything below hangs off that symmetry: same transport (a carried container), same skill gate (a roll vs the box's security), same relay (GM-owned writes, players relay), same consequence spine (trace + heat).

---

## 1 · The program model

A **program** is an executable artifact with an *effect*. Today `payload` (mature: real effect engine) and `malware` (a stub — deploy→GM-adjudicate + honeypot trap) are two content types that overlap ~80%. We keep them as distinct **skins** (the biohazard vs signed-utility identity is worth preserving, catalog stays at 18, and more program types may come) but unify the machinery beneath:

```
program = {
  effect:      { type, params, lifecycle },              // the SHARED engine — both skins use it
  disposition: 'utility' | 'hostile',                    // flavor + default trace weight
  trap:        { honeypot, gate, iceActorId, disguise }, // orthogonal booby-trap layer
  provenance:  { author, plantedBy, plantedAt, forgeQuality, host }, // GM audit — NEW
}
```

Three concepts kept deliberately separate so they never tangle again:

- **Effect** = the enforceable verb. One registry (`SiphonFlow._applyNativeEffect` grows), one applier (`applyPayloadEffect`), GM-owned writes, players relay via `PAYLOAD_EFFECT_REQUEST`. This already exists; we extend it.
- **Black ICE** = **not a program.** It's the defensive CPR actor an effect *deploys* or a trap *wakes*. **Malware delivers; ICE is the teeth.** Keep the split — malware never deals damage itself, it references an ICE actor (today via `trap.iceActorId`, tomorrow also via `effect: deployICE`).
- **Trap** = orthogonal. *Any* found program can be a honeypot / ICE-guarded / disguised, regardless of its effect. This is malware's "obstacle" life (GM plants it, player finds it). Countered by **ANALYZE**.

### 1a · The line between MALWARE and PAYLOAD

Now that they share an engine, the distinction is a **fiction rule**, not a code difference. It decides the skin, the default trace posture, and which effect verbs are legal.

- **PAYLOAD = a TOOL. It empowers the operator.** Effects make *you* more capable against a system — open sealed files, clear your own lockout, scan, decrypt-assist, jam-to-cover-your-exit. Signed/authorized framing. Low/no inherent trace: it's what you carry to do the job.
- **MALWARE = a WEAPON. It harms the system, its owner, or the next intruder.** Effects damage / subvert / booby-trap — wipe their logs, plant false evidence, forge a backdoor, arm ICE, drop a logic bomb. Running it **is** an attack: inherently trace-generating.

**The test:** *"Does it make me more capable (payload), or does it attack the target (malware)?"*

That test also assigns the verb tables (§2). A few verbs are genuinely dual-use (`jammer` = cover vs sabotage; `scanner` = recon either way) — they may exist on both skins, and **disposition** decides the skin + trace weight, not the code. `disguise` crosses freely (malware masked as a note; payload masked as an eddies drop).

**Extensibility:** a future program type declares itself tool-side or weapon-side and inherits the right verb set + trace posture — the model generalizes past two types.

---

## 2 · Effect engine — verbs & the enforceability discipline

**The payload lesson, kept:** every effect is either **truly module-native** (it changes real game state) or it honestly degrades to `adjudicate` (a GM alert). No fake buttons.

Current registry (`_applyNativeEffect`, applied GM-side): `icebreaker` · `skeletonKey` · `scanner` · `jammer` · `adjudicate` (default). We grow it:

**Payload (tool) verbs**
| verb | native action | lifecycle |
|---|---|---|
| `icebreaker` | unseal sibling typed entries in the host journal | instant ✅ |
| `skeletonKey` | clear the host's SecurityService lockouts | instant ✅ |
| `scanner` | report hidden/off-net accounts or sealed files | instant ✅ |
| `jammer` | drop the host uplink → LOCAL ONLY | timed ✅ |
| `decryptAssist` | one-shot unlock of a chosen sealed entry | instant |

**Malware (weapon) verbs**
| verb | native action | lifecycle |
|---|---|---|
| `wipe` | soft-purge host entries to the GM recycle bin (§4g) | instant |
| `plant` | write a forged typed entry to a mailbox (the PLANT family) | triggered |
| `forgeAccount` | write a hidden backdoor `TERMINAL_ACCOUNT` | triggered |
| `keylog` | capture the next login / password, report to GM | triggered |
| `deployICE` | arm linked Black ICE for the next intruder | triggered |
| `logicBomb` | run any inner effect on a trigger (date/login/action) | triggered |
| `corrupt` | flag entries corrupted / redact-in-place | instant |
| `adjudicate` | honest fallback — GM alert, no state change | — |

Malware gains this whole table (this **kills the deploy→adjudicate stub**); payload keeps its utility subset. Same run path (`runProgram`, generalizing `runPayloadExecute`/`runMalwareDeploy`), same GM/relay split, same reaper.

---

## 3 · Effect lifecycle — the new primitive

Today effects are **instant** or **timed-then-revert**. We add a third, which is the heart of both malware-as-weapon and the blackmail on-ramp:

- **instant** — fires now (icebreaker, wipe, scan). ✅
- **timed** — fires now, reverts at expiry (jammer). ✅
- **triggered / resident** — **installed now, fires on a trigger later** (next login, a date, a specific user/action). ← NEW

Keylogger, logic bomb, backdoor account, and planted blackmail content ("the next login finds it" — the mock's third box) are all the *same* lifecycle: a resident artifact stamped with provenance that resolves on a hook.

### 3a · Resident spec

On a successful run/upload, a triggered effect **installs a resident record on the host and arms a trigger.** The effect applies only when the trigger fires.

**Host state** — `state.residents[]` on the terminal item flag:
```
{
  id,
  effectType,        // 'plant' | 'keylog' | 'forgeAccount' | 'logicBomb' | 'deployICE' | ...
  params,            // effect payload  (plant: the typed entry to write; keylog: capture buffer)
  trigger: {
    kind: 'onLogin' | 'onDate' | 'onAction' | 'onHeat' | 'manual',
    // onLogin:  { accountId?, actorId? }   (any login if both omitted)
    // onDate:   { atMs }                    (GAME time, via the time provider)
    // onAction: { action: 'siphon'|'exfil'|'login'|... }
    // onHeat:   { threshold }
  },
  provenance: { plantedBy, plantedAt, forgeQuality, sourceLabel },
  stealthDV,         // ANALYZE DV to detect it
  state: 'armed' | 'fired' | 'defused',
  firedAt,
}
```

**Trigger hook points** (all GM-side — players relay only the *arming* via the upload roll; firing is host-state, always GM-owned):
- `onLogin` → `TerminalService` login-success (`_loginSuccess` / `_updateSession`): on session establish, scan residents for matching triggers.
- `onDate` → extend the payload reaper's 60s poll (already exists via `reapExpiredPayloads`); honors the paused clock through the time provider.
- `onAction` → the siphon / exfil / login flows check residents.
- `onHeat` → checked inside `fireTrace` when heat bumps (§6).
- `manual` → GM fires from the Security tab (§7).

**Firing** = `fireResident(host, resident)` → runs the effect through the shared engine, marks `fired`, writes to the trace/security log, alerts the GM. **GM-gated (per decision #4):** a trigger match *proposes* to the GM (a **Fire / Defuse / Later** Dialog) — it never auto-applies. "Later" **snoozes** the resident (~10 game-min) so the 60s onDate reaper / a re-login doesn't re-prompt. A concurrency guard + post-Dialog re-check stop two triggers stacking two Dialogs or firing a resident already resolved elsewhere.

**Detect / remove** — this is a **host scan**, distinct from file-scoped ANALYZE (`runAnalyze` scans one file for a disguise; residents aren't files). A viewer **SYSTEM SWEEP** action rolls vs the resident's `stealthDV`; success surfaces it (GM sees `provenance`, player just learns "something's installed") and offers **Defuse** (`state:'defused'`). It's a new viewer affordance → **mock-first** per the visual-code rule. The GM can already Defuse from the fire proposal (and, later, the Admin Security tab). Closes the plant→detect→clean loop.

**SWEEP — BUILT 2026-07-24** (`scripts/ui/content/SystemSweep.js` + `styles/components/system-sweep.css`, wired into `TerminalViewerApp`'s OPERATOR-TOOLS dropdown as `terminalSystemSweep` → `_onSystemSweep`; defuse relays through `TERMINAL_RESIDENT_REQUEST {op:'defuse'}`). Mock approved (`docs/mockups/system-sweep-mock.html`) then lifted to the real component; the real CSS was headless-verified through the full import chain (cyan resolves from content-types.css `[data-ct-color]`). A cyan FUI-family modal (SecurityConsole/UploadConsole sibling — corner brackets · topbar · scanline film · a rotating radar wedge scan beat; distinct from upload's offensive purple because SWEEP is *defensive recon*). The model the mock encodes for the real `SystemSweep.js`:
- **ONE sweep roll** (the operator's skill, default Interface / configurable `sweepSkill`·`sweepDV`) → reveal **every armed resident whose `stealthDV ≤ roll total`**. A well-hidden plant (high forgeQuality → high stealthDV) survives a mediocre sweep; the verdict is "SWEEP CLEAN" or "N FOUND" and **never says how many you missed** (honest ambiguity).
- **Information split by role:** GM sees the real type (PLANTED FILE / KEYLOGGER / BLACK ICE / BACKDOOR / LOGIC BOMB), `provenance.plantedBy`, `stealthDV`, and a **forgery tell** derived from `forgeQuality` (SLOPPY < ~45 else WELL-MADE). A player sees only **"UNKNOWN PROCESS"** + a vague per-type hint ("a trap is primed"), no type/DV/provenance.
- **Per-resident DEFUSE** → `updateResident(state:'defused')` (GM direct / player relays via `TERMINAL_RESIDENT_REQUEST`, extended with a `defuse` op). Available to **anyone logged in** (owner or intruder), gated by `canOperate` like ANALYZE/upload. **No trace/heat** — it's recon, not an attack. Wired in all three viewers via the OPERATOR-TOOLS dropdown (the UPLOAD sibling; the "SYSTEM-SWEEP-soon" slot already stubbed there).

**Build status (thread #2):** ✅ data model + CRUD (`getResidents`/`installResident`/`updateResident`/`removeResident`, + `slotKey` replace-don't-stack) · ✅ GM-gated fire proposal — **now `residentFireMode` (world setting): `propose` (default) / `auto` / `manual`**, and the prompt is the styled `ResidentConsole` (FUI family, host-scoped), NOT a raw Dialog. The prompt exists to be the **netrun pause** (§5) and now *says so on its face*, names the closest NET action, and shows the forgery tell — dev's play-test note was "it's just not obvious the intention is to use this time to Netrun". · ✅ `onLogin` (hooked in `_updateSession` GM branch) · ✅ `onDate` (60s reaper, priority 67) · ✅ `onAction` (exfil, via one GM-side `TERMINAL_EXFIL` listener; siphon/others later) · ✅ `plant` effect applier. Deferred: player-facing SYSTEM SWEEP (mock-first) · `onHeat` (needs thread #4) · `manual` fire + audit (thread #5) · `keylog`/`forgeAccount`/`deployICE`/`logicBomb` appliers (thread #6). Install is GM-only until upload relays it (thread #3). Logic-sim: scratchpad `test-residents.mjs` 26/26.

**Dead-field payoff:** an `onDate` / `onHeat` resident is where the long-scaffolded, never-wired `traceStarted` / `traceExpiresAt` message fields finally live (a logic bomb arms a countdown).

---

## 4 · Upload / Forge — the player→machine direction

Upload is the existing effect engine with the **target seam swapped**. `_applyNativeEffect` already takes `hostItem`; today the host is "the journal the entry lives in" (in-place). Upload sources the effect from a **carried container** and points `hostItem` at a **target you're operating against**.

### 4a · Transport — the go-bag

The program is carried in one of:
- **A data shard** — the "NPC hands you a shard, carry it to the terminal" on-ramp. A shard entry is already a program artifact.
- **The Agent** — a program authored/stored in the player's own inbox (the "upload through the Agent" path).

The upload picker (mock §②) lists carried programs, each tagged **PLANT** (purple) or **EXECUTE** (red) with a **FORGE DV** / **RUN DV** chip.

### 4b · Target model

- **v1 — logged-in only.** You breach an account (existing auth), *then* RUN a carried program against that terminal. Cheapest, reuses everything, matches the on-ramp. `hostItem` = the terminal you're in.
- **later — remote / no-login.** Push from the Agent / a scene pin without logging in, at **higher DV + more security** (needs a target picker + a breach roll). Deferred; the model already supports it (just a different `hostItem` resolver + DV modifier).

### 4c · PLANT is one effect, not a family of its own

`effect: { type: 'plant', lifecycle: 'triggered', params: { entry: <a typed content entry> } }`. On a successful FORGE roll it installs a resident that writes the forged chatlog / gallery / dossier / message into an account mailbox — landing for the next login (`trigger: onLogin`). **The authoring pipeline already makes all 18 types**, so PLANT content is nearly free; the only new bit is the FORGE check.

### 4d · The FORGE check & "tells"

The upload roll's **margin** becomes `provenance.forgeQuality`. On the owner's side, ANALYZE (the same scan that reveals disguised payloads) rolls vs `stealthDV`; a low `forgeQuality` reveals a **`FORGED`** tell. **One scan verb — ANALYZE — now catches disguises *and* forgeries.**

**REVISED 2026-07-17 (dev call, after the first play-test) — the check is a LADDER, not pass/fail.** This section used to read "a botched forgery installs anyway but with low quality", i.e. *any* committed roll installed. In play that was wrong twice over: there was **no floor** (failing by 12 planted the same file as failing by 1), and since a miss still landed, players retried — which **stacked a duplicate armed plant per attempt**, so the GM's next login prompt fired every failed try ("it uploads all the failed tries as well"). The model now (`forgeOutcome` in `UploadFlow.js`, `FORGE_SLOPPY_BAND = 4`):

| margin (roll − DV) | outcome |
|---|---|
| `>= 0` | **clean** — high `forgeQuality`, high `stealthDV` |
| `-1 … -4` | **sloppy** — it lands, but ANALYZE will flag it `FORGED` (the original intent, now bounded) |
| `< -4` | **rejected** — the box refuses the file; **nothing installs** |

And a re-upload **replaces** rather than stacks: a resident carries a `slotKey` (`effectType::accountId::name`) and `installResident` overwrites an existing **armed** plant in that slot (a *fired* one is left alone — it already landed, so a re-upload is a new file). Sim: `test-forge-bands.mjs` 21/21 against the real `installResident`.

**Hiding the DV was considered and rejected as a one-console change:** the shared `templates/chat/hack-result.hbs` prints "vs DV {dc}" for every skill check in the module, so the roll's own card reveals it regardless. The console instead states the ladder before the player commits. A real hide needs a `hideDV` flag through `SkillService.performCheck` + that shared card.

### 4f-build · Status (thread #3)

✅ **Backend** (`UploadFlow.js`, sim `test-forge.mjs` 15/15): `runUpload` (FORGE roll → `forgeQualityFromMargin` → `stealthDVFromQuality` → install `plant` resident) · `TERMINAL_RESIDENT_REQUEST` relay + `handleResidentRequest` + SocketHandlers. Roll margin drives quality: hit DV = 50, clean forge → high quality + high stealthDV, botch → low + detectable. Committing the roll always installs (a botch is sloppy, not aborted).

✅ **Picker modal** — `UploadConsole.js` + `upload-console.css` (framework-free FUI, host-scoped, purple accent; cascade rows, top-bar sheen, select glow, COMPILING beat, all reduced-motion-gated). Render-verified headless (`upcon.png`); live preview `docs/mockups/upload-console-preview.html`.

**PLANT target = an account ON the terminal** (mailboxes are account-scoped): the forged entry lands in that account's mailbox and fires on that account's next login; "— any login —" lands in whoever logs in next. **Target list = player-visible accounts only** (`getAccounts(item)` already filters hidden + net-gated for non-GM) **∪ the account you're logged into** — so a runner can aim at someone else's inbox but **can't plant into a hidden account they never discovered**. GM sees all.

✅ **Viewer wiring** — `TerminalViewerApp` OPERATOR-TOOLS HUD chip → dropdown (UPLOAD + SYSTEM SWEEP, both live), gated by `canOperate` (locked chip + reason tooltip when not capable). `_onUpload` gathers the operator's carried `uploadable` shard entries (`_gatherCarriedPrograms`) + visible accounts (`_uploadTargetAccounts`) → `runUploadConsole` → `runUpload`. Purple OPS chip + animated dropdown in terminal.css. (Agent-inbox source + EXECUTE families → later.)

✅ **Composer `uploadable` fieldset** — in the composer's ③ SECURITY & ACCESS section (`DataShardComposer`): an "Uploadable" toggle + Forge DV / Forge skill / Stealth DV / "botched forge fires a trace", folded into `contentData` cross-type, prefilled on edit, purple-accented. WHO/WHEN is chosen at upload time (the picker's TARGET), so no trigger field here.

**Thread #3 is feature-complete for v1** (PLANT). Deferred to later threads: Agent-inbox as a second carry source, EXECUTE families (thread #6). Decisions locked: UPLOAD lives in a host-level **OPERATOR menu** (the offensive toolkit — UPLOAD now, SYSTEM SWEEP later), and the picker lists only entries the GM flagged **`uploadable`** on a carried shard or the Agent. The FORGE roll reuses the existing SecurityConsole (no new modal). (Both open items since resolved: `uploadable` is authored in the composer's ③ SECURITY & ACCESS section — and, since 2026-08-14, by the Malware Workshop — and EXECUTE programs joined the picker with thread #6.)

### 4e · EXECUTE (thread #6 — verb appliers BUILT 2026-07-24)

The engine pointed outward — `wipe` (cover tracks), `forgeAccount` (backdoor), `jammer`, `deployICE`, `keylog`, `logicBomb`. Malware gains authored effects here (it stops being a GM-adjudicate stub) and *becomes uploadable* in the same motion.

**Decisions locked** (full rationale in `THREAD6-MALWARE-MODEL.md`): economy = GM-authored v1 (sell via the built-in store / Item Piles, no NCM market surface) · cost = heat + one-shot `charges` on destructive verbs · forgeAccount = **24h game-time** (`ttlHours:0` = permanent) · deployICE = **both** (runner-brought > box-own > degrade) · logicBomb = timed single-effect (no nesting) · worm = out.

**The five stubbed verbs are now native** (`test-thread6-verbs.mjs` 27/27, NOT live-tested). Two appliers grew (no third added, per §3):

- **Instant** (`_applyNativeEffect`, SiphonFlow — where `wipe` lives): **`corrupt`** redacts target sibling entries *in place* (documents/dossiers) and arms a DECLASSIFY (DV) to restore — the reversible sabotage; non-redactable types are honestly skipped. **`forgeAccount`** (instant variant) delegates to `TerminalService.forgeBackdoorAccount`.
- **Triggered** (`TerminalService.fireResident` → the shared `_fireResidentEffect` switch — where `plant` lives): **`keylog`** captures the login that fires it and whispers the account (a usable secret-login lead) to the runner + GM. **`forgeAccount`** writes a HIDDEN, password-protected backdoor account with a `forged` provenance block + a 24h game-time expiry (`reapForgedAccounts` on the resident-reaper cadence closes it); creds whisper to the runner. **`deployICE`** bites the intruder whose login fired it — runner-brought `params.iceActorId` first, else `_resolveDeployIce` reads the box's own account `security.ice`, else honest degrade. **`logicBomb`** runs ONE inner effect through the same `_fireResidentEffect` switch; an inner `logicBomb` is refused (the recursion fence).

`_fireResidentEffect` was split out of `fireResident` precisely so `logicBomb` can run its inner effect without re-marking the outer resident. `forgeBackdoorAccount` is the single source of truth for the backdoor (shared by the instant deploy path and the triggered resident path).

**Thread #6 remainder — status (updated 2026-08-14):** ✅ **SYSTEM SWEEP** shipped 2026-07-24 (`SystemSweep.js` + `system-sweep.css`, OPERATOR-TOOLS menu — detect vs `stealthDV`, per-resident DEFUSE, GM/player information split). ✅ **Malware-uploadable** shipped 2026-07-25 (composer "When pushed, it…" verb select → EXECUTE programs install triggered residents through the same forge ladder; family-aware console copy instead of a separate RUN-DV chip) — and superseded 2026-08-14 by the **Malware Workshop** (`MalwareWorkshopApp` + `ProgramLibrary`/`programLibrary` setting + Program Deck), which is now the authoring surface for payload/malware (the composer redirects there). ⏭ **`runProgram` unification** deliberately dropped — a pure refactor of two working flows the upload path never routes through; revisit only if a third caller needs the shared entry point.

### 4g · `wipe` = a GM recycle bin (not a hard delete)

A weapon that destroys player/NPC-authored evidence is too lossy to be irreversible. So `wipe` **soft-purges** — target entries move to a **GM-only quarantine**, stamped with their origin (`{ hostId, journalId, pageData, wipedBy, wipedAt }`). Rules:

- **Not the terminal's own Trash** (`status.deleted`) — the owner could restore them and defeat the attack. It's a *separate GM-owned holding*, world-scoped.
- The owner/next-login sees the entries **gone**. Only the GM sees the quarantine.
- The GM can **Restore-to-origin** (rebuild the page on its source journal) or **Empty** (the one true permanent delete — the recycle-bin lever).
- Surfaced in the Admin Security tab (§7) as **Recycle Bin**.

`corrupt` stays distinct: it flags entries corrupted *in place* (recoverable via declassify-style reveal), it doesn't remove them.

### 4f · On-ramp, end to end

NPC's shard carries `{ type:'plant', lifecycle:'triggered', params:{ entry:<forged chatlog> }, trigger:{ kind:'onLogin', accountId:<npc> } }` → player logs into the terminal → **RUN from shard** → FORGE roll vs the box's security (trace-on-fail) → installs the resident, `forgeQuality` = margin → NPC's next login fires the trigger → GM gets the fire-proposal → confirms → forged chatlog lands in the NPC's mailbox → Security tab logs it → owner's later ANALYZE vs `stealthDV`/`forgeQuality` may flag `FORGED`. Every step reuses an existing primitive.

---

## 5 · Netrunning binding — resolution modes

**NCM must never pretend to *be* netrunning.** RED runs the NET on a soft, GM-adjudicated honor system, and every table does it differently — any rigid model we hard-code is wrong for someone. So NCM's hack/upload actions **choose their resolution mode** and **announce themselves** so they slot into whatever the table already does.

Setting: **`hackResolution`** — **global default with per-terminal override** (decision #6b: set once table-wide, override the odd box). Three tiers:

- **A — Auto (default, current behavior).** Single skill check: Interface (or configured) + 1d10 vs DV via `SkillService.performCheck`. Self-contained, table-agnostic, honor-system-compatible. Explicitly *an abstraction of* netrunning, not netrunning. Most tables never leave this.
- **B — Flagged.** Same auto-roll, **but tagged `netAction` and posted as a rich GM card** naming the NET-action equivalent (`forgeAccount`→*Backdoor*, `wipe`/`logicBomb`→*Virus*, `jammer`→*Control*, `scanner`→*Eye-Dee/Scanner*). Resolves and advances state, but announces "this was a Backdoor-class action, DV X" so the GM can fold it into their run or veto it.
- **C — GM-adjudicated (the "lock").** NCM does **not** auto-roll. The action becomes a *pending netrunning action*: the netrunner does their NET run at the table (or in whatever netrunning framework/house-rules they use), and the GM clicks **Resolve → pass/fail**. NCM only tracks and applies state. Hands dice authority entirely to the table; NCM becomes the **state layer** for their netrunning.

**"Lock it and flag it as netrunning"** = Tier C + the `netAction` tag. Every hack/upload/effect carries a `netAction: { verb, dv, program? }` descriptor **regardless of tier**, so the trace log and GM cards always show the netrunning shape — even in Tier A.

**Later hook (not v1):** in B/C, optionally let the action reference the Netrunner's **equipped program items** (Sword, Banhammer, Worm…) to modify DV or gate a verb — the real bridge to a table running full RED programs. Deep; deferred. v1 ships the three-mode toggle + the `netAction` tag only.

---

## 5b · Operator capability gate — WHO can netrunner

Netrunning isn't for everyone (core RED: it's the Netrunner's job, gated by the Interface ability). So the OPERATOR tools (upload / hacking / — later — SYSTEM SWEEP) are gated by a **capability predicate**, configurable by the GM.

**`canOperate(actor, override?) → { ok, reason }`** (helpers.js, beside `resolveOperator`). Reads the world **`operatorGate`** policy; an optional per-target `override` merges over it (a hard box can demand more). Policy shape (`DEFAULTS.OPERATOR_GATE`):

```
{ mode: 'anyone'|'gated',           // default 'anyone' → nothing gated until a GM opts in
  logic: 'any'|'all',               // combine the SET qualifiers
  roles: [],                        // CPR role name substrings, e.g. ['Netrunner']
  skill: { name:'', min:0 },        // min skill rank (Interface 4+), via SkillService.getSkillData
  items: [],                        // gear name substrings, e.g. ['Cyberdeck']
  actors: [],                       // explicit actor-id allowlist (always pass)
  allowGM: true }                   // GM user escape
```

Evaluation: `anyone` → always ok. `gated` → GM escape → allowlist → then only the qualifiers the GM actually set, combined by `logic`. **Gated-with-nothing-configured is inert** (ok:true) so an incomplete config never locks the table out. Blocks return a human `reason` ("Operator tools require Netrunner or Interface 4+.").

**Reusable by design** — today it gates the OPERATOR menu, but the same predicate can gate any action (siphon/crack/exfil) later via a per-category toggle, so capability never gets retrofitted into each call site. This is the sibling of §5's `hackResolution` (WHO can act vs HOW it resolves) — together they're the "netrunning integration" config, and both belong in the same GM settings area.

**Config home:** the Admin **Security tab** (§7 / thread #5) — a form for mode/logic/role/skill/item/allowlist. Until that lands, the world setting is live (macro/console-settable). Enforcement rides the OPERATOR-menu build (thread #3 UI): a non-capable operator sees the menu disabled with the `reason` as its tooltip. **Backend built + sim'd** (`test-canoperate.mjs` 17/17): `DEFAULTS.OPERATOR_GATE`, the `operatorGate` setting, `canOperate`.

## 6 · Trace overhaul — the consequence spine

Today trace is three inconsistent, ephemeral things: `_fireUnlockTrace` (sound + `showShardTrace` splash + a GM whisper) on the unlock paths, but siphon / malware / payload-fail call `showShardTrace` **bare** — no whisper, no ICE, no record. **Nothing persists.**

### 6a · One `fireTrace` — and the call-site audit

Trace consequences are scattered across the module today with **no actor/object tagging and no record** — that's the exact gap behind "make heat easy to track by player and object." Every one of these sites must funnel through `fireTrace({ actor, source, action, host, ... })` (which internally still calls `NotificationService.showShardTrace` for the splash + `trace-fire` sound — that stays as the *display* primitive; the log + heat wrap around it):

| site | today | after |
|---|---|---|
| `SiphonFlow._fireUnlockTrace` (unlock/camera/analyze/sniff — 6 callers) | splash + GM whisper | `fireTrace` |
| `SiphonFlow` siphon fail (~L104) | **bare** `showShardTrace` | `fireTrace` |
| `SiphonFlow` malware misfire/honeypot (~L670) | **bare** `showShardTrace` + ICE | `fireTrace` (heat can drive the ICE) |
| `SiphonFlow` payload fault (~L792) | **bare** `showShardTrace` | `fireTrace` |
| `BankHeist.js` (~L207) | **bare** `trace-fire` sound | `fireTrace` |
| `MessageViewerApp` (~L3194) | **bare** `trace-fire` sound | `fireTrace` |
| `TerminalViewerApp` (~L1649, L1944) | **bare** `showShardTrace` / sound | `fireTrace` |
| `UploadFlow.runUpload` (botched forge) | **bare** `showShardTrace` + sound | `fireTrace` |

`NotificationService.showShardTrace` is **not** deleted — it's demoted to the display call `fireTrace` makes. The point of the funnel is that **every** consequence now carries `actorId` + `hostId` into the log + heat, so nothing escapes the tracker.

Every risky failure routes through the one function:

```
fireTrace({ actor, source, action, dv, margin, host, severity })
```

1. **Always:** GM alert (whisper + a persistent log row) + `trace-fire` sound + the splash.
2. **Durable log:** world setting `traceLog: [{ id, ts, actorId, actorName, source, action, host, hostId, dv, margin, severity, outcome }]`.
3. **Teeth via per-target HEAT** (§6b).

### 6b · Heat & escalation (GM-gated)

**Heat is keyed by (object × actor), not per-object alone.** The GM needs to see *which player* is hot on *which object* — so heat lives as a map: on a terminal, `state.heat = { [actorId]: value }`; on a network, a `heat: { [actorId]: value }` flag. One player running hot on a box doesn't punish the whole party, and the Admin tab (§7) renders it as a **player × object matrix** ("V: 45 on ARASAKA-WS, 20 on CitiNet"). The `traceLog` is the raw event stream behind it (every row carries `actorId` + `hostId`); heat is its running aggregate.

Each trace bumps that actor's heat on the target terminal/network. Heat **decays over time via the time provider** (honors the standing "all expiries go through the provider" rule).

**Placeholder numbers (scaffold with these; tune in playtest — §11):** heat is `0–100`, decays **~5/hour** of game time. Trace additions by severity: minor unlock fail **+10** · siphon/exfil fail **+20** · hostile upload/malware fail **+35**. So one fumble cools off in an hour; sustained hammering is what escalates.

| heat | tier | consequence (GM-confirmed unless `autoEscalate`) |
|---|---|---|
| < 25 | cold | logged only |
| ≥ 25 | warm | SecurityService **lockout** of the actor eligible |
| ≥ 50 | hot | **ICE response** eligible — generalize the malware-ICE path |
| ≥ 80 | burned | **countdown** eligible — arm `traceStarted`/`traceExpiresAt`; expiry = a GM "the corp found you" event |

**GM-gated by default (decision #4):** heat accumulates and *suggests*; the GM confirms the ICE / countdown. A per-terminal **`autoEscalate`** toggle exists for hands-off tables. So a single bad roll never nukes a player unsupervised.

This finally wires the dead countdown fields, and folds the malware `iceActorId` bite into a general "high-heat ICE response."

---

### 6c · Build status (thread #4)

✅ **Spine built + sim'd** (`TraceService.js`, `test-trace.mjs` 24/24): `fireTrace` (local drama → GM-owned log + heat; player relays via `TRACE_REQUEST`) · `recordTrace`/`handleTraceRequest` · durable `traceLog` (250-cap) · per-(object × actor) `traceHeat` with 5/hr game-time decay + tiers (`tierOf`) · settings + service (ready/43) + socket handler. `fireTrace` has a **`quiet`** option (record log+heat, skip splash/sound) for sites that already show their own fail feedback / whose animation owns the climax.

✅ **All 17 consequence sites funneled** (a subagent audit found 11 I'd missed):
- *Original 6* (loud): `_fireUnlockTrace` (unlock/camera/analyze/sniff), siphon-fail, malware-misfire, payload-fault, upload-botch, terminal-exfil-fail.
- *Data shards*: `_handleHackFailure` (`quiet:silent` — animation owns climax), `handleLayerHackFailure`, shard login-fail (minor·quiet), `validateKeyItem` wrong-item (minor·quiet).
- *Networks*: `NetworkAuthDialog` password-fail (major) + skill-bypass-fail (hostile), `ContactBreachService._handleFailure` (hostile).
- *Terminals*: `_failAuth` (account login), `_failNetAuth` (net-join).
- *Messages*: `MessageService.attemptDecrypt`-fail (hostile), `MessageAccessService._handleFailedAttempt` (major·quiet).
- **Severity guide:** breach/decrypt/hack fails = `hostile`; discrete auth fails = `major`; credential fumbles = `minor`. All tunable.
- **Correctly EXCLUDED** (per audit): `_traceAnonSender` (the player's *unmask* feature — shares the word only), presentation-only reactions (`ItemInboxApp`/`MessageViewer` hack-fail & black-ice animations, `NotificationService` toast handlers, `NetworkAccessLogService`), and the low-level shared choke points (`SecurityService.recordFailedAttempt`, `NetworkService.authenticate*` events) that would double-count under the per-site funnel. `NotificationService.showShardTrace` stays as the display primitive `fireTrace` calls.

**Noted for later:** `traceStarted`/`traceExpiresAt` on messages are a *separate* scaffolded "traced-network-message countdown" (WP-6) whose expiry-consequence was never wired — a candidate to fold into the escalation slice.

🟨 **Escalation consequences** (§6b tiers → lockout / ICE / countdown, GM-gated). **Lockout + ICE + countdown all BUILT** (2026-07-20) in the Security-tab **Escalate** dialog (one GM-gated dialog, three options), offered from the **warm tier up** (heat ≥25, was ≥50). The missing map — heat is keyed by bare `objectId`, lockouts are keyed granularly — is resolved by **`SecurityTab._lockoutScope(objectId)`** fanning it out: a terminal → every account key (`termId::acctId`, all accounts incl. hidden), a shard → the shard id, a network → the network id (the Agent connect gate; a terminal's own compound net-join key is NOT covered — noted in-code), a `label:` object → nothing lockable (button warns). The primitive is **`SecurityService.forceLockout(actorId, targetId, {durationMs, reason})`** — imposes a lockout immediately (no burned attempts; sets attempts→max so login screens read 0 tries, emits `NETWORK_LOCKOUT{forced:true}`, expires on game time). Sim `test-forcelockout.mjs` 18/18. **Still 🔲:** the per-terminal **`autoEscalate`** hands-off toggle (today every escalation is a manual GM click — arguably the safer default anyway) and folding `traceStarted`/`traceExpiresAt` message fields into the countdown.
🔲 **Admin surface** for the log + heat → thread #5.

## 7 · Admin — one Security / Audit tab

A new **Admin → Security** tab (`SecurityTab`, following the composed-tab pattern in `AdminPanel/tabs/`) satisfies **both** hard requirements in one surface:

- **Trace log** — the `traceLog` rows, filterable by actor/host/severity.
- **Heat dashboard** — per-terminal / per-network heat, with GM set/clear and the `autoEscalate` toggle.
- **PLANT / infection audit** — every resident and planted artifact by `provenance` ("what's forged where, by whom, forgeQuality"), with **Defuse** / **Fire now** (manual trigger) controls.
- **Recycle Bin** — `wipe`-purged entries (§4g), with **Restore-to-origin** / **Empty** (permanent).

This is the dev's non-negotiable "GM must see & log traces" *and* "forged content must be trackable" — met by one tab.

---

## 8 · Malware model — expansion menu

Triggers + residents are the substrate; here's what they unlock. Split by cost.

**Cheap, high-value (do alongside):**
- **Infection as terminal state** — residents *are* infections; a terminal can be "dirty." GM-visible + ANALYZE-detectable. Free once residents exist.
- **Trigger richness** — `onLogin`(any/account/actor) · `onDate` · `onAction`(next siphon/exfil) · `onHeat`. The logic-bomb / keylogger / blackmail engine.
- **Scrubber / antivirus payload** — the utility counterpart that detects + removes residents. Gives payload a real defensive job; closes the plant→clean loop.
- **Behavior tags as modifiers** (not new types): `persistent` (survives relock) · `stealth` (needs ANALYZE) · `armored` (linked ICE) · `polymorphic` (re-disguises after a failed detection). Combinatorial depth, zero new content types.
- **Reverse-the-arrow bait** — a GM honeypot that, when exfil'd/deployed, plants onto the *player's own Agent*. Already feasible (plant targets any journal).

**Big toys (design later):**
- **Worm / propagation** — on trigger, a resident tries to copy to *linked* terminals (same uplink/network, or shared account/master-contact — we already have that graph). GM-gated per jump. The escalating-threat centerpiece, but real system.
- **Heat-driven corp counterplay** — high sustained heat makes the corp *proactively* fight (ICE, lockouts, a counter-trace). Ties malware + trace into one "how hot are you running" gauge. Natural once heat exists.

---

## 9 · Reconciliation with the mock

`eddies-and-upload-mock.html` (② UPLOAD/FORGE) pre-figures this model:
- **PLANT (purple) / EXECUTE (red)** families = the two poles of the shared engine; its examples map onto §2's verbs (`affair.chat`/`evidence.img`→`plant`; `watchdog-mute`→`wipe`; `backdoor`→`forgeAccount`; `BLACKWIDOW.ice`→`deployICE`).
- The **"whoever logs in next finds it"** box = a `trigger: onLogin` resident (§3).
- **"Interface vs the box's security"** + **FORGE DV / RUN DV** = Tier-A resolution + the two DV labels (adopted).
- **"a botched forgery leaves tells"** = `forgeQuality` + ANALYZE (§4d).

Doc extends past the mock with: the Agent as a second container, the netrunning tiers, the trace/heat spine, the Security/audit tab, and the expansion menu.

---

## 10 · Build order (proposed)

1. **Program-model refactor** — one `runProgram` path + `_applyNativeEffect` grown with the malware verbs; malware sheds the adjudicate stub. Establishes the spine.
2. **Triggered/resident lifecycle** — `state.residents`, trigger hooks, `applyResidentEffect`, GM-gated fire-proposal, ANALYZE-to-detect/defuse.
3. **PLANT via upload** (Phase 1 of the mock) — carry from shard/Agent, FORGE roll, `forgeQuality`, install a `plant` resident. Delivers the blackmail fantasy.
4. **Trace overhaul** — `fireTrace`, `traceLog`, heat + GM-gated escalation, wire the countdown fields.
5. **Admin Security tab** — trace log + heat + plant audit.
6. **EXECUTE verbs** (Phase 2) — `wipe`/`forgeAccount`/`keylog`/`deployICE`/`logicBomb` uploadable.
7. **Netrunning resolution modes** — the `hackResolution` setting + `netAction` tag (can land early; independent). **BUILT 2026-07-20** (v1): world setting + per-terminal override (terminal config → Network tab); Tier B posts the NET-action card (`postNetActionCard`); Tier C is a **live adjudication round-trip** (`NetResolve.js` — the player's console parks in AWAITING GM while the GM's `NetAdjudicator` prompt calls it; DISMISS withdraws harmlessly, no durable pending queue in v1 — revisit if live play wants offline adjudication). The GM's verdict **synthesizes `{ok, total}`** so no flow changed: the upload hands the GM the forge LADDER (clean/sloppy/reject rungs carrying in-band totals). The `netAction` verb is derived centrally in `TraceService._payload` from the existing `action` strings (`NET_ACTION_VERBS`) and shown as a chip in the Activity Log. Auth/login checks are deliberately outside the tiers (access ≠ action).
8. **Creator UI polish** (Phase 3) + expansion toys (scrubber, behavior tags, worm).

---

## 11 · Decisions & open questions

**Resolved:**
- **`wipe` reversibility** — soft-purge to a GM-only recycle bin with Restore/Empty (§4g), *not* a hard delete. The owner sees it gone; the GM holds the lever.
- **Provenance visibility** — **GM-only.** A defused/detected resident tells the player "tampering found" / `FORGED`, never `plantedBy`. Fiction: *you found it*, not *you know who*.

**Still open:**
- **Heat decay rate & tier thresholds** (§6b) — **placeholder values set** (0–100, ~5/hr decay, +10/+20/+35, tiers 25/50/80). Build against these; tune in playtest. Not locked.
- **Remote/no-login upload** (§4b) — DV modifier + target-picker shape. Deferred; worth pinning the DV math when we get there.
- **Program-item bridge** (§5, Tier B/C referencing equipped RED programs) — dedicated pass when a table asks for it.
```
