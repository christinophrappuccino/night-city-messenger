# AUDIT-OPUS — Night City Messenger, full technical audit (stage 1 of 2)

- **Module:** `night-city-messenger` v2.1.0 (working tree on branch `dev`, including uncommitted payphone work)
- **Foundry:** module.json declares minimum 12, verified 12. Cross-checked against the local Foundry **12.343** install (`resources/app`) and the installed `cyberpunk-red-core` system.
- **Date:** 2026-11-04
- **Mode:** read-only. No source file was changed. This report is the only file written to the project.

---

## How to read this report

**Classification**
- **Confirmed**: the code path shows the defect directly. Every finding marked **[lead-verified]** was re-read by the lead auditor against the source, and against Foundry's own code where that matters.
- **Probable**: the code path is confirmed, but the timing or the live effect was not reproduced.
- **Potential**: a plausible risk that needs investigation.
- **Improvement**: optional; not a defect.

**What was executed**
- `node dev/tools/check-syntax.mjs`: 345 files parse as ES modules, 0 broken.
- All 108 `dev/tools/sims/test-*.mjs`: 108 pass, 0 fail.
- `node dev/tools/audit-i18n.cjs`: no missing keys.
- Nothing was run inside Foundry. Every multiplayer, timing and UI claim below comes from static analysis. **The existing sims passing does not contradict any finding here.** The sims mock a single cooperative client. They do not model a hostile client, several GMs, or concurrent socket handlers.

**Line numbers** are from the current `dev` working tree and will drift.

**Threat model.** Two attacker levels are used throughout:
- **(a) In-game only.** A normal player who can rename their own character and items, and author their own messages and shards.
- **(b) Browser console.** A player who can also run JavaScript in their own client. Anyone can do this with F12. It is the realistic model for any table that is not fully trusted, and for anyone who joins a public game.

---

## 1. Executive summary

The module has very broad features, an unusually large set of in-repo logic sims, and careful handling of many Foundry quirks. Its weak point is the **trust boundary between clients**.

**1. Clients are trusted to say who they are.**
- The module identifies the sender of every socket message from a field the sending client writes itself (SEC-01).
- Most player→GM relays check only that the *receiving* client is a GM. They do not check whether the *requesting* user may act on the target.

**2. A player can run code on the GM's client.** A player who uses the browser console can make the GM's client:
- run any world macro, with GM rights (SEC-02);
- display attacker-supplied HTML in a toast, which runs script (SEC-03);
- delete, unlock or rewrite any shard, terminal file or message (SEC-04 to SEC-06);
- forge mail and create eddies from nothing (SEC-07).

**3. Some of the same script injection needs no console at all.** A character or item **name** containing HTML reaches unescaped HTML in several places on the GM's client:
- toasts (Foundry v12 renders toast text as HTML, verified);
- the Admin Overview activity feed;
- the composer's To autocomplete;
- tooltips.

**4. There are money bugs that need no hacking.**
- Siphoning, or claiming eddies on a shard, while no GM is connected credits the player's wealth and then fails to persist the "drained" or "claimed" state. The player can repeat it indefinitely (DATA-01, DATA-02).

**5. Cross-system reliability problems cluster around a few causes.**
- **Every connected GM runs most relay handlers and reapers.** Worlds with an Assistant GM double-deliver mail, double-add heat, fire plants twice and run macros twice (INT-01).
- **Whole settings and flags are read, changed and written back with no queue.** Logs, heat, recycle-bin entries and terminal residents can be lost.
- **Some state lives only in a client's memory.** Security lockouts reset when the page is reloaded. The GM's directory cache never refreshes on other clients.

**6. Foundry compatibility is mostly clean.**
- There are no v12 deprecation warnings, no monkey-patches and no libWrapper dependency.
- The three real compatibility risks are:
  - initialization awaits template loading before it registers settings and keybindings (COMPAT-01);
  - the CPR system's `hotbarDrop` hook pre-empts the module's own (COMPAT-02);
  - a phone preview permanently shadows `game.user.isGM` on the GM's client (COMPAT-03).

**Overall.** For a table of friendly players with a single GM, the module is functionally rich and mostly stable. Static review cannot confirm compatibility or safety, so this is not a claim that the module is safe. Under the browser-console threat model, the current trust boundary is effectively open. Any player can gain full control of the GM's client. Fixing SEC-01, SEC-02 and SEC-03 should come before any wider or public release.

### Finding counts

| Severity | Confirmed | Probable | Potential | Improvement | Total |
|---|---|---|---|---|---|
| Critical | 5 | 0 | 0 | 0 | **5** |
| High | 16 | 5 | 0 | 0 | **21** |
| Medium | 26 | 5 | 0 | 0 | **31** |
| Low | 16 | 5 | 5 | 4 | **30** |
| **Total** | 63 | 15 | 5 | 4 | **87** |

Many findings share root causes. The core of the problem is about 10 issues; §11 groups them for fixing.

---

## 2. Codebase overview

| Area | Size and notes |
|---|---|
| JavaScript | 223 files under `scripts/`, about 128k lines; 345 `.js`/`.mjs` files including `dev/tools` |
| Templates | 106 `.hbs` |
| Styles | 100 `.css`, one entry point: `styles/night-city-messenger.css` |
| Build | none: Foundry loads `scripts/main.js` directly. `dev/tools` holds the sims, the macro-pack generator and the packaging script |
| Persistence | world settings (about 60), document flags under `night-city-messenger`, journals for inboxes, shards, terminals, conversations and call logs, and two macro compendium packs |
| Networking | one socket channel, `module.night-city-messenger`, about 60 `SOCKET_OPS` |
| Startup | `ModuleInitializer`, four phases (`preInit` / `init` / `ready` / `postReady`), tasks registered from 12 `scripts/init/register*.js` files |
| Tests | `scripts/tests/Phase*Verification.js`, run in Foundry under `debugMode`; 108 Node sims in `dev/tools/sims` |

---

## 3. Critical and high-severity findings

### SEC-01: The sender identity of every socket message can be forged
- **Severity:** Critical · **Category:** Security / multiplayer · **Confirmed [lead-verified]** · Confidence: high
- **Where:** `scripts/core/SocketManager.js:37-39` (listener), `:59-66` (emit), `:73-82` (router)
  ```js
  game.socket.on(`module.${MODULE_ID}`, (data) => { this._onMessage(data); });   // second argument dropped
  emit(...) { game.socket.emit(..., { operation, data, sender: game.user.id, ... }) }
  const { operation, data, sender } = message; if (sender === game.user.id) return; handler(data, sender);
  ```
- **What Foundry provides:** the Foundry 12.343 server forwards custom socket events as `emit(event, data, this.user.id)` (`dist/server/sockets.mjs`, `handleCustomSocket`). The **authenticated** user id is the listener's second argument. The module ignores it and uses `message.sender`, a value the sending client chooses.
- **Trigger:** from a player's console, `game.socket.emit('module.night-city-messenger', {operation: <op>, sender: <any user id>, data: {...}})`.
- **Consequence:** every check of the form "does `sender` own this actor", or "is `sender` a GM", can be satisfied by naming someone else. Affected checks include:
  - ConversationService `_owns`;
  - CallService `handleLineRequest`, `handleVoicemailRequest` and `handleAudio`;
  - Emergency `add`;
  - `forUserId` acknowledgements;
  - `reportedBy`.

  It is also the reason none of the GM→client ops (SEC-08) can safely check "came from a GM".
- **Fix:** `game.socket.on(name, (message, userId) => this._onMessage(message, userId))`. Route the server-provided `userId` to handlers and drop `sender` from the payload. Add a helper such as `fromGM(userId)`.
- **Runtime verification:** a two-client console emit (cheap; recommended to confirm the second argument in your hosting setup).

### SEC-02: A player can make the GM's client run any world macro
- **Severity:** Critical · **Category:** Security / privilege escalation · **Confirmed [lead-verified]** · Confidence: high
- **Where:**
  - `scripts/ui/content/SiphonFlow.js:886-897`, `applyUploadRun`:
    ```js
    if (macroId) { try { await game.macros?.get(macroId)?.execute?.({ actor, item: hostItem }); } ... }
    ```
    It is reached from `SOCKET_OPS.PAYLOAD_EFFECT_REQUEST` (`SocketHandlers.js:355-364`) through `handlePayloadEffectRequest` (`SiphonFlow.js:875-879`). The only gate is `isGM()` on the *receiving* client.
  - Related macro paths:
    - `TerminalService._fireResidentEffect`, `adjudicate` branch (about `:2137-2141`, `params.macroId`). A resident can be planted unvalidated with `TERMINAL_RESIDENT_REQUEST` (`UploadFlow.js:252`, `handleResidentRequest`).
    - `applyPayloadEffect` (`SiphonFlow.js:~847`) and `applyMalwareEffect` (`:~933`). Both read `effect.macroId` from page `contentData`, which SEC-04 lets any player rewrite.
- **Trigger:** emit `PAYLOAD_EFFECT_REQUEST` with `{kind:'uploadRun', itemUuid:<any item>, macroId:<id>}`.
- **Consequence:** the macro runs on the GM's client with GM permissions. The core "Use Script Macros" permission defaults to allowing players. So a player creates their own script macro and then has the GM run it. That is full world compromise: role changes, deleting the world's documents, reading everything. Even without that permission, any existing GM macro can be triggered. `effectType` and `params` are also arbitrary, so `wipe`, `corrupt` and `forgeAccount` can be run against any item.
- **Fix:**
  - Never accept a `macroId` (or any executable reference) from a relay.
  - Read effects only from authored, GM-owned data that the GM re-loads.
  - Refuse to execute a macro whose author is not a GM.
  - Allowlist `effectType`.
  - Sanitize `resident` objects on the GM side.
- **Runtime verification:** recommended; one console emit.

### SEC-03: HTML from players reaches the GM's toasts and runs as script
- **Severity:** Critical · **Category:** Security / XSS · **Confirmed [lead-verified]** · Confidence: high
- **Platform fact (verified):** Foundry v12 `Notifications.notify` stores the message unescaped, and `fetch` builds ``$(`<li …>${next.message}…`)`` (`client/ui/notifications.js:199`). Every `ui.notifications.*` call is therefore an HTML sink.
- **Where:**
  - **Payload text toasted directly:** `SiphonFlow.js:245-249`, `handleContentUpdateRequest`, does `if (data.gmToast) ui.notifications.info(data.gmToast);`. `data` is the player's socket payload.
  - **Payload fields interpolated:** `SiphonFlow.js:160-165` (`_alertGM`: `p.actorName`, `p.accountLabel`, `p.currency`, through `BANK_SIPHON_REQUEST`); `MessageService.handleMessageRelay` (about `:2037`: `` `Could not deliver ${who} → ${to}: ${why}` `` from `data.fromName`, `toName`); `handleAnonTraceRequest` (`data.byActorName`).
  - **No console needed: actor and item names in GM toasts during normal play:**
    - `TraceService.js:370-371` (`${p.actorName} tripped a trace…`);
    - `TerminalService.js:1997, 2019, 2277` (`_residentGmAlert`, which includes the player-chosen program name);
    - `SiphonFlow.js:284-290, 482, 691, 717, 803, 871`;
    - `UploadFlow.js:171, 190, 209, 242`.
- **Trigger:**
  - Console: one emit with `gmToast:'<img src=x onerror=…>'`.
  - In game: rename your character to an `<img onerror>` string, then fail a traced hack or upload a plant. Character names are a `StringField`, which the Foundry server does not sanitize.
- **Consequence:** script runs on every connected GM client, with no interaction needed. That is full world compromise.
- **Fix:**
  - Remove `gmToast` from the relay; the GM builds its own text from ids.
  - Add one wrapper, for example `ncmNotify(text)`, that escapes with `foundry.utils.escapeHTML` or `Handlebars.escapeExpression`, and route every `ui.notifications.*` call through it. There are about 186 call sites that interpolate values.
  - Add a lint grep that fails on `` ui.notifications.<x>(`…${ `` without the wrapper.
- **Runtime verification:** recommended (rename a test PC and trigger a trace).

### DATA-01: Siphoning with no GM online pays out repeatedly
- **Severity:** Critical (game economy) · **Category:** Data integrity · **Confirmed [lead-verified]** · Confidence: high
- **Where:** `scripts/ui/content/SiphonFlow.js:53-123`, `runSiphon`. It never calls `canPersistContent()`, which guards claim, unlock, deploy and analyze at `:264/:374/:559/:647/:1030`. The credit happens at about `:103`, and the persist is only a relay emit (`_persistSiphon`, `:150-157`).
- **Trigger:** a player siphons a bank entry while no GM is connected.
- **Consequence:** wealth is credited and the "drained" state is never written. The account stays full and can be siphoned again and again.
- **Fix:** `if (!canPersistContent()) return;` at the top of `runSiphon`. Longer term, see DATA-03: have the GM do the check-and-set and authorize the credit.
- **Runtime verification:** a quick test with the GM offline.

### DATA-02: Claiming eddies on a shard with no GM online pays out repeatedly
- **Severity:** Critical (game economy) · **Category:** Data integrity · **Confirmed [lead-verified]** · Confidence: high
- **Where:** `scripts/services/DataShardService.js:1289-1342`, `claimEddies`, called from `ItemInboxApp.js:~2217`. It credits `actor.update({'system.wealth'})` first, then `await persistContentData(...)`. The `false` return when no GM is online is ignored, and the method returns `{success:true}`.
- **Consequence:** CLAUDE.md describes exactly this claim-again exploit as the reason `canPersistContent` exists. This second claim path was missed.
- **Fix:**
  - Call `canPersistContent()` before crediting.
  - Treat a failed persist as a failure, and roll back or don't credit.
  - Better: route the shard claim through `runEddiesClaim`.
- **Runtime verification:** a quick test with the GM offline.

---

### SEC-04: `CONTENT_UPDATE_REQUEST` and `BANK_SIPHON_REQUEST` overwrite any message's content
- **Severity:** High · **Category:** Security / data integrity · **Confirmed** · Confidence: high
- **Where:** `SiphonFlow.js:173-196` (`applySiphonToJournal`) and `:245-249`. They search every journal for a page with that `messageId` and replace its `flags.contentData` wholesale. There is no check on journal type, on the requester's access, or on which fields changed.
- **Consequence:**
  - A player can reset other players' claimed eddies (`claimed:false`) or raise balances.
  - They can unlock fogged or encrypted content.
  - They can plant `effect.macroId`, which completes SEC-02.
- **Fix:** relay the *intent* (claim, crack, siphon, unlock) rather than a full blob. The GM re-reads the page, checks that the requester can see it, and applies an allowlisted change.
- **Runtime verification:** optional.

### SEC-05: Shard relays let a player wipe, unlock, convert or unconvert any shard
- **Severity:** High · **Category:** Security · **Confirmed** · Confidence: high
- **Where:**
  - `DataShardService.js:1893-1904`, `handleStateRequest`:
    - `destroy` deletes every page of any shard named by UUID (`_destroyShard`, `:1774`);
    - `decrypt` and `decryptPage` unlock without a roll;
    - `session` writes any actor's session.
  - `SHARD_INTEGRITY_REQUEST` (`:1222`): repair, degrade, per-entry corruption, and salvage with `ok:true`.
  - `SocketHandlers.js:499-521` (`SHARD_UNCONVERT_REQUEST`) and `:149-194` (`SHARD_CONVERT_REQUEST`, including re-encode): no ownership check, and no active-GM guard either.
- **Fix:** with the real user id (SEC-01):
  - require `item.testUserPermission(user, 'OBSERVER')`, or OWNER for convert and unconvert;
  - require that the user owns `actorId`;
  - accept `destroy` only when the shard's self-destruct rule allows it.

### SEC-06: Terminal relays: delete or copy any file, plant residents
- **Severity:** High · **Category:** Security · **Confirmed** · Confidence: high
- **Where:** `SocketHandlers.js:240-267` → `TerminalService.exfilWipe` (`:1688-1698`), `exfilToInbox` (`:1366`), `exfilForward` and `exfilToShard`.
  - `wipe` deletes any message ids on any terminal. It does not check the per-action exfil policy, the logged-in account, or whether the ids belong to that account.
  - `exfilToInbox` only checks the master `allowExfil`. It writes to any `targetActorId`, so it can plant mail in other players' inboxes.
  - `TERMINAL_RESIDENT_REQUEST` installs an arbitrary resident object (`forgeAccount`, `deployICE` against someone else's later login, or a macro through SEC-02).
- **Fix:**
  - Resolve `getExfilPolicy` on the GM side and check the per-action `allow`.
  - Confirm the ids belong to `accountId`.
  - Require that the requesting user owns the target actor.
  - Sanitize residents and allowlist their `effectType`.

### SEC-07: Forged mail, and eddies created from nothing
- **Severity:** High · **Category:** Security / economy · **Confirmed** (eddies part: Probable) · Confidence: high
- **Where:**
  - `MessageService.handleMessageRelay` (about `:2008-2058`) delivers whatever `from`, `fromActorId`, `anonymous` and `eddies` the payload carries. Only `terminalSend` is verified.
  - `SchedulingService.js:543-563` (`SCHEDULE_SYNC`): any client can add, cancel or `mergeObject`-edit anyone's scheduled entry, including its `messageData.eddies`.
  - `ContactShareService.js:~266` (`CONTACT_SHARE_RELAY`): pushes arbitrary contacts into anyone's list.
- **Consequence:**
  - Impersonation of any PC or NPC.
  - The sender's debit happens only on the composer's client and the recipient's Claim credits wealth, so a forged `eddies` amount creates money.
  - Cancelling or rewriting other players' scheduled mail.
- **Fix:**
  - Require that the requesting user owns `fromActorId`, or that it is one of their character's linked identities.
  - Move the eddies debit to the GM, or have the GM confirm it.
  - Apply the same owner check to schedule entries and contact shares.

### SEC-08: Players can spoof GM→client operations
- **Severity:** High · **Category:** Security / multiplayer · **Confirmed** · Confidence: high
- **Where:** `SocketHandlers.js:440-496`; `SecurityService.js:254` (`receiveForcedLockout`), `:432` (`SECURITY_CLEAR`), `:474`. None of these receivers check that the message came from a GM.
- **Consequence:**
  - **High impact:**
    - `SECURITY_LOCKOUT` locks any player out of any terminal, shard or network and kicks their session.
    - `SECURITY_CLEAR` (including `actorId:'*'`) clears lockouts on every client.
    - `TERMINAL_KICK` logs players out.
  - **Lower impact:**
    - `SECURITY_NOTIFY` (fake Black ICE toasts), `MESSAGE_QUEUE_CMD` (cancels another player's held mail), `NET_RESOLVE_RESULT` (forges the GM's Tier C verdict), `MESSAGE_DELIVERED`, `CONVERSATION_RESULT`, `CONTACT_SHARE_NOTIFY`.
- **Fix:** after SEC-01, every GM→client handler starts with `if (!game.users.get(userId)?.isGM) return;`.

### SEC-09: A crafted watch snapshot runs script on the watcher's client (including a GM)
- **Severity:** High · **Category:** Security / XSS · **Confirmed [lead-verified]** · Confidence: high
- **Where:** `scripts/utils/watchMirror.js:233-236`, `mountMirror`:
  ```js
  for (const [k, v] of Object.entries(snap.data || {})) stage.setAttribute(k, v);
  stage.setAttribute('style', `${snap.rootVars || ''};${snap.vars || ''}`);
  ```
  The sender only limits keys to `data-*`. The receiver applies any key, `onanimationstart` included.
  - `registerWatchSystem.js:17` does not pass the sender through.
  - `WatchService.onSocket` never checks that a `snap`/`edit` comes from the operator who made the offer, and `shareId` values are broadcast.
- **Trigger:** emit `SOCKET_OPS.WATCH` `{type:'snap', shareId, userIds:[victim], snap:{data:{onanimationstart:'…'}, cls:'<an animated class>'}}`. It fires on mount with no click.
- **Consequence:** script on the watcher's client. GMs can watch, so this reaches the GM.
- **Fix:**
  - On receive, accept only keys matching `/^data-[\w-]+$/`.
  - Accept only class tokens matching `[\w-]+`.
  - Accept only `--name:value` custom-property pairs, with no `url(`, `;` or `expression`.
  - Drop packets whose real sender (SEC-01) is not the offer's operator.

### SEC-10: The Overheard HUD renders HTML supplied by any sender
- **Severity:** High · **Category:** Security / XSS · **Confirmed [lead-verified]** · Confidence: high
- **Where:** `scripts/ui/Calls/OverheardHud.js:71` (`<span class="tx">${x.html}</span>`) and `:41` (`box.innerHTML = line.html`). `OverheardService.handleSocket:236-242` routes `prompt`/`joined`/`line` to the HUD from **any** sender.
- **Trigger:** emit `{op:'joined', runId:'x', userIds:[victim]}` and then `{op:'line', …, line:{html:'<img src=x onerror=…>'}}`.
- **Consequence:** script on the victim's client, which can be a GM.
- **Fix:**
  - Accept HUD ops only from the active GM, using the real user id.
  - Send plain text plus garble positions and build the HTML on the receiver.

### SEC-11: The Admin → Overview activity feed puts actor names in unescaped
- **Severity:** High · **Category:** Security / XSS · **Confirmed [lead-verified]** · Confidence: high
- **Where:** `scripts/ui/AdminPanel/AdminPanelApp.js:1088-1094`:
  ```js
  `<strong>${from}</strong> sent message to <span class="ncm-ov-hl--cyan">${to}</span>`
  ```
  The shard-breached, Black ICE and eddies handlers around `:1163-1213` do the same. They are rendered by `templates/admin-panel/tab-overview.hbs:34` as `{{{html}}}`. `OverviewTab.js:40` already defines `esc`, but these builders in AdminPanelApp do not use it.
- **Trigger:** a player whose character name contains HTML sends any mail; the GM views Overview. No console is needed.
- **Fix:** escape `from`, `to`, `actorName` and `shardName`. Better, pass structured parts and let the template escape them.

### SEC-12: The composer's To autocomplete puts names and addresses in unescaped
- **Severity:** High · **Category:** Security / XSS · **Confirmed** · Confidence: high
- **Where:** `scripts/ui/MessageComposer/MessageComposerApp.js:~1558-1582`: `${r.name}`, `${r.email}`, `${r.unreachableLabel}` go into `dropdown.innerHTML`. The same file defines `esc` at about `:2109`.
- **Trigger:** the GM, or another player, types a letter that matches a character whose name contains HTML. No console is needed.
- **Fix:** escape every interpolated value.

### SEC-13: Reply, Forward and drafts render message bodies uncleaned
- **Severity:** High · **Category:** Security / XSS · **Confirmed** · Confidence: high
- **Where:**
  - `MessageComposerApp.js:~603` (`body: orig.body || ''`) → `message-composer.hbs:226` `{{{originalMessageCard.body}}}`.
  - `MessageService.buildForward` (`:1605-1613`) concatenates the raw `from`/`to`/`subject`/`body` → `message-composer.hbs:514` `{{{body}}}` in the contenteditable.
  - Drafts (the `composerDrafts` actor flag) take the same path.
- **Why the viewer doesn't catch it:** the viewer itself cleans bodies (`_renderMessageBody` → `cleanHtml`), so the message looks harmless until someone presses Reply or Forward. The Admin "Reply as" / "Open in the full composer" routes put the GM in the line of fire.
- **Trigger:** a body sent with raw HTML. That needs the console (`sendMessage`), or a GM opening a player-written draft.
- **Fix:** run `cleanHtml(…, {mode:'mail'})` on the quoted body, on the forward body and on draft bodies, and escape the header fields.

### SEC-14: Typed content with an unknown type renders its body unescaped
- **Severity:** High · **Category:** Security / XSS · **Confirmed** · Confidence: medium-high
- **Where:**
  - `templates/content/content-body.hbs:1056-1058`: the fallback branch `{{{body}}}`.
  - `:228` `{{{scanReport}}}`.
  - `ContentRenderers.enrichContent` (`:~1584`) cleans `body` only for `isMessage`.
  - `contentType` and `contentData` are persisted unchecked by `MessageRepository.createMessage:552-553` and `DataShardService.addMessage:782-809`.
- **Trigger:** a relayed send, encoder relay or content update that sets an unknown `contentType` with an HTML body.
- **Consequence:** script in whatever viewer opens the entry: Agent, terminal or shard, including the GM's.
- **Fix:**
  - Always clean `body` in `enrichContent`.
  - Clean or escape `scanReport`.
  - Reject an unknown `contentType` on the GM's write path.

### INT-01: Every connected GM runs most relay handlers, reapers and migrations
- **Severity:** High · **Category:** Cross-system / multiplayer · **Confirmed** (code) · Confidence: high
- **Where:**
  - **Gated on `isGM` only:**
    - `SocketHandlers.js:34` (MESSAGE_RELAY), `:44` (ANON_TRACE), `:149` (SHARD_CONVERT), `:240` (TERMINAL_EXFIL), `:276` (TERMINAL_NET), `:299` (TERMINAL_SESSION), `:331` (BANK_SIPHON), `:343` (CONTENT_UPDATE), `:355` (PAYLOAD_EFFECT), `:368` (RESIDENT), `:380` (TRACE);
    - `LOG_RELAY`, `SHARD_UNCONVERT`, `SHARD_PRICE_REQUEST`, `NET_RESOLVE_CANCEL`.
  - **Reapers:**
    - `registerNetworkSystem.js:68-71` (countdown reaper);
    - `registerTerminalSystem.js:60-86` (payload / resident / forged-account reapers);
    - `TraceService.reapCountdowns:317`;
    - `registerMessagingSystem.js:635-651` (self-destruct).
  - **`MigrationRunner.js:186-224`.**
  - **The correct pattern already exists** for `SHARD_STATE`/`INTEGRITY`, network nodes, Calls, Conversations, scheduling and contact share: the `activeGM` check.
- **Trigger:** two GM-role users connected at once (an Assistant GM, or the GM on two devices).
- **Consequence:**
  - Mail delivered twice, with two sent copies.
  - Traces logged twice and heat added twice.
  - Countdown expiry adds +35 heat twice.
  - Plants and keyloggers fire twice; `_proposing` is a per-client guard.
  - Exfil copies duplicated.
  - Payload macros run twice.
  - Shard conversion can create two journals and orphan one.
  - Migration v3 can lower Interface DVs by twice the amount.
- **Fix:** one helper, `isPrimaryGM()` = `game.user.id === game.users.activeGM?.id`, used in every GM-side relay handler, every interval reaper and `runMigrations`.
- **Runtime verification:** recommended: two GM accounts plus one traced failure.

### DATA-03: Claim and siphon decide "already claimed" on the client, so the same money can be paid twice
- **Severity:** High · **Category:** Data integrity · **Probable** · Confidence: medium
- **Where:** `SiphonFlow.js:265` (`if (cd.claimed)` on a client snapshot), `:55`; `DataShardService.js:1304`. The GM writers (`handleContentUpdateRequest`, `applySiphonToJournal`) write blindly.
- **Trigger:** two players, or two windows, claim the same entry before the relayed write has synced back.
- **Consequence:** both credit the full amount.
- **Fix:** relay a claim *intent*. The GM re-reads the page, refuses if it is already claimed, and then credits (or authorizes the credit and acknowledges).

### DATA-04: Recycle-bin read-modify-write can permanently lose a wiped file
- **Severity:** High · **Category:** Data integrity · **Probable** · Confidence: medium-high
- **Where:** `SiphonFlow.js:1331-1352` (`_quarantinePage`) reads the bin, pushes `page.toObject()` and `set`s the whole array, then deletes the page. `SocketManager` dispatches handlers concurrently, without awaiting or serializing them (`SocketManager.js:79-85`), so two wipes can interleave.
- **Consequence:** the second write overwrites the first record, and that page is still deleted. The file is unrecoverable.
- **Fix:**
  - Put recycle-bin writes behind a queue (the existing `NODE_WRITERS` queue in `NetworkService.js:~1472` is the model).
  - Delete the page only after a read-back confirms the record.
  - See also PERF-07: the bin is also unbounded.

### DATA-05: Security lockouts and attempt counts live only in memory and reset on reload
- **Severity:** High (game integrity) · **Category:** State consistency · **Confirmed** · Confidence: high
- **Where:** `scripts/services/SecurityService.js:22-46`. `_states`, `_remote` and `_timers` are plain `Map`s; `stateManager` is assigned but never used.
- **Trigger:** a locked-out player presses F5. Or the GM reloads, which loses GM-forced lockouts. Or a player was offline when a forced lockout was broadcast.
- **Consequence:** these all reset:
  - terminal account lockouts;
  - network login lockouts;
  - siphon attempt counts;
  - jack-in tries.

  Shard lockouts survive, because they are also stored in the item's `sessions` flag.
- **Fix:**
  - Persist lockouts: a GM-written world setting or flag keyed `actorId::targetId`, with players relaying.
  - Have the GM-side login and session paths re-check them.

### DATA-06: A relay timeout refunds eddies, but the GM may still deliver, creating money and duplicates
- **Severity:** High · **Category:** Cross-system / economy · **Probable** · Confidence: medium
- **Where:**
  - `MessageService.js:916-923`: after an 8 s timeout, `_awaitDeliveryAck` returns `RELAY_TIMEOUT`.
  - `MessageComposerApp.js:2427-2430`: the composer refunds on any failure.
  - `flushQueue` refunds held mail (`:1482-1485`).
  - Retry restamps a new `messageId` (`_stampOutgoing:388`).
  - A late acknowledgement only logs or toasts (`:2155-2165`).
- **Trigger:** a GM `handleMessageRelay` that takes more than 8 s, such as a large fan-out with terminal mirror and tap scans, or a slow host.
- **Consequence:**
  - The message lands with its `eddies` after the sender was refunded, so the recipient claims money that was never debited.
  - Retry delivers a second copy.
- **Fix:**
  - Keep the `messageId` across retries, and have the GM de-duplicate by id.
  - Have the GM acknowledge "accepted" immediately.
  - Defer the refund until a late acknowledgement confirms failure.

### DATA-07: The GM directory (master contacts) never reloads on other clients
- **Severity:** High · **Category:** State consistency · **Probable [lead-verified code]** · Confidence: medium-high
- **Where:** `scripts/services/MasterContactService.js:33, 805-812`. `_loadContacts()` runs only in the constructor, and no hook re-runs it. `DocumentSyncBridge.js:439-445` only emits `CONTACT_UPDATED` on a `masterContacts` setting change.
- **Trigger:** the GM adds or edits a directory entry during a session.
- **Consequence:**
  - **Players:** `verifyContact`, `getByEmail`, `isSendOnly`, display names and identity resolution all use the load-time list. That produces "CONTACT NOT FOUND", send-only rules that aren't enforced, and wrong names until reload.
  - **Second GM:** writes its stale array over the first GM's additions, so updates are lost.
- **Fix:** an `updateSetting` hook on `night-city-messenger.masterContacts` that calls `_loadContacts()`.
- **Runtime verification:** yes. Add a contact as GM, then send to it from a player without reloading.

### PERF-01: The GM's unread badge creates an inbox journal for every actor, then rescans all mail on every mail event
- **Severity:** High · **Category:** Performance / data pollution · **Confirmed [lead-verified]** · Confidence: high
- **Where:**
  - `NotificationService.js:916-929`: `for (const actor of game.actors) { if (!actor.isOwner) continue; await getUnreadCount(actor.id) }`.
  - That calls `getMessages` → `getInboxJournal`, which **creates** a journal when none exists and the user is a GM (`MessageRepository.js:~433-460`).
- **Trigger:**
  - Init, postReady/20, and every `MESSAGE_RECEIVED`/`READ`/`DELETED`.
  - The listeners are registered twice: `registerMessagingSystem.js:531-549` and `NotificationService._setupEventListeners:960-969`.
  - `MESSAGE_RECEIVED` itself fires twice per delivery, from the socket path and the doc-sync path.
- **Consequence:**
  - The GM owns every actor, so one inbox journal gets created per actor: NPCs, vehicles, containers, Black ICE.
  - After that, each mail event walks every page of every inbox two to four times. A large world stalls the GM's client on every delivery, and a group fan-out multiplies it.
- **Fix:**
  - Use a lookup that never creates (`getInboxJournal(id, {create:false})`, or an `identifyInbox` index).
  - Count only actors that already have an inbox.
  - Remove the duplicate listener set.
  - Debounce.
- **Runtime verification:** count the journals in "Night City Messenger / Inboxes" on a world with mail-less NPCs before and after a GM reload. Worth doing first, because this may already have polluted live worlds.

### PERF-02: Create Network stacks an Enter handler on every render, which can create duplicate networks
- **Severity:** High · **Category:** Resource / correctness · **Confirmed** (stacking); duplicate creation **Probable** · Confidence: high
- **Where:** `scripts/ui/NetworkManagement/CreateNetworkDialog.js:368`. It adds `keydown` to `this.element` (the persistent frame) on every `_onRender`. The dialog re-renders on many field changes (`:287, 296, 303, 314, 337, 458`), and `_doCreate` has no in-flight guard.
- **Consequence:** after N re-renders, a single Enter calls `createNetwork` N times.
- **Fix:** bind once, with a flag. Add a `_creating` guard.

### COMPAT-01: Initialization awaits template loading before it registers settings, keybindings and the canvas layer
- **Severity:** High · **Category:** Foundry lifecycle · **Probable [lead-verified code]** · Confidence: medium-high
- **Where:**
  - `scripts/main.js:44-47`: `Hooks.once('init', async () => { await runPhase('preInit'); await runPhase('init'); })`.
  - `ModuleInitializer.js:37-52` awaits each task in order.
  - `registerTemplates.js:30-36`: preInit/20 `await loadTemplates(paths)`, about 110 templates.
  - Foundry's `Hooks.callAll` does not await async callbacks.
  - **These all run after the first network `await`:**
    - settings registration (preInit/30);
    - every Handlebars helper (same task, after the await);
    - `CONFIG.Canvas.layers.ncmControls` and the `getSceneControlButtons` hook (init/20);
    - `game.keybindings.register` (init/40);
    - the `@NCM` enricher (init/90).
  - Foundry 12.343 `foundry.js:1300`: `if ( this.bindings ) throw new Error("You cannot register a Keybinding after the init hook")`.
- **Trigger:** slow hosting (The Forge, a remote server, a cold cache), where the template fetches take longer than Foundry's i18n, tours, setup and keyboard initialization.
- **Consequence:**
  - The call keybindings fail. They are logged as `FAILED` and swallowed by `runPhase`.
  - The NCM scene-control group can point at a layer that was never constructed.
  - Ready-phase tasks can interleave with unfinished init tasks.
  - **The module's own `ready` handler is not gated on init finishing either**, so ready tasks can read settings that are not registered yet.
- **Fix:**
  - Do all synchronous registration first (settings, helpers, layer, keybindings, hooks, enricher).
  - Start `loadTemplates` without awaiting it inside the hook, and attach a `.catch`.
  - Have `ready` await an `initDone` promise.
- **Runtime verification:** throttle the network to "Slow 3G" in DevTools and reload. Look for `FAILED: Call key bindings` or "after the init hook".

### PRIV-01: Call privacy masking happens only on display; the real identity is broadcast to every client
- **Severity:** High (privacy; not script execution) · **Category:** Privacy / multiplayer · **Confirmed** · Confidence: high
- **Where:** `CallService.js:845-863` (`_send`). Both the unmasked emit (payphone `realName`/`realActorId`/`realUserId`, the anonymous caller) and the masked emit go out on the broadcast socket. `handleSocket:1179` filters by `userIds` only after receipt.
- **Consequence:** any client can read who is really on a booth, or behind a withheld number, using DevTools or a socket listener. CLAUDE.md says "the real person never reaches the other end's client", which is not true at the network level. Conversations has the same known limitation.
- **Fix:**
  - Never put the real identity in a broadcast. Keep it on the caller's client.
  - Hand it to the GM through a GM-only route: a whispered ChatMessage, which the server filters, or a GM-only document.
  - At minimum, correct the documentation.

---

## 4. Medium and low-severity findings

### Medium

| ID | Category | Where | Problem → consequence | Class / confidence | Fix | Runtime verification? |
|---|---|---|---|---|---|---|
| SEC-15 | XSS | `scripts/utils/richText.js:132-140` (`safeUrl`) **[lead-verified]** | `decodeBasic` decodes only 6 named entities. `href="javascript&#58;alert(1)"` passes the scheme test, and `esc` keeps existing entities, so the browser decodes it to `javascript:`. Any mail body a reader clicks, including in the GM's Admin Messages pane, can run script | Confirmed · high | Decode all numeric and named entities (`DOMParser`/`textarea`), strip control characters, and allow only `http`, `https`, `mailto` and relative URLs | Click test |
| SEC-16 | XSS | Foundry `foundry.js:3944` `tooltip.innerHTML = …dataset.tooltip` **[lead-verified]**; 54 templates put names in `data-tooltip` (`tab-security.hbs:183,185`, `tab-contacts.hbs:374/378/385/528/705`, `message-detail.hbs:392/630/647`, `attachment-chip.hbs:26`, `content-body.hbs:961`…) | The attribute value is decoded back to raw HTML, which Foundry then renders as HTML, so a name with `<img onerror>` runs when the tooltip is hovered | Confirmed · high | A `{{ncm-tip x}}` helper that escapes twice, or switch these to `title` | Hover test |
| SEC-17 | XSS | `ShardsTab.js:452,1071,1086,1659,1692`; `ContactsTab.js:2313`; `ItemInboxApp.js:1562` | GM confirm dialogs interpolate player-chosen item and group names into Dialog HTML | Confirmed | Route them through `dialogBodyHtml`, which already escapes | No |
| SEC-18 | Code injection | `scripts/utils/accessPoints.js:87-89` | The access-macro label only strips `\r\n`. U+2028/U+2029 in a shard name break out of the `//` comment, so code is injected into a macro the GM generates and possibly runs | Confirmed | Strip `[\r\n  ]`, or emit the label with `JSON.stringify` | No |
| SEC-19 | XSS | `ChatCards.js:95`; `MessageViewerApp.js:3455,3492`; `TerminalViewerApp.js:2632,2641` | Add-contact toasts use `data-ncm-name` / sender names. A player can post a chat message carrying those `data-*` attributes (the server keeps `data-*`), so clicking Add contact runs script | Confirmed | Escape | No |
| SEC-20 | XSS / CSS | `watchMirror.js:42-62` (`cleanMirror`) | The blocklist misses `<style>` (CSS injection across the whole page), a tab inside `javascript:`, SVG `xlink:href` and `<set>`, and `<base>`/`<meta refresh>` | Confirmed gaps; exploit Probable | Use an allowlist; validate URLs with a parser | Two-client test |
| SEC-21 | Privacy | `MessageService.handleAnonTraceRequest` (~858); `CallService.js:1204` (`traceRequest` → `_revealTo`) | Reveals an anonymous sender or withheld caller to any requester, with no check of ownership, party membership or a roll | Confirmed | Require that the requester owns the inbox or is the callee, and check `traceable` | No |
| SEC-22 | Integrity | `NetworkService.handleNodeRequest:716`; `TRACE_REQUEST` → `recordTrace`; `LOG_RELAY`; `CallService.handleLogRequest:1758`; Emergency `add`/`arrive`; Overheard `enhance` amount | GM-side writes with no requester check: jam, tap or backdoor any node; forge trace or heat (which fires resident triggers); forge call-log pages into any inbox; instant emergency arrival; enhance to 100 | Confirmed | Check the requester against the real user id; rebuild records on the GM side | No |
| PRIV-02 | Privacy | `CallService.js:849-853` | Once someone answers a booth call, `answeredBy` puts the far-end callee on the unmasked send list | Confirmed | Use `answeredBy` only when the booth is the callee | No |
| PRIV-03 | Privacy | `PayphoneService.js:208-213` | `setUse` broadcasts `{userId, name, callId}` to everyone, which undoes booth masking | Confirmed | Send it only to users on that scene, without `callId` | No |
| INT-02 | Cross-system | `TerminalService.js` `setUplink:1090`, `forceUnlock:1298`, `installResident:1886`, `updateResident:1922`, `removeResident:1931`; `DataShardService` `_updateActorSession:1965`, `_writeDecrypted:1884` | Each rewrites the whole `terminalState` or shard `state` outside the session queue. Concurrent relays revert one another: plants vanish, fired residents go back to armed, `decrypted` is undone | Probable | One queue per item, or write only the changed keys | Two-client test |
| INT-03 | Cross-system | `TraceService.recordTrace:127-140`, `bumpHeat:205-213`, `startCountdown:279-289` | Read-modify-write of whole settings while handlers run concurrently, so log rows and heat are lost | Probable | A queue per service | No |
| DATA-08 | Logic | `SiphonFlow.js:751` (the only `charges` reference) **[lead-verified]** | Payload `charges` is never decremented, so a program with 2+ charges runs without limit | Confirmed | Decrement on success | No |
| DATA-09 | Migration | `NamespaceMigration.js:214-222`; `MigrationRunner.js:193-224`; `migrateWorldSettings:127-139` | A declined namespace migration lets MigrationRunner stamp `dataSchemaVersion` on the empty namespace. On a later accept, the legacy version key is skipped as "already present", so v2–v5 never run on legacy data (the v3 DV prompt is lost) | Confirmed (logic) | Don't run `runMigrations` until `namespaceMigrationDone`; when copying, take the minimum of the two versions | No |
| DATA-10 | Cross-system | `TerminalService.reapForgedAccounts:2250`, `reapResidents:2296`; `TraceService._fireResidentTriggers:162` | These scan only `game.items` (world items). Terminals carried by actors never fire `onDate`/`onAction`/`onHeat`, and backdoors never expire | Confirmed | Use `collectTerminals()` and resolve by uuid | No |
| DATA-11 | Economy | `SchedulingService.cancelScheduled:231-258`; GM handler `:543-563`; `_checkAndDeliverInner:394-411` | A cancel or edit near delivery time refunds unconditionally while the GM delivers anyway, so the money is paid twice | Probable | Cancel by request and response through the active GM; refund only once confirmed pending; mark entries "delivering" | Timing test |
| DATA-12 | Rules bypass | `SchedulingService.scheduleMessage:157-216`; `_deliverScheduled:439` | Scheduled player mail skips the send-only, verification and `verifyAccountSend` checks, because delivery runs as the GM | Confirmed | Run `_resolveRecipient` and `verifyAccountSend` as the creator at schedule time | No |
| DATA-13 | Persistence | `MessageService.js:416-424` sets it; `MessageRepository.createMessage` never writes it; read at `:1219` **[lead-verified]** | `signalDegradation` is never persisted, so the low-signal garble and Reconstruct never trigger | Confirmed | Add it to the flags builder | No |
| DATA-14 | Cross-system | `registerMessagingSystem.js:617-626`; `registerNetworkSystem.js:206-211` | Mail held because no GM was online is not flushed when a GM connects (no `userConnected` hook) | Confirmed | `userConnected` → `flushQueue` on player clients | Yes |
| DATA-15 | Race | `MessageRepository.getInboxJournal:418-463`; `_getOrCreateSubfolder:82-108` | Find-then-create with no lock. Two concurrent first deliveries create two inbox journals, and the second one's mail is invisible | Probable | A per-owner in-flight promise map | Yes |
| DATA-16 | Referential integrity | `MasterContactService.removeContact:428-441`; `MessageService._resolveRecipient:171-176, 225-236` | Deleting a root NPC orphans its aliases (they still route to the deleted id). Deleting a linked actor breaks delivery to its directory contact. A failed sent copy is ignored (`:619`) | Confirmed | Promote or clear `identityOf`; fall back to the contact; add these to Orphan Audit | No |
| DATA-17 | Multiplayer | CallService (no `userConnected` handler) | A live or held call never ends when the other party disconnects or reloads; the HUD and the GM switchboard keep stale calls | Confirmed | End calls involving a disconnected user | Reload test |
| DATA-18 | Data loss | `CallService.handleVoicemailRequest:1471-1473`; `_caller:766-768` | A payphone caller has `actorId:null`, so the voicemail is silently dropped while the player was told it succeeded | Confirmed | Check `realActorId` for booth callers | Yes |
| COMPAT-02 | Third-party (CPR) | NCM `AccessPoints.js:503-511`; CPR `modules/hooks/hotbar/generate-item-macro.js:24-129` | CPR's `hotbarDrop` is registered first and returns `false` for every non-Macro drop. A converted terminal dragged to the hotbar opens the item sheet, because `ShardSheetOverride._onRenderItemSheet` only intercepts shards. `NCMAccess` drags throw a TypeError inside CPR (console noise; NCM's handler still runs) | Confirmed (by code) | A capture-phase `drop` listener on `#hotbar` for NCM drags; an `isTerminal` branch in the sheet intercept | Yes |
| COMPAT-03 | Core state | `phoneNumbersView.js:745-748` **[lead-verified]** | `Object.defineProperty(game.user,'isGM',{value:wasGM})` in `finally` leaves a frozen own property that shadows the `User.isGM` getter for the rest of the session, for every module | Confirmed | `delete game.user.isGM` in `finally`, or better, pass a `viewAsPlayer` option | Console check |
| COMPAT-04 | CSS leak | `styles/components/admin-panel/tab-phone.css:482` **[lead-verified]** | A bare `.mt` selector turns every element anywhere in Foundry with class `mt` (a common margin-top utility) into a flex box | Confirmed | Prefix it (`.ncm-pn-mt`) | No |
| PERF-03 | Leak | `MessageComposerApp.js:810-823, 1789, 1813-1828` | `keydown` on the frame and `selectionchange` on `document` are added again on every render; `close()` removes only the last. Escape calls `close` N times; selection handlers stack and keep closed composers alive | Confirmed | Bind once, or remove the previous handler first | No |
| PERF-04 | Network | `NodeConsoleApp.js:553-562`; `WatchService.js:127-197`; `tooBig` branch `:172-177` | A watched node console sends about 10 socket messages per second, to every client, for as long as anyone watches. The `tooBig` path never sets `nextAt`, so it can loop every 30 ms with up to 900 KB snapshots | Probable | Mark the animated nodes `data-watch-ignore`; set `nextAt` | Yes |
| PERF-05 | Performance | `MessagesTab.js:190-198, 1001`; `AdminPanelApp._refreshIfTab:1226` | One or two full scans of every page in the world on every render; un-debounced `render(true)` on each `MESSAGE_SENT`/`RECEIVED`, so a fan-out to N recipients causes about 2N full re-scans | Confirmed | Debounce; cache the scan with a dirty flag set by DocumentSyncBridge | Yes, at scale |
| PERF-06 | Performance | `MessageViewerApp.js:962` → `inboxRoster.js:70-85` | With the GM's Switch-inbox drawer open, every viewer re-render does a full mail scan | Confirmed | Cache with a dirty flag | No |
| PERF-07 | Growth | `SiphonFlow.js:1332-1352` | `recycleBin` is unbounded and stores whole `page.toObject()` records, re-sent to every client on every wipe | Confirmed | Cap it, or store pages in a GM-only journal | No |

### Low

| ID | Category | Where | Problem | Class |
|---|---|---|---|---|
| SEC-23 | CSS injection | `tab-phone.hbs:76`, `calls-tab.hbs:135/148/190`, `message-viewer.hbs:548`, `conversationPane.js:30`, `phoneNumbersView.js:235/755`; `richText.js:157-175` (`cleanStyle`) | Image paths inside `url('{{img}}')` can close the CSS string (Handlebars' `&#x27;` decodes back to `'`). `cleanStyle` accepts any value containing `var(--ncm-` (a fixed full-screen overlay via a var fallback). Remote `img src` is a tracking pixel | Confirmed |
| INT-04 | Cross-system | `ConversationService.js:422-425`; `createMessage` metadata | `metadata.tapLog` is not persisted, so the tap log restarts and loses lines | Confirmed |
| INT-05 | Race | `ConversationService.js:393` | `_tap` runs outside the write queue, unawaited, so duplicate tap pages or lost lines | Probable |
| INT-06 | Race | `ContactRepository` add/update/remove (`:106-301`); `ContactGroupService` (`:116-163, 323`); `MessageComposerApp.js:2403-2405` | Read-modify-write of whole actor-flag arrays; `touchActorGroup` runs unawaited in a loop and overwrites itself | Probable |
| INT-07 | Notifications | `DocumentSyncBridge._onJournalPageCreated:295-339` | Does not skip read, recovered or file pages: taps, exfil copies and the conversation tap log toast the tapper; a second GM is toasted for everyone's mail | Confirmed |
| INT-08 | Integrity | `DataShardService.removeDataShard:152-155`, `_destroyShard:1774-1795`; `ShardsTab.onPurgeDestroyed:1420` | The archive guard works one way only: destroying an archive copy wipes the real shard; purging the source orphans its copies; the destroy state uses a merged nested-flag write | Confirmed |
| INT-09 | Race | `DataShardService.degradeIntegrity:1011-1052` | Read-modify-write; concurrent degrades lose a hit | Probable |
| INT-10 | Race | `MessageRepository.updateMessageFlags:812-828` | Writes the whole flags block, so a stale GM write can revert a player's `eddiesClaimed` | Potential |
| INT-11 | Race | `MessageService.recordDeliveryFailure:1401-1427`, `retryDeliveryFailure:1440` | Read-modify-write; a retried group send writes duplicate rows | Confirmed |
| INT-12 | Duplicate | `MessageService.forceDeliver:1351-1360` vs `handleQueueCommand:1327-1337` | During a flush, a GM force-deliver is missed by the player's drop, so a duplicate is sent | Potential |
| DATA-19 | Persistence | Mass Broadcast → `createMessage` | `isBroadcast` is not persisted, so the admin broadcast icon never shows | Confirmed |
| DATA-20 | UX / data | `SiphonFlow.js:748-806` | Payload execution has no GM-online guard: the roll is spent and the player is told "sent" | Confirmed |
| DATA-21 | Multiplayer | `PayphoneService.inUse` | Never cleared on disconnect; accepts `entry.userId` that is not the sender | Confirmed |
| DATA-22 | Multiplayer | `CallService` `line` handler `:1214-1220` | Does not check that the sender is `answeredBy`, so the losing answerer's lines are accepted in that window | Confirmed |
| COMPAT-05 | Third-party | `registerTemplates.js:115-141` | The global helpers `lower`/`upper` throw on non-strings; `add`/`sub` concatenate strings and break with one argument; `truncate` with one argument returns "…". They override any other module's helpers of the same name. If a later module (for example the installed `social-navigator`) registers `eq` without block support, NCM's 15 `{{#eq}}` blocks print "true"/"false" | Probable / Potential |
| COMPAT-06 | Third-party | `ShardSheetOverride.js:330-404` | Directory context-menu entries are injected into `#context-menu` by DOM after `setTimeout(80)` rather than through `getItemDirectoryEntryContext`; fragile with menu-altering modules | Potential |
| COMPAT-07 | Core prefs | `TerminalScenePins.js:672-681` | Forces the client setting `core.notesDisplayToggle = true` on every load | Confirmed |
| COMPAT-08 | Robustness | `TerminalScenePins.js:73-79` | `fromUuidSync` outside a try in `dropCanvasData`, which throws on compendium-embedded uuids (console noise) | Confirmed |
| COMPAT-09 | Third-party | `SkillService.js:366-371, 482` | Dice So Nice is shown to everyone and the chat card ignores roll mode | Improvement |
| COMPAT-10 | UI | `ChatIntegration.js:19` | `Hooks.once('renderChatLog')` binds only the main chat log, so the buttons are dead in a popped-out chat | Confirmed |
| COMPAT-11 | Leftover CSS | `calls-tab.css:384, 507-522` (`.mk-*`), `malware-workshop.css:21,337` (`.fw-in`), `roll-panel.css:40-47` (`button[data-rollp-step]`), `terminal.css:2076,2124,2134` (`[data-boot-animation]`) | Unscoped selectors (mock leftovers) | Confirmed |
| COMPAT-12 | Robustness | `ShardSheetOverride.js:676-678`; `PayphoneBooth.js:128-135`; `activateNote` | Sheet rows suppress `contextmenu`; the booth swallows digit keys (intended); an earlier module returning `false` from `activateNote` swallows pins | Potential |
| PERF-08 | CPU | `MessageViewerApp.js:1193-1223` | The weak-signal waveform repaints every animation frame, with no reduced-motion check, including while minimized | Confirmed |
| PERF-09 | Growth | `TraceService.bumpHeat/setHeat:205-230` | `traceHeat` keeps entries that have decayed to zero | Confirmed |
| PERF-10 | CPU | `ConversationService._journal:41`, `_noticeGm:543`, `convWaiting` | Each lookup scans every journal; about O(conversations × journals) per line on the GM | Probable |
| PERF-11 | Growth | `NetworkService.applyScenePrewire` | `scenePrewire` entries are never removed after import | Confirmed |
| PERF-12 | Robustness | `PayphoneService._onRinging:239` | The ring interval has no state check of its own; a missed end event leaves a bell ringing | Potential |
| ARCH-01 | Error handling | `SocketManager._onMessage:81-85`; `EventBus.emit:50-56` | Async handlers are called without awaiting or catching them, so failures become unhandled rejections. A throw before the relay's final acknowledgement causes DATA-06 | Improvement |
| ARCH-02 | Maintainability | `ModuleInitializer.runPhase` | Every task failure is logged and swallowed; the module keeps running half-initialized with no visible signal | Improvement |
| ARCH-03 | Maintainability | `main.js:45` | The init log reads "v4.1" while module.json says 2.1.0 (cosmetic) | Improvement |

---

## 5. Foundry VTT core compatibility

- **Declared:** minimum 12, verified 12. Checked against 12.343.
- **v12 deprecation warnings:** none found. There are no bare `mergeObject`/`duplicate`/`getProperty`/`randomID`/`isNewerVersion`, no `CHAT_MESSAGE_TYPES`, no `.data.data`, and no `evaluate({async})`. Audio uses `foundry.audio.AudioHelper`.
- **Real v12 risks:**
  - COMPAT-01 (initialization timing; **the most important compatibility finding**);
  - COMPAT-03 (`game.user.isGM` shadowed);
  - COMPAT-07 (core client preference forced);
  - COMPAT-10 (popped-out chat log).
- **Internal and undocumented APIs:** limited. `CONFIG.Canvas.layers.ncmControls` (a unique name) and `CONFIG.TextEditor.enrichers.push` (a unique `@NCM` prefix) are standard extension points. The "Foundry doesn't escape notifications or tooltips" behavior that SEC-03 and SEC-16 depend on is documented Foundry behavior, not an internal API.
- **v13 (informational; not declared supported):** `getSceneControlButtons` uses `controls.push` (v13 passes an object). There are global `Dialog` (about 18 uses), `renderTemplate`, `loadTemplates`, `FilePicker`, `TextEditor`, `ImagePopout` and `InteractionLayer`. `renderChatMessage` becomes `renderChatMessageHTML`, and the Item directory moves to AppV2. Expect a dedicated porting pass. Some groundwork already exists (namespace fallbacks for `ImagePopout`/`DocumentOwnershipConfig`, and `html[0] ?? html`).

## 6. Third-party module conflict risks

The installed module list was not provided, and only `social-navigator` and the CPR system were found in this Data folder and inspected. Everything else below is **potential** and needs reproducible tests.

| Risk | Status | Test to reproduce |
|---|---|---|
| CPR `hotbarDrop` pre-empts NCM (COMPAT-02) | Confirmed by reading CPR's code | Drag a converted terminal to the hotbar and see what the macro opens; drag an admin rack row and watch the console |
| Global Handlebars helper names (COMPAT-05) | Probable | Enable `social-navigator` (or any helper-registering module), open the inbox empty state, and look for "true"/"false" text. Swap module load order |
| `.mt` and other leaked selectors (COMPAT-04/11) | Confirmed | Look for elements with class `mt` in other modules' sheets with NCM on and off |
| Canvas `drop` capture for terminals (TerminalScenePins) | Safe by design: claims only terminal items; Item Piles keeps shards | Drop a shard and a terminal with Item Piles active |
| `activateNote` returning `false` (Monk's Enhanced Journal and similar) | Potential, already documented | Double-click a terminal pin with MEJ active |
| Directory context menu by DOM injection (COMPAT-06) | Potential | Right-click an item with a context-menu module that also edits the menu (for example "Item Context Menu" types) |
| `renderDialog` / `renderApplicationV2` hooks | Safe: every one acts only on `ncm-` classes | — |
| `notesDisplayToggle` forced (COMPAT-07) | Confirmed: affects every module's map notes | Turn notes off, reload, and notes are back on |
| Dice So Nice roll mode (COMPAT-09) | Improvement | Blind GM roll with DSN |
| Simple Calendar | Uses the documented `currentDateTime` + `updateWorldTime`; no conflict seen | Advance SC with the admin panel open (the re-render throttle exists) |
| Socket channel and `game.nightcity` namespace | No collision found among the installed modules | — |

**Limitation:** source for third-party modules that are not installed was not available. No conflict is claimed for any module that was not inspected.

## 7. Security and permissions

**Root cause:** clients are trusted to report who they are and what they may do. Findings, in priority order:

1. **SEC-01**: the forgeable sender identity is the foundation.
2. **GM-client code execution:** SEC-02 (macros), SEC-03 (toasts), SEC-09 (watch), SEC-10 (overheard), and, with no console needed, SEC-11, SEC-12, SEC-16 and SEC-19 through character and item names.
3. **Arbitrary writes to other players' data:** SEC-04, SEC-05, SEC-06, SEC-07, SEC-22.
4. **Spoofed GM authority:** SEC-08.
5. **Privacy:** PRIV-01, PRIV-02, PRIV-03, SEC-21. The documented trust model ("the data reaches every client; the UI hides it") is honest for conversations, but call-masking claims overstate it.
6. **Sanitizer gaps:** SEC-13, SEC-14, SEC-15, SEC-18, SEC-20, SEC-23.

**What the code already does well:**
- `cleanHtml` is a real tokenizer with an allowlist; apart from SEC-15 and SEC-23, no bypass was found.
- Bodies are cleaned at render time in the main viewers.
- `dialogBodyHtml` and the `@NCM` enricher escape correctly.
- `accessMacroCommand` uses `JSON.stringify` for the ref.
- The Calls, Conversations and network-node relays have proper ownership checks and active-GM guards; they become sound once SEC-01 is fixed.
- No `eval` or `new Function` is used on user input.

**Server-side facts relied on:**
- Foundry runs `sanitize-html` on `HTMLField`s (ChatMessage content, journal text, item descriptions), so chat cards themselves cannot run script.
- It does **not** sanitize `StringField`s (actor and item names) or flags, which is where every NCM payload lives.

## 8. Performance and resource management

**Highest impact:** PERF-01 (also writes data), PERF-02 (duplicate networks), PERF-05/06 (full world mail scans per render, growing with mail volume), PERF-03 (composer listener stacking), PERF-04 (watch socket chatter), PERF-07 (unbounded recycle bin).

**Checked and fine:**
- BaseApplication sound listener and EventBus cleanup.
- MessageViewerApp and TerminalViewerApp listeners and timers.
- AdminPanelApp hooks, clock throttle and keyboard handler.
- Bounded logs: `traceLog` 250, `loginLog` 50, `deliveryFailures` 100, access log 500, node log 40.
- The module 1 s ticker returns early when nothing is on screen.
- Call ring loops self-check.
- WatchService uses an AbortController.

## 9. Architecture and maintainability

- **No single "GM authority" layer.** Each relay re-implements (or forgets) is-GM, active-GM and ownership checks. That is how INT-01, SEC-04 to SEC-08 and SEC-22 arose inconsistently across about 60 ops. A small `relay(op, {requires:'activeGM', owns:'actorId', validate})` wrapper in SocketManager would make the rule structural.
- **Whole-object read-modify-write is the default persistence style** (world-setting maps, flag blocks). Only network nodes, terminal sessions, scheduling and conversations are serialized. Generalize the queue (INT-02, INT-03, DATA-04, INT-06, INT-09, INT-11).
- **Field-by-field persistence builders** (`createMessage`, `_pageToMessage`, `_buildMessageFlags`, `addMessage`) keep dropping fields (DATA-13, INT-04, DATA-19). CLAUDE.md warns about this repeatedly. A shared field list, with a sim that asserts every field `sendMessage` sets is persisted, would end it. One sim partially does this today.
- **Escaping is opt-in and per-file** (at least five local `esc` helpers). A single `escapeHTML` import, a notification wrapper and a `{{ncm-tip}}` helper would close SEC-03, SEC-11, SEC-12, SEC-16, SEC-17 and SEC-19 at their roots.
- **Swallowed errors** (ARCH-01, ARCH-02) make field failures invisible. This matters more because most testing is manual.
- **Client-local authoritative state** (DATA-05, DATA-07) contradicts the world-setting model used everywhere else.

---

## Internal Systems Integration and Cross-System Reliability

### 1. Major systems found in the code

| # | System | Main files | Owns or writes | Init |
|---|---|---|---|---|
| S1 | Core: initializer, settings, sockets, event bus, migrations | `core/*`, `init/*` | world and client settings; `dataSchemaVersion`; namespace migration | preInit → postReady |
| S2 | Messaging (mail) | `MessageService`, `MessageRepository`, `DataValidator` | inbox journals and pages; `deliveryFailures`; held queue (client); relay acknowledgements | init / ready |
| S3 | Contacts and identities | `MasterContactService`, `ContactRepository`, `ContactGroupService`, `ContactShareService`, `utils/identities.js`, `participants.js` | `masterContacts`, `masterContactGroups` settings; actor `contacts` and `contactGroups` flags | ready (registerGMTools) |
| S4 | Notifications and doc-sync | `NotificationService`, `DocumentSyncBridge`, `ChatCards` | toasts, badge (in memory) | ready |
| S5 | Scheduling | `SchedulingService` | `scheduledMessages` | ready / postReady interval |
| S6 | Conversations | `ConversationService`, `ConversationPane` | conversation journals; user `conversationState` flag | ready (setting-gated) |
| S7 | Data shards and integrity | `DataShardService`, `IntegrityModel`, `ShardSheetOverride`, `ItemInboxApp`, Shard Encoder | item flags `isDataShard`/`config`/`state`; shard journals | ready |
| S8 | Terminals and residents | `TerminalService`, `TerminalViewerApp`, `TerminalScenePins`, `AccessPoints` | item flags `terminalConfig`/`terminalState` (sessions, residents, loginLog); terminal journals; scene notes and regions | ready (62+) |
| S9 | Content actions | `SiphonFlow`, `UploadFlow`, `SecurityConsole`, `BankHeist`, `RollReveal`, `ContentRenderers` | page `contentData`; actor wealth; `recycleBin` | — |
| S10 | Security, trace, ICE | `SecurityService`, `TraceService`, `ICEService`, `SkillService`, `NetResolve` | in-memory lockouts; `traceLog`/`traceHeat`/`traceCountdowns` | ready (43) |
| S11 | Networks and nodes | `NetworkService`, `NetworkAccessLogService`, `utils/networkNodes.js`, `jackIn.js` | `networkNodes`, `scenePrewire`, access log; `playerNetworks` (memory) | ready |
| S12 | Calls, payphones, emergency, overheard | `CallService`, `PayphoneService`, `EmergencyService`, `OverheardService`, `ui/Calls/*` | `phoneLines`, `phoneSpecial`, `payphones`; call-log journals; in-memory call state | ready |
| S13 | Watch | `WatchService`, `watchMirror.js`, `WatchWindowApp` | none persistent | ready (127) |
| S14 | Spam and junk | `SpamService`, `utils/junkSenders.js` | `spamAutoConfig`, `spamJunkSenders` | ready (109) |
| S15 | Time | `TimeService`, `CyberTimePicker` | `manualTime` and related | init |
| S16 | Admin panel and GM tools | `AdminPanelApp` + 11 tabs | reads every system, writes through each system's services | on demand |
| S17 | Macro API and integration bridge | `MacroAPI`, `IntegrationBridge`, packs | mirrored hooks; `game.modules.get(id).api` | ready |

### 2. Dependency relationships (as implemented)

```
S1 Core ─┬─> every system (settings, socket router, EventBus, initializer)
         └─ SocketManager dispatches handlers concurrently, without awaiting (root of INT-02/03, DATA-04, DATA-15)

S2 Messaging ──> S3 (recipient/sender resolution, identities, send-only, verification)
             ──> S11 (current network, dead zone, tapDelivery, signal)
             ──> S8 (mirrorDeliveryToAccounts / mirrorSentToAccounts / verifyAccountSend)
             ──> S14 (spam routing)   ──> S15 (timestamps)   ──> S4 (MESSAGE_RECEIVED)
S5 Scheduling ──> S2.sendMessage (as GM: bypasses player checks, DATA-12)
S6 Conversations ──> S3 (identities) ──> S11 (tappersAt) ──> S2 repository (tap log pages)
S7 Shards ──> S9 (claim/crack/siphon via persistContentData) ──> S10 (lockouts, trace, ICE) ──> S2 (attachments)
S8 Terminals ──> S10 (auth lockouts, trace) ──> S2 (pages via MessageRepository) ──> S3 (account↔contact link-or-create)
S9 Content actions ──> S10 ──> S8 (residents, exfil) ──> actor wealth (CPR system data)
S10 Trace ──> S8 (resident triggers: _fireResidentTriggers) ──> S11 (node alerts)
S11 Nodes ──> S2 (tap/sniffer copies) ──> S8 (terminal uplink cut)
S12 Calls ──> S3 (numbers, contacts) ──> S11 (signal, taps) ──> S2/S8 (call logs into inboxes, terminal mirror)
S13 Watch ──> any ncm-app window DOM
S16 Admin ──> all of the above (read and write)
S4 Notifications <── S2, S6, S7, S10, S12 (events)
```

**Circular dependencies:**
- **S8 ↔ S10:** trace fires residents, and residents fire traces. Guarded by not re-entering `'exfil'`, and by `logicBomb` refusing to nest.
- **S2 ↔ S8:** the mirror calls back into the repository.

Neither cycle has a recursion guard beyond these. Both are fine today but fragile.

### 3. Confirmed cross-system defects

| ID | Systems affected | Summary |
|---|---|---|
| INT-01 | S1, S2, S7, S8, S9, S10, S16 | Every GM runs relays, reapers and migration |
| DATA-01, DATA-02 | S7, S9 → actor wealth | Money credited when the shard or bank state can't be persisted |
| DATA-06 | S2 ↔ composer ↔ wealth | A timeout refund followed by delivery |
| DATA-07 | S3 → S2, S6, S12 | Stale directory on every non-writing client |
| DATA-10 | S8 ↔ S10 | Residents on carried terminals never fire |
| DATA-12 | S5 → S2, S8 | Scheduled mail skips the send checks |
| DATA-16 | S3 → S2 | Deletions break routing |
| PERF-01 | S4 → S2 | Badge refresh creates journals |
| INT-07 | S2 / S6 / S11 → S4 | Tap and exfil copies cause toasts |
| INT-08 | S7 (archives) ↔ S16 | One-way archive guard |
| SEC-04 / SEC-06 | S9 / S8 → S2 / S7 | Relays write across system boundaries unchecked |

### 4. Potential integration conflicts

- **INT-02:** terminal residents and session writes against uplink, force-unlock and resident writes.
- **INT-03:** concurrent trace and heat writes.
- **DATA-11:** scheduled cancel against delivery.
- **DATA-15:** duplicate inboxes.
- **INT-06:** a GM push against a player's contact edit.
- **INT-10:** a whole-flags write reverting a claim.
- **INT-12:** force-deliver against flush.

### 5. Shared state and data-integrity risks

- **Multiple sources of truth:**
  - lockouts: client memory, plus the shard `sessions` flag for shards only;
  - directory: per-client cache versus the setting;
  - player networks: GM memory fed by "hello";
  - held mail: player client, mirrored to the GM by sync.
- **Whole-object writes:** `traceLog`, `traceHeat`, `traceCountdowns`, `recycleBin`, `deliveryFailures`, `scheduledMessages` (serialized), `networkNodes` (serialized), `terminalState`, shard `state`, actor `contacts`/`contactGroups`.
- **Broken references after deletion:** aliases' `identityOf`; contacts' `actorId`; archive shards' journals; terminal pins (handled); residents whose host is gone (reaper only scans world items).

### 6. Fragile architectural dependencies

- `SocketManager` concurrency combined with whole-object read-modify-write.
- `game.user.isGM` used as "authority" in about 60 places, where `activeGM` is the real one.
- Field-by-field flag builders.
- Escaping that has to be remembered at each call site.
- An init ordering that assumes Foundry waits for async hooks.
- Behavior that depends on CPR hook order (COMPAT-02).

### 7. Missing integration tests

The 108 sims exercise logic on one cooperative mocked client. None of them model a second client acting concurrently, a hostile payload, or two GMs. Recommended additions, as more `dev/tools/sims/*.mjs` with mocked sockets:

| Test | Scenario | Expected | Failure indicator |
|---|---|---|---|
| T1 sender forging | Deliver a socket packet whose `sender` names the GM, with the real `userId` = player | Rejected | Handler acts |
| T2 relay authorization matrix | For each player→GM op: a request against an actor and item the player does **not** own | Rejected | Any write |
| T3 GM→client authority | Emit LOCKOUT, CLEAR or KICK from a player | Ignored | State changes |
| T4 two GMs | Two mocked GM clients receive one relay, one reaper tick, one migration | Exactly one application | Duplicate pages, heat or macros |
| T5 concurrent read-modify-write | Fire two `recordTrace` / `_quarantinePage` / `installResident` calls without awaiting in between | Both survive | A lost record |
| T6 no GM online | `runSiphon`, `claimEddies` and payload execution with no `activeGM` | Refused before the credit | Wealth increased |
| T7 claim race | Two claims on one entry before the sync | One credit | Two credits |
| T8 ack timeout | GM handler delayed past 8 s | No refund-plus-delivery, and no duplicate on retry | An eddies mismatch |
| T9 persistence round-trip | Every key `sendMessage` / `_stampOutgoing` sets survives `createMessage` → `_pageToMessage` | All kept | `signalDegradation`, `isBroadcast` or `tapLog` missing |
| T10 escaping | Render every admin, composer and toast path with an actor named `<img src=x onerror=window.__x=1>` (in a DOM harness) | `__x` stays unset | It gets set |
| T11 `cleanHtml` URL fuzz | `javascript&#58;`, `&#x6a;avascript:`, tab and newline inside the scheme, `&colon;` | Stripped | Kept |
| T12 directory reload | Change `masterContacts` on the "GM", then query on the "player" | New data | Old data |
| T13 badge on a fresh world | GM `_refreshAllUnreadCounts` with N actors and no inboxes | 0 journals created | N created |
| T14 deletion cascade | Remove a root NPC with aliases, then send to an alias; delete a linked actor, then send | Delivered or refused cleanly | Silent failure |
| T15 disconnect | A call party, a booth user or the watch operator disconnects | State cleaned up | Stale call or booth |

Runtime (live Foundry) checks are listed in §10.

### 8. Recommended improvements, ranked by risk and impact

1. **Authenticated relay layer** (fixes SEC-01, SEC-04 to SEC-08, SEC-21, SEC-22 and INT-01 together): the real `userId`, a per-op `requires` / `owns` / `validate`, and active-GM only.
2. **Remove executable references from relays** (SEC-02).
3. **One escaping policy** (SEC-03, SEC-11, SEC-12, SEC-16, SEC-17, SEC-19), plus receive-side sanitizing for the watch and overheard HUDs (SEC-09, SEC-10).
4. **GM-authoritative money operations** (DATA-01, DATA-02, DATA-03, DATA-06, SEC-07).
5. **A generic per-key write queue** for setting maps and item flag blocks (DATA-04, INT-02, INT-03, INT-06, INT-09, INT-11).
6. **Persist security state** (DATA-05); **reload the directory** (DATA-07).
7. **Initialization order** (COMPAT-01).
8. **A non-creating inbox lookup and scan caching** (PERF-01, PERF-05, PERF-06).
9. **Lifecycle hooks for disconnects** (DATA-14, DATA-17, DATA-21).
10. **A field-list contract for persistence builders**, with a sim (DATA-13, DATA-19, INT-04).

---

## 10. Missing tests and runtime verification requirements

**Static-only areas that need live Foundry confirmation**, in order:

1. **SEC-01, SEC-02, SEC-03:** two clients. From the player's console, emit (a) `content:updateRequest` with `gmToast:'<b>x</b>'` and see whether bold text appears on the GM; (b) `payload:effectRequest` with `uploadRun` + `macroId` of a harmless macro. Use a test world.
2. **No-console XSS:** rename a test PC to `<i>X</i>` (harmless markup), send mail, and check whether the Overview activity feed, the To autocomplete and toasts show italics (SEC-11, SEC-12, SEC-03).
3. **PERF-01:** GM reload on a world with NPC actors that have never had mail; count inbox journals before and after.
4. **COMPAT-01:** DevTools "Slow 3G" and reload; check the console for keybinding or initialization failures.
5. **DATA-01, DATA-02:** siphon and shard claim with no GM connected.
6. **INT-01:** two GM accounts online; one traced failure, one player mail, one plant fire.
7. **DATA-05:** F5 while locked out of a terminal account.
8. **DATA-07:** add a directory contact, then send to it from a player without reloading.
9. **COMPAT-02:** drag a converted terminal to the hotbar under CPR.
10. **COMPAT-03:** after an Admin → Phone preview, run `Object.getOwnPropertyDescriptor(game.user,'isGM')`.
11. **DATA-17:** reload mid-call.

## 11. Recommended fix priority

| Priority | Findings | Why |
|---|---|---|
| P0 (before any public or untrusted table) | SEC-01, SEC-02, SEC-03, SEC-11, SEC-12, DATA-01, DATA-02 | GM-client code execution; infinite money with no hacking needed |
| P1 | SEC-04 to SEC-10, SEC-13, SEC-14, INT-01, PERF-01, COMPAT-01, COMPAT-03, DATA-03, DATA-05, DATA-06, DATA-07 | Cross-player data destruction, multi-GM duplication, data pollution, initialization fragility |
| P2 | SEC-15 to SEC-22, PRIV-01 to PRIV-03, INT-02, INT-03, DATA-04, DATA-08 to DATA-18, COMPAT-02, COMPAT-04, PERF-02 to PERF-07 | Correctness, privacy, races, performance at scale |
| P3 | All Low items and Improvements | Hygiene, robustness, polish |

## 12. Areas requiring further investigation

- **About 60 socket ops:** the sockets review checked every op's handler entry, but deeper payload-shape validation for the newest ones (emergency, overheard, payphone `line`) deserves a second, independent pass.
- **UI apps not deeply reviewed:** about 40 admin and UI files with escaping concerns beyond the sampled ones. A grep for template-literal HTML that interpolates `.name`, `.subject` or `.email` into `innerHTML`/`Dialog` content across `scripts/ui/**` should be completed by stage 2.
- **CPR system data:** wealth writes assume `system.wealth = {value, transactions}`. Not checked across CPR versions.
- **Large-world performance:** none of the PERF findings were measured. Profile the Admin Messages tab and the GM badge on a world with more than 1,000 messages.
- **Compendium packs:** the `.db` and LevelDB macro packs were not inspected for content; they are generated, and their generator self-validates.
- **The `relationships` integration surface** (IntegrationBridge hooks) and its effect on other modules was not explored.
- **Hosting differences:** behavior on The Forge (latency for COMPAT-01, read-only data paths) was not tested.
- **Items Fable should independently verify:** SEC-01 (second socket argument on the target host), SEC-02, SEC-03, SEC-09, SEC-15, DATA-01, DATA-02, PERF-01 and COMPAT-01. Also look for anything this audit missed in `scripts/ui/**` HTML building, and in the newest uncommitted payphone code.
