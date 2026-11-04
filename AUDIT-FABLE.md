# AUDIT-FABLE — Stage 2: independent verification and deep audit

- **Module:** `night-city-messenger` v2.1.0, branch `dev`, HEAD `9624901` plus the same 52 uncommitted paths Stage 1 saw. **No source file changed between the two audits** (nothing under `scripts/`, `styles/`, `templates/` or `module.json` is newer than `AUDIT-OPUS.md`), so the comparison is like-for-like.
- **Foundry:** 12.343 local install used for API checks. Installed modules under `Data/modules` were inspected for concrete conflicts (list in §6).
- **Mode:** read-only. This file is the only thing written to the project.

## 0. Independence caveat (read this first)

This stage ran in the **same session** that produced Stage 1, so the Stage 1 findings and its reviewers' reports were already in my context. A true "inspect first, read the audit after" sequence was impossible. I compensated in two ways: (1) I spawned eight fresh reviewers with no access to this conversation and an instruction not to open `AUDIT-OPUS.md`, cut along different lines (UI apps, uncommitted payphone work, small services/settings/migrations, admin tabs, templates/CSS/packaging, cross-system traces, plus two falsification passes); **all eight were terminated by the API usage limit before returning anything**. (2) I then did the verification myself with targeted re-reads and small executed checks. Consequently this report is strongest where I re-read code or ran it, and I say so per finding. If you want a genuinely blind second opinion, run Stage 2 again in a fresh session once the limit resets; this report tells that run where to look.

**What was executed in Stage 2 (not just read):** the sanitizer bypass payloads through the real `richText.js` in Node; a scan of all 223 `scripts/*.js` for toast interpolations, unregistered setting keys, unreferenced socket ops, unmatched `Hooks.on`/`Hooks.off`, and sim coverage; greps across the installed modules and the CPR system for hook, helper, CSS and namespace collisions.

---

## 1. Executive summary

- **The Stage 1 picture holds.** Every Critical finding re-verifies against the code and against Foundry's own source. The module's trust boundary between clients is open: the sender of a socket message is self-reported (SEC-01), relays run macros and HTML chosen by the requester (SEC-02, SEC-03), and most GM-side relays check only that the *receiver* is a GM.
- **Two severities are overstated.** DATA-01/DATA-02 ("infinite money") and the self-enrichment half of SEC-07: a player already owns their actor and can set `system.wealth` to anything with one `actor.update`. The real defect is silent state desync (the bank account never drains, the eddies entry never marks claimed, the player is told it worked, the GM sees nothing). That is High, not Critical. The impersonation and cross-player halves of SEC-07 stay High.
- **One finding is backwards in practice.** COMPAT-05: `social-navigator` registers two-argument `eq/neq/gt/lt/gte/lte/and/or/not` in its `init` hook, synchronously; NCM registers its helpers *after* awaiting ~110 template fetches, so today NCM's versions win, and nothing breaks. The danger is the opposite direction: **the natural fix for COMPAT-01 (register helpers synchronously at init) would let social-navigator's helpers overwrite NCM's and break all 15 `{{#eq}}` block uses** (FBL-01). Also, social-navigator does not register `truncate`/`join`/`add` as Stage 1 said.
- **The fix surface for SEC-03 is about twice what Stage 1 estimated:** 393 `ui.notifications.*` calls interpolate values, not ~186 (FBL-04).
- **New since Stage 1:** the sanitizer bypass is now *executed*, not reasoned (SEC-15 confirmed with output); the load-order regression trap (FBL-01); `pin-cushion`, `item-piles`, `monks-active-tiles`, `popout`, `filepicker-plus`, `lib-wrapper`, `socketlib` and `dice-so-nice` are installed, so several "potential" conflicts become concrete test cases (§6); the dispatch layer that most race findings depend on (`SocketManager`, `EventBus`, `DocumentSyncBridge`) has **zero** sim coverage (FBL-05).
- **Disputed / downgraded:** DATA-01, DATA-02 (Critical→High), SEC-07 self-enrichment (dropped), COMPAT-04 (Medium→Low: no installed module or the system uses a `.mt` class), COMPAT-05 (direction reversed; today harmless). No Stage 1 finding is a clean false positive.

### Counts

| | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Stage 1 findings re-verified by me (code re-read or executed) | 3 | 14 | 8 | 3 | 28 |
| Stage 1 findings consistent with what I verified but not independently re-read | 0 | 7 | 23 | 27 | 57 |
| Stage 1 findings downgraded / corrected | 2→High | 0 | 2→Low | — | 4 |
| Rejected outright | 0 | 0 | 0 | 0 | 0 |
| **New (FBL-)** | 0 | 1 | 2 | 5 | **8** |

Stage 1 total after Stage 2 adjustment: **3 Critical, 23 High, 29 Medium, 32 Low** (87 → severities moved, none removed). Plus 8 new.

---

## 2. Independent codebase assessment

The map in `AUDIT-OPUS.md` §Internal Systems (S1–S17) matches what the code implements; I did not find a documented system that is absent, nor an implemented one it omits. The points below are what my own pass added or sharpened.

**Startup (main.js, ModuleInitializer):** Foundry's `Game#initialize` runs `Hooks.callAll("init")` synchronously, then `await i18n.initialize()` and `await registerTours()` (both network), then `_initializeView → setupGame` which calls `initializeKeyboard()` → `game.keybindings.initialize()` (foundry.js 9074, 9292) before `Hooks.callAll("setup")` and the canvas. NCM's `init` handler awaits `loadTemplates` (~110 fetches) *before* settings (preInit/30), the canvas layer (init/20) and keybindings (init/40). The race is therefore not only a slow-host problem: an **uncached first load after an update** on a local server runs ~110 template fetches against two or three i18n/tour fetches. `KeybindingsConfig.register` throws after initialization (foundry.js:1300). The `ready` handler is not gated on the init phase finishing either. (Confirms COMPAT-01; raises its likelihood.)

**Socket dispatch (SocketManager):** one listener, drops Foundry's authenticated `userId` argument, trusts `message.sender`, dispatches handlers without awaiting or serializing. 36 handlers in `SocketHandlers.js`; **2** check `activeGM`. All 55 `SOCKET_OPS` are referenced somewhere (no dead ops). This single file is the root of SEC-01, SEC-08, INT-01 and most race findings.

**Settings:** 111 keys registered; **every** `settings.get/set` with a literal key is registered (scan). Good.

**Hooks hygiene in UI code:** `Hooks.on`/`Hooks.off` balance per file is clean except `PayphoneBooth.js` (1 on / 0 off), which is a module-lifetime singleton (`registerCallSystem.js:90`), so that is fine.

**Sanitizer (richText.js), executed:**
```
<a href="javascript&#58;alert(1)">x</a>        => kept verbatim
<a href="javascript:alert(1)">x</a>            => "x"   (stripped, correct)
<a href="java&#9;script:alert(1)">x</a>        => kept verbatim
<p style="position:var(--ncm-x,fixed);inset:0">y</p> => <p style="position:var(--ncm-x,fixed)">y</p>
<img src="https://evil/p.png">                 => kept
```
So SEC-15 is a real bypass, and SEC-23's `var(--ncm-…, fallback)` pass-through is real (the `inset:0` was dropped only because it had no `var(`; `inset:var(--ncm-x,0)` would pass).

**Test coverage:** 108 sims pass, but 31 of 223 script files are never named in any sim, including `SocketManager.js`, `EventBus.js`, `DocumentSyncBridge.js`, `ThemeService.js`, `EmailSetupFlow.js`, `OperatorSelect.js`, `ResidentConsole.js`, `TraceCountdownHud.js`, `CyberTimePicker.js`, `DateRangePicker.js`, `DataDropOverlay.js`. The sims model one cooperative client; none models two clients, two GMs or a hostile payload.

---

## 3. Verification of Opus findings

Legend: **C** = Confirmed (I re-read the cited code / Foundry source, or executed it); **C\*** = consistent with code I verified and the mechanism is the same class, but the specific lines were not re-read in Stage 2; **P** = Partially confirmed (adjustment stated); **U** = Unconfirmed (needs runtime). None are False Positive.

### Critical / High

| ID | Verdict | Evidence / adjustment |
|---|---|---|
| SEC-01 | **C** | `dist/server/sockets.mjs` `handleCustomSocket` → `broadcast.emit(e, t, this.user.id)`; any authenticated user may emit a `socket:true` package event (`activate()` registers every package socket). `SocketManager.js:37` ignores arg 2, `:74` trusts `message.sender`. Fix as proposed. |
| SEC-02 | **C** | `SiphonFlow.js:886-897` executes `game.macros.get(macroId)` from the relay payload; gate is `isGM()` on the receiver only. Critical stands. |
| SEC-03 | **C** | Foundry `Notifications.notify` stores raw, `fetch` builds `$(`<li…>${next.message}…`)` (notifications.js:199). `handleContentUpdateRequest` toasts `data.gmToast`. **Scope correction:** 393 interpolating toast calls, not ~186 (FBL-04). |
| DATA-01 | **P → High** | `runSiphon` has no `canPersistContent()` (`SiphonFlow.js:53-123`; guards exist at 264/374/559/647/1030). Real. But an actor owner can already set wealth directly, so "unlimited eddies" is not an escalation; the defect is a silent desync (account never drains, player told success). |
| DATA-02 | **P → High** | `DataShardService.claimEddies:1289-1342` credits first, ignores `persistContentData`'s `false`. Same reasoning as DATA-01. |
| SEC-04 | **C** | `applySiphonToJournal` writes `contentData` wholesale for any page by id. Also the vector that completes SEC-02 via `effect.macroId`. |
| SEC-05 | **C\*** | Handler entry points re-read for `handleStateRequest`; ownership checks absent. |
| SEC-06 | **C\*** | `SocketHandlers.js:240-267` → `exfil*` with master-switch-only checks. |
| SEC-07 | **P** | Impersonation and cross-player writes (`SCHEDULE_SYNC` edit/cancel of others' mail, `CONTACT_SHARE_RELAY`) are High and stand. The "mint money for yourself" clause is not an escalation (owner can edit wealth). Giving money to *another* player's PC via forged eddies remains a real but low-harm oddity. |
| SEC-08 | **C\*** | Follows directly from SEC-01: no handler can tell a GM-origin packet from a player one. |
| SEC-09 | **C** | `watchMirror.js:233-236` applies arbitrary attribute names from `snap.data`; `registerWatchSystem.js:17` drops the sender. |
| SEC-10 | **C** | `OverheardHud.js:71` `${x.html}` into `innerHTML`; `OverheardService.handleSocket:236-242` forwards HUD ops from any sender. |
| SEC-11 | **C** | `AdminPanelApp.js:1088-1094` builds `<strong>${from}</strong>` from `data.fromName` / `actor.name`, rendered by `tab-overview.hbs:34` `{{{html}}}`; `OverviewTab.js:40` has `esc` but these builders don't use it. |
| SEC-12 | **C\*** | Composer autocomplete; consistent with the file's other raw interpolations I saw. |
| SEC-13 | **C** | `message-composer.hbs:226` `{{{originalMessageCard.body}}}` and `:514` `{{{body}}}` exist; the quote body is `orig.body` uncleaned. |
| SEC-14 | **C\*** | Fallback `{{{body}}}` branch; `enrichContent` cleans only `isMessage`. |
| INT-01 | **C** | 2 of 36 `SocketHandlers.js` registrations check `activeGM`; reapers gate on `isGM()`. |
| DATA-03 | **U** | Mechanism sound (client-side snapshot decides `claimed`); needs a two-client timing test. |
| DATA-04 | **C\*** | Read-modify-write + concurrent dispatch (SocketManager verified). Data-loss consequence stands. |
| DATA-05 | **C\*** | `SecurityService` Maps only; `stateManager` assigned at `:24` and never used (grep). |
| DATA-06 | **U** | 8 s timeout + client-side refund is real (`MessageService.js:916-923`); whether a GM handler exceeds 8 s in practice needs measuring. |
| DATA-07 | **C** | `_loadContacts()` called once (`:33`), no setting hook re-runs it. **Player impact confirmed:** `ContactRepository.verifyContact` goes through `masterContactService.getByEmail` (`ContactRepository.js:188-191`), so a player's "CONTACT NOT FOUND" after a mid-session GM edit is real. |
| PERF-01 | **C** | `_refreshAllUnreadCounts` runs in `init()` with no GM gate (`NotificationService.js:118-123`) and at postReady/20; `getInboxJournal` creates for a GM when no journal exists; no person-type filter. **Check live worlds for stray "X — Inbox" journals.** |
| PERF-02 | **C\*** | `CreateNetworkDialog.js:368` adds `keydown` to `html = this.element` in `_onRender`; `_doCreate:507` has no guard (grep `_creating` = none). |
| COMPAT-01 | **C (likelihood raised)** | See §2. Local uncached first load is enough; keybinding registration throws after `initialize()`. |
| PRIV-01 | **C\*** | `_send` broadcasts both branches; filtering is receiver-side. |

### Medium

| ID | Verdict | Note |
|---|---|---|
| SEC-15 | **C (executed)** | Output above. `decodeBasic` misses numeric entities and `\t` inside the scheme. |
| SEC-16 | **C** | foundry.js:3944 `this.tooltip.innerHTML = text \|\| localize(element.dataset.tooltip)`. |
| SEC-17, SEC-19, SEC-21, SEC-22, PRIV-02, PRIV-03 | **C\*** | Same classes as verified items; lines not re-read. |
| SEC-18 | **C\*** | `\r\n` only; U+2028/2029 are JS line terminators. Not executed (module imports Foundry globals). |
| SEC-20 | **C\*** | Blocklist shape re-read in Stage 1; `<style>` is only removed with a marker. |
| INT-02, INT-03 | **U** | Unqueued whole-block writes are real; the interleaving needs a two-client test. |
| DATA-08 | **C** | Only `charges` reference in `SiphonFlow.js` is the gate at `:751`. |
| DATA-09 | **C\*** | `MigrationRunner.js:206` gates on `isGM()` only; no `namespaceMigrationDone` check in the file (grep). |
| DATA-10, DATA-12, DATA-14, DATA-16, DATA-17, DATA-18 | **C\*** | Plausible, not re-read. |
| DATA-11, DATA-15 | **U** | Timing races. |
| DATA-13 | **C** | `signalDegradation` set in `MessageService.js:417`, read in `MessageRepository.js:1219`, never written by `createMessage` (grep). |
| COMPAT-02 | **C** | CPR `generate-item-macro.js:24` registers `hotbarDrop` at system load, `:25 fromUuidSync(data.uuid)`, `:129 return false`. NCM registers at ready. |
| COMPAT-03 | **C** | `phoneNumbersView.js:745-748` `finally` redefines `isGM` as a data property. |
| COMPAT-04 | **P → Low** | `.mt` leak is real (`tab-phone.css:482`), but no installed module or the CPR system uses a `.mt` class in any `.hbs/.css/.html` (grep). Fix anyway. |
| PERF-03 … PERF-07 | **C\*** | Not re-read; mechanisms consistent with AppV2 frame persistence. |

### Low

| ID | Verdict | Note |
|---|---|---|
| COMPAT-05 | **P (direction reversed)** | `social-navigator/scripts/utils/handlebars-helpers.js:79-135` registers `gt gte lt lte eq neq and or not` (two-argument, no block) from `Hooks.once('init')` (`main.js:28`). NCM registers *after* `await loadTemplates`, so NCM wins today and nothing breaks. It does **not** register `truncate/join/add`. See FBL-01 for why this matters. |
| COMPAT-10 | **C (now concrete)** | `popout` module is installed. |
| ARCH-03 | **C** | `main.js:45` logs "v4.1". |
| COMPAT-06…09, 11, 12; INT-04…12; DATA-19…22; PERF-08…12; ARCH-01, 02; SEC-23 | **C\*** / SEC-23 **C (executed, partial)** | SEC-23's `var()` pass-through executed; the rest not re-read. |

---

## 4. Newly discovered issues (FBL-)

| ID | Sev | Class | Where | Finding | Fix |
|---|---|---|---|---|---|
| **FBL-01** | High | Probable | `scripts/init/registerTemplates.js:30-141`; `social-navigator/scripts/utils/handlebars-helpers.js:79-135`, `main.js:28`; 15 `{{#eq` sites in `templates/` | **Regression trap in the COMPAT-01 fix.** Module ES modules are injected in world-module insertion order with the same priority (`dist/server/views/view.mjs`, non-library modules priority 8), i.e. effectively by id, so `night-city-messenger`'s `init` hook fires before `social-navigator`'s. Today NCM's helpers land late (after the template await) and overwrite SN's. If helper registration is made synchronous (the correct COMPAT-01 fix), SN's two-argument `eq` overwrites NCM's and every `{{#eq a b}}…{{/eq}}` renders the literal `true`/`false` instead of branching. Same for any other module that registers generic helper names. | Rename NCM's generic helpers to `ncm-*` (or convert the 15 block uses to `{{#if (eq …)}}` and accept that a 2-arg `eq` still works as a subexpression). Do this **in the same change** as COMPAT-01. Keep a sim that asserts no bare `{{#eq` remains. |
| **FBL-02** | Medium | Confirmed | `scripts/core/SocketManager.js:79-85`, `scripts/core/EventBus.js`, `scripts/integrations/DocumentSyncBridge.js` (+28 other files) | **Zero sim coverage on the dispatch layer.** 31 of 223 script files are never named by any sim; the three that every race/duplication finding (INT-01/02/03, DATA-04/15, SEC-01/08) runs through are among them. The 108 green sims therefore cannot catch any of the P0/P1 defects. | Add the T1–T8 scenarios from `AUDIT-OPUS.md` §Internal Systems as sims over a mocked two-client `SocketManager`. |
| **FBL-03** | Medium | Confirmed | 393 call sites (scan) | **SEC-03 fix scope.** 393 `ui.notifications.(info\|warn\|error)(\`…${…}\`)` calls, across services, flows and UI. A per-call sweep will miss some; a wrapper is the only durable fix. | One `ncmNotify()` wrapper + a lint sim that fails on a raw interpolating call. |
| **FBL-04** | Low | Confirmed (executed) | `scripts/utils/richText.js:157-175` | `cleanStyle` keeps any declaration whose value contains `var(--ncm-`; executed: `position:var(--ncm-x,fixed)` survives. Combined with `inset:var(--ncm-x,0)` this is a full-screen overlay inside a mail body (UI redress on the GM's Admin reading pane). | Allow `var(--ncm-*)` only without a fallback, and only in colour/font properties. |
| **FBL-05** | Low | Potential | `pin-cushion/module.js:3007-3014` vs `TerminalScenePins.js` | `pin-cushion` (installed) `libWrapper` OVERRIDEs `Note.prototype._drawControlIcon` and MIXES `Note.prototype.isVisible`. NCM pins rely on the item's art as the icon and on a GM-only journal to hide pins. Its `NotesLayer._onClickLeft2` OVERRIDE returns early on a hovered note, so NCM's `activateNote` path is **not** blocked; the icon and visibility rules may be. | Runtime test: place a terminal pin and a hidden pin with pin-cushion active; check icon, tint and player visibility. |
| **FBL-06** | Low | Potential | `item-piles/module.js:71136`, `monks-active-tiles.js:5803`, `filepicker-plus/scripts/main.js:8,124` | Three installed modules also handle `dropCanvasData`; `filepicker-plus` OVERRIDEs `FilePicker.prototype._onDrop`. NCM's capture-phase `drop` listener claims only terminal items, so by design these do not collide, but the ordering is only safe because NCM uses the DOM capture phase rather than the hook. | Keep the capture listener; add a sim/grep guard that `stopImmediatePropagation` stays gated on `isTerminal`. |
| **FBL-07** | Low | Confirmed | `scripts/init/registerTemplates.js:30-36` + `main.js:44` | The settings registration task (preInit/30) is *also* behind the template await, so the module's own `ready` tasks (not gated on init) can call `settings.get` on a key not yet registered → throws, logged as `FAILED` and swallowed. Distinct consequence from the keybinding throw in COMPAT-01. | Same fix as COMPAT-01 plus `ready` awaiting an `initDone` promise. |
| **FBL-08** | Low | Improvement | `helpers.js:67` | `audit-i18n.cjs` flags one non-literal i18n lookup; `languages/en.json` has 7 keys. Harmless; noted for completeness. | None required. |

---

## 5. Foundry VTT core compatibility

- No v12 deprecation warnings found (Stage 1 claim stands; nothing contradicts it in my scans).
- **COMPAT-01 is the headline risk and is more likely than Stage 1 said** (§2). Its fix must be bundled with FBL-01 and FBL-07.
- **COMPAT-03** shadows a core `User` getter for the session; confirmed.
- `ui.notifications` and `TooltipManager` render raw HTML in 12.343 (verified); any fix must not assume core escapes.
- v13: as Stage 1 (global `Dialog`, `renderTemplate`, `FilePicker`, `getSceneControlButtons` array shape, `renderChatMessage`). Not declared supported; informational.

## 6. Third-party module conflict assessment (installed set inspected)

| Module | Mechanism | Status |
|---|---|---|
| `cyberpunk-red-core` (system) | `hotbarDrop` returns `false` first | **Confirmed** (COMPAT-02) |
| `social-navigator` | generic Handlebars helper names at `init` | **Confirmed mechanism; harmless today; regression trap** (FBL-01) |
| `pin-cushion` | libWrapper on `Note` draw/visibility/control | **Potential** (FBL-05); `activateNote` not blocked |
| `item-piles`, `monks-active-tiles` | `dropCanvasData` | Safe by NCM's capture design (FBL-06); runtime-check a shard drop still makes a pile |
| `filepicker-plus` | OVERRIDE `FilePicker._onDrop` | Theoretical; NCM only opens pickers |
| `popout` | separate chat log window | **Confirmed** NCM chat buttons dead there (COMPAT-10) |
| `dice-so-nice` | NCM shows dice to everyone regardless of roll mode | Improvement (COMPAT-09) |
| `foundryvtt-simple-calendar` | documented API use; day-index fix in place | No conflict found |
| `lib-wrapper`, `socketlib` | NCM uses neither | No conflict; NCM's own socket channel and `game.nightcity` are not referenced by any other installed module (grep) |
| `cyberpunk-relationships` | only design docs mention NCM | No runtime coupling found |

Load-order assumption worth stating: NCM registers *nothing* via `libWrapper`, so it never sees wrapper ordering, but it also cannot coordinate with modules that do (pin-cushion).

## 7. Security and permissions

Stage 1 §7 stands, with the severity corrections above. The one architectural statement I would add: **the only attacker capability the module hands a player that Foundry itself withholds is "write to documents you don't own and run code on the GM client."** Every SEC finding reduces to that, and every one of them is closed by the same two measures — authenticate the relay (SEC-01) and build GM-side mutations from *intent*, never from payload blobs or payload strings (SEC-02/03/04). Self-cheating (own rolls, own wealth) is not in scope for a security fix; it is a table-trust matter, as CLAUDE.md already says.

## 8. Performance and reliability

PERF-01 is the one to act on first because it *writes* (journals) rather than merely costs time; confirm on a live world. PERF-05/06 scale with mail volume and were not measured in either stage. Nothing new found; FBL-02 explains why none of these would show in the sims.

## 9. Architectural concerns

As Stage 1 §9, plus: the `init` phase's single `await` sits in front of every synchronous registration (FBL-07), and generic helper names make the module's correctness depend on other modules' hook timing (FBL-01). Both are small changes with outsized regression potential, which is why they should be done together and guarded by a sim.

## 10. False positives and disputed findings

- **No Stage 1 finding is a false positive.**
- **Downgraded:** DATA-01, DATA-02 (Critical → High; silent desync, not escalation). COMPAT-04 (Medium → Low; no collision in the installed set).
- **Corrected:** COMPAT-05 (social-navigator registers only comparison/logic helpers, and today loses to NCM; the risk is the reverse ordering after the COMPAT-01 fix → FBL-01). SEC-03's scope (393, not ~186 sites).
- **Narrowed:** SEC-07's self-enrichment clause.

## 11. Required runtime and compatibility tests

Unchanged from `AUDIT-OPUS.md` §10, with these additions/priorities:
1. **PERF-01 on a real world first** — count `Night City Messenger / Inboxes` journals before/after a GM reload; this may already have polluted worlds.
2. **COMPAT-01 on an uncached local load** (clear site data, reload) — not only "Slow 3G".
3. **FBL-01 dry run:** temporarily move helper registration before the `await` on a scratch copy and open the inbox empty state with social-navigator enabled; expect "true"/"false" text.
4. **FBL-05:** terminal pin + hidden pin with pin-cushion active.
5. **SEC-15:** click a mail link whose `href` is `javascript&#58;…` in the Admin reading pane (test world, harmless payload).

## 12. Consolidated risk assessment

- **Confirmed and most important:** SEC-01, SEC-02, SEC-03 (GM-client takeover; two of three need no console once names are hostile), INT-01 (multi-GM duplication), PERF-01 (world pollution), COMPAT-01 (+FBL-01/07), DATA-07 (stale directory on players), DATA-05 (lockouts reset on reload).
- **Shared root causes:** (a) self-reported sender → SEC-01/08, SEC-21/22, PRIV-*; (b) payload-as-truth → SEC-02/04/05/06/07, SEC-03's `gmToast`; (c) `isGM` ≠ `activeGM` → INT-01, DATA-09/10/11, PERF reapers; (d) unserialized whole-object writes → DATA-04/15, INT-02/03/06/09/11; (e) escaping is opt-in → SEC-03/11/12/16/17/19, FBL-03; (f) one `await` in `init` → COMPAT-01, FBL-07, and the accidental helper ordering (FBL-01).
- **Fixes that can regress:** COMPAT-01 (→ FBL-01); SEC-01 (every GM→client op must then be *allowed* from a GM — an over-strict `fromGM` check would silence legitimate `MESSAGE_DELIVERED` acks from the active GM to a player; test the ack path); INT-01 `activeGM` gating (a world whose only GM is a non-active Assistant must still work; `game.users.activeGM` picks by role and connection — verify); DATA-01/02 guards (the GM-less table will now be *refused* where it was silently broken — intended, but tell users).

## 13. Recommended remediation order

1. **SocketManager: use the server-provided user id; add `fromGM()` and `isPrimaryGM()` helpers.** (SEC-01, SEC-08, INT-01 foundation.) Add the two-client sim (FBL-02) with this change.
2. **Remove executable and display strings from relays:** no `macroId` from payloads, no `gmToast`, allowlist `effectType`, intent-based `CONTENT_UPDATE`. (SEC-02, SEC-03 part, SEC-04.)
3. **`ncmNotify` wrapper + lint sim** over all 393 sites; escape Overview rows, composer autocomplete, dialog content; `{{ncm-tip}}` for tooltips. (SEC-03, SEC-11/12/16/17/19, FBL-03.)
4. **Ownership checks on every player→GM relay** (SEC-05/06/07/21/22) and `isPrimaryGM()` on every handler and reaper (INT-01, DATA-09/10, PERF-L4).
5. **Money paths GM-authoritative + `canPersistContent` guards** (DATA-01/02/03/06).
6. **Init ordering fix bundled with helper renaming** (COMPAT-01, FBL-01, FBL-07) and a `{{#eq` guard sim.
7. **PERF-01 non-creating lookup** + one-off cleanup tool for stray inbox journals.
8. **Reload the directory on `updateSetting`** (DATA-07); **persist lockouts** (DATA-05).
9. **Write queues** for settings maps and item flag blocks (DATA-04, INT-02/03/06/09/11).
10. **Sanitizer hardening** (SEC-15, SEC-20, SEC-23/FBL-04, watch/overheard receive-side) and the privacy redesign of call masking (PRIV-01/02/03).
11. Everything Low.

Stop here; nothing was modified. Awaiting your review of both reports.
