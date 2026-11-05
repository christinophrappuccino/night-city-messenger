# AUDIT-REMEDIATION-PLAN — Night City Messenger v2.1.0

- **Inputs:** `AUDIT-OPUS.md` (87 findings) and `AUDIT-FABLE.md` (re-verification + 8 new findings).
- **Status:** planning only. No source file has been changed. This document is the only file written in this session.
- **Date:** 2026-11-04.

---

## 1. Executive summary

**Baseline.** The working tree is the audited revision: HEAD `9624901` on `dev`, and no file under `scripts/`, `styles/`, `templates/` or `module.json` is newer than either audit. The uncommitted count is now 53, not 52. The difference is `AUDIT-FABLE.md`. The original 51 work-in-progress paths (payphones and related) plus the two audit reports make 53. All of it is preserved.

**Verdict on the audits.** No finding in either report was disproved by the code. Stage 2 was not blind (same session), so this plan re-checked the facts every batch depends on rather than trusting agreement between models. Re-checked in planning:
- the socket op map;
- who emits each "GM-only" op;
- the helper-collision surface;
- the existing active-GM pattern;
- the escape helpers;
- the sim harnesses.

**What the plan does.**
- It fixes the trust boundary at its root. Socket messages carry the server-verified sender, every op has a declared trust class, and GM-side relays decide from intent rather than from payload content.
- It applies that rule in small batches, one subsystem at a time.
- **Gameplay mechanics are not removed.** Hacking, siphoning, forging and tracing all stay. Only the ability to act on Foundry documents you don't control is closed.

**Five decisions that shape everything:**
1. **Rolls stay client-reported.** The module's documented trust model, where the player's client reports its own roll outcome, is kept. Fixes ensure a request can only act on things the sender is entitled to act on, as the actor they actually own. They do not move dice to the GM.
2. **Peer-to-peer traffic stays peer-to-peer.** Calls, watch, payphone presence and network state are emitted by players to players, so "must come from a GM" cannot be a blanket rule. Each op gets one of three trust classes (§4.1).
3. **Toast escaping uses a tagged template, not a 393-site rewrite.** `ui.notifications.info(safe\`… ${name}\`)` escapes only the interpolated values and leaves any deliberate markup in the literal intact.
4. **The init-order fix (COMPAT-01) is bundled with a 16-site template change (FBL-01).** It is not a rename of 335 `eq` uses (§6).
5. **The first batch is the socket identity fix plus a reusable two-client test harness.** It changes nothing for honest clients and is the foundation for every later security batch.

---

## 2. Consolidated findings and corrections

### 2.1 Severity after consolidation

Opus IDs are kept as-is. Fable's IDs are `FBL-01` to `FBL-08`. Where the two disagree, the evidence-based call is stated.

| ID | Opus | Fable | **Plan** | Basis |
|---|---|---|---|---|
| SEC-01 | Critical | Confirmed | **Critical** | Foundry `handleCustomSocket` passes the server's `this.user.id` as the 2nd listener arg; `SocketManager.js:37` drops it |
| SEC-02 | Critical | Confirmed | **Critical** | `SiphonFlow.js:886-897` executes `macroId` from the payload |
| SEC-03 | Critical | Confirmed (scope ×2) | **Critical** | Foundry Notifications renders raw HTML; 393 interpolating calls |
| DATA-01, DATA-02 | Critical | → High | **High** | Agree with Fable. An owner can already set their own wealth. The defect is silent desync plus false success, not an escalation |
| SEC-07 | High | Partial | **High** (impersonation, cross-player schedule and contact writes) | The self-enrichment clause is not an escalation |
| COMPAT-04 | Medium | → Low | **Low** | No installed module or the system uses `.mt` (verified); fix is trivial anyway |
| COMPAT-05 | Low | Direction reversed | **Superseded by FBL-01** | Verified: social-navigator registers 2-argument `eq`/`and`/`or`/`not`/`gt`… at `init`; today NCM wins |
| FBL-01 | — | High | **High** (only once COMPAT-01 is fixed) | Verified: 15 `{{#eq` blocks plus one 4-argument `or` (`message-viewer.hbs:205`) depend on NCM-only semantics |
| FBL-02 | — | Medium | **Medium** | Verified: `SocketManager`, `EventBus` and `DocumentSyncBridge` are untested |
| FBL-03 | — | Medium | Merged into SEC-03 | Scope fact |
| FBL-04 | — | Low | Merged into SEC-23 | Same function |
| FBL-05, FBL-06 | — | Low / Potential | **Runtime test only** | pin-cushion; drop-handler coexistence |
| FBL-07 | — | Low | **Merged into COMPAT-01** | Same root cause |
| FBL-08 | — | Improvement | **No action** | |
| All other IDs | as filed | | **As filed** | Not contradicted by the code; batch-level re-verification before each fix (§9.4) |

### 2.2 Duplicates and merges

- **SEC-08, SEC-21 and SEC-22** are SEC-01 consequences plus missing per-handler checks.
- **The PRIV-01/02/03 and SEC-09/10 "any sender" parts** are SEC-01 consequences.
- **INT-01** covers L4 (reapers on two GMs), DATA-09's multi-GM part (MigrationRunner) and the INT-01 aspects of DATA-10.
- **SEC-03** covers SEC-19 (add-contact toasts) and FBL-03.
- **SEC-23** covers FBL-04.

### 2.3 Needs runtime before a fix is designed in detail

| ID | What decides it |
|---|---|
| DATA-03 | Claim race |
| DATA-06 | Real GM relay times |
| DATA-11 | Scheduling race |
| DATA-15 | Inbox race |
| INT-02, INT-03 | Interleaving under concurrent requests |
| COMPAT-01 | Uncached-load and Forge behavior |
| PERF-01 | Count of stray inbox journals in a live world |
| FBL-05 | pin-cushion |
| PERF-04, PERF-05 | Measured cost |

---

## 3. Shared root causes

| Root | Findings it produces | One fix that covers them |
|---|---|---|
| **R1. The sender is self-reported** | SEC-01, SEC-08, SEC-09/10 (sender checks), SEC-21, SEC-22, PRIV-03 (spoofing), DATA-21 | Use the server user id; give each op a trust class (A1) |
| **R2. The payload is treated as truth on the GM** | SEC-02, SEC-03 (`gmToast`), SEC-04, SEC-05, SEC-06, SEC-07, DATA-03 | Relays carry intent and ids; the GM re-reads documents and checks entitlement (A2, A3) |
| **R3. `isGM` used where the active GM is meant** | INT-01, DATA-09 (multi-GM), DATA-10 reapers, L4 | `isPrimaryGM()`; the pattern already exists (`SchedulingService._isDeliverer`, 23 uses) (B1) |
| **R4. Unserialized whole-object writes** | DATA-04, DATA-15, INT-02, INT-03, INT-06, INT-09, INT-11, PERF (recycle bin) | One `serialize(key, fn)` helper, modeled on the existing `NODE_WRITERS` queue (B4) |
| **R5. Escaping is opt-in, with 45 local `esc` copies** | SEC-03, SEC-11, SEC-12, SEC-16, SEC-17, SEC-19 | A shared `escapeHtml` and a `safe` tagged template in `helpers.js`; `{{ncm-tip}}` (A4) |
| **R6. One `await` in front of synchronous registration** | COMPAT-01, FBL-07, FBL-01 (latent) | Register synchronously; templates load in the background; `ready` waits for `initDone` (C1) |
| **R7. Client-local authoritative state** | DATA-05, DATA-07, DATA-17, DATA-21 | Setting-change reloads, GM-written persistence, disconnect hooks (D2, D3, B6) |
| **R8. Field-by-field persistence builders** | DATA-13, DATA-19, INT-04 | Add the fields, plus a round-trip sim (E1) |

---

## 4. Security priorities

### 4.1 The target security architecture

Each `SOCKET_OPS` key gets exactly one trust class. The table below is built from the emitter and handler map produced during planning.

| Class | Rule on receipt | Ops |
|---|---|---|
| **REQUEST** (player → active GM) | Only the active GM handles it. The real sender must be entitled: they own the actor, have permission on the item or page, the action is allowlisted, and any ids are re-read from documents | MESSAGE_RELAY, MESSAGE_QUEUE_SYNC, SCHEDULE_SYNC, CONTACT_SHARE_RELAY, LOG_RELAY, SHARD_CONVERT_REQUEST, SHARD_UNCONVERT_REQUEST, ANON_TRACE_REQUEST, TERMINAL_EXFIL_REQUEST, TERMINAL_NET_REQUEST, TERMINAL_SESSION_REQUEST, BANK_SIPHON_REQUEST, CONTENT_UPDATE_REQUEST, PAYLOAD_EFFECT_REQUEST, TERMINAL_RESIDENT_REQUEST, TRACE_REQUEST, SHARD_PRICE_REQUEST, NET_RESOLVE_REQUEST, NET_RESOLVE_CANCEL, CALL_LOG_REQUEST, CALL_LINE_REQUEST, CALL_VM_REQUEST, CONVERSATION_REQUEST, SHARD_INTEGRITY_REQUEST, SHARD_STATE_REQUEST, NETWORK_NODE_REQUEST, SECURITY_REPORT |
| **RESULT/COMMAND** (GM → player) | Drop unless the real sender is a GM | MESSAGE_DELIVERED, MESSAGE_QUEUE_CMD, MESSAGE_NOTIFY, INBOX_REFRESH, CONTACT_SHARE_NOTIFY, CONTACT_SHARE_CONFIRM, SHARD_CONVERT_RESULT, SHARD_UNCONVERT_RESULT, TERMINAL_EXFIL_RESULT, SHARD_PRICE_RESULT, NET_RESOLVE_RESULT, NET_RESOLVE_STATE, CONVERSATION_RESULT, SECURITY_LOCKOUT, SECURITY_CLEAR, TERMINAL_KICK, CALL_OVERHEARD (HUD ops: prompt/joined/line/ended…) |
| **PEER** (player ↔ player or broadcast) | Accept from anyone; each handler checks that the real sender is the party it claims to be | CALL, WATCH, PAYPHONE, NETWORK_STATE_CHANGED, MESSAGE_STATUS_UPDATE, SECURITY_NOTIFY, TRACE_COMPLETE, CALL_AUDIO, CALL_EMERGENCY (mixed: requests go to the GM, arrivals are broadcast), CALL_OVERHEARD (join/leave/enhance/save go to the GM) |

**Verified while planning:** SECURITY_LOCKOUT, SECURITY_CLEAR and TERMINAL_KICK are only emitted from GM-gated code (`forceLockoutMany` from SecurityTab, `clearFor`/`kickSession` from admin tabs, `resetAllForTarget` from GM-only relock and force-decrypt). Requiring a GM sender on them is therefore safe.

**Classified PEER, not RESULT, because players legitimately emit them:**
- `SECURITY_NOTIFY`: `ICEService.applyDamage` runs on player clients during shard, network and siphon failures.
- `MESSAGE_STATUS_UPDATE`: players emit it from `markAsRead`.

**Ops never registered by any handler:** `SHARD_STATE_CHANGED` and `TERMINAL_STATE_CHANGED` have no handler. Leave them alone.

**Guard:** a static sim asserts every op appears in exactly one class, and that every RESULT-class emitter function is GM-gated.

### 4.2 The gameplay boundary

| Intended in-game action (kept) | Foundry-level abuse (closed) |
|---|---|
| A player hacks a shard they can open, siphons an account entry they are viewing, uploads a program to a terminal they are logged into, traces an anonymous sender of mail in their own inbox | The same requests aimed at someone else's actor, inbox, shard or terminal; or asking the GM to execute a macro; or to show attacker-written HTML |
| Rolls reported by the acting client | Results reported *for another actor*; content blobs rewritten wholesale |
| GM automation: linked macros on GM-authored payloads and residents | Macros chosen by a relay payload, or authored by a non-GM |
| Forged identities, aliases, anonymous mail as **game features** | Spoofing the sender field of the transport itself |

---

## 5. Internal systems impact analysis

Systems S1–S17 are as mapped in `AUDIT-OPUS.md` §Internal Systems. The two maps agree. Fixes concentrate on five shared seams. Every batch in §8 lists its own system impact; these are the cross-cutting ones.

| Seam | Systems that depend on it | What must keep working |
|---|---|---|
| `SocketManager` (S1) | All 55 ops: mail relay and acknowledgements, held-mail queue, scheduling, contact share, shards, terminals, content actions, traces, calls, payphones, watch, conversations, nodes | Ack round-trips (`MESSAGE_DELIVERED`, `forUserId`), payphone first-pick-up arbitration on the caller's client, watch snapshots, Tier C adjudication docking, conversation queue |
| GM relay handlers (`SocketHandlers.js` plus service handlers) | S2, S7, S8, S9, S10, S11, S12 | Player encode/convert, upload/plant, exfil to Agent/shard/forward/wipe, siphon heist, claim, crack, unlock, payload run, decrypt relays, sessions, jack-in actions |
| Notifications and escaping (S4 + 393 toast sites) | Every subsystem | Deliberate markup inside toast literals (for example `<b>`) must still render |
| Persistence builders and settings writers | S2 (`createMessage`/`_pageToMessage`), S8 (`_buildMessageFlags`), S10 (`traceLog`/`traceHeat`), S9 (`recycleBin`) | Existing world data: no schema change without a MigrationRunner step |
| Init phases (S1) | Templates, settings, helpers, scene controls, keybindings, enricher, every `ready` service | No change to task priorities or service construction order other than moving work before the `await` |

---

## 6. Foundry compatibility dependencies

- **C1 is one indivisible batch: COMPAT-01 + FBL-07 + FBL-01.**
  - Move everything synchronous (settings, helpers, layer, keybindings, enricher, scene-control hook) before any `await`.
  - Start `loadTemplates` without awaiting it (`.catch` logs).
  - `ready` awaits an `initDone` promise.
  - **In the same change, rewrite the 16 helper-dependent template sites** (15 × `{{#eq a b}}…{{/eq}}` → `{{#if (eq a b)}}…{{/if}}`, and the 4-argument `or` at `message-viewer.hbs:205` → nested 2-argument `or`).
  - With those removed, NCM's templates work with *any* module's 2-argument comparison helpers, so registration order stops mattering in both directions. NCM's helpers remain supersets of social-navigator's, so SN keeps working whichever wins.
  - **Not done:** renaming the 335 `eq` uses. It isn't needed.
  - A guard sim fails on any new `{{#eq`/`{{#and`/`{{#or` block, or any `(and|or)` with more than 2 arguments.
- **COMPAT-03** (`game.user.isGM` shadow): fix with `delete game.user.isGM` in `finally`, or better, pass a `viewAsPlayer` flag to `_callHtml`. No dependencies.
- **COMPAT-02** (CPR `hotbarDrop` pre-empts NCM): a capture-phase `drop` listener on `#hotbar` that claims only NCM access drags and converted terminal/shard items, using the same pattern as the proven canvas drop listener. Plus an `isTerminal` branch in the item-sheet intercept. Must be tested with the CPR system loaded.
- **Other v12 notes:**
  - Foundry `ui.notifications` and `TooltipManager` render raw HTML (verified). The fixes must not assume core escapes.
  - `game.users.activeGM` prefers a full GM over an Assistant and works in Assistant-only worlds, so `isPrimaryGM()` keeps those worlds functional.

---

## 7. Third-party interoperability risks

| Module | Status | Plan |
|---|---|---|
| Cyberpunk RED core | COMPAT-02 confirmed | C3; test with the system |
| Social Navigator | Latent conflict | Neutralized by C1's template change; test with SN enabled and disabled |
| Pin Cushion | libWrapper on `Note` draw, visibility and control; `activateNote` not blocked (verified) | Runtime test only (pin icon, hidden pin); no code change planned |
| Item Piles, Monk's Active Tiles | Coexist (NCM's canvas drop claims only terminals) | Keep; add a guard sim so `stopImmediatePropagation` stays gated on `isTerminal` |
| PopOut | COMPAT-10 confirmed | E-batch fix: bind chat buttons by delegation on `renderChatMessage` instead of `renderChatLog` once |
| FilePicker Plus | Overrides `FilePicker._onDrop`; NCM only opens pickers | No action |
| Dice So Nice | COMPAT-09 (roll mode ignored) | **Behavior change, needs your approval** (E) |
| Simple Calendar | No conflict found | No action |
| libWrapper, socketlib | NCM uses neither | No action; do not introduce libWrapper for this work |

---

## 8. Phased implementation batches

Each batch is independently shippable and is followed by a stop for review.

Complexity: **S** = under 1 h, a few files · **M** = several files, needs a sim · **L** = many files or design choices.

**Order note.** B1 (active-GM gating) moves ahead of A3. It touches the same handler lines and is mechanical, and having it in place makes the A3 checks simpler to reason about.

### A0 — Checkpoint *(no code change)*
- **Goal:** protect the 51 uncommitted WIP paths (payphones etc.) before any remediation edit.
- **Options (your call):**
  - (a) You commit the WIP on `dev` yourself.
  - (b) I commit it on `dev` as `wip: payphones + 2.1 work (pre-audit checkpoint)` after you say so.
  - (c) I create a branch `audit-remediation` from a WIP commit and keep `dev` untouched.

  Recommended: (b) or (c). Remediation diffs then review cleanly against a fixed base.
- **Risk:** none.

### A1 — Authenticated socket identity *(SEC-01; foundation for SEC-08/09/10/21/22, PRIV-03)* · **M**
- **Root cause:** R1.
- **Changes:**
  - `SocketManager.initialize`: `game.socket.on(name, (message, userId) => this._onMessage(message, userId))`. `_onMessage` passes the **server** `userId` to handlers; the payload `sender` is ignored. Foundry never echoes to the emitter, so the own-message skip becomes unnecessary; keep a harmless equivalent.
  - `helpers.js`: `isPrimaryGM()`, `isFromGM(userId)`, `userOwnsActor(userId, actor)`.
  - The three handlers that currently swallow the sender (`registerWatchSystem.js:17`, `registerCallSystem.js`, and service handlers taking `(data)`) are given the argument.
  - **No access rules change in this batch.**
- **Systems:** all socket consumers (S1–S13).
- **Preserve:** every honest flow. The real id equals the old payload `sender` for honest clients, so behavior is identical.
- **Regressions:** a handler that compared `sender` to something other than the emitter (none found); a test or verification file that fakes `sender` (`Phase*Verification` uses `SOCKET_OPS` refs: re-run them).
- **Tests:** new shared harness `dev/tools/sims/lib/socketHarness.mjs`, a fake server that stamps `userId` and routes to N clients, including two GMs. T1 (forged sender is ignored). All 108 existing sims.
- **Runtime:** two-client smoke test: send mail, claim, call, watch, payphone ring.

### B1 — One GM handles each request *(INT-01, DATA-09 multi-GM, L4)* · **S–M**
- **Changes:**
  - `isPrimaryGM()` at the top of every REQUEST-class handler that is gated on `isGM` only (34 of 36 in `SocketHandlers.js`, plus `SchedulingService` and the call and conversation handlers already done).
  - Every `setInterval` reaper: self-destruct, payload, resident, forged-account and countdown.
  - `MigrationRunner.runMigrations`.
- **Preserve:** single-GM worlds (identical); Assistant-only worlds (`activeGM` resolves to the Assistant).
- **Regressions:** an Assistant GM who is not active no longer handles relays. That is the intended effect.
- **Tests:** T4 (two GMs, one relay → one application) on the harness; migration run with two GMs.
- **Runtime:** two GM accounts: mail, traced failure, plant fire.

### A2 — No executable references from relays *(SEC-02)* · **S–M**
- **Changes:**
  - `applyUploadRun` ignores a payload `macroId`. A program's linked macro is read from the program entry on the GM side.
  - Every macro execution path (`applyUploadRun`, resident `adjudicate`, `applyPayloadEffect`, `applyMalwareEffect`) refuses a macro whose `author` is not a GM.
  - `effectType` is allowlisted against `PROGRAM_EFFECTS`.
  - `handleResidentRequest` sanitizes the resident (allowlisted fields and verbs; `slotKey`/`stealthDV` derived on the GM).
- **Preserve:** GM-authored payloads and residents with linked macros still run them (the intended GM automation). Player programs keep every native verb.
- **Regressions:** a player-authored program that links a macro written by a player stops running that macro. **Gameplay note:** this is the escalation itself; the native effect still applies.
- **Tests:** a sim pushes `uploadRun` with a foreign `macroId` and expects no execute; a GM-authored resident with a GM macro still fires.

### A3 — Relay authorization by intent *(SEC-04/05/06/07/21/22, plus the remaining SEC-03 `gmToast`)* · **L, split into five reviewable sub-batches**

| Sub-batch | Ops | Rule | Preserve |
|---|---|---|---|
| **A3a** Content & money | CONTENT_UPDATE, BANK_SIPHON, PAYLOAD_EFFECT | The request names an **action** (`claim` / `siphon` / `crack` / `unlock` / `declassify` / `run` / `kill` / `sniff` / `camLoop`…) plus `messageId`. The GM re-reads the page, checks the sender can see it (it is in a journal they are OBSERVER on) and acts through an owned actor, then computes the new `contentData` itself. `gmToast` is removed; the GM builds its own text | Every content action in all three viewers; trace on fail; claim animation |
| **A3b** Shards | SHARD_STATE, SHARD_INTEGRITY, SHARD_CONVERT, SHARD_UNCONVERT | Item OBSERVER or higher for state/integrity, OWNER (or embedded on an owned actor) for convert/unconvert; `session` only for an actor the sender owns; `destroy` only when the shard's own self-destruct config allows it | Player hacking of world shards they don't own (the 2026-10-21 relay); Encoder convert/re-encode |
| **A3c** Terminals | TERMINAL_EXFIL, TERMINAL_NET, TERMINAL_SESSION, TERMINAL_RESIDENT | Per-action exfil policy resolved on the GM; ids must belong to the account; target inbox actor must be owned by the sender (or be the forward recipient chosen from contacts); residents sanitized (A2) | Exfil to Agent/shard/forward/leak/sell/wipe, uplink relays, sessions, uploads |
| **A3d** Mail & social | MESSAGE_RELAY, SCHEDULE_SYNC, CONTACT_SHARE_RELAY, ANON_TRACE_REQUEST | `fromActorId` owned by the sender, or an identity of a character they own (identities rule), or a `terminalSend` that passes `verifyAccountSend`; schedule edit/cancel only by `createdBy` or a GM; contact share only from an owned sender; anon trace only for mail in an inbox the sender owns and `anonymous.traceable` | Player mail, groups and fan-out, aliases (Sending as), terminal send-as, scheduling, Data Drop, trace-to-unmask |
| **A3e** World systems | NETWORK_NODE, TRACE_REQUEST, LOG_RELAY, CALL_LOG_REQUEST, CALL_EMERGENCY add/arrive, CALL_OVERHEARD enhance, NET_RESOLVE_CANCEL | Node actions need a live run by an owned actor (or switching an unlocked box on its own scene); traces only for an owned actor; call logs only for calls the active GM saw with the sender as a party; emergency rows rebuilt from validated fields; enhance clamped to a GM-side rolled or allowed value | Jack-in session actions, trace/heat logging, call logs, emergency flow, overhear |

- **Regressions (all A3):** an honest flow that relays on behalf of a character the user doesn't own. Known case: the GM-without-character "force" paths run locally on the GM and don't relay. Each sub-batch gets a matrix sim (T2): owned → allowed, foreign → refused.
- **Runtime:** a two-client pass over each sub-batch's flows.

### A4 — Escaping layer *(SEC-03, SEC-11, SEC-12, SEC-16, SEC-17, SEC-19)* · **M**
- **Changes:**
  - `helpers.js`: `escapeHtml` and a tagged template `safe` that escapes interpolations only.
  - Mechanical change at the 393 interpolating `ui.notifications.*` sites: insert the `safe` tag. Sites that deliberately interpolate pre-built HTML (to be listed by a scan before editing) get reviewed by hand.
  - Escape the Overview activity builders (`AdminPanelApp.js:1088-1213`), composer autocomplete, GM dialog contents (route through `dialogBodyHtml`), and add-contact toasts.
  - A `{{ncm-tip x}}` helper (double-escape) for `data-tooltip` sites carrying player text.
  - The 45 local `esc` copies stay. Consolidating them is churn with no security benefit.
- **Preserve:** the look of every toast; deliberate `<b>` and line breaks in literals.
- **Tests:** T10 (render paths with an actor named `<img src=x onerror=window.__x=1>` in a DOM harness); a lint sim that fails on an untagged interpolating toast.
- **Runtime:** rename a test PC to `<i>X</i>` and walk mail, trace and Overview.

### A5 — Receive-side HTML and sanitizer *(SEC-09, SEC-10, SEC-13, SEC-14, SEC-15, SEC-18, SEC-20, SEC-23/FBL-04)* · **M**
- **Changes:**
  - `richText.safeUrl` fully decodes entities and strips control characters before the scheme test (allowlist http/https/mailto/relative).
  - `cleanStyle` accepts `var(--ncm-*)` without a fallback, in color and font properties only.
  - `mountMirror` keeps only `data-*` keys, class tokens and custom-property pairs.
  - Watch accepts snaps only from the share's operator.
  - The overheard HUD accepts HUD ops only from a GM (RESULT class).
  - Composer quote, forward and draft bodies go through `cleanHtml(mode:'mail')`.
  - `enrichContent` always cleans `body`; `scanReport` is cleaned.
  - Access-macro labels strip U+2028/U+2029 (or use `JSON.stringify`).
  - `cleanMirror` becomes an allowlist.
- **Preserve:** rich mail formatting (bold, lists, colors from the module palette, images), watch fidelity, the overheard garble.
- **Tests:** T11 fuzz (extend `test-rich-paste.mjs`), a watch snapshot with handler attributes, a forward containing hostile markup.

### A6 — Call privacy *(PRIV-01/02/03)* · **L, design decision needed**
- **Options:**
  - (a) Correct the documentation and accept "masked on screen".
  - (b) Never broadcast the real identity: the booth/anonymous caller's client keeps it and hands it to the GM in a whispered ChatMessage, which the server filters.
- **Recommendation:** fix PRIV-02 and PRIV-03 (small) now; decide (a) or (b) for PRIV-01. Deferred until you choose.

### B2 — Money and persistence guards *(DATA-01, DATA-02, DATA-20, DATA-08)* · **S**
- **Changes:**
  - `canPersistContent()` at the top of `runSiphon` and payload execute.
  - The shard `claimEddies` checks `canPersistContent()` before crediting, and does not report success if the persist fails.
- **DATA-08** (payload charges never decrement) **is a gameplay rule change.** Charges were authored to limit runs. Confirm you want them enforced.
- **Preserve:** GM-present behavior unchanged. GM-absent: refused with the existing "needs a GM online" warning.

### B3 — Relay ack and retry *(DATA-06, INT-12, ARCH-01 for relays)* · **M**
- **Changes:**
  - Keep `messageId` across retries; the GM de-duplicates by id before writing.
  - The GM sends an immediate "accepted" ack, then the final one.
  - The player's refund waits for a definite failure.
  - `try/finally` guarantees the final ack.
  - The player's queue-drop also checks `_flushing`.
- **Preserve:** the composer's Delivered / Queued / Failed overlays (CLAUDE.md "relay ACK").
- **Tests:** T8 with a delayed GM handler on the harness.

### B4 — Serialized writers *(DATA-04, DATA-15, INT-02, INT-03, INT-06, INT-09, INT-11)* · **M**
- **Changes:** one `serialize(key, fn)` helper (a promise chain per key, the existing `NODE_WRITERS` design) used by:
  - `recordTrace`/`bumpHeat`/`setHeat`/`startCountdown` (key `trace`);
  - `_quarantinePage` (key `bin`; delete the page only after the record reads back);
  - `recordDeliveryFailure`;
  - `getInboxJournal` creation (key `inbox:<owner>`) and subfolder creation;
  - `terminalState` writers (key `term:<itemId>`, joining the existing session queue);
  - shard `state` writers;
  - `degradeIntegrity`.
- **Why a generic helper is justified:** seven findings share the same shape, and the pattern already exists in three places.
- **Preserve:** all write results; no schema change.
- **Tests:** T5 (two un-awaited writes both survive) per writer.

### B5 — Scheduling *(DATA-11, DATA-12)* · **S–M**
- **Changes:**
  - Cancel and edit become GM request/response; refund only after the GM confirms the entry was still pending.
  - Entries are marked `delivering` before `sendMessage`.
  - Player entries run `_resolveRecipient` and `verifyAccountSend` at schedule time.
- **Preserve:** the Edit-reopens-composer flow and `eddiesHeld` accounting.

### B6 — Disconnects *(DATA-14, DATA-17, DATA-21, payphone stale `inUse`)* · **S**
- **Changes:** `userConnected` hooks:
  - the player flushes held mail when a GM connects;
  - calls end with `dropped` when a party leaves;
  - payphone `inUse` entries are cleared for users who leave, and `use` packets are accepted only when `entry.userId === sender`.

### C1 — Init order + helper independence *(COMPAT-01, FBL-07, FBL-01)* · **M** (see §6)
- **Tests:**
  - A sim that loads `main.js` with a mocked `Hooks`/`game` and asserts settings, keybindings, layer and enricher are registered before the first await resolves.
  - The template guard sim.
  - Render the 16 converted sites through Handlebars with **social-navigator's helper file loaded after NCM's** (it is plain JS and importable).
- **Runtime:** uncached reload; "Slow 3G" reload; social-navigator enabled.

### C2 — `isGM` shadow *(COMPAT-03)* · **S**

### C3 — CPR hotbar *(COMPAT-02)* · **S–M**
- **Runtime:** with the CPR system: drag a terminal, a shard and an admin rack row to the hotbar.

### D1 — No inbox creation from badge counts *(PERF-01)* · **S**
- **Changes:**
  - `getInboxJournal(id, {create:false})` for `getUnreadCount` and every count or scan path.
  - Remove the duplicate badge listener set; debounce `refreshBadge`.
- **Cleanup of already-created empty inboxes:** offer it as a *listing* in Orphan Audit ("empty inbox for an actor that never received mail"), never auto-deleted. Needs your approval.
- **Runtime first:** count stray journals in your live world.

### D2 — Directory reload *(DATA-07)* · **S**
- **Change:** an `updateSetting` hook for `masterContacts` calls `_loadContacts()` and emits `CONTACT_UPDATED`.
- **Preserve:** the second GM no longer overwrites with a stale array (with B1, only the active GM writes relayed changes).

### D3 — Persist security lockouts *(DATA-05)* · **M–L, design**
- **Change:** a GM-written world setting `securityLockouts` `{ "actor::target": {attempts, lockedUntil (game ms)} }`. Players read it; the GM writes it (player failures relay through `SECURITY_REPORT`, which already exists).
- **Preserve:** game-time expiry, forced lockouts, the Admin views.
- **Migration:** none (new key).
- **Risk:** this changes where lockout truth lives. Shard lockouts already persist in item `sessions` and stay as they are.

### D4 — Listener stacking *(PERF-02, PERF-03)* · **S**
- **Changes:** bind once; add a `_creating` guard.

### D5 — Scan caching and growth *(PERF-05, PERF-06, PERF-07, PERF-09, PERF-11)* · **M**
- **Changes:**
  - A dirty-flag cache for the admin mail scans, invalidated by the DocumentSyncBridge page hooks.
  - Debounce `_refreshIfTab`.
- **Recycle-bin cap (PERF-07) evicts old entries:** behavior change, needs your approval. Alternative: move pages to a GM-only journal.

### D6 — Watch chatter *(PERF-04)* · **S**
- **Changes:** set `nextAt` on the `tooBig` path; a `data-watch-ignore` attribute on the node console wave.

### E — Remaining defects and improvements · **S each, batched by file**

| Group | IDs |
|---|---|
| E1 persistence fields | DATA-13 (`signalDegradation`), DATA-19 (`isBroadcast`), INT-04 (`tapLog`) + T9 round-trip sim |
| E2 references and cleanup | DATA-09 (sequencing after a declined namespace migration), DATA-10 (carried terminals), DATA-16 (deletion fallbacks + Orphan Audit), INT-08 (archive guard), DATA-18 (payphone voicemail), DATA-22 (`line` sender = `answeredBy`) |
| E3 notifications | INT-07 (doc-sync toasts for tap/exfil/second GM), INT-05 (`_tap` in the queue), INT-10 (dot-path flag writes) |
| E4 compatibility small | COMPAT-04/11 CSS leaks, COMPAT-08 try/catch, COMPAT-10 PopOut, COMPAT-06 context-menu hook; **behavior changes needing approval:** COMPAT-07 (stop forcing notes on), COMPAT-09 (DSN roll mode) |
| E5 perf small | PERF-08 waveform, PERF-10 conversation journal map, PERF-12 ring self-check |
| E6 hygiene | ARCH-02 (surface failed init tasks to the GM), ARCH-03 (log version) |

---

## 9. Testing and regression strategy

### 9.1 New infrastructure (built in A1, reused by every batch)

`dev/tools/sims/lib/socketHarness.mjs` provides:
- a fake Foundry server that stamps `userId` and routes `emit` to N clients, including two GMs and an offline GM;
- per-client `game.user`, `game.users.activeGM`, actors and ownership;
- a hostile client that emits arbitrary payloads.

Reuse the scripted two-client pattern in `test-send-feedback.mjs` as the seed.

### 9.2 Scenario coverage

| Test | Batch | Automated (sim) | Needs live Foundry |
|---|---|---|---|
| T1 forged sender | A1 | ✔ | Two-client smoke |
| T2 relay entitlement matrix (per op) | A3a–e | ✔ | Per-flow two-client pass |
| T3 GM→client authority | A1/A3 | ✔ | — |
| T4 two GMs | B1 | ✔ | Two GM accounts |
| T5 concurrent writers | B4 | ✔ | — |
| T6 no GM online | B2 | ✔ | Quick |
| T7 claim race | A3a/B2 | ✔ (GM check-and-set) | Two players |
| T8 ack timeout | B3 | ✔ | — |
| T9 persistence round-trip | E1 | ✔ | — |
| T10 hostile names in renders | A4 | ✔ (jsdom-like DOM harness or headless page) | Rename a PC |
| T11 sanitizer fuzz | A5 | ✔ (pure) | Click test |
| T12 directory reload | D2 | ✔ | Two clients |
| T13 badge on fresh world | D1 | ✔ | Count journals |
| T14 deletion cascade | E2 | ✔ | — |
| T15 disconnects | B6 | Partial | Reload mid-call |
| **T16 op classification guard** (new) | A1 | ✔ static | — |
| **T17 init registration before await** (new) | C1 | ✔ | Uncached / Slow 3G reload |
| **T18 helper independence with social-navigator** (new) | C1 | ✔ (real SN helper file) | SN enabled |
| **T19 CPR hotbar** (new) | C3 | — | CPR + drags |
| **T20 macro authorship rule** (new) | A2 | ✔ | — |
| **T21 gameplay smoke** (new) | every batch | — | Mail/claim/hack/siphon/upload/exfil/jack-in/call/payphone/watch walkthrough with one GM + one player |

### 9.3 Per-batch gate (runs after every batch)
1. `node dev/tools/check-syntax.mjs`
2. All sims in `dev/tools/sims`. Today 108 pass. Every new sim is added, and any failing sim blocks the batch.
3. `.hbs` balance check on touched templates.
4. Phase verification files that reference changed ops, re-read for compatibility.
5. A list of what still needs live Foundry, handed to you.

### 9.4 Re-verification before each fix
Each batch starts by re-reading the cited lines. If a finding no longer reproduces in code, it is reported and skipped rather than "fixed".

---

## 10. Outstanding uncertainties

- **Misclassified emitters.** An op I classed RESULT might be emitted by a player in a path I didn't trace. T16 plus the emitter scan mitigates this; a silently dropped legitimate packet is the main A1/A3 risk.
- **Hosting differences.** The Forge's latency (COMPAT-01) and read-only data paths are untested.
- **Whether PERF-01 already polluted live worlds,** and how many journals are involved.
- **Real GM relay durations** (DATA-06): whether the 8 s timeout is reached in practice.
- **pin-cushion's effect on NCM pins** (FBL-05).
- **Rule decisions that are yours:** payload charges (DATA-08), recycle-bin cap (PERF-07), DSN roll mode (COMPAT-09), forcing map notes on (COMPAT-07), call-privacy design (PRIV-01), cleanup of empty inboxes (D1).
- **Stage 2 was not blind.** A fresh-session Stage 2 could still surface issues neither audit found, particularly in `scripts/ui/**` HTML building and the uncommitted payphone code (the payphone review agent never ran).

---

## 11. Recommended first implementation batch

**A0 → A1, then stop.**

- **A0:** checkpoint the existing work (your choice of option a, b or c).
- **A1:**
  - Change `SocketManager` to the server-provided user id.
  - Add `isPrimaryGM` / `isFromGM` / `userOwnsActor` to `helpers.js`.
  - Thread the real sender into the handlers that drop it.
  - Add the op trust-class table as a frozen constant plus T16.
  - Build `socketHarness.mjs` with T1.
  - **No access rule changes yet.**
- **Why first:** behavior for honest clients is unchanged by construction. It removes the forgery primitive under SEC-08/09/10/21/22. Every later security batch depends on it.
- **Expected diff:** about 4 source files and 2–3 new sim files.
- **After the stop:** you run the two-client smoke test (send mail, claim eddies, a phone call, a payphone ring, watch a terminal), and I summarize the diff and remaining risk.

Proposed order after that, pending your approval at each stop: **B1 → A2 → A3a → A3b → A3c → A3d → A3e → A4 → A5 → B2 → C1 → D1 → (B3, B4, B5, B6, C2, C3, D2–D6) → E**, with A6 and the rule decisions taken when you've decided them.
