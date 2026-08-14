# Terminal Expansion — Design Guide

> **Status:** design / brainstorm. Nothing built yet. This is the plan of record for
> converting items into **Terminals** — interactive computers a player "logs into,"
> as opposed to Data Shards (passive files you crack open).
>
> Drafted 2026-06-27 from three code-map passes (shard system, security/identity,
> MessageViewer + theme). File:line refs are point-in-time — verify before coding.

---

## 1. Concept & mental model

**Data Shard = a file you crack open. Terminal = a computer you sit down at.**

A Terminal is a converted **Item** (like a shard) that, instead of revealing a static set
of entries once decrypted, presents a **MessageViewer-style session** you log into. The
core new behaviors over a shard:

- You **log in as an account** (one of several on the machine), each with its own
  credentials and its own message set — "whose computer is this, and whose mailbox am I in?"
- The UI is the **inbox experience** (folders, read/reply, search), not a flat entry list.
- You can **exfiltrate** content into your own MessageViewer for safekeeping.
- The **GM themes the machine** (it should *look* like a NetWatch box vs. a Streetkid BBS),
  and players can **import/export** those themes.

Everything else — the security to get in, the ICE that bites you, the storage — is the
machinery you already built for shards and networks.

---

## 2. The one big architectural decision

**Recommendation: a Terminal is a _sibling_ of Data Shard, not a mode of it.**

- New atomic flag `flags.<MODULE>.isTerminal = true` (mirrors `isDataShard`).
- New `TerminalService` (parallels `DataShardService`) — but it **delegates** to the shared
  security/ICE/storage services rather than re-implementing them.
- New `TerminalViewerApp` (parallels/forks `MessageViewerApp`), reusing its list/detail UI.
- Shards stay simple containers; terminals get the session/account behavior. No risk of
  regressing the shard flow.

Why not "just a shard mode": the shard viewer (`ItemInboxApp`) is built around a flat,
content-typed entry list with overlays; the terminal wants the full mailbox UX. Forking keeps
both clean. We still **reuse the shard's security config block verbatim** (see §4).

---

## 3. What we reuse vs. build

| Capability | Reuse (exists today) | Build (new) |
|---|---|---|
| Item → X conversion | `convertToDataShard` flag pattern (`DataShardService.js:51`), `ShardSheetOverride._launchConversionFlow` (`:514`), `SHARD_CONVERT_REQUEST` socket relay (`SocketHandlers.js:135`) | `convertToTerminal`, terminal context-menu entry, `TERMINAL_CONVERT_REQUEST` |
| Security (password / skill / keyitem / lockout) | **Identical config block** across network+shard (`NetworkService.js:646`), `SecurityService` per-`actorId::targetId` tracking, `NetworkAuthDialog` method-card UI | A thin account-scoped wrapper (targetId = `terminalId::accountId`) |
| Black ICE | `ICEService.resolveICE / isLethalICE / applyDamage` | nothing — call as-is |
| Message storage | Journal pages w/ flags, `MessageRepository.identifyInbox` (`:185`) | A `type: 'terminal'` inbox kind + per-account tagging |
| Inbox UI | `MessageViewerApp` list/detail/search/responsive layout, `_enrichMessageDisplay` | `TerminalViewerApp`: decouple the message *source* from `this.actorId` |
| Theming | `ThemeService.applyTheme` (`:44`), admin-theme scoping pattern, import/export blob (`ThemeCustomizerApp.js:526`) | Per-terminal theme in item flags, scoped to `.ncm-terminal-viewer` |
| Identity / accounts | Email flag (`EmailService`), master directory (`MasterContactService`), `verifyContact` | Account = lightweight identity stored in terminal config |

**The headline:** the security config shape is byte-for-byte the same across networks, shards,
and terminals, and `SecurityService` already keys on `actorId::targetId`. So **per-account
login + lockout is free** — we just pick the right `targetId`.

---

## 3b. Phasing & MVP (the authoritative build order)

The §8/§9 menus are the *feature catalog*; this is the *build order*. Ship MVP, play it, then pull
from P2/P3. Each phase is independently shippable.

### ✅ MVP — Phase 1: "log into someone's box, read it, rip it"
The smallest slice that's genuinely fun and testable. **Definition of done:**
- **Convert** an item → Terminal: GM instant-convert (default config) + the "Convert to Terminal"
  context entry + the Admin **Terminals tab** (enumerate, open config, force-unlock, relock).
  *(Player conversion wizard → P2.)*
- **Accounts:** author **1+ accounts** (username/displayName/optional email + a `security` block).
  Login screen lists visible accounts; switch-account = log out + back to login. *(Privilege
  tiers / Manage Users / discovery → P2.)*
- **Login/security:** reuse the existing method-card auth (password / skill / keyitem, `authLogic`
  any|all, lockout, Black ICE) via `SecurityService` keyed `terminalId::accountId`. GM bypass.
- **Read mail:** `TerminalViewerApp` = MessageViewer fork with the **source adapter** (the one real
  refactor). Content type = **MESSAGE only**. Read/search/filter/sort/responsive all reuse. *(Other
  content types → P2; send-as/reply → P3.)*
- **Exfil:** copy selected messages **to your Agent inbox (§9a)** *and* **burn to a Data Shard
  (§9b)** — works in MVP because messages already flow through `addMessage`. Gate on a single
  terminal-level `allowExfil`. *(Per-file DRM §9c / capacity → P2.)*
- **Theme:** GM picks a per-terminal **theme preset** + login banner, scoped to
  `.ncm-terminal-viewer`. *(Import/export / per-account themes → P2.)*
- **Liveness:** none yet (static snapshot). **Multiplayer:** independent per-actor sessions.
- **Every setting above ships with hints/descriptions (§12b).**

### Phase 2 — content, account depth, authoring
- **Content-type catalog (§8c)** + the **shared `ContentRenderers` registry** (used by terminal
  *and* shard viewers) — SPREADSHEET, RECORD/DB, DOCUMENT, GALLERY, AUDIO, VIDEO/CCTV, BANKING,
  NOTE, CALENDAR, CHATLOG, SYSLOG, CREDENTIALS, SCHEMATIC, MALWARE.
- **Per-file DRM / copy policy (§9c)** + capacity limits.
- **Accounts:** privilege tiers (guest/user/admin), **Manage Users** panel, account **discovery**
  (enumerate / credential autofill), **CREDENTIALS-vault → unlock other accounts**.
- **Apps / desktop** (grouped views + GM wallpaper); **player conversion wizard** (tier-gated, via
  socket relay); **theme import/export** + per-account themes.
- **Authoring ergonomics (§8d):** prebuilt-terminals compendium + "quick-fill"; **contact exfil**
  (add a cracked account to your Agent); **GM consequence feed**; Admin **live-session board**.
- **Liveness:** "N new since last login" diff; scheduled content arrival.

### Phase 3 — tension, consequence, connectivity
- **Trace timer** while logged in + **cover-tracks** wipe; **login footprints / history**.
- **Send-as outbound mail** (the ★ live mail client); **forge / plant / tamper** that persists.
- **Backdoors** (recurring access); **honeypot/tripwire** accounts; **dead-man's-switch wipe**.
- **Networked terminals** (two-stage hack: network → terminal); **pivoting / known hosts**;
  **connected devices / world actions** (`terminalActions` macro hook).
- **Task Manager / CLI app**; **concurrent-presence** warnings + idle auto-logout + GM **spectate**;
  **form factor: agent** (loot a phone).
- *(Non-goal unless play demands: shared live multiplayer screen.)*

## 4. Data model

### 4.1 Terminal config (item flags)

Mirror the shard's three-flag pattern (`isTerminal` / `config` / `state` / `journalId`):

```
flags.<MODULE>.isTerminal = true
flags.<MODULE>.terminalConfig = {
  terminalName, metadata { owner, org, location, classification },
  boot { ...reuse shard boot block: banner/login splash },     // login banner / ASCII
  theme,                                                        // per-terminal theme (§7)
  network { required, allowedNetworks, ... },                  // reuse shard network gate
  accounts: [ ACCOUNT, ... ],                                  // §4.2 — THE new bit
  defaultAccountId,                                            // login screen default
  trace { enabled, duration, onComplete },                    // §8 tension (phase 3)
  allowExfil: true,                                            // can players download msgs?
  apps: ['mail', 'files', 'notes', 'banking'],                // §6 which apps exist
}
flags.<MODULE>.terminalState = {
  sessions: { [actorId]: { activeAccountId, loggedInAccounts:[], ... } },
  bootPlayed, firstAccessedAt, accessCount,
}
```

### 4.2 The Account object (the heart of the feature)

An account is a **login + a mailbox + (optional) its own security/theme**:

```
ACCOUNT = {
  id,                         // stable id
  username,                   // "v_arasaka" — what you type at login
  displayName,                // "Veronica A." — shown in the chrome once in
  email,                      // optional NCM email → ties into identity resolution
  isAdmin,                    // admin sees all accounts / all apps
  security: { ...SECURITY_BLOCK },   // SAME shape as network/shard security
  theme,                      // optional per-account theme override
  hidden,                     // not shown on login list until "enumerated" (§ idea)
  inboxJournalId,             // OR: messages tagged by accountId in one journal (see 4.3)
}
```

`SECURITY_BLOCK` = the exact object documented in CLAUDE.md (password / allowSkillCheck /
bypassSkills / bypassDC / allowKeyItem / keyItem* / authLogic / maxAttempts / lockoutDuration
/ encryptionType / failureMode / ice{}). **Author it with the same UI shards/networks use.**

### 4.3 Where account messages live

Two options — **recommend (A)** for phase 1:

- **(A) One terminal journal, pages tagged `accountId`.** Reuse the shard journal pattern:
  a single linked `JournalEntry` (`type: 'terminal'`, `linkedItemId`), each page a message with
  flags `{ messageId, accountId, folder, ...standard message flags }`. The viewer filters by the
  active account. Simplest; one document to manage; matches `identifyInbox` if we add a
  `terminal` type.
- **(B) One inbox journal per account.** Closer to the real inbox model but multiplies documents.
  Defer unless accounts need fully independent folder structures.

Messages reuse the **existing message flag shape** (`_pageToMessage`, `MessageRepository`), so
`_enrichMessageDisplay` and the whole viewer pipeline work unchanged.

---

## 5. Security & login flow

1. Player opens the terminal item → `TerminalViewerApp`.
2. **Boot/login splash** (reuse shard boot block) shows the GM's banner + a **login screen**
   listing visible accounts (`hidden` ones omitted until discovered).
3. Player picks an account → auth runs through the **existing method-card auth UI**
   (`NetworkAuthDialog` generalized, or a terminal-scoped instance) using
   `account.security`, with `SecurityService` tracking keyed on
   **`targetId = ${terminalId}::${accountId}`** → per-account attempts & lockout, no new code.
4. On success, `terminalState.sessions[actorId].activeAccountId = accountId`; the viewer
   re-renders into that account's mailbox.
5. Failure paths reuse shard/network behavior: lockout, **Black ICE damage** via
   `ICEService.applyDamage` when `failureMode === 'damage'`.
6. **Switch account** (the "log into a different account" feature) = log out + back to the
   login screen; admin accounts may list/jump to others directly.
7. **GM bypass** mirrors the shard `forceDecrypt` — GM sees everything without auth.

> Refactor note: `NetworkAuthDialog` currently reads `network.security`. To reuse it for
> terminals, parameterize its "what am I authing against" source (a `{ security, name,
> targetId }` descriptor) instead of hard-binding to a network. This also tidies the network/
> shard duplication. Alternatively, copy it to a `SecurityAuthDialog` both consume.

---

## 6. The Terminal UI (`TerminalViewerApp`)

Fork `MessageViewerApp`; the work is **decoupling the message source from `this.actorId`**:

- **Message source seam:** `_loadMessages()` (`MessageViewerApp.js:3975`) calls
  `messageService.getMessages(this.actorId, …)`. Replace with a source adapter:
  `this._source` is either an actor inbox (normal) or a terminal account
  (`TerminalService.getAccountMessages(item, accountId)`). Everything downstream (filter/sort/
  paginate/enrich) is source-agnostic already.
- **Account switcher replaces character switcher:** the existing `switch-character` drawer
  (`:1574`) becomes a `switch-account` action → back to login (re-auth unless already unlocked).
- **Window chrome:** title `"{username} @ {terminalName}"` instead of `{handle} // {agentName}`
  (reuse the `get title()` seam at `:159`).
- **Apps strip (phase 2):** the folder tabs generalize into "apps" (Mail / Files / Notes /
  Banking). Each app is a filtered view or a small custom panel; gate per `account.isAdmin` or a
  per-app access check (reuse the shard per-entry access pattern).
- **Reuse as-is:** responsive container-query layout, sidebar resize, search, bulk select,
  read/reply/forward, the network selector/HUD (terminals can show "you are jacked into X").

---

## 6b. GM Admin Panel — Terminals tab

The Admin Panel is composed (thin `AdminPanelApp` shell + per-tab classes under
`AdminPanel/tabs/`). Add a **`TerminalsTab`** mirroring `ShardsTab`/`NetworksTab`:

- **Enumerate** every terminal: scan `game.items` + all `actor.items` for `isTerminal` (parallel
  to `ToolsTab._collectDataShards`). Show name, owner/org, account count, current logins, network
  binding, lock state.
- **Convert** here too: an "Import Item → Terminal" / convert button (same affordance as the
  Shards tab "Convert"), plus the actor-sheet + Items-directory context entry.
- **Per-terminal management:** open the `TerminalConfig` sheet; **manage accounts** (add / edit /
  reset password / delete, set admin); **force-unlock** (GM bypass, mirrors `forceDecrypt`);
  **relock** (mirrors `relockShard` — `unsetFlag`→`setFlag`); push/apply a theme.
- **Live session view:** which players are jacked into which terminal/account right now (reads
  `terminalState.sessions`) — the GM's "who's in the system" board.
- **Purge integration:** extend Tools → Purge to include terminal journals (reuse the scoped-purge
  enumerate pattern; delete only message pages so the terminal survives).

Wiring follows the documented admin pattern: action name → one-line static delegator on
`AdminPanelApp` → `onXyz` instance method on `TerminalsTab`; cross-refs via `this.app.*`.

## 7. Per-terminal theming

The admin-theme pattern is the blueprint: **CSS custom properties resolve from the nearest
ancestor**, so scope the terminal theme to the window root instead of `:root`.

- **Store** the theme in `terminalConfig.theme` (and optional `account.theme`) — same prefs
  shape as `playerTheme`.
- **Apply** by writing the `--ncm-*` vars onto the **`.ncm-terminal-viewer` element**, not
  `:root` (generalize `ThemeService.applyTheme` to take a target element — it's nearly there;
  admin-theme.css already proves the scoping). The player's own `:root` theme is untouched, so a
  hacked corp box looks corporate while the player's client stays their style.
- **GM sets it** from the terminal config UI (reuse the preset list + color/font controls from
  `ThemeCustomizerApp`).
- **Import/export** reuses the blob download / hidden file-input pattern
  (`ThemeCustomizerApp.js:526–567`) — GM exports `ncm-terminal-<name>.json`; players import into
  a terminal they own/configure. Reuse `THEME_PRESETS` (ship terminal-flavored presets:
  Arasaka, NetWatch, Streetkid-BBS, Retro-DOS, Ripperdoc).
- **Login banner** (`terminalConfig.boot`) + theme together carry the "whose machine" story.

---

## 8. Feature ideas (mapped to phases)

### Phase 1 — MVP ("log into a computer and read the mail")
- Item → Terminal conversion (GM instant + player wizard, reusing shard flow).
- Login screen with **one+ accounts**; auth via existing security stack; per-account lockout.
- MessageViewer-style mailbox sourced from the terminal.
- **Download-to-inbox** exfil: copy selected messages into the player's actor inbox, tagged
  "Recovered from {terminal}" (see §9).
- GM theme via presets; login banner.

### Phase 2 — depth
- **Multiple accounts + privilege tiers** (guest/user/admin); admin sees all accounts/apps.
- **Account discovery:** `hidden` accounts revealed by an "enumerate users" skill check or by
  finding creds in a message (autofill from a key-item/message).
- **Apps:** Files/Documents, Notes, Banking (eddies ledger — reuse `claimEddies`).
- Theme **import/export** + per-account theme overrides.
- Copy a terminal's contacts into your directory (reuse `ContactRepository` / master verify).

### Phase 3 — tension & consequence
- **Trace timer** while logged in (reuse self-destruct/trace countdown); completion → alarm/ICE/
  GM toast. "Smash-and-grab" pacing.
- **Cover your tracks** on logout (skill check to wipe logs) vs. leaving a "last login" trail.
- **Forge / plant / delete** messages as the account owner (reuse anonymous-send impersonation
  infra) — write mail that looks like it came from them.
- **Networked terminals:** reachable only when connected to the terminal's NetworkService
  network → two-stage hack (network auth *then* terminal auth). Chain the gates.
- **World-state actions:** GM-scriptable buttons (open a door = toggle a wall/light, disable
  cameras, transfer eddies to the party). A small `terminalActions` macro hook.

### 8b. Terminal-specific features (what a passive shard *can't* do)

These are the differentiators — they only make sense because a terminal is a **live machine you
are present on**, not a file you opened. Curated, highest-value first:

- **Send-as / outbound mail (★ signature).** The terminal is a *live mail client*: compose and
  **actually deliver** a message FROM the logged-in account to a real actor/contact via
  `MessageService.sendMessage`. You can socially-engineer NPCs *as* the owner; their replies land
  back in this account, readable next time you log in. A shard can never do this — it has no
  outbox.
- **Login history + footprints.** Terminal shows "Last login: {date} from {location}." Reading it
  profiles the owner; **your** login writes a history entry the owner sees later — unless you
  **cover tracks** (skill check to wipe the log). Presence has consequences.
- **Privilege escalation across accounts.** Guest → user → admin; each unlock reveals more
  accounts/apps. Admin gets a **"Manage Users"** panel (see other accounts, reset/lock them —
  player sabotage or GM tooling). Multiple accounts is the terminal's reason to exist.
- **Pivoting / known hosts.** A terminal has bookmarks/known machines; cracking it yields a
  **jump-point to another terminal** (optionally over its network). Builds a graph of machines to
  hop — a netrun *route*, not a single object.
- **Connected devices.** The machine controls real things in the scene — door locks, cameras,
  turrets, a braindance rig, a vehicle. Buttons fire `terminalActions` (GM macro hook) to toggle
  world state. The terminal is the *console for the room*.
- **Tamper / forge / plant (persists for the owner).** Edit or delete the owner's messages, alter
  a transaction record, plant evidence. Reuses anon-send impersonation; changes stick — the owner
  finds them later.
- **Backdoor for recurring access.** "Install backdoor" (a flag) lets you re-enter without
  re-hacking; GM can detect/remove it. Turns a one-shot hack into an ongoing asset.
- **OS metaphor — apps + desktop.** A home screen with app icons (Mail / Files / Notes / Banking /
  Photos / Recycle Bin) and a GM-set **wallpaper**, vs. the shard's single scroll. Optional
  **CLI/console app** (type `ls`/`cat`/`decrypt`) for retro flavor + hidden content.
- **Task Manager / running processes.** A process list; killing one (skill check) disables a
  security layer, silences an alarm, or frees a locked app — an in-fiction way to *reduce* the
  security stack mid-session.
- **Concurrent-presence tension.** Even with independent sessions, show "⚠ admin is currently
  active" (real or bluff) to pressure the player; idle **auto-logout** after inactivity. GM can
  **spectate** a live session from the Admin panel.
- **Honeypot / tripwire accounts.** Decoy accounts that, if accessed, fire an alarm/trace/ICE
  instead of granting data.

---

### 8c. Content types & apps (what's *on* the machine)

Extend the shard `contentType` registry (today: MESSAGE / EDDIES / DOSSIER / PAYLOAD / AVLOG /
LOCATION). Each new type = a `contentData` shape + a renderer; most reuse existing systems.
**Design rule:** every file type has a *mechanical hook*, not just flavor. Encrypted/redacted
pieces reuse the per-entry encryption layer; media reuses `resolveMediaEmbed`; money reuses
`claimEddies`. All are exfiltratable (§9) per `allowExfil`.

| Type | `contentData` (sketch) | Mechanical hook | Reuse |
|---|---|---|---|
| **SPREADSHEET** | `{ columns[], rows[][], redactedCells[], flaggedCells[] }` | spot the anomaly / **siphon a transaction** / find a target on a hit list; cells can be individually encrypted | table render; encryption layer; `claimEddies` |
| **DOCUMENT** | `{ title, richText, classification }` | memos/contracts/NDAs/reports; sections gated by access check | rich text; per-entry access |
| **RECORD/DB** | `{ schema, records[], searchable }` | look someone up → intel; address → LOCATION pin | DOSSIER render + search |
| **SCHEMATIC** | `{ imageUrl, annotations[] }` | heist intel — floorplans/guard routes/vault spot | image viewer; optional scene link |
| **GALLERY** | `{ images[] {url,caption} }` | blackmail / surveillance / ID scans | `resolveMediaEmbed` |
| **AUDIO** | `{ mediaUrl, transcript? }` | wiretap / voicemail / confession | media embed (audio) |
| **VIDEO/CCTV** | `{ mediaUrl, live? }` | security footage; may expose a scene | media embed (video) |
| **CREDENTIALS** | `{ entries[] {host, user, secret} }` | **the jackpot** — other accounts' logins → escalation / pivot to other terminals & networks | keyitem/login autofill |
| **BANKING** | `{ balance, currency, transactions[] }` | transfer/drain eddies; cold wallet = vault needing 2nd key | `claimEddies`; keyitem |
| **NOTE** | `{ text }` | sticky-note password / diary (RP) / to-do — sometimes the actual solution | trivial |
| **CALENDAR** | `{ events[] {when, where, who} }` | ambush/meet intel; ticking deadlines | timeService |
| **CHATLOG** | `{ thread[] {from, text, ts} }` | back-channel tone; deleted-but-recoverable in Recycle Bin | message render; soft-delete |
| **MALWARE** | `{ payloadType, deployable }` | copyable weapon; honeypot variant trips a trace on open | PAYLOAD + trace-fire |
| **SYSLOG** | `{ entries[] {ts, actor, action} }` | login history / footprints; error hints at a weakness | login-history (§8b) |

Apps (phase 2) are just **grouped views over these types** (Mail = MESSAGE, Files = DOCUMENT/
SPREADSHEET/SCHEMATIC, Photos = GALLERY, Banking = BANKING, Security = VIDEO/CCTV + device
actions) + a GM **wallpaper**. `terminalConfig.apps[]` picks which exist; admin accounts see all.

### 8d. Structural additions (not features — what makes it land)

- **Liveness / persistence.** Terminals are *not* snapshots — the owner keeps using the machine.
  Reuse `SchedulingService` so new mail/files arrive over the campaign; show a **"N new since your
  last login"** diff per account. A raided box that has *changed* next session is the difference
  between a fixture and a prop.
- **Authoring ergonomics (adoption-critical).** Ship a **compendium of prebuilt terminals**
  (Arasaka workstation, ripperdoc PC, fixer's burner) + a **"quick-fill"** that seeds plausible
  accounts/files. Target: empty item → playable terminal in under a minute, or GMs won't use them.
- **GM consequence feed.** Tamper / exfil / forge / login each fire a GM toast (reuse the existing
  `notifyGm*` pattern) so the GM keeps track of what happened inside the machine.
- **Form factor = same tech.** `terminalConfig.formFactor: 'desktop' | 'agent'` changes only the
  chrome — so the identical conversion lets you **loot a victim's Agent (phone) off their body**
  and raid it, not just sit at a fixed terminal.
- **Empty / bricked / offline + dead-man's-switch.** Define the no-accounts, powered-off, and
  bricked states (polish). Stakes-raiser: too many failures or a tripped alarm **wipes the data**
  (reuse the self-destruct / `shard-expire` path).

## 9. Exfiltration — three destinations

Any content the player can see can be **taken** (subject to its copy policy, §9c). There are three
destinations; all three copy the *same* entry/message objects, so no new content format is needed:

### 9a. To your Agent inbox (read-it-later)
A journal-page copy into the player's own inbox:
- `TerminalService.exfilToInbox(item, accountId, ids, targetActorId)`:
  1. Resolve the player's inbox via `MessageRepository.getInboxJournal(actorId)`.
  2. Copy each selected entry as a page reusing the existing message flag shape, stamping
     `metadata.recoveredFrom = terminalName`, fresh `messageId`, synthetic `from` (the account).
  3. Fire the normal document-sync hooks so open viewers update — **no new delivery path** (worst
     case route through `MessageService._deliverMessage` with a "recovered" source).

### 9b. To a physical Data Shard (the "go-bag" — ★ capstone)
Burn the selected content onto an **inventory item** so it's portable, lootable, tradeable. This
is just the Shard system as the exfil *target*:
- Player picks a target item (a **"Blank Data Shard"** the module ships, or any gear) via the
  inventory picker (reuse `showItemPicker` / the keyitem picker).
- `TerminalService.exfilToShard(sourceItem, accountId, ids, targetItem)`:
  1. If the target isn't already a shard, `convertToDataShard(targetItem)` (default config).
  2. For each selected entry, `DataShardService.addMessage(targetItem, entryData)` — the entry
     **keeps its `contentType`/`contentData`**, so a copied SPREADSHEET stays a spreadsheet.
  3. Player path goes through **`SHARD_CONVERT_REQUEST`** (carrying the entries) since players
     can't write the GM-owned shard journal — exactly the shard initial-entry relay pattern.
- The shard is now a **portable viewer** for free: `ItemInboxApp` already renders shard entries.
  **Build the per-content renderers once (§8c) and share them between `TerminalViewerApp` and
  `ItemInboxApp`** so a downloaded calendar/log/spreadsheet looks identical wherever it's opened.
- **Encryption carries over:** copy *decrypted* if the player already cracked it, else copy
  *still-encrypted* (they cracked the box, not the file — must decrypt the shard later).
- Optional **capacity**: a shard holds N entries → "take it to go" forces choices; oversize copies
  prompt what to drop. Defer to phase 3.

### 9c. Copy policy / DRM (the "security that blocks it")
Per-content exfil gate — the decision layer that makes ripping data a *play beat*:
```
entry.exfil = {
  allowed,          // false → "Copy Protected", can't take at all
  requiresHack,     // must pass a check to rip it
  dv,               // the rip DV (defaults to the file's encryptionDC)
  onFail,           // 'corrupt' | 'watermark' | 'trace' | 'block'
}
```
- `allowed:false` → shown but not takeable (corp DRM).
- `requiresHack` → a skill check (reuse `SkillService.performCheck`); success rips it, failure
  applies `onFail` (corrupted copy via integrity, a traceable watermark, or trips the trace timer).
- Terminal-level `allowExfil` is the master switch; per-entry `exfil` refines it.
- Exfil **takes in-world time** → feeds the trace timer (download = exposure). Big steals are loud.

---

## 10. Conversion flow

Clone the shard launch path:

- **GM**: instant `convertToTerminal(item)` with default config, then configure via a
  `TerminalConfig` sheet (parallel to `ItemInboxConfig`). Mirror `ShardSheetOverride`'s
  context-menu entry ("Convert to Terminal") on actor sheets + the Items directory.
- **Player**: a tier-gated wizard (parallel to `ShardConversionFlow`) if you want players to
  build terminals; **players can't write to GM-owned journals**, so the initial accounts/entries
  **ride along in the socket relay** (`TERMINAL_CONVERT_REQUEST` → GM does convert + seed in one
  round-trip), exactly like `SHARD_CONVERT_REQUEST` carries `entryData`.
- Macro API: `game.nightcity.messenger.convertToTerminal(itemOrId, config)`,
  `addTerminalAccount(...)`, `addTerminalMessage(...)`, `forceUnlockTerminal(...)`.

---

## 11. Decisions (locked 2026-06-27)

1. **Multiplayer = independent sessions.** Each player logs into an account; session state keyed
   per `actorId` exactly like shard sessions. No live-screen broadcast. (Shared screen is off the
   table for now — revisit only if play demands it.)
2. **Account ↔ identity = optional link.** `account.email` is freeform, but when it matches a
   master-directory contact, the viewer surfaces **"Add to my contacts"** — the signature beat is
   *log into someone else's box and walk away with a real contact in your own Agent*. If it
   matches no one, it stays a plain string.
3. **Storage = one journal per Terminal**, pages tagged `accountId` (§4.3 option A). Easier to
   track (one document = one machine); the viewer filters pages by the active account.
4. **Terminal is a sibling of Data Shard** — `isTerminal` flag, own `TerminalService` +
   `TerminalViewerApp`, reusing the shared security/ICE/storage/theme plumbing.
5. **Interface stat** for terminal hacks stays TECH+Interface+d10, consistent with `SKILL_MAP`.
6. **Conversion parity** — "Convert to Terminal" behaves like shard conversion: GM instant +
   default config, player tier-gated wizard, socket relay for player-seeded data.

---

## 12. File-by-file sketch (phase 1)

| File | Action |
|---|---|
| `scripts/services/TerminalService.js` | **New.** convert/seed/getAccountMessages/login(via SecurityService)/exfiltrate; delegates security+ICE. |
| `scripts/ui/Terminal/TerminalViewerApp.js` | **New.** Fork of MessageViewer with the source adapter + account switcher + login screen. |
| `scripts/ui/Terminal/TerminalConfigApp.js` | **New.** GM authoring (accounts, security per account, theme, banner). |
| `scripts/ui/AdminPanel/tabs/TerminalsTab.js` + `templates/admin-panel/tab-terminals.hbs` | **New.** Enumerate/convert/manage terminals + live-session board (§6b); wire action→delegator→tab method per the admin pattern. |
| `templates/terminal/*.hbs` | **New.** viewer + login + config; reuse message-detail/list partials where possible. |
| `templates/content/*.hbs` (+ a `ContentRenderers` registry) | **New, shared.** One renderer per `contentType` (spreadsheet/calendar/log/…), consumed by **both** `TerminalViewerApp` and `ItemInboxApp` so downloaded content (§9b) looks identical wherever opened. Refactor shard entry rendering onto it. |
| "Blank Data Shard" item (compendium) | **New.** Ships a blank gear item players target when burning content to a shard (§9b); plus the prebuilt-terminals compendium (§8d). |
| `styles/components/terminal.css` | **New.** scope `--ncm-*` overrides to `.ncm-terminal-viewer` (admin-theme pattern). |
| `scripts/ui/NetworkManagement/NetworkAuthDialog.js` | **Refactor.** Parameterize the auth target → `{security, name, targetId}` so terminals reuse it. |
| `scripts/services/ThemeService.js` | **Small refactor.** `applyTheme(prefs, targetEl = :root)`. |
| `scripts/data/MessageRepository.js` | **Extend.** add `type: 'terminal'` to `identifyInbox` + a terminal-journal helper. |
| `scripts/integrations/SocketHandlers.js` | **Extend.** `TERMINAL_CONVERT_REQUEST`. |
| `scripts/integrations/*SheetOverride*` | **Extend.** "Convert to Terminal" context entry. |
| `scripts/init/register*.js` | **Extend.** construct `TerminalService`, register macro API + `openTerminal`. |
| `scripts/utils/constants.js` | **Extend.** `DEFAULTS.TERMINAL_CONFIG/STATE`, `TEMPLATES.TERMINAL_*`, terminal theme presets. |
| `CLAUDE.md` | **Doc.** new "Architecture: terminals" section once built. |

---

## 12b. Design principles & non-goals (keep scope honest)

- **Every config/setting is self-explanatory (non-negotiable).** A new GM or player must
  understand what a control does *without* reading this doc or the code. Concretely, for anything
  we add:
  - Module settings (`registerSettings`) get a real `hint` string in `languages/en.json` — never a
    bare label. Keep the hint and the behavior in sync (the standing `RequireContactVerificationHint`
    rule).
  - In-UI config fields (the `TerminalConfig` sheet, account/security/exfil options) get inline
    helper text or a native `data-tooltip`, and say what *off/0/empty* means, not just *on*.
  - Presets, themes, content types, `failureMode`/`authLogic`/`onFail` enums each ship a one-line
    plain-language description shown in the picker (e.g. "ALL = every method required").
  - Destructive/risky toggles (wipe-on-fail, copy-protection, trace) state the consequence in the
    hint. No silent footguns.
- **Every file/feature has a mechanical hook** — if it's pure flavor, it's a `NOTE`, not a new type.
- **Reuse before build** — networks/shards/themes already solve security, ICE, storage, theming.
  A new code path is a smell; prefer parameterizing an existing one.
- **Author-time speed beats feature count** — a terminal nobody builds is worth nothing (see §8d).
- **Don't fork the shared security contract** — networks + shards + terminals share it; treat it
  as stable.
- **Non-goals (for now):** shared live multiplayer screen; a full file-system tree; a real
  scripting language in the CLI app; terminal-to-terminal real-time chat. Revisit only if play
  demands it.

## 13. Risks & gotchas (from the existing codebase)

- **Nested-flag writes are unreliable** — reset state via `unsetFlag` then `setFlag` (the shard
  `relockShard` lesson).
- **Players can't write GM-owned journals** — all player-initiated seeding must go through the
  socket relay (the shard initial-entry bug).
- **`identifyInbox` is flag-based** — never key terminal inboxes on a name prefix.
- **Button/input resets** in any new standalone window need the Foundry `!important` resets
  scoped to the inner content (the auth-dialog ✕-glyph lesson).
- **Theme scoping**: write terminal vars to the window element, never `:root` (don't clobber the
  player's theme).
- **Security config is shared** — if you "improve" the security block shape, you touch networks
  and shards too. Treat it as a stable contract.
- **No build step** — new files load via `module.json` esmodules; new templates must be added to
  `TEMPLATES` + preloaded; new CSS `@import`ed into `cyberpunk-messenger.css`.

---

## 14. One-paragraph pitch (for the README, later)

> **Terminals** turn any item into someone else's computer. Jack in, crack the login (password,
> skill check, or a stolen keycard — same security you already use for shards and networks), and
> you're in their inbox: read their mail, raid their files, drain their account, or forge a
> message in their name. Multiple accounts per machine mean privilege escalation is a thing.
> GMs dress each terminal in its own theme and login banner so a NetWatch box *feels* different
> from a back-alley BBS — and players can rip a copy of anything they find back to their own deck.
