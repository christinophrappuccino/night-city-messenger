# Post-audit report: what the remediation changed

The record of the audit remediation, for reference and for writing the changelog. It sits beside the three documents
it answers: `AUDIT-OPUS.md` and `AUDIT-FABLE.md` (the findings) and `AUDIT-REMEDIATION-PLAN.md` (the plan). Like them,
it is not shipped in the module zip.

- **Branch:** `audit-remediation`, from the checkpoint `383cd76` ("pre-remediation checkpoint"). `dev` is untouched.
- **Commits:** 36 batch commits, `25a9bf1` (A1) through `c30e357` (leftovers). The list is in section 4.
- **Size:** 312 files, +13,096 / −2,251 lines. Most of that is the new sims and test macros. One sweep was
  mechanical: all 1,098 module toast calls moved to `ncmNotify` (A4a).
- **Module version:** still `2.1.0` in `module.json`. Nothing here bumps it.
- **Tested:** every batch was syntax-checked, passed every sim in `dev/tools/sims/`, and passed its in-Foundry
  PASS/FAIL macro, run by the developer. Each new sim was also run against the code from before its fix, to show
  it fails there.
- **Not yet tested live with several clients:** the two-client "real checks" listed at the bottom of each macro's
  chat card (section 6).

---

## 1. Changelog draft (in players' and GMs' words)

The same changes as section 4, grouped by what a table notices. Edit freely.

### Security
- Players can no longer pretend to be the GM or another player in the messages NCM sends between browsers. Every
  request names its real sender, checked by Foundry's server.
- A player can no longer make the GM's browser run a macro.
- Every player request the GM acts on is now checked: who is asking, whether that character is theirs, and whether
  they can reach the shard, terminal, account or node. This covers shard hacks, terminal downloads and sessions, mail,
  scheduling, contact sharing, traces, network nodes, call logs and emergencies. The GM works out what a player's
  action does instead of accepting a result the player sent.
- Names, subjects and other text typed by players can no longer run script, wherever they appear: toasts,
  tooltips, GM dialogs, the admin panel, chat cards, stored mail and shard entries, and watch views of another
  player's window.
- Stored mail and shard text keep their formatting, but scripts, `javascript:` links and dangerous styles are
  removed when shown.
- Mail a player sends is checked again by the GM before delivery: send-only addresses and "must be in the
  directory". In a group send, only the refused people are dropped, and the player is told who and why.

### Mail
- With two GMs logged in, mail, traces and plants no longer happen twice. One GM handles each request.
- A message sent while the GM's answer is slow is no longer delivered twice or refunded too early. When there is
  no answer, the message is held, not failed. It goes out shortly after a GM connects.
- Scheduled mail: the delivering GM confirms adding, cancelling and editing. Eddies come back only once it is
  confirmed; a scheduled message being delivered can't also be refunded. A player's scheduled mail obeys the
  player's rules when it is delivered.
- The broadcast icon in Admin → Messages shows again. Low-signal garble and the Reconstruct roll now apply, to a
  player's sends only. Tapped conversations keep their running log.
- Taps, exfil copies, read tap logs and files no longer pop a "new message" toast. A second GM is no longer toasted
  for every player's mail.
- Saving one field of a message no longer re-sends the whole record, so an out-of-date copy can't undo a just-claimed
  eddies payment or a just-read flag.
- Rich text keeps the space between two formatted words ("**Hello** *world*" no longer becomes "Helloworld").

### Contacts and identities
- Changes to the GM directory reach every client without a reload.
- Deleting an NPC's main identity makes one of its aliases the new main, so the aliases' mail still has a home.
- Mail to a deleted character reaches its directory entry.
- If the sender's sent copy can't be saved, the GM is told.
- Contact-list changes from different places (sharing, phone numbers, the contact manager) no longer overwrite
  each other.

### Shards and terminals
- No money or program charges are lost or spent for nothing when no GM is online: siphons, eddies claims and
  program runs are refused instead.
- A program spends one charge each time it runs. A program with no charges set runs once.
- Destroying an archive copy of a shard no longer wipes the player's real shard. Purging a real shard also
  unconverts its archive copies.
- Backdoor accounts and timed programs on terminals carried by a character now expire and fire. Before, only
  terminals in the Items directory did.
- Lockouts and failed tries survive a reload.
- The Shard Encoder handles two conversions at once. Before, the second one cut off the first.
- The shard and terminal badges on sheets and in the Items directory keep fixed colours, whatever the player's
  theme: a cyan chip for shards, a white glyph on red for terminals.

### Calls and payphones
- When a user disconnects, every client ends the calls that user was part of and frees their payphone.
- A payphone caller can leave voicemail.
- Only the person who answered can talk into a call. Before, when two people picked up a payphone at once, the
  one who lost could still talk into it.
- Whoever answers a payphone's call sees the booth, not the person on it. "Who is on this booth" no longer reveals
  which call they are on. Hiding on screen is the whole model; see section 3.
- The booth's handset cord reaches the handset in the Foundry desktop app. Hanging up no longer reopens the booth.
  Walk away and "who is on it" sit above the booth instead of over its wires.
- A ringing payphone's bell stops by itself once the call ends, even if the end signal was missed.

### Rolls
- NCM skill rolls follow the chat box's roll mode: public, GM roll, blind GM roll or self roll. This applies to the
  Dice So Nice dice and to the chat card. NCM's own screens still show the roller whether it worked.

### Compatibility with Foundry and other modules
- NCM no longer stops working on a slow host: everything it registers at startup is in place before the game
  loads.
- NCM's templates no longer depend on helpers that other modules can replace.
- A phone preview no longer changes `game.user.isGM` for the rest of the session.
- Dragging a terminal or shard to the hotbar works with the Cyberpunk RED system. A terminal's item sheet opens the
  terminal.
- Map notes are switched on once per user, then left alone; before, they came back on at every load.
- Dragging an item from inside a compendium no longer throws an error.
- Chat-card buttons work in a popped-out chat log.
- NCM's stylesheet no longer styles other modules' elements: leftover `.mk-*`, `.fw-in`, roll-panel and
  boot-animation selectors are now scoped.

### Admin panel and performance
- The unread badge no longer creates empty inboxes. Orphan Audit lists empty ones, and deletes them only if you tick
  the box.
- Orphan Audit also repairs aliases whose main identity was deleted and contacts linked to a deleted character.
- Admin → Messages and the GM's inbox roster no longer rescan every page in the world on each redraw.
- The recycle bin lives in a GM-only journal instead of a setting sent to every client. Old entries are moved
  across once.
- With two GMs online, they no longer erase each other's network access log entries. Only the active GM saves it.
- Admin → Tools → Force Refresh now does what it says: every client re-reads NCM's contact list and redraws its
  open NCM windows.
- Create Network opens again. Windows no longer stack duplicate keyboard and selection listeners on each redraw.
- A watched node console no longer floods the network while its wave animates.
- The weak-signal wave in the inbox redraws about 12 times a second, not 60. It doesn't draw while the inbox is
  minimized, and it holds still when motion is turned down.
- Conversation lookups are kept between lines instead of scanning every journal.
- If a startup step fails, the GM gets one notice naming it. The startup log shows the real version.

---

## 2. What the remediation introduced: rules for future code

These are the patterns the fixes rely on. New code should keep to them, and most have a sim that fails when one is
broken.

| Rule | Where | Guarded by |
|---|---|---|
| A socket handler trusts the **second argument** (the sender's id, checked by the server), never a field in the message. `isFromGM(sender)`, `userOwnsActor(sender, actorId)`, `isPrimaryGM()` | `scripts/core/SocketManager.js`, `helpers.js` | `test-socket-identity` |
| Every socket op has a trust class in `SOCKET_TRUST` (request, result, peer, unused) | `scripts/utils/constants.js` | `test-socket-identity` (T16) |
| A player request carries **what they did** (an intent); the GM re-reads the data and computes the change | `scripts/utils/contentIntents.js`, the A3 relays | `test-content-intents`, `test-*-relays` |
| A linked macro runs only through `runGmMacro`, and only if a GM wrote the link | `helpers.js` | `test-macro-gate` |
| Toasts go through `ncmNotify`, which escapes. Tooltips use `{{ncm-tip}}` / `tipText()`. Picture urls use `cssUrl` | `scripts/utils/notify.js` | `test-safe-html`, `test-tooltip-text` |
| Stored HTML is cleaned when shown, not only on paste | `scripts/utils/richText.js` | `test-stored-html` |
| A read-modify-write of one record goes through `serialize(key, fn)`. Contacts use `contacts:<actorId>`. **Never wait on the same key inside `fn`** | `scripts/utils/serialize.js` | `test-serialized-writers`, `test-leftovers` |
| One GM acts on each request and runs each reaper: `isPrimaryGM()` | `helpers.js` | `test-one-gm` |
| A message keeps one id across retries (`sendKey`); "no answer" means held, never failed | `MessageService` | `test-relay-retry` |
| `createMessage` stores fields one by one: a new message field must be added there **and** in `_pageToMessage` | `MessageRepository.js` | `test-persist-roundtrip` |
| `updateMessageFlags` writes only the changed paths (`flagChangePaths`) | `MessageRepository.js` | `test-notify-quiet` |
| Startup registers everything synchronously inside `init` (`runPhaseNow`); ready waits on `initDone` | `ModuleInitializer.js`, `main.js` | `test-init-order` |
| Templates use only two-argument comparison subexpressions, not block helpers another module might replace | templates | `test-init-order` |
| Mail-scan caches are keyed on `mailRevision`, which journal, page, actor, user and setting hooks bump | `scripts/utils/mailRevision.js` | `test-mail-scan-cache` |
| A window binds its document-level listeners once and removes them on close | composer, Create Network | `test-listener-stacking` |
| Decorative animation is marked `data-watch-ignore` so watchers aren't sent it | `WatchService`, node console | `test-watch-chatter` |
| Measure on-screen geometry with one API (`getBoundingClientRect` on both ends) under CSS `zoom` | `PayphoneBooth.cordPoint` | `test-payphone-booth-polish` |

---

## 3. Decisions the developer made

| Item | Decision (2026-11-04 / 05) |
|---|---|
| B2: program charges | Every run spends one charge; none set = one use |
| D1: empty inboxes | Orphan Audit lists them; deleted only with an unticked box |
| D3: lockouts | Lockouts **and** failed tries are saved (world setting `securityLockouts`) |
| D5: recycle bin | Moved to a GM-only journal ("NCM — Recycle bin"); migration v6 moves old entries |
| E1: low-signal garble | Players' sends only; the GM's never, and never the sender's own copy |
| E4 / COMPAT-07: map notes | Switched on once per user, then left alone |
| E4 / COMPAT-09: roll mode | NCM rolls follow the chat roll mode, for both the dice and the card |
| A6 / PRIV-01: call privacy | **Say it honestly.** Masking a payphone or withheld caller is on screen only. Module messages reach every client, so a player using the browser's developer tools could find out who is calling. This is the same model as conversations; the GM guide and `CLAUDE.md` now say so |
| A6 / PRIV-02, PRIV-03 | Fixed: each booth side is masked per recipient; the in-use packet carries no call id |
| Badges | Fixed colours, not theme-following |
| Leftovers: GM re-check | The GM re-runs the send-only and directory checks on relayed player mail |
| Leftovers: access log | One GM saves; other GMs reload |
| Leftovers: Force Refresh | Redraws NCM windows on every client; no page reload |
| Payphone polish | Dev's own requests during the run: cord, hang-up, bar position |

---

## 4. Batches

Each batch has an in-Foundry macro in `dev/tools/` (paste it into a Script macro; it whispers a PASS/FAIL card) and
a sim in `dev/tools/sims/` (`node dev/tools/sims/<name>.mjs`).

| Batch | Commit | Audit IDs | What | Sim | Macro |
|---|---|---|---|---|---|
| A1 | `25a9bf1` | SEC-01 | Socket sender from the server | test-socket-identity | test-a1-sender |
| A4a | `c52f9e8` | SEC-03/11/12/19 | Escaped toasts and admin names | test-safe-html | test-a4a-safe-html |
| A5a | `f1165ef` | SEC-13/14/15 | Stored mail and shard HTML cannot run | test-stored-html | test-a5a-stored-html |
| A2 | `968666a` | SEC-02 | No player-triggered macros on the GM | test-macro-gate | test-a2-macro-gate |
| B1 | `eb0e519` | INT-01 | One GM handles each request | test-one-gm | test-b1-one-gm |
| A4b | `24d712a` | SEC-16/17/18 | Tooltips, GM dialogs, macro labels | test-tooltip-text | test-a4b-tooltips |
| A5b | `3814a00` | A5's rest: SEC-09/10/20/23 | What a client accepts from another | test-receive-side | test-a5b-receive-side |
| A3a | `0d73a67` | A3 as a whole: SEC-04/05/06/07/21/22 | Content relays as intents | test-content-intents | test-a3a-content-intents |
| A3b | `05a7303` | (A3) | Shard relays | test-shard-relays | test-a3b-shard-relays |
| A3c | `ceec7e2` | (A3) | Terminal relays | test-terminal-relays | test-a3c-terminal-relays |
| A3d | `bf1a258` | (A3) | Mail, scheduling, sharing, trace | test-mail-relays | test-a3d-mail-relays |
| A3e | `712af27` | (A3) | Nodes, trace, logs, calls, emergency | test-world-relays | test-a3e-world-relays |
| B2 | `ec7cb3a` | DATA-01/02/08/20 | Money and charge guards | test-money-guards | test-b2-money-guards |
| B3 | `410c78f` | DATA-06, INT-12, ARCH-01 | Relay ack and retry | test-relay-retry | test-b3-relay-retry |
| B4 | `2392f97` | DATA-04/15, INT-02/03/06/09/11 | Serialized writers | test-serialized-writers | test-b4-serialized-writers |
| B5 | `117305b` | DATA-11/12 | Scheduling requests | test-schedule-requests | test-b5-scheduling |
| B6 | `e87273f` | DATA-14/17/21 | Disconnects, GM arrival | test-disconnects | test-b6-disconnects |
| C1 | `61a1372` | COMPAT-01, FBL-01/07 | Init order, helper-independent templates | test-init-order | test-c1-init-order |
| C2 | `02dc4c0` | COMPAT-03/04 | `isGM` shadow, `.mt` leak | test-isgm-shadow | test-c2-isgm-shadow |
| C3 | `4aaba9f` | COMPAT-02 | CPR hotbar drops | test-hotbar-drop | test-c3-hotbar |
| D1 | `8755eb8` | PERF-01 | No inboxes from the badge | test-no-stray-inboxes | test-d1-stray-inboxes |
| D2 | `7f2894c` | DATA-07 | Directory reloads everywhere | test-directory-reload | test-d2-directory-reload |
| D3 | `031a016` | DATA-05 | Lockouts and tries persist | test-lockout-persist | test-d3-lockouts |
| D4 | `585eb08` | PERF-02/03 | Listeners bound once; Create Network fix | test-listener-stacking | test-d4-listeners |
| D5 | `2b8b82f` | PERF-05/06/07/09 | Scan caching; recycle bin journal | test-mail-scan-cache | test-d5-scan-cache |
| D6 | `91a6944` | PERF-04 | Watch chatter | test-watch-chatter | test-d6-watch-chatter |
| E1 | `e4bc197` | DATA-13/19, INT-04 | Persistence fields | test-persist-roundtrip | test-e1-persistence |
| E2 | `2a1b987` | DATA-09/10/16/18/22, INT-08 | References and cleanup | test-deletion-cascade | test-e2-references |
| (dev ask) | `2c97681` | — | Payphone booth polish | test-payphone-booth-polish | test-payphone-polish |
| E3 | `a51f00a` | INT-05/07/10 | Quiet copies, leaf flag writes | test-notify-quiet | test-e3-notify |
| E4 | `1ac3f1f` | COMPAT-07/08/09/10/11 | Roll mode, map notes, leaks | test-compat-small | test-e4-compat |
| E5 | `0635ca5` | PERF-08/10/12 | Wave, conversation cache, bell | test-perf-small | test-e5-perf |
| E6 | `d5a485e` | ARCH-02/03 | Startup failures, real version | test-startup-report | test-e6-startup |
| A6 | `8904c52` | PRIV-01/02/03 | Call privacy | test-call-privacy | test-a6-call-privacy |
| Leftovers | `c30e357` | (found during the run) | Badges, GM send re-check, contacts queue, word spaces, access log, Force Refresh, encoder results | test-leftovers | test-leftovers |

`dev/tools/sims/lib/socketHarness.mjs` is the shared multi-client fake server the relay sims use.

---

## 5. Deliberately not done, and known limits

- **COMPAT-06**, NCM's entries in the Items directory right-click menu. They are still added through the page
  rather than Foundry's menu hook. The menu works, and rebuilding it (including the ▸ sub-menus) risked breaking it.
- **PERF-11**, scene pre-wiring entries. These are never removed after an import. They were left as they are: they
  are small, and removing them would lose a pre-wire for a scene imported again.
- **Call privacy is on-screen only** (A6 decision). Moving a real identity to a GM-only route (whispered cards)
  would be a larger change to calls and payphones.
- **Conversations** have the same honest model: the data reaches every client, and the UI hides it.
- **Blind rolls:** the chat card and the dice are hidden from the roller, but NCM's own screens (a breach animation,
  a login) still show whether the roll worked. The game needs that.
- **Low-signal garble** now really happens for players on a network under 50%. Tables that never saw it before
  will see it now.
- **Program charges** now count down. Programs authored without a charge count run once.
- **Map notes:** a user who had already switched them off before this update gets them switched on one more time,
  on their first load with the update. After that their choice stands.
- **Mail stored before E1** has no broadcast mark and no garble data. It can't be recovered; only new mail
  carries these.
- **Migration v6** (the recycle bin move) is new and runs once, on the active GM. Back up a world before loading
  this version.

---

## 6. Live checks still worth doing (two clients)

Each macro's chat card ends with a "Real check" line. The ones that need a second client:

- A player calls another player from a payphone. The answerer sees "Payphone, …" and never the caller; the GM's call
  log shows the real caller (A6).
- Two GMs logged in: a player's mail is delivered once (B1), and the network access log keeps both GMs' events
  (leftovers).
- A player messages a send-only address, and the GM refuses it (leftovers).
- A player with a tap on a node gets no toast for a tapped copy (E3).
- A user disconnects in the middle of a call, and the call ends for the other party (B6).
- Force Refresh shows players the notice and redraws their open windows (leftovers).
- A watched node console (another client watching) still looks right (D6).

## 7. Running the checks

```bash
node dev/tools/check-syntax.mjs                       # every .js/.mjs, parsed as a module
for s in dev/tools/sims/*.mjs; do node "$s" >/dev/null || echo "FAILED $s"; done
```

`cdp-*.mjs` sims drive headless Chrome and need the mockup server (`node dev/tools/serve-mockups.cjs`); the loop
above runs them too, so skip them if Chrome isn't set up.
