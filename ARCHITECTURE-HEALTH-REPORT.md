# Night City Messenger — Architecture & Code Health Report (Stage 2)

**Date:** 2026-11-05 · **Branch read:** `dev` at `cf7cdcd` · **Module version:** 2.1.0 · **Foundry:** v12 (minimum and verified)
**Scope:** read-only. No source file was changed. This report sits beside `AUDIT-POST.md` and, like it, is not shipped
(the zip is an allowlist).

**How the evidence was gathered.** Scripts in the session scratchpad parsed every `.js` file under `scripts/`: the
static and dynamic import graph (cycle search with Tarjan's algorithm), every `game.nightcity.*` access, every
`EVENTS.*` and `SOCKET_OPS.*` emit and subscription, every `game.settings.register`, and counts of hooks, intervals and
document listeners. Specific files were then read to confirm each finding. Numbers below are from those scripts;
"no emitter found" means a static search found none, not a runtime proof.

---

## 1. Executive summary

NCM is a large module (230 JS files, 131,000 lines of JS; 106 templates; 100 stylesheets, 52,700 lines; 146 Node sims;
42 in-Foundry test macros). It is in better structural shape than its size suggests:

- **No static import cycles.** The layering `utils → data → services → ui` mostly holds.
- **One startup path** (`ModuleInitializer` + nine `register*` files), with failure isolation and a GM report.
- **One socket router** with a server-verified sender and a trust class for every op (the audit's A1 work).
- **Strong pure-rule modules** (`participants.js`, `threading.js`, `conversations.js`, `networkNodes.js`,
  `jackIn.js`, `EncoderModel.js`, `phoneNumbering.js`…) that the sims drive directly. This is the module's best asset
  for future work.
- **Registries already exist** for several extension axes: `PROGRAM_EFFECTS`, `CONTENT_TYPE_INFO`, `TERMINAL_PRESETS`,
  `SHARD_PRESETS`, `SOUND_PATHS`/`SOUND_INFO`, `TEMPLATES`.

The problems that matter for continued growth are fewer and more specific:

1. **The real dependency graph is invisible.** Services find each other through `game.nightcity.*` (1,364 accesses,
   76 names), so the static graph shows no cycles while the runtime graph has several (MessageService ↔ NetworkService,
   MessageService ↔ NotificationService, TerminalService ↔ TraceService, MasterContactService ↔ CallService). A failed
   startup step leaves its name `undefined`, and consumers' optional chaining turns that into silent no-ops.
2. **Money is written in seven places with three different rules,** and none of them serialize. Eddies are the
   highest-stakes data the module touches.
3. **The player → GM request/response pattern is reimplemented in at least six places.** Two of them register a fresh
   socket handler per request into a single-handler map, so a second concurrent request silently replaces the first.
4. **Nothing runs the 146 sims automatically.** CI only zips and publishes.
5. **`CLAUDE.md` is 660 KB** (1,357 very long lines, ~160k tokens). It is loaded into every Claude Code session. It is
   accurate and valuable, but it is now the main cost of starting work, and it mixes standing rules with as-built
   history.
6. **Feature on/off is ad hoc.** Conversations show the right pattern (reload-required setting, service built but not
   wired, socket handlers not registered). Calls use a different pattern (live UI hiding, handlers always on). Everything
   else is always on. A small feature registry would make toggles consistent without a framework.
7. **The public API (`game.modules.get(id).api`, v1.0.0) exposes raw service instances.** That makes every method of
   those classes, including internals, an implicit contract, which conflicts with INTEGRATION.md's own promise that
   internals may change.

None of these needs a rewrite. The plan in §13 is a sequence of small, independently testable steps, most of them
mechanical. The largest files (MessageViewerApp, DataShardComposer) are worth splitting only along seams, and only
when next touched.

---

## 2. Current architecture overview

### 2.1 Size and shape

| Tree | Files | Lines | Role |
|---|---:|---:|---|
| `scripts/ui/` | 99 | 80,903 | AppV2 windows, admin tabs, framework-free modals, content renderers |
| `scripts/services/` | 29 | 22,998 | Long-lived stateful services (`game.nightcity.<x>Service`) |
| `scripts/utils/` | 60 | 14,123 | Pure rules, helpers, constants, small UI utilities |
| `scripts/integrations/` | 10 | 4,242 | Foundry hooks/sheets, socket handlers, macro API, public API bridge |
| `scripts/init/` | 12 | 2,683 | Startup task registration |
| `scripts/data/` | 5 | 2,490 | Repositories (journal/flag persistence) |
| `scripts/core/` | 8 | 2,311 | Initializer, settings, EventBus, sockets, migrations, factory reset |
| `scripts/tests/` | 6 | 1,595 | In-Foundry verification suites (shipped; run under `debugMode`) |

Largest files: `MessageViewerApp.js` 6,216 · `DataShardComposer.js` 5,727 · `MessageComposerApp.js` 3,760 ·
`TerminalViewerApp.js` 3,402 · `MessagesTab.js` 3,334 · `ItemInboxApp.js` 3,282 · `ShardEncoderApp.js` 3,267 ·
`ContactsTab.js` 2,829 · `MessageService.js` 2,618 · `TerminalService.js` 2,560 · `TerminalConfigApp.js` 2,517 ·
`ContentRenderers.js` 2,516 · `DataShardService.js` 2,320.

### 2.2 Startup

`scripts/main.js` → `ModuleInitializer` → twelve `register*` calls → four phases. preInit/init run synchronously inside
Foundry's `init` hook (`runPhaseNow`); ready awaits `initDone`, then runs `ready` tasks in priority order; `postReady`
runs 100 ms later and ends with `reportFailures()`.

Ready-phase service order (priority): Time 10 · Theme 15 · Sound 16 · Skill 20 · Network 30 · Security 40 · ICE 42 ·
Trace 43 · repositories 48–49 · Message 50 · Notification 52 · Spam 54 · MessageTemplate 55 · DataShard 60 · Terminal 62
· TerminalScenePins 64 · reapers 66–68 · Scheduling 70 · MasterContact 80 · Portrait 82 · ContactBreach 83 ·
ContactShare 84 · MessageAccess 85 · Email 86 · NetworkAccessLog 90 · SocketManager.initialize 100 · UI/launchers
110–123 · Conversation 124 · Call (+ Emergency, Overheard, Payphone) 125 · launchers 126 · Watch 127. postReady: schema
migration 5, journal organisation 15, flushes/reapers 20–24, Phase verification 30–33, network hello 40,
IntegrationBridge 95.

Note that **MasterContactService (80) is constructed after MessageService (50), TerminalService (62) and
Scheduling (70)**, all of which use it. That works only because those services look it up lazily at call time, not in
their constructors. It is an ordering rule nobody wrote down.

### 2.3 Communication channels

| Channel | Scope | Count | Notes |
|---|---|---:|---|
| `game.nightcity.*` | same client, service lookup | 76 names, 1,364 accesses | The de facto dependency mechanism |
| `EventBus` (`EVENTS`) | same client, pub/sub | 81 events; 63 emitted, 51 subscribed directly | Owner-tagged cleanup via `BaseApplication.subscribe` |
| Foundry hooks | same client | 79 `Hooks.on`, 2 `Hooks.once`, 20 `Hooks.off` | Most are permanent module hooks (fine); app-scoped ones are removed in `close()` |
| `SocketManager` (`SOCKET_OPS`) | cross client | 56 ops, 54 registered, `SOCKET_TRUST` for each | 37 of the registrations live in `integrations/SocketHandlers.js` |
| Document sync | cross client | `DocumentSyncBridge` (9 hooks) | Journal/page/actor changes → EventBus |
| World settings | cross client, GM-written | 98 world settings, 49 of them Object/Array data stores | Every write ships the whole value to every client |

### 2.4 Persistence

- **Journals** identified by flags: inboxes (`type: inbox | contactInbox`), terminals (`type: terminal`), shards
  (linked journal), conversations, call logs / voicemail / payphone log, the recycle bin, hidden-access and node
  journals. One subfolder tree under "Night City Messenger". `MessageRepository.identifyInbox` /
  `identifyTerminal` are the identification points.
- **Document flags** under `flags.night-city-messenger` on actors (contacts, groups, email, send-as), items (shard and
  terminal config/state), users (conversation state), notes/regions (access points).
- **World settings**: 49 structured data stores (directory, groups, networks, nodes, phone lines, payphones, trace log,
  heat, countdowns, lockouts, scheduling, templates, preset libraries, encoder config, jack-in rules…).
- **Migrations**: `NamespaceMigration` (id rename, one-time), `MigrationRunner` (version-keyed, `dataSchemaVersion`,
  currently v6), plus two shape-detecting migrations (`migrateJournalOrganization`, `_migrateContacts`).
  `FactoryReset` covers all of it.

### 2.5 UI

- 24 windows extend `BaseApplication` (HandlebarsApplicationMixin(ApplicationV2)) and get managed subscriptions,
  debounced render, atmosphere, sounds, admin-theme stamping, GM-view toggle.
- Two windows extend AppV2 directly: `MessageComposerApp` (mirrors BaseApplication hooks by hand — documented) and
  `EmailSetupFlow`.
- ~10 framework-free promise modals (`SecurityConsole`, `BankHeist`, `OperatorSelect`, `UploadConsole`, `SystemSweep`,
  `ResidentConsole`, `JackInLock`, `RollReveal`, `NetAdjudicator`, `ShardIconBuilder`) share a shape (mount into a
  host, Esc/backdrop, reduced-motion veto, resolve a result) but no code.
- Admin panel: a shell with 11 composed tabs (`BaseTab`), `tabAct` op dispatch, `openTo`, pop-out windows. This is the
  cleanest extension point in the UI.

---

## 3. Internal systems dependency map

### 3.1 Layers

```
                        ┌─────────────────────────────────────────────────────┐
  Foundry ───hooks────▶ │ integrations/  DocumentSyncBridge · ShardSheetOverride │
                        │ TerminalScenePins · AccessPoints · ChatCards · Macro API │
                        │ SocketHandlers · IntegrationBridge (public api)          │
                        └──────────────┬──────────────────────────────────────┘
                                       │ game.nightcity.*
  ┌──────────────── ui/ (windows, admin tabs, modals, content renderers) ─────────┐
  │   imports utils directly; reaches services through game.nightcity / getters    │
  └──────────────────────────────────┬────────────────────────────────────────────┘
                                     │ game.nightcity.*  (+ 6 static ui→services imports)
  ┌──────────────── services/ (29) ──┴────────────────────────────────────────────┐
  │  11 static imports point back UP into ui/ (see §4.4)                           │
  └──────────────────────────────────┬────────────────────────────────────────────┘
                                     │
  ┌──── data/ repositories ──────────┴──┐   ┌──── core/ ───────────────────────────┐
  │ MessageRepository · ContactRepository│   │ ModuleInitializer · SettingsManager   │
  └──────────────────────────────────────┘   │ EventBus · SocketManager · Migrations │
                                             └───────────────────────────────────────┘
  ┌──── utils/ (pure rules + helpers; helpers.js fan-in 134, constants.js 133) ─────┐
  │  helpers.js imports two ui/content modules (EncoderModel, OperatorSelect)        │
  └────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Service-to-service runtime dependencies (via `game.nightcity.*`)

| Service | Uses |
|---|---|
| MessageService | contactGroup, contactRepo, eventBus, ice, masterContact, messageRepo, **network**, **notification**, skill, socket, sound, spam, **terminal**, time, trace |
| NetworkService | accessLog, eventBus, messageRepo, **message**, socket, sound, time |
| NotificationService | conversation, eventBus, masterContact, messageRepo, **message**, network, sound, terminal |
| TerminalService | dataShard, eventBus, ice, masterContact, messageRepo, network, security, skill, socket, sound, time, **trace** |
| TraceService | notification, socket, sound, **terminal**, time |
| CallService | accessLog, contactRepo, emergency(+Hud), eventBus, **masterContact**, messageRepo, network, payphone, skill, socket, sound, terminal, time, trace |
| MasterContactService | **call**, contactRepo, email, eventBus |
| DataShardService | eventBus, ice, messageRepo, network, security, skill, socket, sound, time, trace |
| ConversationService | eventBus, masterContact, messageRepo, network, notification, socket, sound, time |
| SchedulingService | contactGroup, eventBus, message, socket, terminal, time |
| PayphoneService | call, eventBus, payphoneBooth (UI), socket, sound, terminalScenePins |
| SecurityService | eventBus, notification, socket, sound, time |
| ICEService | eventBus, network, socket, sound |
| SkillService | eventBus, network, sound |
| Time / Theme / Sound | none |

Bold pairs are runtime cycles: **MessageService ↔ NetworkService** (taps), **MessageService ↔ NotificationService**,
**TerminalService ↔ TraceService** (residents fire from the trace funnel), **MasterContactService ↔ CallService**
(phone numbers on contacts). They work because every lookup is lazy. They become a problem when one side is switched
off or fails at startup (§9).

### 3.3 Hub services

The services nearly everything depends on: **NetworkService** (12 services), **TimeService** (12), **SoundService**
(15), **MasterContactService** (9 services + most of the UI; 127 accesses), **TraceService** (7 services + 31 call
sites), **MessageRepository** (9). These are the "Core" layer in the feature matrix (§F.3).

---

## 4. Code health findings

Each finding has an ID used by the recommendations in §11.

### 4.1 H1 — Eddies (money) are read-modify-written in seven places, with diverging rules

`system.wealth` is updated by `MessageComposerApp._deductEddies/_creditEddies` (3553–3620),
`TerminalViewerApp._creditActorWealth` (2983), `ShardEncoderApp._debitWealth/_refundWealth` (3129–3147), plus
`SiphonFlow`, `DataShardService`, `MessageService._refundHeld`, `SchedulingService._refund`. Compared:

- The composer clamps the balance at 0 (`Math.max(0, …)`); the Encoder lets it go negative.
- The composer pushes onto `wealth.transactions` without a guard (throws if the array is missing); the terminal and
  Encoder guard it.
- The composer refuses an unowned actor with a toast; the Encoder throws; the terminal swallows the error into a log.
- **None go through `serialize()`.** Two writes to the same actor in one client (a claim landing while a refund runs)
  each clone the old value and the later write erases the earlier.

### 4.2 H2 — The player → GM round trip is reimplemented, and two copies can lose a reply

The pattern "emit a request with an id, wait for a result op with that id, time out" exists in `NetResolve.js`,
`SchedulingService.js`, `ShardEncoderApp.awaitConvertResult`, `ShardMarket.requestShardPrice`,
`ShardSheetOverride._requestPlayerUnconvert`, and `MessageService._awaitDeliveryAck`, each with its own timeout,
"no GM online" check (19 copies of `!game.users.activeGM` across the tree) and cleanup.

`SocketManager.register` stores **one handler per op** in a `Map`. `ShardMarket.js:132` and
`ShardSheetOverride.js:882` call `register(…RESULT…)` **per request**, so a second request from the same client
replaces the first request's handler (the first then times out), and the handler from a finished request stays
installed until overwritten. The Encoder's copy was already fixed during the audit with a one-time handler and a
pending map — that is the shape all of them should share.

### 4.3 H3 — Hidden runtime coupling through `game.nightcity`

Covered in §3.2. Consequences in code: 1,364 lookups, most behind `?.`, so a missing service degrades silently
(e.g. `game.nightcity.terminalService?.mirrorDeliveryToAccounts?.(…)` in delivery). This silence is partly
deliberate and useful (it is what makes features *softly* optional, §F), but nothing records which dependency is
optional and which is required, and the startup report says "step failed" without naming what then stops working.

### 4.4 H4 — Lower layers import UI modules

Eleven static/dynamic imports go from `services/` or `utils/` into `ui/`:

| From | Imports |
|---|---|
| `utils/helpers.js` (fan-in 134) | `ui/content/EncoderModel.js`, `ui/content/OperatorSelect.js` |
| `services/TerminalService.js` | `ui/content/EncoderModel.js`, `ui/content/ContentRenderers.js`, `ui/content/ResidentConsole.js` |
| `services/DataShardService.js` | `ui/content/IntegrityModel.js`, `ui/content/SiphonFlow.js` |
| `services/SkillService.js` | `ui/content/RollReveal.js`, `ui/content/RollPanel.js` |
| `services/CallService.js` | `ui/Calls/dictation.js` |
| `services/ContactShareService.js` | `ui/DataDropOverlay/DataDropOverlay.js` |

Two different things are mixed here. `EncoderModel`, `IntegrityModel` and the `PROGRAM_EFFECTS` /
`CONTENT_TYPE_INFO` registries are **pure rules that happen to live under `ui/`**; they should simply live in `utils/`
or a `rules/` folder. `OperatorSelect`, `ResidentConsole`, `RollReveal`, `DataDropOverlay` are **real UI** called from
services. The second kind is what makes a service hard to run headless (sims must stub DOM) and ties gameplay logic to
presentation.

### 4.5 H5 — God methods in the two largest files

- `MessageViewerApp._onDelegatedClick` is **696 lines with 145 `case` branches** — the viewer routes clicks through
  one switch instead of the AppV2 `actions` map every other window uses. `_prepareContext` is 354 lines,
  `_decryptMessage` 282, `_reconstructSignal` 272.
- `DataShardComposer` has **271 methods**; `_collectEntryData` is 395 lines and branches over all 18 content types.
  Every content type adds code to this one file (13 `_schem*`, 13 `_cal*`, 10 `_doss*`, 10 `_doc*`…).

These files work and are covered by sims, so this is a maintainability cost, not a defect: every new content type or
viewer action lands in the same file, merge conflicts concentrate there, and a Claude session must read thousands of
lines to make a small change.

### 4.6 H6 — Duplicated small utilities with drifting behaviour

- Settings reads: three private `_get(key, fallback)` copies (CallService, EmergencyService, OverheardService) and 92
  try-wrapped `game.settings.get` sites. Fallbacks disagree: `anonSendEnabled` falls back to `false` in
  `MessagesTab.js:854` and `true` in `MessageComposerApp.js:3495`.
- Primary-GM checks: 27 `isPrimaryGM()` calls and 10 hand-written `game.users.activeGM?.id === game.user.id` in five
  files (`registerCallSystem`, `TerminalScenePins`, `CallService`, `ConversationService`, `OverheardService`). They are
  equivalent today; they will not stay equivalent if `isPrimaryGM` gains a rule.
- GM checks: 453 `isGM()` vs 165 raw `game.user.isGM` (equivalent; low priority).
- Framework-free modal plumbing (mount, Esc, backdrop, reduced motion, cleanup) is copied across ~10 files; reduced-
  motion is checked with `matchMedia` in 27 files and `getAnimationLevel` in 11, with slightly different veto rules.

### 4.7 H7 — Dead or unreachable code

| Item | Evidence |
|---|---|
| `scripts/integrations/EmailSettingsIntegration.js` (180 lines) | Imported by no module file |
| `scripts/ui/dialogs/PlayerEmailSetup.js` (257) | Imported by no module file; only a sim reads its text |
| `scripts/utils/validators.js` (41) | Imported by no module file |
| `SOCKET_OPS.SHARD_STATE_CHANGED`, `TERMINAL_STATE_CHANGED` | Emitted (`DataShardService.js:2310`, `TerminalService.js:2549`), no handler anywhere — every emit is broadcast to every client for nothing |
| 8 `EVENTS` keys | Never referenced: `CONTACT_SHARE_STARTED`, `CONTACT_VERIFIED`, `CONTACT_VERIFICATION_FAILED`, `SHARD_OPENED`, `SHARD_BOOT_STARTED`, `TERMINAL_STATE_CHANGED`, `UI_VIEWER_OPENED`, `UI_COMPOSER_OPENED` |
| Public hook mirrors `contacts:burned`, `contacts:verified` | In `IntegrationBridge.MIRRORED_EVENTS`; no emitter found. Integrators who listen get nothing |
| 4 events subscribed but never emitted | `CONTACT_BURNED`, `CONTACT_TAGS_UPDATED`, `SHARD_EXPIRED`, `COMPOSER_OPEN` (subscribers wait for nothing) |

The burned-contact feature is CSS-hidden by decision (CLAUDE.md), so its events may be intentionally parked; the
others look like leftovers. All should be verified before removal (a dynamic emit by variable would not show in a
static search).

### 4.8 H8 — Error handling

Generally good after the audit (socket handler rejections are caught, startup failures are reported, toasts escape).
Remaining patterns worth knowing:

- 20 `.catch(() => {})` sites (composer ×4, NetworkService ×2, NodeConsole ×2, …). Most are fire-and-forget sounds or
  cosmetic writes, but `NetworkService`'s are on node writes, where a swallowed error means a state change silently
  did not happen.
- Result shapes are inconsistent across the module and the public surface: `{success, error}`, `{ok, error}`,
  `{success:false, errorCode}`, `null`, a toast with no return (`MacroAPI.js:417`).

### 4.9 H9 — Event and listener hygiene

Good: app-scoped hooks are removed (`Hooks.off` ×20), `BaseApplication.subscribe` cleans up, the audit's D4 batch
stopped listener stacking. 77 `document.addEventListener` vs 62 removals: the gap is mostly module-lifetime listeners
(ContentRenderers' 12 delegated drivers, AccessPoints, TerminalScenePins), which is intended. No action beyond keeping
the existing `test-listener-stacking` sim.

### 4.10 H10 — World-setting data stores that grow

49 world settings hold structured data. Writing any of them sends the whole value to every client and fires
`updateSetting` everywhere. The growing, append-style ones are the concern: `traceLog` (cap 250, written on every
trace and success log), `networkAccessLog`, `deliveryFailures` (cap 100), `overheardCalls`, `phoneWrittenLogs`,
`npcMailAnswered`, `scheduledMessages`, `traceHeat`. The audit already moved the recycle bin to a GM-only journal
(D5) for exactly this reason; the trace log is the next obvious candidate.

### 4.11 H11 — Shipped test code

`scripts/tests/` (1,595 lines) is statically imported by `main.js` and five `register*` files, so every user downloads
and parses it, though it only runs under `debugMode`. Small cost; noted because a lazy `import()` would remove it
from the boot path with no behaviour change. (Low priority.)

---

## 5. Technical debt — what it costs today

| Debt | Cost to ongoing development |
|---|---|
| Hidden runtime graph (H3) | You cannot answer "what breaks if I change X" without grepping 76 names. Feature toggles have no map to work from |
| Money duplication (H1) | Every new money flow (marketplace, browser purchases, contracts) would add an eighth copy |
| Round-trip duplication (H2) | Every new player→GM action (a website form, an app install) re-implements timeout/no-GM/cleanup |
| God methods (H5) | New viewer actions and content types land in the same 6k-line files |
| Pure rules under `ui/` (H4) | Services import UI; sims stub DOM; it is unclear where a new rule belongs |
| No CI for sims (§6) | 146 sims protect the module only when someone remembers to run them |
| 660 KB CLAUDE.md (§6) | Each session pays ~160k tokens before reading code; rules are buried in history |
| Inconsistent result shapes (H8) | Callers branch on `ok` vs `success`; a public API cannot be stable on top of it |

---

## 6. Developer experience assessment

**Strengths.**
- Conventions are written down and mostly followed: BEM `ncm-` prefix, startup registration, `TEMPLATES` constants,
  one CSS entry, admin tab composition, the audit's rule table (AUDIT-POST §2).
- Sims are numerous, fast, and drive real code (`prototype.call` with mocked globals). `check-syntax.mjs` catches the
  module-context parse trap. Probes render real templates against the real cascade. In-Foundry PASS/FAIL macros exist
  for every audit batch.
- Pure-rule modules make most game logic testable without Foundry.

**Friction.**

1. **`CLAUDE.md` is 660,710 bytes.** It is the single most expensive thing in a session. Roughly three kinds of content
   are mixed: standing rules (which belong there), per-system as-built notes (which belong beside the system), and
   history ("tester round 2026-10-24", 50 "not live-tested" notes). A fresh session cannot tell which paragraph is a
   rule and which is a diary entry.
2. **No system map.** There is no one place that says "the calls system is these files, owns these settings,
   registers these sockets, depends on these services". §F.3 of this report is a first draft of that map.
3. **No CI checks.** `.github/workflows/release.yml` and `dev-build.yml` build and publish; neither runs
   `check-syntax.mjs` or the sims.
4. **Sim boilerplate.** 113 of 146 sims define their own `globalThis.game`; only 2 use the shared
   `sims/lib/socketHarness.mjs`. 28 sims assert on source text. A shared mock-world library would make new sims cheaper
   and make mocks consistent.
5. **Two test systems that don't know about each other.** Phase suites (in-Foundry, shipped) and sims (Node, dev-only)
   cover overlapping ground with no index of which feature each covers.
6. **Naming.** Mostly consistent. Two things trip people up: a context field named like a Handlebars helper (already
   guarded by a sim), and the `ncm-<prefix>` collision class (documented). "Phase 2…6" names in `scripts/tests/` refer
   to build history, not to features.

---

## 7. Maintainability and extensibility

### 7.1 Can a system be changed without touching unrelated ones?

| System | Isolation today |
|---|---|
| Conversations | Good. Own service, own journals, own socket ops, behind a reload toggle. The inbox merge is the one shared seam (`rowAsMessage`) |
| Calls / payphones / emergency / overheard | Good inside the call stack; payphones are a caller identity on CallService (clean layering). Shares MasterContactService both ways |
| Watch | Good. One service, one socket op, an opt-in class flag (`static WATCHABLE`) |
| Network nodes / jack-in | Good rules isolation (`networkNodes.js`, `jackIn.js`); enforcement sits in one place (`getAvailableNetworks`) |
| Terminals | Medium. TerminalService is called from MessageService (mirror), TraceService (residents), CallService (terminal numbers), Scheduling |
| Data shards | Medium. Shared with terminals (burn, exfil), messages (attachments), Encoder, Workshop |
| Messaging | Low by nature: it is the hub. Delivery calls spam, terminal mirror, taps, notifications, trace, groups |
| Security / trace | Low: 31 call sites, and residents trigger off the trace funnel |

### 7.2 Extension points that exist

- Admin tab: `BaseTab` + `tabAct` + `openTo` + pop-out. Adding a tab is three known steps.
- Window: `BaseApplication` with opt-in class flags (`ADMIN_THEMED`, `GM_VIEW_TOGGLE`, `WATCHABLE`).
- Content type: four documented touches (CONTENT_TYPES, CONTENT_TYPE_INFO, ENRICHERS, a `content-body.hbs` branch) plus a
  composer fieldset. Static, but proven 18 times.
- Program effects: `PROGRAM_EFFECTS` registry with modes and params; two appliers.
- Access points: refs `{kind, id}` with one door `openAccess` — but kinds are hard-coded switches in
  `AccessPoints.js` (describe/open), `TerminalScenePins` (activation), and the Access tab.
- Sounds, presets, templates, shard/terminal themes: data registries.

### 7.3 What is missing for future systems (browser, apps, braindance, evidence, world events)

Assessed against the ideas document only as context:

| Need | Exists? | Gap |
|---|---|---|
| A place for a new system's service + startup | Yes (`register*` + `game.nightcity`) | No declared dependencies or feature tag |
| UI shell for a new window | Yes (`BaseApplication`) | No shared framework-free modal base |
| Typed content rendering (articles, posts, listings) | Largely (content registry, `richText.js`, media resolver) | Content types are registered by editing core files, not by a `registerContentType` call |
| Auth/gates for restricted pages | Yes (SECURITY_BLOCK, `NetworkAuthDialog` adapters, `canOperate`, countermeasures) | Already source-agnostic via `SecurityAuthAdapters` — the best-prepared area |
| Player → GM writes | Yes (intents + socket trust) | No single request/response helper (H2) |
| Money | Partially | No single ledger (H1) |
| World-reactive events | EventBus + trace funnel + residents triggers | No catalogue of event payloads; events are not versioned |
| Persistence for a new system | Journals/flags/settings patterns | No guidance on which to use; settings are overused for growing data (H10) |
| Access-point kinds | Partly | Hard-coded kind switches |
| Feature enable/disable | Ad hoc | See §F |
| Testing | Sims + macros | No shared mock world, no CI |

**Conclusion:** the module can take new systems without rewrites. The missing pieces are small shared utilities
(ledger, round trip, feature registry, settings access, kind/content registration) rather than architecture.

---

## 8. Reusable infrastructure (keep and lean on)

| Infrastructure | Where | Use it for |
|---|---|---|
| Startup phases + failure report | `core/ModuleInitializer.js` | Any new service |
| Socket router + trust classes | `core/SocketManager.js`, `SOCKET_TRUST` | Any cross-client op |
| Intents | `utils/contentIntents.js` | Any player-caused state change |
| `serialize(key, fn)` | `utils/serialize.js` | Any read-modify-write |
| `ncmNotify`, `tipText`, `cssUrl`, `richText.cleanHtml` | utils | Any player-typed text |
| Time provider | `TimeService` (also on the public api) | Any timer or "ago" |
| Security block + auth adapters | `SecurityAuthAdapters.js`, `NetworkAuthDialog` | Any login/gate |
| `canOperate` / gate shape | `helpers.js` | Any "who may do this" rule |
| Countermeasure visibility | `utils/countermeasures.js` | Any hidden-defence UI |
| Content registry + `enrichContent` + partial | `ui/content/ContentRenderers.js` | Any typed document |
| Program effect registry | `PROGRAM_EFFECTS` | Any runnable software |
| Name picker / scope picker | `utils/namePicker.js`, `utils/scopePicker.js` | Any world-collection choice |
| Admin theme + dialog wrappers | `utils/adminTheme.js`, `dialogBody.js` | Any GM dialog |
| Legibility + CRT + theme | `utils/legibility.js`, `utils/crt.js`, `ThemeService` | Any immersive surface |
| Watch | `WatchService` | Spectating any window |
| Access points | `integrations/AccessPoints.js` | Ways into any thing |
| Mail revision cache | `utils/mailRevision.js` | Any cached world scan |
| Migrations | `core/MigrationRunner.js` | Any breaking data change |
| Factory reset / orphan audit | `core/FactoryReset.js`, `ToolsTab` | Cleanup coverage for new data |

---

## 9. Architectural bottlenecks

1. **MessageService delivery** (`_deliverMessage`, 143 lines; `_resolveRecipient` 147) is where spam, anonymous masking,
   terminal mirror, taps, NPC GM toast, notifications, fan-out and trace meet. Every messaging-adjacent feature adds a
   line here. Not broken; it is the place to add a small "after delivery" listener list rather than more direct calls
   if growth continues.
2. **The trace funnel** (`TraceService.recordTrace`) is both a log and a trigger bus: `_fireResidentTriggers` runs
   inside it. Anything that wants "react when X happens" is tempted to hang off it. This is the closest thing NCM has to
   a world-event system, and it is in a security service.
3. **MasterContactService** is consumed by most UI and 9 services and depends on CallService. Changes to the directory
   shape ripple widely.
4. **NetworkService** decides signal/dead zone for messages, calls, conversations, terminals, shards and nodes. It
   cannot be "turned off" — only simplified (§F).
5. **The two god methods** (H5) are throughput bottlenecks for development rather than runtime.
6. **World-setting blobs** (H10) are a scaling bottleneck in long campaigns and busy sessions.

---

## 10. Foundry compatibility considerations

The module declares v12 only (`minimum` and `verified` 12), so nothing below is a current defect.

- **Good practice already in place:** standard module socket, `game.modules.get(id).api`, AppV2 for windows, flags
  namespaced, the custom `ncmControls` canvas layer (avoids sharing a layer with core), helpers made answer-compatible
  with Foundry's (`_isOptions`), no libWrapper, no core prototype patches. (The one prototype rewrite,
  `NetworkService.js:1582`, wraps NCM's own class.)
- **Known DOM-level integration:** the Items directory context menu is extended through the page, not the menu hook
  (COMPAT-06, deliberately deferred). The pin right-click reads the board's DOM `contextmenu` event (documented as the
  safe pattern).
- **v13 hotspots, for whenever the compatibility range is widened** (verify against the v13 release notes before
  acting): `getSceneControlButtons` (control/tool shape changed), `renderChatMessage` (an HTML-element successor
  exists), v1 `Dialog` (18 call sites through wrappers, deprecated), jQuery-style access in dialog callbacks (~150
  `html.find` / `$(`), `FilePicker` (35 constructions), and the `ImagePopout` lexical-global lookup. Because most v1
  Dialog use already funnels through `adminTheme.js` wrappers, that part of a migration is concentrated. **The full
  plan — including the Cyberpunk RED system's data, and why the v12-shaped sims would not notice a break — is R20,
  step 10 of §13.** (Batch 2 since added a CI check, `check-paths.mjs`, for the case-sensitive Linux hosts The Forge
  runs on.)
- **Multiplayer:** the audit made one-GM handling (`isPrimaryGM`), sender identity and relays solid. The remaining
  multiplayer risk is H2 (lost replies) and H10 (blob writes).
- **Large worlds:** journal scans are cached on `mailRevision`; admin re-renders are debounced and throttled by game
  clock. The growing settings (H10) and the inbox scan on worlds with thousands of pages are the things to measure.
- **Module isolation:** the stylesheet was scoped during the audit; templates no longer depend on replaceable block
  helpers; global helpers match Foundry's semantics. Keep `test-core-helpers` and `test-init-order`.

---

## F. Feature Modularity and Configurable Systems

### F.1 Inventory of implemented features

User-facing features: Messaging & inboxes · Composer (drafts, templates, preview, send-via, backdate) · Threading ·
Self-destruct · Eddies attachments · Anonymous send + trace-to-unmask · Unknown-sender spam filter · Spam generator &
auto-spam · Contact groups · Contacts & identities (aliases) · Contact breach (encrypted contacts) · Contact sharing
(Data Drop) · Email setup / domains / directory import · Conversations · Calls & voicemail · Payphones · Emergency
(Trauma Team / backup) · Overheard calls · Phone numbering · Networks (signal, dead zones, auth) · Network nodes &
jacking in · Infections (worms, taps, sniffers) · Terminals (accounts, files, mailbox layouts, admin access, send-as) ·
Terminal scene pins & access points · Data shards (integrity, typed content, exfil) · Shard Encoder (player authoring) ·
Malware Workshop & program library · Upload / forge / residents · Security: trace, heat, lockouts, escalation,
countermeasure visibility · Scheduling · Watch · Roll reveal / roll panel · Chat cards · Theme customizer / CRT /
legibility · Sound board · Admin panel (all tabs) · Factory reset / orphan audit · Macro packs.

Foundational services: ModuleInitializer, SettingsManager, EventBus, SocketManager, Migrations, TimeService,
SoundService, ThemeService, MessageRepository, ContactRepository, MasterContactService, NotificationService,
NetworkService, SkillService, SecurityService, TraceService, DocumentSyncBridge, BaseApplication, AdminPanel shell.

### F.2 Current enable/disable capabilities

| Feature | Setting | Kind of gate | What it actually does |
|---|---|---|---|
| Conversations | `conversationsEnabled` (default off, reload) | **Startup gate** | Service is built but `wire()` and both socket handlers are skipped when off (`registerCallSystem.js:42`); the service refuses calls; UI checks `enabled`. The reference pattern |
| Calls | `callsEnabled` (default on, live) | UI + action gate | Hides the scene-control button and the Calls tab; `canCall` refuses new calls. All 10 call socket handlers, the hooks, emergency, overheard and payphones are still built and registered |
| Watch | `watchMode` (`player`/`always`/`off`) | Behaviour gate | Off = no eye button, no sharing. Service and socket still present |
| Anonymous send | `anonSendEnabled` | UI gate (GM composer) | Fallback values disagree between two readers (H6) |
| Unknown-sender spam | `spamUnknownSenderEnabled` | Rule gate | Delivery-time only |
| Player shard authoring | `encoderConfig` master switch + `canEncode` | Rule gate with one door | Well-built: every door asks `canEncode` |
| Email setup | `emailSetupRequired` | Flow gate | |
| Resident firing | `residentFireMode` | Behaviour mode | |
| Netrunning resolution | `hackResolution` | Behaviour mode | |
| Network nodes | none | Data-optional | No nodes = no effect, but UI is always present |
| Everything else | none | Always on | |

### F.3 Feature dependency matrix

"Registers" counts what the feature installs at startup regardless of use. Readiness per the requested scale.

| Feature | Depends on | Depended on by | Registers (sockets / hooks / timers) | Owns (settings / data) | Readiness |
|---|---|---|---|---|---|
| **Messaging & inboxes** | repos, directory, network, notification, time, sound | almost everything | ~15 sockets in SocketHandlers; DocumentSyncBridge hooks; self-destruct reaper 60s; queue flush | inbox journals, `messageTemplates`, `deliveryFailures`, `npcMailAnswered` | **Core** |
| **Contacts / directory / identities** | ContactRepository, Call (numbers), Email | messaging, calls, conversations, terminals, groups, admin | directory sync | `masterContacts`, `customRoles`, actor `contacts` flags | **Core** |
| **Networks (signal, auth, dead zones)** | Time, Message (taps), AccessLog | messaging, calls, conversations, terminals, shards, nodes, skill | 2 sockets + 3 hooks; access-log writes | `customNetworks`, `coreNetworkOverrides`, `networkAccessLog`, scene flags | **Core** (can be simplified, not removed — see F.5) |
| **Security / trace / heat** | Notification, Terminal (residents), Time | shards, terminals, nodes, messages, calls, contact breach, upload | countdown reaper; `updateSetting` hooks in admin | `traceLog`, `traceHeat`, `traceCountdowns`, `securityLockouts`, `operatorGate` | **Coupled** |
| **Notifications / sound / time / theme** | — | everything | — | client prefs, `soundOverrides`, time settings | **Core** |
| Composer extras (drafts, templates, preview) | Messaging | — | — | actor `composerDrafts`, `messageTemplates` | Ready (UI only) |
| Anonymous send | Messaging, Skill (trace) | — | 1 socket (trace request) | anon settings | **Ready** (fix the fallback mismatch) |
| Spam filter + generator | Messaging, Network (auto-spam) | — | NETWORK_CHANGED listener | spam settings, `spamAutoConfig`, `spamJunkSenders` | Partial |
| Contact groups | Directory, Messaging | composer, scheduling, broadcast | — | `masterContactGroups`, actor `contactGroups` | Partial |
| Contact breach | Skill, Trace, Contacts | — | — | contact fields | Partial |
| Scheduling | Messaging, Groups, Terminal (send-as) | admin Outbox | 1 socket; 10 s delivery tick; setting hook | `scheduledMessages` | Partial |
| **Conversations** | Messaging (inbox merge), Directory, Network, Notification | Taps (log pages) | 2 sockets + 9 hooks **only when on** | conversation journals, user flags | **Ready** |
| **Calls & voicemail** | Directory, Network, Skill, Terminal (numbers), Trace | payphones, emergency, overheard, directory (numbers) | 10 sockets, 4 hooks, recording purge — always | phone settings (~14 keys), call-log journals | Partial |
| Payphones | Calls, Access points, Scene pins | — | 1 socket, ring timer | `payphones`, `payphoneStyles`, payphone log journal | Partial (clean layer on Calls; needs its own gate) |
| Emergency | Calls, Skill | — | 1 socket, round ticker | `phoneEmergency`, `phoneEmergencyActive` | Partial |
| Overheard calls | Calls, Network, Trace | — | 1 socket | `overheardCalls`, `phoneEavesdrop` | Partial |
| Network nodes / jack-in / infections | Network, Security, Trace, Message (taps), Skill | Access points, Admin | node reaper 30s; `networkNodes` hook | `networkNodes`, `jackInRules`, pins | Partial (data-optional) |
| **Terminals** | DataShard, Security, Trace, Network, Directory | Messaging (mirror), Trace (residents), Calls (numbers), Scheduling (send-as), Access points | resident reapers, payload reaper, page hooks per open viewer | item flags, terminal journals, preset libraries | **Coupled** (soft: callers use `?.`) |
| Data shards | Security, ICE, Trace, Network, Skill | messages (attachments), terminals (burn/exfil), Encoder, Workshop | shard sockets in SocketHandlers | item flags, shard journals, preset libraries | **Coupled** |
| Shard Encoder | Shards, Skill | — | convert/price sockets | `encoderConfig` | **Ready** (has a master switch + one gate) |
| Malware Workshop / programs | Shards, Terminal, Network | upload, residents, nodes | — | `programLibrary` | Partial |
| Upload / residents | Terminal, Trace, Shards | — | resident reapers | terminal state | Coupled (lives in terminal state) |
| Access points | Terminal, Shard, Node, Payphone, Message | — | init enricher, drop/click listeners, hotbar hook | pins, regions, macros, `accessHandoutStyle` | Partial |
| Watch | Socket | — | 1 socket, 3 hooks | `watchMode` | **Ready** |
| Roll reveal / panel | Skill | everything that rolls | — | `askBeforeRoll` (client) | Core (presentation of Skill) |
| Admin panel | all | — | setting/world-time hooks while open | admin theme (client) | **Core** |

### F.4 Features that can be disabled safely today

- **Conversations** — already. Off means no hooks, no sockets, no UI; data is untouched; switching reloads the world.
- **Watch** — `watchMode: off`. The socket handler remains, but nothing sends.
- **Shard Encoder** — the master switch; `canEncode` is the one door.
- **Anonymous send** — UI gate; fix the fallback mismatch first.
- **Calls** for the casual case — the UI hides and new calls are refused. It is "safe" in that nothing breaks; it is not
  isolation (handlers, hooks, payphone bell logic and emergency all stay live).

### F.5 Features that need architectural changes to disable

- **Networks.** Cannot be removed: 12 services ask NetworkService for the current network, signal or dead zone. The
  viable form is a **"simple network" mode**: one always-connected network, no dead zones, no signal garble, no auth.
  That requires `getAvailableNetworks`, `isDeadZone`, signal reads and the selector to honour the mode — all
  centralised in NetworkService, so the change is contained. Terminals and shards keep working because their gates
  would always pass.
- **Tracing.** Cannot be removed: 31 call sites, and residents' `onAction`/`onHeat` triggers fire inside
  `recordTrace`. The viable form is a **consequence switch**: the funnel always records and always runs triggers, but
  heat, GM alerts, countdowns and escalation can be off. Moving `_fireResidentTriggers` out of the trace funnel onto
  the EventBus would decouple the two cleanly (small change, regression-sensitive).
- **Payphones without disabling calls.** Viable with modest work: skip PayphoneService/Booth construction and its socket
  op, hide Admin → Phone → Payphones, make the `payphone` access kind refuse, and have CallService treat a booth line
  as "not in service". Booth records stay in settings.
- **Emergency / overheard** separately from calls: the same shape as payphones (each is a service built inside the
  CallService task).
- **Terminals or shards.** Coupled. Many systems call them with `?.`, so a skipped service mostly no-ops, but item
  sheets, directory badges, access points, exfil, messages with shard attachments and the admin tabs all assume they
  exist. Disabling means "hide the doors and refuse new conversions", not "remove the service". Existing items must
  still open read-only or show a clear "disabled by the GM" panel.
- **Network nodes / infections.** Data-optional already. A toggle would only hide the UI (node rows, jack-in rules
  card, access kind) and skip the node reaper.

### F.6 Shared infrastructure that must stay active

Initializer, settings, EventBus, SocketManager, migrations (must run even for disabled features — their data still
needs upgrading), Time, Sound, Theme, MessageRepository, ContactRepository, MasterContactService, NotificationService,
NetworkService (possibly in simple mode), SkillService, SecurityService (lockouts are used by logins everywhere),
TraceService (recording), DocumentSyncBridge, BaseApplication, admin panel shell, factory reset and orphan audit
(they must clean data of disabled features too).

### F.7 Recommended toggle behaviour

1. **Reload-required by default.** Follow Conversations: a world setting with `requiresReload: true`; at startup the
   feature's services, hooks, sockets and timers are not installed. This avoids every partial-state problem (in-flight
   calls, open windows, half-registered handlers) and keeps every client in agreement because the setting is world
   scope.
2. **Live toggles only for pure presentation or pure rule gates** (anonymous send, spam chance, watch mode, the Encoder
   switch). These never own sockets or timers.
3. **Requests for an off feature are answered, not ignored.** With the reload model, an off feature's request handler
   is not registered, so a stale or hostile player request would just time out on the player side. Register one small
   stub per off feature's request ops that replies "this feature is switched off" (or drops `result`/`peer` class ops).
   The GM's world setting is the authority; the player's client is only a UI.
4. **Data is never touched by a toggle.** Re-enabling must restore everything. Migrations and Factory Reset still cover
   the data of disabled features.
5. **Dependencies are declared, and enforced at one place.** Turning off Calls implies Payphones, Emergency and
   Overheard are off; the settings UI says so and the registry computes it (`isOn('payphones')` is false whenever
   `isOn('calls')` is false).
6. **Documents referencing a disabled feature open safely.** A terminal item opens to a "disabled" panel; a shard
   attachment link says so; a payphone pin says "out of order"; an `@NCM[…]` link renders as a dimmed chip.

### F.8 Recommended architecture: a feature registry, not a framework

One pure file, e.g. `scripts/utils/features.js`:

```js
export const FEATURES = {
  conversations: { setting: 'conversationsEnabled', reload: true, requires: [] },
  calls:         { setting: 'callsEnabled',         reload: true, requires: [] },
  payphones:     { setting: 'payphonesEnabled',     reload: true, requires: ['calls'] },
  // …
};
export function isFeatureOn(name) { /* setting && every requires is on; cached per load */ }
```

and three small hooks into existing infrastructure:

- `initializer.register(phase, priority, name, fn, { feature })` — `ModuleInitializer` skips a task whose feature is
  off and records it as "skipped (off)", not "failed".
- `socketManager.register(op, handler, { feature })` — when off, installs the reply-stub instead.
- UI entry points (scene controls, Agent tabs, admin tabs/sub-tabs, access kinds, context-menu entries) ask
  `isFeatureOn`.

This reuses Foundry settings and NCM's initializer/socket router; it adds no new runtime concepts.

### F.9 Regression and compatibility risks

- A feature whose startup is skipped leaves `game.nightcity.<x>` undefined. Every `?.` caller already tolerates that,
  but **non-optional callers** (e.g. a launcher that does `game.nightcity.callService.x`) would throw. A sweep of
  non-optional accesses per feature is part of each toggle's work.
- Migrations must not be feature-gated.
- Macro packs call features directly; with a feature off they must return `{ ok:false, error:'… is switched off' }`
  rather than throw.
- Third-party integrators need `api.features` to know what is on (§D).
- Changing Calls from a live toggle to reload-required is a behaviour change GMs will notice; keep it live until the
  registry exists, then decide.

### F.10 Tests required for feature isolation

- **Isolation sim (new):** boot every `register*` against a mocked world once per feature with that feature off;
  assert no task of that feature ran, no socket op of that feature has a real handler, no hook of that feature is
  registered, no error is thrown, and dependent features report off.
- **Request-stub sim:** a player request for an off feature gets the refusal, and no data changes.
- **Round trip sim:** toggle off → data unchanged → toggle on → data and config identical.
- **Per-feature in-Foundry macro:** open a document referencing the disabled feature (terminal item, shard
  attachment, payphone pin, `@NCM` link) and check for a clean refusal.
- Existing sims and Phase suites must pass with every feature on (the default).

---

## D. Developer API and Third-Party Extensibility

### D.1 Existing integration capabilities

| Surface | Where | Status |
|---|---|---|
| `game.modules.get('night-city-messenger').api` (`apiVersion: '1.0.0'`) | `IntegrationBridge.js`, postReady/95 | Exposes `messenger` (macro helpers), `contacts` (ContactRepository instance), `masterContacts` (MasterContactService instance), `groups` (ContactGroupService instance), `portraits`, `eventBus` (raw), `time` (a 3-method facade), vocab |
| Hook mirrors `night-city-messenger.<event>` | `MIRRORED_EVENTS` (16 + `apiReady`) | Two have no emitter (`contacts:burned`, `contacts:verified`); `message:received` double-fires by design (consumer dedupes) |
| `game.nightcity.*` | everywhere | 76 names, undocumented, the macro packs use it |
| `game.nightcity.messenger.*` (MacroAPI) | `MacroAPI.js` (499 lines) | The de facto public scripting surface; unversioned |
| `game.nightcity.openX` launchers | various register files | Undocumented but stable in practice |
| Access links `@NCM[kind:id]`, access macros | `AccessPoints.js` | A data-level contract (world content depends on it) |
| INTEGRATION.md | repo root | Documents the bridge and the relationships-module plan |

### D.2 Potential public API boundaries

Reasonable to offer (they already exist behind UI paths with authorization):

- **Messages:** send (to people or a group, as an identity for a GM), read summaries of an actor's mail the caller can
  already see, mark read. Delivery goes through `MessageService.sendMessage`, which relays and is re-checked by the GM.
- **Contacts & identities:** read the caller's own contacts; GM-only directory reads/writes; resolve a display name or
  portrait.
- **Groups:** read, resolve members (`recipientsFor`), GM push.
- **Calls:** place a call as the operator (or GM identity); read call log summaries the caller can see.
- **Networks:** current network, signal, dead zone (read-only for players), GM set.
- **Terminals / shards:** open; GM convert/configure; read public metadata. Not internal state.
- **Security / trace:** subscribe to trace events; GM-only log/heat reads.
- **Time:** already a good facade.
- **Features:** `has(name)`, `list()`.

Defer: browser/app/braindance registration until those systems have requirements.

### D.3 Security and permission concerns

- A module's JavaScript runs in the same client, so the API is **not a sandbox**. The real boundary is the same as the
  UI's: Foundry document permissions on direct writes, and the GM-side socket checks (sender id, ownership, intents)
  on relays. **An API method is safe if and only if it uses the same service path the UI uses.** The current bridge
  satisfies that by accident (it hands out the services the UI uses) — but it also hands out every *other* method of
  those classes, including internal helpers that skip checks the UI performs before calling them.
- GM-only methods must check on the client for good errors (`MacroAPI` does this with `isGM()`), and must not rely on
  that check for safety: any write a player could reach must still be a relay the GM validates.
- Exposing the raw `eventBus` lets any module **emit** internal events (e.g. `NETWORK_CHANGED`), making NCM windows
  re-render or act on forged local events. Not a cross-client security hole, but a stability one. A public `events.on`
  without `emit` avoids it.
- Inputs from other modules are untrusted in the same way player input is: the existing escaping rules (`ncmNotify`,
  `cleanHtml`, `tipText`) apply.
- Disabled features must refuse through the API with a structured error (§F.7).

### D.4 Suggested API structure

Keep `game.modules.get(id).api` as the discovery point, keep `apiVersion`, and add a v2 surface **beside** v1 rather
than replacing it:

```
api.version          '2.0.0'            semver of this object
api.features         { has(name), list() }
api.messages         { send(opts), listFor(actorId, opts), markRead(id) }
api.contacts         { listFor(actorId), find(query), resolveName(ref), resolvePortrait(ref) }
api.directory        { list(), get(id), add(data)*, update(id, data)*, pushToPlayer(id, actorId)* }   * GM
api.groups           { list(scope), recipientsFor(group), push(groupId, actorId)* }
api.calls            { place(number, as?), logFor(actorId) }
api.networks         { current(), signal(), isDeadZone(sceneId?), set(id)* }
api.time             (unchanged)
api.events           { on(name, cb) → off, names }      documented names only, no emit
api.open             { inbox(actor), composer(opts), terminal(item), shard(item), node(id) }
```

Rules for every method:

- Thin facade over a service method; no logic in the facade.
- Async, and always resolves `{ ok: true, data }` or `{ ok: false, error, code }` (codes like `NOT_GM`, `NO_GM_ONLINE`,
  `FEATURE_OFF`, `NOT_FOUND`, `REFUSED`). Never throws for expected failures; never toasts.
- Plain-object inputs and outputs; no Foundry documents returned by default (ids instead), so internal shapes can
  change.
- Each method documented with JSDoc (params, result, who may call it).

Keep v1 working for at least one minor version after v2 ships, with a console deprecation note naming the v2
equivalent.

### D.5 Hooks and events suitable for exposure

From the existing EventBus, already emitted and stable in meaning: `message:sent`, `message:received`,
`contacts:masterUpdated`, `contact:updated`, `contacts:trustChanged`, `contacts:shared`, `contacts:decrypted`,
`contacts:breachFailed`, `shard:decrypted`, `groups:*`, network connected/changed, trace recorded (needs a public
payload), terminal login success/failure (emitted today with no subscriber — a natural public event), call
started/ended (CallService emits 53 times; needs a curated subset).

Needed changes:

- **A public event table in `constants.js`** — name, payload fields, which client fires it (delivering client vs
  owning clients), whether it can fire twice, since which version — and the bridge mirrors from that table instead of
  string literals.
- **Remove or implement** the two dead mirrors.
- **One firing rule per public event.** `message:received` firing from two sources is documented, but a public event
  should fire once per client per occurrence; the bridge can dedupe by `messageId` before mirroring.
- **A feature event** (`feature:changed` is unnecessary with reload-required toggles; `apiReady` carrying
  `features.list()` is enough).
- `apiReady` fires at postReady/95; document that integrators should listen for it rather than read `api` in `ready`.

### D.6 Compatibility and versioning

- Semver on `api.version`; additive changes are minor; removals only with a major and one deprecation cycle.
- The api object exists only when NCM is active. Integrators check `game.modules.get(id)?.active && …api`.
  Document that `api` is `undefined` until `apiReady`.
- Never expose service instances in v2; v1's instance exposure is the reason INTEGRATION.md's "internals may change"
  promise cannot hold today.
- Feature detection through `api.features.has`, not version sniffing.
- Keep the macro API (`game.nightcity.messenger`) as a separate, documented-but-unversioned convenience layer for GMs,
  implemented on top of the v2 facade over time, so there is one code path.

### D.7 Developer documentation requirements

- `docs/API.md`: discovery, versioning, every method with params/result/permissions, every public event with payload,
  error codes, a "safe when NCM is absent" snippet.
- JSDoc on the facade (enough for editor completion); a hand-written `.d.ts` only if an integrator asks.
- Two worked examples: listen for `message:sent`; send a message as an NPC from another module's button.
- A small sim harness (`dev/tools/sims/test-public-api.mjs`) that calls every facade method as GM and as player
  against the mocked world and asserts the result shape — this doubles as the regression test.

### D.8 Architectural changes that would be necessary

- The result-shape normalisation (H8) at the facade layer (services can keep theirs).
- A public event table (D.5).
- Feature registry (§F.8) for `api.features`.
- H2's round-trip helper, so API calls that need the GM share one timeout/no-GM behaviour.

### D.9 Changes to defer

- Registration APIs for websites, apps, braindance, content types or access kinds (until those systems are designed).
- TypeScript declarations.
- Any "extension framework" or plugin loader.
- Exposing terminals'/shards' internal state.

### D.10 Recommended implementation priorities

1. Fix the two dead mirrors and document payloads of the existing ones (small, P2).
2. Public event table + bridge reads it (P2).
3. `api.features` once the feature registry exists (P3).
4. v2 facade for messages, contacts/directory, time, events, open (P3).
5. Calls, networks, groups facades (P3).
6. Docs + test-public-api sim alongside each step.

---

## 11. Recommended improvements

Format for each: **Problem · Evidence · Why it matters · Smallest fix · Larger change justified? · Affects · Regression
risk · Testing · When.**

### Priority 1 — Necessary

**R1. Run the existing checks in CI.**
- Problem: 146 sims and the module-context syntax check run only by hand.
- Evidence: `.github/workflows/release.yml`, `dev-build.yml` contain no `check-syntax` or sim step.
- Why: the sims are the module's regression net; a release can ship with a red sim.
- Smallest fix: a job on push to `dev` and on `v*` tags that runs `node dev/tools/check-syntax.mjs` and every
  `dev/tools/sims/test-*.mjs` (skip `cdp-*`, which need Chrome), and blocks the release job on failure.
- Larger change: no.
- Affects: CI only. Risk: a sim that depends on the Windows checkout or local Foundry files would fail on Linux CI
  (one already needed CRLF normalisation; `gen-macros` needs `classic-level`) — fix or mark those.
- Testing: run the job on a branch first. When: now.

**R2. One eddies ledger.**
- Problem / Evidence: H1 — seven writers, three rules, no serialization.
- Why: money bugs are the ones players notice and the ones that corrupt saved characters; future features (markets,
  contracts) multiply it.
- Smallest fix: `scripts/utils/wealth.js` with `creditWealth(actor, amount, reason)` / `debitWealth(actor, amount,
  reason, { allowNegative, checkBalance })`, wrapping `serialize('wealth:' + actor.id, …)`, guarding `transactions`,
  returning `{ ok, error, balance }`. Migrate callers **one at a time, keeping each caller's current clamp/negative
  behaviour via options** so no rule changes without your decision.
- Larger change: no.
- Affects: composer, Encoder, terminal viewer, siphon, shard claim, message refunds, scheduling refunds.
- Risk: medium (money). Behaviour must be byte-identical per caller.
- Testing: a `test-wealth` sim (concurrent credit + debit on one actor, missing transactions array, negative/clamp per
  option), plus re-running `test-money-guards`, `test-schedule-requests`, eddies sims, and a PASS/FAIL macro that sends
  eddies, claims, refunds, siphons and encodes a cred drop. When: now (before any new money feature).

**R3. One player→GM round-trip helper; fix the two overwriting handlers.**
- Problem / Evidence: H2 — six implementations; `ShardMarket.js:132` and `ShardSheetOverride.js:882` register a
  result handler per request into a single-handler map.
- Why: lost replies look like "the GM never answered"; every new GM-mediated action re-implements it.
- Smallest fix: `requestGM(op, resultOp, payload, { timeoutMs, noGmResult })` in `scripts/utils/` with one handler per
  result op registered once and a pending map keyed by `requestId` (the `awaitConvertResult` shape). Move ShardMarket
  and unconvert first. Also: `SocketManager.register` logs a warning when an op already has a handler (would have
  caught this).
- Larger change: migrating the other four is P2, as they are touched.
- Affects: shard pricing, unconvert; later net adjudication, scheduling, delivery ack.
- Risk: low for the two; the trust class of the result ops must stay `result` and keep checking the target user id.
- Testing: socketHarness sim with two concurrent requests from one client, a timeout, no GM online; existing
  `test-shard-relays`. When: now.

**R4. Split `CLAUDE.md` into rules and per-system notes.**
- Problem: 660 KB loaded into every session; rules buried among history.
- Evidence: `wc -c CLAUDE.md` = 660,710; 84 `##` sections; 50 "not live-tested" notes.
- Why: the cost of every future change, and the risk that a rule is missed because it sits in paragraph 9 of a tester
  round.
- Smallest fix: keep in `CLAUDE.md` only (a) what NCM is, workflow, verification commands; (b) the standing rules
  (AUDIT-POST §2 table, CSS/Foundry gotchas, conventions); (c) a system index — one line per system pointing at
  `dev/design/systems/<system>.md`. Move each "Architecture: …" section, unchanged, into its system file. Move
  tester-round history to `CHANGELOG.md` or the memory notes. Nothing is deleted.
- Larger change: no.
- Affects: documentation only. Risk: a session misses a moved rule — mitigated by keeping every *rule* in CLAUDE.md and
  moving only descriptions.
- Testing: grep that every `dev/tools/sims/*` and file path cited before is still cited somewhere. When: now (it is
  the cheapest high-value change in this report).

### Priority 2 — Valuable

**R5. Remove verified dead code.**
- Evidence: H7 (3 unimported files, 2 receiver-less socket ops broadcast on every shard/terminal change, 8 unused events,
  2 dead hook mirrors, 4 events with subscribers and no emitter).
- Smallest fix: verify each with a runtime search and git history; delete the files and unused keys; stop emitting the
  two socket ops (or add the intended receiver); remove or implement the two mirrors (and say so in INTEGRATION.md).
- Risk: low; `PlayerEmailSetup.js` is read by `test-window-minimize` — update that sim. Testing: full sim run,
  `check-syntax`. When: next cleanup batch.

**R6. Declare service dependencies and report what a failure takes down.**
- Problem / Evidence: H3; MasterContactService constructed after three of its consumers; silent `?.` degradation.
- Smallest fix: an optional `requires: ['networkService', …]` on `initializer.register` used only for reporting: when a
  task fails, `reportFailures` names the features that depend on it; a debug-mode startup check logs any service
  looked up before its task ran.
- Larger change: dependency injection — not justified (§12).
- Risk: none (reporting only). Testing: extend `test-startup-report`. When: P2, and it is the base for R13.

**R7. One settings accessor.**
- Evidence: H6 — three private `_get` copies, 92 try-wrapped reads, disagreeing fallbacks (`anonSendEnabled`).
- Smallest fix: `getSetting(key, fallback)` in helpers (or on SettingsManager) where the fallback defaults to the
  registered default; replace the three copies and the two anon readers. Sweep the rest only when touching files.
- Risk: low; a changed fallback could flip behaviour during early startup — use the registered default, which is what
  most call sites mean. Testing: a sim asserting each fallback equals the registered default. When: P2.

**R8. Finish the `isPrimaryGM()` sweep.**
- Evidence: 10 hand-written comparisons in 5 files. Smallest fix: replace them. Risk: very low. Testing: `test-one-gm`.
  When: P2 (with R7).

**R9. Move pure rules out of `ui/`; inject UI into services.**
- Evidence: H4.
- Smallest fix: (a) move `EncoderModel.js`, `IntegrityModel.js` and the pure registries inside `ContentRenderers.js`
  (`PROGRAM_EFFECTS`, `CONTENT_TYPE_INFO`, `RECORD_FIELD_KINDS`…) to `scripts/rules/` (or `utils/`), re-exporting from
  the old path so nothing else changes; (b) for real UI called from services (`ResidentConsole`, `RollReveal`,
  `OperatorSelect`, `DataDropOverlay`), have the service accept or look up a presenter (`game.nightcity.ui.x` or a
  callback) instead of importing it. Start with `helpers.js`, whose two UI imports pull UI into nearly every module.
- Larger change: no.
- Affects: imports only for (a); call sites for (b). Risk: low for (a) with re-exports; medium for (b) (rolls,
  residents). Testing: full sims; the roll-reveal and resident sims. When: (a) P2; (b) when those services are next
  changed.

**R10. Shared mock-world library for sims.**
- Evidence: 113 sims build their own `globalThis.game`; 2 use `socketHarness`.
- Smallest fix: `dev/tools/sims/lib/world.mjs` (actors, items, journals with pages and flags, users, settings with
  registered defaults, hooks) used by **new** sims; migrate old ones only when edited.
- Risk: none to the module. When: P2 (makes R2/R3/R13 tests cheaper).

**R11. Move the trace log (and other append logs) out of world settings.**
- Evidence: H10; precedent D5 (recycle bin).
- Smallest fix: measure first — log the byte size of `traceLog`, `networkAccessLog`, `deliveryFailures`,
  `phoneWrittenLogs`, `overheardCalls` in a busy test world. If any exceeds a few tens of KB, move it to a GM-only
  journal with a migration, following D5's code.
- Risk: medium (migration). Testing: migration sim + the security-tab sims. When: P2 if measured large, else P4.

**R12. A public event table.**
- See D.5. Smallest fix: a frozen `PUBLIC_EVENTS` list in `constants.js` with payload fields; `IntegrationBridge`
  mirrors from it; a sim asserts every public event has an emitter. When: P2 (cheap, protects integrators today).

**R13. Turn the viewer's click switch into an action table.**
- Evidence: H5, `_onDelegatedClick` 696 lines / 145 cases.
- Smallest fix: keep the delegated listener but dispatch through `const VIEWER_ACTIONS = { 'reply-message': (app, el,
  ev) => app._reply(…), … }`, moving each `case` body verbatim into a method. No behaviour change.
- Larger change: splitting MessageViewerApp into sub-controllers (list, detail, network, calls tab already split) — only
  along those seams and only when touched.
- Risk: low-medium (event ordering, `stopPropagation`, `await`s inside cases). Testing: every viewer sim; a sim that
  asserts every `data-action` in the viewer templates has an entry. When: P2, ideally before the next large viewer
  feature.

### Priority 3 — Future preparation

**R14. Feature registry (§F.8).** Problem: ad-hoc gates. Smallest fix: `features.js` + `{feature}` option on
`register` and `socketManager.register` + UI checks; first migrate Conversations onto it (no behaviour change), then
add Payphones/Emergency/Overheard gates, then the "simple network" mode and the trace "consequences" switch. Affects:
startup, sockets, UI entry points. Risk: medium per feature (non-optional accesses). Testing: §F.10. When: P3 — after
R6 and R20 (v13 readiness), before the first new major system.

**R15. Public API v2 facade (§D.4).** When: P3, after R12 and R14.

**R16. Small kind/type registries.** Access-point kinds (`AccessPoints.js` describe/open switches,
`TerminalScenePins` activation, Access tab) → one `ACCESS_KINDS` table `{describe, open, pinIcon}`; content types →
a `registerContentType(key, {info, enrich, partialBranch})` wrapper over the existing four touches (the template
branch chain stays; it can call a registered partial). Admin tabs → a list the template iterates. Do each when the first
new kind/type/tab needs it (a website is all three). Risk: low. Testing: the existing access/content sims.

**R17. A shared overlay base for framework-free modals.** `mountOverlay(host, {onEsc, onBackdrop, motion})` returning
`{root, close, motion}`; new modals use it; old ones migrate only when edited. Risk: low for new code. When: P3.

**R18. Move resident triggers off the trace funnel.** `recordTrace` emits an EventBus event; residents subscribe.
Makes trace consequences switchable and gives world-event features a clean signal. Risk: medium (exfil already has its
own listener path — keep the de-duplication rule). Testing: resident and trace sims. When: P3, with R14's trace
switch.

**R19. An "after delivery" listener list in MessageService.** Replace direct calls in `_deliverMessage` (terminal
mirror, taps, NPC GM toast) with a small ordered list of hooks the owning features register. Only when a fourth
consumer appears. When: P3.

**R20. Foundry v13 / v14 and Cyberpunk RED system readiness** (added 2026-11-05 at the developer's request; §10).
- Problem: NCM and its tests are written against Foundry v12 and today's CPR system. Foundry v13 moves global classes
  into namespaces (`renderTemplate`, `loadTemplates`, `FilePicker`, `TextEditor`, `ImagePopout`), deprecates the v1
  `Dialog`, passes HTML elements instead of jQuery to hooks, rebuilds the sidebar / directories / chat log / settings
  as AppV2, replaces the `renderChatMessage` hook, reshapes `getSceneControlButtons`, and puts core CSS into cascade
  layers. v14 is expected to remove APIs deprecated earlier (verify each against the release notes before acting).
  The CPR system's own v13 update may change the data NCM reads. **The sims would not notice**: their mocks describe
  v12, so they keep passing after Foundry changes.
- Evidence (counts in `scripts/`): `renderTemplate` ×11, `FilePicker` ×38, `TextEditor` ×4, `ImagePopout` ×7,
  `loadTemplates` ×1; v1 `Dialog` 21 calls (most through the `adminTheme.js` wrappers); `html.find(` ×109 and `$(` ×40;
  `renderChatMessage` ×2; `getSceneControlButtons` ×1 (the whole button group); directory badges + right-click menu
  added through the page (COMPAT-06); 11 `renderActorSheet` / `renderItemSheet` hooks on CPR sheets. CPR data:
  `system.wealth` (one file since batch 3), `system.stats` (~6 reads), role items' `mainRoleAbility` / `rank`
  (`SkillService`), item / actor types (`role` ×14, `blackIce` ×10, `skill`, `gear`, `character`, `mook`, `container`,
  `demon`), `system.price.market`. Test stack: `world.mjs` and 113 hand-built mocks are v12-shaped; CI pins Handlebars
  4.7.8; `test-core-helpers` silently falls back when Foundry's token-HUD template isn't found; mockups / probes link
  Foundry's and CPR's stylesheets by path.
- Why it matters: The Forge and most tables upgrade on Foundry's schedule, not NCM's; a deprecation becomes a removal a
  few versions later; and passing sims would give false confidence exactly when it matters.
- Smallest fix, in order — one codebase that supports v12 and v13 together, not a fork:
  1. `scripts/utils/compat.js`: every moved class looked up once (new namespace first, v12 name as fallback — the
     existing `ImagePopout` lookup is the pattern), plus `htmlOf(html)` turning jQuery-or-element into an element.
     Callers change mechanically.
  2. A deprecation scanner in CI (`dev/tools/check-deprecations.mjs`): a data list of names deprecated in v13 (later
     v14), failing on any use outside `compat.js`.
  3. `scripts/utils/cpr.js`: one adapter for CPR data shapes (stats, role ability rank, item / actor types, price),
     the batch-3 pattern. Wealth is already done.
  4. `world.mjs` version profiles (`foundryVersion: 12 | 13`) that model the hook / class / control differences in one
     place; CI runs the sims once per version; `test-core-helpers` fails loudly when Foundry is installed but its file
     is missing; probe stylesheet paths come from one table.
  5. A live smoke run in a v13 test world (the headless-Chrome join technique): the in-Foundry Phase suites plus the
     batch macros. Only after it passes does `module.json` say `verified: 13`.
  6. The directory menu (COMPAT-06) moves to the menu hook as part of the v13 work, since the AppV2 sidebar is where the
     page-level injection is most likely to break.
- Larger change justified: no. A shim layer and an adapter, not a rewrite or a separate v13 branch.
- Affects: every window that opens a dialog or file picker, chat cards, scene controls, the Items-directory
  integration, sheet hooks, CSS against core, the sims and CI.
- Regression risk: medium overall but spread thin; each `compat.js` swap is mechanical and v12 keeps working through the
  fallbacks.
- Testing: the deprecation scanner; both version profiles in CI; the live v13 smoke run; the existing sims on v12.
- When: P3 — after the event table (step 9) and before the feature registry, which would add more hooks to port. Not
  urgent while `module.json` declares v12 only; do it before widening `verified`.

### Priority 4 — Defer

See §12.

---

## 12. Changes to avoid or defer

| Change | Why not now |
|---|---|
| Replacing `game.nightcity` with dependency injection | Touches 1,364 call sites for little behavioural gain; declared dependencies (R6) give the visibility without the rewrite |
| Full split of MessageViewerApp / DataShardComposer | High regression risk across dozens of sims; split along seams when touched (R13) |
| TypeScript or a build step | The module deliberately has none; JSDoc on the public facade covers integrators |
| A plugin/extension framework | No external extension exists yet; registries (R16) are enough |
| Rewriting the 52k lines of CSS | Working, swept, contrast-measured; scoped to `ncm-` |
| Live (no-reload) toggles for systems with sockets/timers | Synchronisation and cleanup risk with no user benefit |
| Moving call privacy to GM-only routing | Decided (A6): masking is on screen only |
| COMPAT-06 (directory menu via the hook) | Deliberately deferred in the audit; the menu works |
| Generic world-event / rules engine | Wait for R18 and a concrete feature that needs it |
| Moving every world-setting store to journals | Only the growing logs, and only if measured (R11) |
| Removing shipped Phase suites | Users never run them; a lazy import is enough if anything (H11) |
| Normalising every internal result shape | Do it at the public facade only; internal callers are covered by sims |

---

## 13. Proposed incremental refactoring plan

Each step is one batch in the established loop (checkpoint commit → change → sim + PASS/FAIL macro → gate → report →
stop). None depends on a later step; the order is by value and by what later steps reuse.

| Step | Content | Recs | Size | Behaviour change |
|---|---|---|---|---|
| 1 | CI runs check-syntax + sims | R1 | S | none |
| 2 | Split CLAUDE.md into rules + `dev/design/systems/*.md` | R4 | M (docs) | none |
| 3 | Wealth ledger + migrate the seven callers, behaviour preserved | R2 | M | none (unless you choose to unify clamping) |
| 4 | Round-trip helper; ShardMarket + unconvert; register-overwrite warning | R3 | S | fixes lost replies |
| 5 | Dead code removal (verified) + dead mirrors | R5 | S | none |
| 6 | Settings accessor + isPrimaryGM sweep + anon fallback | R7, R8 | S | anon fallback agrees |
| 7 | Shared sim world lib (new sims only) | R10 | S | none |
| 8 | Declared dependencies + better failure report | R6 | S | report text only |
| 9 | Public event table; bridge reads it | R12 | S | none (dead mirrors gone in step 5) |
| 10 | **Foundry v13/v14 + CPR readiness** (added 2026-11-05): `compat.js` shims + `htmlOf`, deprecation scanner in CI, `cpr.js` adapter, `world.mjs` version profiles + per-version CI, live v13 smoke run, directory menu onto its hook | R20 | L (several batches) | none on v12 |
| 11 | Pure rules out of `ui/` with re-exports; helpers.js stops importing UI | R9a | M | none |
| 12 | Viewer action table | R13 | M | none |
| 13 | Measure setting sizes; move trace log if large | R11 | M | storage location |
| 14 | Feature registry; Conversations onto it | R14 | M | none |
| 15 | Payphones / Emergency / Overheard gates; request stubs | R14 | M | new settings |
| 16 | Resident triggers off the trace funnel; trace consequence switch | R18, R14 | M | new setting |
| 17 | "Simple network" mode | R14 | M | new setting |
| 18 | API v2 facade (messages, contacts, time, events, features, open) + docs + test | R15 | M | additive |
| 19 | Registries for access kinds / content types / admin tabs, when first needed | R16 | S each | none |

Steps 1–9 are the "foundation" set: mostly mechanical, low risk, and they make everything after them cheaper.
Step 10 comes before the feature registry because the registry adds hooks and entry points that would otherwise be
ported to v13 later.

**Progress (2026-11-05):** steps 1–7 done on branch `stage2-architecture` (commits `071e3d7` … `d183f2b`).

---

## 14. Required regression testing

**For every step**
- `node dev/tools/check-syntax.mjs`
- every `dev/tools/sims/test-*.mjs` (and `cdp-*` where Chrome is available)
- `.hbs` balance check for touched templates
- `node dev/tools/gen-macros.cjs` if MacroAPI or macro bodies change
- the step's own PASS/FAIL macro in Foundry

**By area**

| Area touched | Existing sims to watch | New tests |
|---|---|---|
| Wealth (R2) | `test-money-guards`, `test-schedule-requests`, `test-relay-retry`, eddies/claim sims, encoder model | `test-wealth` (concurrency, clamps, missing ledger); macro: send/claim/refund/siphon/encode |
| Round trips (R3) | `test-shard-relays`, `test-netresolve`, `test-schedule-requests`, `test-socket-identity` | concurrent-request sim on `socketHarness` |
| Dead code (R5) | `test-window-minimize`, `test-socket-identity` (T16 trust classes), integration-bridge consumers | — |
| Settings/primary GM (R7, R8) | `test-one-gm`, `test-init-order` | fallback = registered default |
| Foundry v13 / CPR readiness (R20) | all sims on both version profiles; `test-ci-checks` (Handlebars pin per version) | deprecation scanner; `compat.js` lookups on v12 and v13; `cpr.js` adapter against both CPR data shapes; live v13 smoke run (Phase suites + batch macros) |
| Layer moves (R9) | all content, encoder, integrity, program-registry, roll-reveal, resident sims | an import-direction sim (no `services/`/`utils/` → `ui/` except allowed) |
| Viewer actions (R13) | every message-viewer sim, `test-helper-collisions` | every template `data-action` resolves |
| Trace log move (R11) | security-module sims, `test-lockout-persist` | migration sim |
| Feature registry (R14) | all, with every feature on | §F.10 isolation, request-stub, round-trip sims |
| API v2 (R15) | `test-socket-identity`, mail/contact relay sims | `test-public-api` as GM and as player |

**Two-client live checks** (unchanged from AUDIT-POST §6, plus): a player prices a shard while another price request
is pending (R3); two credits to one actor at once (R2); a disabled feature's request from a player client is refused
and nothing changes (R14).

---

*End of report. Nothing in this document has been implemented. Every recommendation waits for your approval.*
