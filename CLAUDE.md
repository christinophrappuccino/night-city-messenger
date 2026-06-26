# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Night City Messenger (NCM)** — a Foundry VTT v12 module for the Cyberpunk RED tabletop RPG. Module ID `cyberpunkred-messenger`. Provides in-character messaging, contact management, data shard mechanics, network simulation, and GM tooling. The local working directory IS the live Foundry module install; there is no separate build artifact.

Repo: https://github.com/christinophrappuccino/night-city-messenger

## Workflow

- No `package.json`, no test runner, no build step. Foundry loads `scripts/main.js` directly via `module.json`'s `esmodules` field.
- `tools/` holds dev-only Node scripts (e.g. `gen-macros.cjs`) that Foundry never runs and that produce committed artifacts. These are authoring conveniences, **not** a build step — running them is never required to load the module.
- The developer pushes to GitHub then tests in live Foundry. **Do not commit unless explicitly asked.**
- All testing is manual in Foundry. There are no automated tests; "verify" means syntax-check + smoke-test in the browser.

## Verification

Before presenting changes, syntax-check JS and balance-check Handlebars:

```bash
node --check path/to/file.js
```

For `.hbs` templates, count block opens vs closes:

```bash
opens=$(grep -oP '\{\{~?#(if|unless|each|with)' path/to/file.hbs | wc -l)
closes=$(grep -oP '\{\{~?/(if|unless|each|with)' path/to/file.hbs | wc -l)
[ "$opens" = "$closes" ] && echo BALANCED || echo "MISMATCH ($opens/$closes)"
```

If the grep flags a mismatch, scan for block tags inside `{{!-- --}}` doc comments first — they're false positives.

To verify the macro packs after editing `tools/gen-macros.cjs`, regenerate — the generator self-validates (every line round-trips as JSON; every `command` parses as the async function Foundry runs it as; ids unique/well-formed):

```bash
node tools/gen-macros.cjs
```

When diffing a regenerated pack against a prior copy, key by `_id`, **never** by line order — Foundry's NeDB compaction reorders the on-disk `.db` on world load (see Compendium packs).

## Architecture: how startup works

**Single entry point**: `scripts/main.js` instantiates a `ModuleInitializer` (`scripts/core/ModuleInitializer.js`), then nine `register*` files in `scripts/init/` each push tasks into one of four phases: `preInit`, `init`, `ready`, `postReady`. Tasks have a numeric priority (lower runs first; conventionally increments of 10). Foundry hooks (`Hooks.once('init')`, `Hooks.once('ready')`) drain the phases.

This means: **to add a new service or hook, add a `register(phase, priority, name, fn)` call in the appropriate `init/register*.js` file.** Don't bolt new `Hooks.once` calls into `main.js`.

## Architecture: services

Long-lived stateful objects in `scripts/services/` (MessageService, NetworkService, DataShardService, MasterContactService, SpamService, etc.) are constructed during the `init` phase and exposed on the `game.nightcity` namespace (e.g. `game.nightcity.messageService`). UI code accesses them via `BaseApplication` getters (`this.messageService`, `this.networkService`, etc.). Cross-service communication goes through `EventBus` (`scripts/core/EventBus.js`) using event names from the frozen `EVENTS` enum in `scripts/utils/constants.js`.

## Architecture: incoming-message notifications

The recipient's "New Message" toast is driven by a **single** path: `EVENTS.MESSAGE_RECEIVED` → the listener in `registerMessagingSystem.js` → `NotificationService.showMessageNotification`. That method owns the toast **and** the receive sound, and **dedups by `messageId`** (a `_recentMsgToasts` map, ~4s window) because the same delivery emits `MESSAGE_RECEIVED` from two sources: the socket path (`MessageService.handleMessageNotification`, recipient online) and the document-sync path (`DocumentSyncBridge._onJournalPageCreated`, when the journal page appears).

Rules so the toast doesn't duplicate or render "Unknown — (no subject)":
- **Never** call `showMessageNotification` directly from a delivery handler, and never add a second toast/sound trigger on `MESSAGE_RECEIVED` — emit the event and let the one listener handle it.
- **Every** `MESSAGE_RECEIVED` emitter must carry the display payload: `from`, `fromName`, `fromActorId`, `fromContactId`, `subject`, `preview`, `priority`. The thin `{messageId, toActorId, fromActorId, priority}` shape was the original duplicate-toast bug. `showMessageNotification` resolves the sender as `fromName → linked actor name → master-contact name → from(email) → "Unknown"`.
- Stored message flags have **no** `fromName`/`senderName` field — only `from` (email) + `fromActorId`/`fromContactId`. Resolve names at read time.
- The document-sync emitter (`DocumentSyncBridge._onJournalPageCreated`) detects inboxes via `MessageRepository.identifyInbox` (flag-based — it previously keyed on a stale `isInbox`/`[NCM]` check and never fired). It **skips `-sent` copies and `status.spam`** and gates the toast on the recipient `actor.isOwner`, mirroring the socket path so a player never gets toasts for NPC or other-player mail. All four `DocumentSyncBridge` journal/page handlers use `identifyInbox`.
- Player→NPC mail never hits a player toast path; the **GM** gets its own toast via `MessageService._notifyGmOfNpcMail` (in `_deliverMessage`, gated by setting `notifyGmNpcMail`, default on). Spam-filtered mail (see spam filter section) is delivered **silently** — the socket notify is skipped and the doc-sync path bails on `status.spam`.

## Architecture: eddies (money) transfer

Eddies attached to a message transfer in **one** place — the recipient clicks **Claim** in the viewer (`MessageViewerApp._claimEddies`), which credits `actor.system.wealth` (CPR `value` + `transactions[]` ledger) and sets `status.eddiesClaimed`. The sender is debited at send (`MessageComposerApp._deductEddies`); the amount rides the message via the `eddies` flag until claimed. **Never auto-credit the recipient in the composer** — doing so caused a double transfer / duplicate ledger entry. `_creditEddies` survives only as the **sender refund** on send failure. `_claimEddies` guards re-claim (sent copy, already-claimed, a per-`messageId` re-entrancy lock) and resolves the target message by id from `_cachedMessages` (so thread-transcript entries claim correctly).

## Architecture: self-destruct messages

Composed via `selfDestruct = { mode, expiresAt, duration }` (modes `after_read` | `1h` | `6h` | `24h`; `_computeExpiry` returns null for `after_read`), persisted in flags. Triggered in `MessageViewerApp`:
- **`after_read`** — erased when the reader *leaves* the opened message: `_destroyAfterReadIfNeeded()` from `_selectMessage` (opening another) and `close()`.
- **Timed** — `_setupDestructFill` runs the countdown bar and fires `_playDestructExpiration` at 0, **and** fires immediately if a message is opened after it already expired. A GM-side **reaper** (`MessageService.reapSelfDestruct`, 60s interval registered in `registerMessagingSystem` postReady) erases timed messages whose expiry passed even if never opened (skips `after_read` + sent copies).

Both paths **hard-delete** (`permanentDelete`, not soft/trash) — self-destruct must be non-recoverable. **GMs never trigger self-destruct** (all three viewer paths early-return when `game.user.isGM`) so they can audit inboxes; timed cleanup still happens via the reaper.

## Architecture: unknown-sender spam filter

Opt-in (`spamUnknownSenderEnabled`, default **off**). At delivery, `MessageService._shouldSpamFilter(data)` may route mail to a **player's Spam folder** (sets `status.spam`) when the sender isn't in the recipient's contacts (`_isSenderInRecipientContacts` checks email / linkedActorId / masterContactId). Player-recipient only; skips sent/broadcast/already-spam. Tuners (Module Settings): `spamUnknownSenderChance` (%), `spamUnknownSenderScope` (`known` = sender is a real contact — a master-directory entry **by `fromContactId` or email**, or a registered character — but the player hasn't added them | `all` = also unknown addresses), `spamUnknownSenderExcludePlayers` (keep party comms out). Delivery is silent (see notifications rules). The viewer's `inbox` filter excludes `status.spam`; the `spam` filter shows it.

**`status.spam` must survive persistence.** `MessageRepository.createMessage` builds the stored status field-by-field; it must read `spam: messageData.status?.spam || false` (it was once hardcoded `false`, which silently dropped **every** spam route — the unknown-sender filter AND the Spam tab blast/templates/auto-spam — into the normal inbox). If spam "isn't landing" and the route decision logged true, check that block first. (`saved`/`deleted`/`scheduled` stay hardcoded `false` for new mail — only `spam` honors the caller.) Also note `_shouldSpamFilter`'s recipient gate is `toActor?.hasPlayerOwner` only — narrower than `SpamService.getPlayerActors` (`hasPlayerOwner` **or** an NCM `email` flag) — so it no-ops when the recipient isn't owned by a logged-in non-GM player (the solo-GM-testing trap). Left intentionally narrow: the only extra actors it'd catch are email-only NPCs, which don't check a spam folder.

**Scope `'known'` is the most common "100% chance but still in inbox" gotcha:** a completely unknown sender (a typed-in address not in the directory) is *intentionally skipped* under `'known'` — switch the scope setting to `'all'` to catch those. `_shouldSpamFilter` emits a `log.debug` at **every** early-return with the reason (recipient-not-player, excludePlayers, already-a-contact, scope-skip, chance-0, etc.) plus the final route/pass decision — turn on `debugMode` to see exactly why any message did or didn't land in Spam. The `'known'` check qualifies a sender via `fromActor` **or** a truthy `data.fromContactId` **or** `verifyContact(data.from).verified`, so a message from a real master contact filters even when its email is blank/synthesized (previously it only checked the email path).

## Architecture: Spam tab (generator, auto-spam, import/export)

The Admin → Spam tab (`SpamTab.js` + `templates/admin-panel/tab-spam.hbs`) is backed by `scripts/services/SpamService.js`. Spam templates are pure content (`fromName`/`fromEmail`/`category`/`subject`/`body`/`networkFilter`) — **recipients are chosen at send-time** via the chip UI, never stored on a template. Both the Quick Blast bar and each template's "Send to →" row render the same `spamPlayerActors` list.

- **Recipient list = `SpamService.getPlayerActors()`.** It returns every actor that is `actor.hasPlayerOwner` **or** carries an NCM `email` flag — the same "messageable character" definition used elsewhere (e.g. `OverviewTab`). **Do not** narrow this back to an explicit per-user `OWNER` entry: that silently returns empty for actors owned via *default* ownership or registered NPCs, which is the bug that made the chip lists show only the "All" chip and no players. The per-user owner lookup survives only to pick a chip color.
- **Auto-Spam by Network** config lives in the `spamAutoConfig` world setting (`{ [networkId]: { enabled, volume, categories } }`; volumes low/med/high/flood → count ranges via `getVolumeRange`). It is **wired but easy to mistake for broken**: `registerNetworkSystem.js` (ready, priority 109) listens for `EVENTS.NETWORK_CHANGED` and calls `SpamService.onNetworkConnect(networkId, actorId)` **only when** the event is `source: 'socket'`, **not** `isGMAction`, and carries an `actorId`. That means it fires when a **player with an assigned character** switches networks (their client broadcasts `NETWORK_STATE_CHANGED` with `game.user.character.id`) — **not** on the GM's own switches and **not** for a player without an assigned character. Delivered spam is pre-flagged `status.spam` (goes to the Spam folder, silent — no toast). Both the listener and `onNetworkConnect` emit `log.debug` with the skip/deliver reason (`debugMode`).
- **Import / Export templates** (`spamImportTemplates`/`spamExportTemplates` actions → `SpamTab.onImport/ExportTemplates` → `SpamService.importTemplates`/`exportTemplates`). Export downloads **only custom** templates (built-ins ship with the module) as `{ ncmSpamTemplates: 1, exportedAt, templates[] }`. Import accepts that envelope **or** a bare array, assigns fresh ids, validates the category, and de-dupes against existing customs by `fromName + subject` (case-insensitive) so re-importing is safe. Follows the ContactsTab blob-download / hidden-`<input type=file>` pattern.

## Architecture: GM awareness of player→NPC mail

`MessageService._notifyGmOfNpcMail` (called in `_deliverMessage`, GM client) toasts the GM when a **player-owned sender → non-player recipient** (gated by `notifyGmNpcMail`). The **NPC Inbox** triage panel in Admin → Messages (`MessagesTab._gatherNpcInbox`, actions `toggleNpcInbox`/`npcInboxFilter`/`npcInboxReply`) groups player→NPC mail by NPC.

## Architecture: anonymous send (GM)

A GM-only composer option (`anonymousEnabled`) that masks the sender: the recipient sees a masked avatar + alias and **cannot resolve the real identity** (it's stored GM-side only — *truly hidden*, not cosmetic). Gated by `game.user.isGM && anonSendEnabled`. Six world settings under "Anonymous Send": `anonSendEnabled`, `anonDefaultStyle` (default **scrambled**), `anonAllowRepliesDefault`, `anonTraceEnabled`, `anonTraceDV` (15), `anonTraceSkill` (a CPR-skill dropdown from `SKILL_MAP`). The message carries an `anonymous` block `{ enabled, role?, style, alias, maskedEmail, allowReplies, traceable, traceDV, traced }`.

**Truly-hidden data model — the masking policy lives in `MessageService`, not the repository.** `MessageRepository` only persists/reads the `anonymous` block (createMessage flags + `_pageToMessage`) and uses the alias for the page name (`_resolveSenderName`). In `_deliverMessage`, `_maskAnonForRecipient(data)` builds a clone with the real identity stripped (`from`=masked email, `fromActorId`/`fromContactId`=''); that clone is used for **both** the recipient inbox copy **and** the recipient `MESSAGE_NOTIFY`/toast. The **real sender survives only on the GM-owned `-sent` copy** (the original `data`). So the recipient's player-readable page never contains the real id. Anonymous mail is **spam-filter exempt** (`_shouldSpamFilter` bails — an "unknown" sender would otherwise always match).

**Masked display is one shared resolver + one CSS component.** `resolveAnonSender(message,{isGM})` (helpers.js) returns the masked view for non-GM (and for a GM reading the scrubbed copy — a known limitation; GMs audit via the `-sent` copy, which reveals + tags **SENT ANON**). All read paths call it: `MessageViewerApp._enrichMessageDisplay` (detail/list/thread — exposes `isAnonMasked`/`isAnonRevealed`/`anonStyle`), `NotificationService.showMessageNotification` (alias), `DocumentSyncBridge._onJournalPageCreated` (carries `anonymous` + alias in the MESSAGE_RECEIVED payload — the doc-sync toast path reads the already-scrubbed page). Avatars render via the `ncm-anon-avatar` Handlebars helper (registerTemplates.js) → pure-CSS layers in `styles/components/anon-mask.css` keyed by `data-anon-style`. **The mask never uses a real photo** — Filtered/Scrambled obscure a neutral silhouette, so nothing leaks. Four styles: `filtered` / `scrambled` (default; heavy static + jitter + tear + RGB) / `ghost` (blobby silhouette) / `monolith` (SEELE "SOUND ONLY" slab). Add-to-Contacts is hidden on masked mail; the `.ncm-anon-badge` shows ANON / SENT ANON / TRACED.

**Reply routing (masked both ways).** `buildReply` detects `originalMessage.anonymous` (role≠recipient, not traced) and returns an `anonReply` descriptor `{ parentMessageId, alias, style, maskedEmail }` with **no** real target — the player can't know it. `sendMessage` and `DataValidator.validateMessage` both skip the recipient-required + verification gates when `data.anonReply`. GM-side `_deliverMessage` calls `_resolveAnonReplyTarget(parentMessageId)` (scans journals for the `<id>-sent` page → real sender), sets the true `toActorId`, and delivers; the replier's **own** sent copy is re-masked via `_maskAnonReplyForSender` → an `anonymous` block with **`role: 'recipient'`** so their outbox can't reveal who they answered (`resolveAnonRecipient` masks the TO; `resolveAnonSender` skips role `'recipient'`). The composer shows a locked masked recipient chip (`anonReplyTo`). One-way mode (`allowReplies` false) → `anonRepliesBlocked` hides Reply/Quick-Reply and shows a "No Reply" chip.

**Trace-to-unmask (GM-mediated).** A "Trace" button (`canTraceAnon`) runs `MessageViewerApp._traceAnonSender` → skill dialog + `skillService.performCheck(actor, anonTraceSkill, {dc: anonymous.traceDV})`. Result is reported to the GM via `SOCKET_OPS.ANON_TRACE_REQUEST` (player→GM; the client reports success — trust model matches the existing relay). `MessageService.handleAnonTraceRequest` → `revealAnonSender(messageId, inboxActorId)` resolves the real sender (`_resolveAnonReplyTarget`) and **patches the player's page** with real `fromActorId`/`from`/`fromContactId` + `anonymous.traced=true`; the update syncs back (`DocumentSyncBridge._onJournalPageUpdated` → `MESSAGE_STATUS_CHANGED` → viewer re-render) and the mask resolves to the real identity. `resolveAnonSender` and `buildReply` both bail when `traced` (so a traced sender shows normally and replies directly). GM clicking Trace force-reveals (no roll). Sounds: `trace-fire` (attempt), `shard-decrypt` (reveal), `hack-fail` (miss).
- **Two trace bugs that bit and how they were fixed (don't reintroduce):** (1) `revealAnonSender` must rewrite the **whole** `anonymous` block (`{...current, traced:true}`), NOT a nested `anonymous.traced` dot-path via `updateMessage` — the nested-flag update is unreliable (the standing CLAUDE.md gotcha) and the **player-side unmask hinges entirely on `traced` landing** (the player masks whenever `enabled && !traced`, regardless of `fromActorId`; only the GM-reveal path keys off `fromActorId`, so the GM saw it "work" while players stayed masked). (2) `handleAnonTraceRequest` must **check `revealAnonSender`'s result** before toasting "identity revealed" — it used to toast success unconditionally, so a failed reveal (e.g. missing `-sent` copy) looked like it worked while nothing changed. On failure it now warns the GM with the reason.

**CSS gotchas this hit:** new composer buttons (`ncm-composer__anon-pill`/`anon-reply`) MUST be added to the composer button-reset lists in `message-composer.css` or they render as Foundry's full-width native buttons; viewer avatar hosts (`.ncm-viewer__avatar--anon`) need `overflow:hidden` because they set `border-radius` but rely on a rounded `<img>` (the absolutely-positioned mask isn't otherwise clipped); the `.ncm-anon-badge` needs `vertical-align:middle`+`align-self:center`+`line-height:1` or it rides high on the text baseline.

## Architecture: inbox window title + theme extras

The inbox window title is **personalized and diegetic**: `MessageViewerApp.get title()` → `{handle} // {agentName}` (handle = NET email local-part, else actor name; `agentName` from `playerTheme.agentName`, default "Agent"). The singleton viewer switches characters, so `_onRender` re-syncs the `.window-title` element (AppV2 builds the frame once). Boot splash + Character Select keep the "Night City Messenger" brand. The Theme Customizer **Text panel** (tab labeled "Text" — formerly "Fonts"; the internal `data-tc-tab`/`activeTab` key is still `fonts`) holds the **Agent Name** field, the font selectors, text size, and a **contrast** slider (70–140%, step 5, default 100). The Agent Name row is wrapped in `.ncm-tc__font-section` so it shares the panel's 16px indent (it's the only `.ncm-tc__srow` outside that section otherwise, which left it flush-left). Contrast — `ThemeService.applyTheme` tone-maps the bg/text/border palette by spreading their **OKLCH lightness** around a pivot of **0.42** (`CONTRAST_SPREAD` in constants.js; `adjustLightness` in helpers.js), **not** a CSS `filter: contrast()`. The filter approach distorted images/wallpaper and drifted saturation; the palette spread leaves images untouched and preserves hue/chroma (neon stays neon), and accents (`primary/secondary/accent`) are deliberately excluded. It always recomputes from base prefs/preset, so dragging can't compound. `textMuted`/`border` aren't user-overridable or in any preset, so `CONTRAST_SPREAD` carries their variables.css defaults as the `base` fallback. Range is deliberate: `text-primary` whites out ~110% and `bg-deep` blacks out ~142%, so 140 is a clean high-contrast ceiling without crushing the bg depth layers (don't exceed ~150); the 70 floor is a soft/dim mode for glare sensitivity. No JS clamps the value — the slider `min`/`max` in `theme-customizer.hbs` are the only gates. The old `--ncm-contrast` var + reset.css filter rule are gone. The customizer's Save button enables via `_markDirty()` (toggles the button's `disabled` in the DOM) because live inputs (sliders/selects/text) don't re-render.

## Player send-gate verification

`MessageService.sendMessage`'s player-only verification gate must accept a recipient that matches the master directory **or** a registered actor email — go through `ContactRepository.verifyContact(email)` (which checks both), not a master-contacts-only lookup. This must stay in sync with the `RequireContactVerificationHint` setting text in `languages/en.json`, which promises both.

## Architecture: message threading / conversation view

Clicking the **`Thread · N`** pill in the message detail (a `<button data-action="toggle-thread">` in the subject strip) swaps the single-message detail pane for a **conversation transcript** — every message in the thread, oldest→newest, on a timeline rail, with the message you came from highlighted and auto-centered. Back returns to the single message. This is the only "Option C" full-transcript view; it lives entirely inside `message-detail.hbs` as an `{{else if message.threadExpanded}}` branch of the locked/encrypted/normal conditional chain (no separate template/part).

**Thread state is a single instance flag.** `MessageViewerApp._threadExpanded` (default false) is flipped by `_toggleThread()` and **reset to false in `_selectMessage`** so opening any message — including an entry's "open" button inside the transcript — returns to the single-message view. `_getEnrichedMessage` attaches `threadInfo` (badge count), `threadExpanded`, and `threadEntries` (only built when expanded). `_onRender` centers `.ncm-viewer__thread-entry--current` in `.ncm-viewer__thread-scroll`. Per-entry bodies are independently access-checked via `messageAccessService.checkAccess` so encrypted/network-locked messages stay redacted *inside* the transcript, exactly as in the single view.

**Thread membership is resolved, not a raw `threadId` filter.** `scripts/utils/threading.js` (pure, no Foundry globals) merges a flat message list into conversations with a union-find over **four signals**, any one of which links two messages:
1. `threadId` — canonical group id
2. `inReplyTo` — points at the parent's id
3. `references[]` — full ancestor chain (survives forward-of-forward, reconstructs even if `threadId` is lost)
4. **subject + shared counterparty** — fuzzy fallback: identical `normalizeSubject()` (strips `RE:`/`FWD:`/`FW:`) **and** an overlapping `counterparties()` (the *other* party from the viewing actor's perspective — the actor's own ids are excluded, since they're in every message). Rescues forwards-to-strangers, hand-composed same-subject mail, and legacy pre-`references` messages.

Signal 4 is the only one that can over-merge (two unrelated "FWD: invoice" chains from the same fixer). It's gated by the world setting **`subjectThreading`** ("Smart Conversation Grouping", default on; strings in `en.json`). Off = strict reply/forward-link threading only. Both `_getThreadInfo` and `_buildThreadEntries` route through the resolver via the shared `_threadOpts()` helper. IDs are compared on their **base** form — `baseId()` strips a trailing `-sent` so a sent copy and its received twin count as one identity. Within a single actor's mailbox each logical message appears once (the twin lives in the other actor's inbox), so no dedup is needed.

**Forwards now connect by design.** `MessageService.buildForward` carries `threadId` + `inReplyTo` + `references` (the new recipient simply sees a single-message thread until they reply); `buildReply` carries `references` too. Both build the chain via `_buildReferences(originalMessage)` (appends the base parent id to the de-duped ancestor list). `sendMessage` never leaves `threadId` undefined — it falls back `references[0] → inReplyTo → messageId`. `references` is persisted/read by `MessageRepository` (`createMessage` flags + `_pageToMessage`), defaulting to `[]` for old messages. **Note:** `MessageRepository.getThread()` (used by the macro API) still keys purely on `threadId` — it was left for back-compat and is *not* the resolver; the transcript UI does not use it.

## Architecture: responsive message viewer

The Message Viewer adapts to the viewer's **own width** via CSS **container queries** — `.ncm-viewer { container-type: inline-size }` (message-viewer.css §23), not viewport `@media`. Breakpoints: wide >720 (full two-pane), medium ≤720 (icon-only header buttons, avatar-only identity, HUD drops Location), narrow ≤520 (single column; pill→dot+%; primary tabs + category pills icon-only via the `font-size:0` collapse trick; denser rows). The single-column switch is the only JS: `_onRender` sets `data-pane` on `.ncm-viewer` (`selectedMessageId ? 'detail':'list'`); narrow CSS shows one pane and the `.ncm-viewer__mobile-back` button (action `mobile-back`). Window min-size clamped in a `setPosition()` override. When narrow, the list-panel inline `width` is overridden with `width:100% !important` (placed after the `--list-collapsed` rule to win on specificity/order).

**Network selector shows only reachable networks.** `MessageViewerApp._buildSelectorNetworks()` still computes each network's `state` ('active'|'available'|'locked'|'unavailable') but then `.filter()`s out `unavailable` and 0% signal — like real life, you don't see networks you can't reach. `locked` (in range, needs auth) stays visible. `availableCount` derives from the shown list. Dead zones return `[]` (jammed state); a scene with networks configured but none reachable shows a "No Networks in Range" empty state (distinct from the dead-zone state) in `network-selector.hbs`.

## Architecture: UI apps

All NCM windows extend `BaseApplication` (`scripts/ui/BaseApplication.js`), which is `HandlebarsApplicationMixin(ApplicationV2)`. BaseApplication provides:

- `subscribe(event, callback)` — managed EventBus subscriptions auto-cleaned in `close()`
- `_debouncedRender()` — 150ms coalesced render for bursty event sources
- `_applyAtmosphere()` — sets `data-ncm-scanlines/neon/animation-level` attributes on the root
- `playSound(id)` / `playEffect(el, cls, ms)` — respect user prefs
- `_animationActive` flag — set by handlers during multi-step flag writes to suppress debounced re-renders mid-animation

**Always use `_onRender` for post-render DOM work.** Never override `render()`. ApplicationV2 template parts must have a single root element.

## Architecture: AdminPanel composition

`scripts/ui/AdminPanel/AdminPanelApp.js` is a thin shell (~1,000 lines). Tab logic lives in **7 separate files** under `scripts/ui/AdminPanel/tabs/`:

```
AdminPanel/
├── AdminPanelApp.js     ← lifecycle, services, action dispatchers, EventBus, keyboard
├── BaseTab.js           ← abstract: prepareContext / onRender / onClose + service proxies
└── tabs/
    ├── OverviewTab.js   ContactsTab.js   MessagesTab.js
    ├── NetworksTab.js   ShardsTab.js     SpamTab.js   ToolsTab.js
```

Tabs are **composed, not inherited** — `AdminPanelApp` holds instances in `this.tabs = { overview, messages, ... }` (lazy-init via getter). Tab classes own their own state (`this._search`, etc.), data gathering, DOM wire-up, and action-handler implementations.

**Why static action handlers stay on `AdminPanelApp`**: Foundry's ApplicationV2 binds the `static DEFAULT_OPTIONS.actions` map at class load. Static methods must remain on the parent. Each handler body is a **one-line delegator**:

```js
static _onContactFilter(event, target) {
  this.tabs.contacts.onFilter(event, target);
}
```

Inside the static method, `this` is the `AdminPanelApp` instance (Foundry binds it). Inside the tab method, `this` is the tab instance.

**Adding a new admin panel action:**
1. Add the action name → static handler in `DEFAULT_OPTIONS.actions`
2. Add a one-line static delegator method on `AdminPanelApp`
3. Implement `onXyz(event, target)` on the appropriate tab

**Cross-references from a tab to parent state/methods** go through `this.app.X`:
- `this.app._saveScroll()` — preserves admin-content scroll
- `this.app._activeTab` — currently active tab key
- `this.app._animationActive` — suppress debounced renders during multi-step writes
- `this.app._relativeTime(iso)`, `this.app._getRelativeTime(ts)` — formatters
- `this.app.constructor._findItem(id)` — static item lookup (used by ShardsTab, NetworksTab)

## Architecture: GM Admin Panel theme (separate from player theme)

The Admin Panel has its **own** theme, isolated from the player theme. The player `ThemeService` writes `--ncm-*` to `:root`; `styles/themes/admin-theme.css` re-defines the same `--ncm-*` variables **on the panel root `.ncm-app.ncm-admin-panel`**, which wins for every descendant (custom properties resolve from the nearest ancestor) — so the panel is themed in isolation and `:root` is untouched. **Don't move these overrides to `:root`** (that's the opposite of the player-theme rule) and **don't scope them tighter than the panel root** or descendants won't inherit them.

- **Presets are pure CSS** keyed by `data-ncm-admin-theme="clean-dark|clean-light|high-contrast"` (no per-variable JS injection). `clean-dark` is the base rule (applies with no attr too, so it's the robust default); light/high-contrast are attribute overrides declaring only their palette diffs (glow/font overrides fall through from the base rule). Goal: clarity/accessibility/cleanliness — a calm slate dashboard, one restrained accent, **no neon/scanlines**, legible system UI fonts (mono kept for numbers).
- `AdminPanelApp._applyAdminTheme()` (called in `_onRender` **after** `super._onRender` so it beats `_applyAtmosphere`) sets the `data-ncm-admin-theme` attr from the `adminTheme` setting **and** force-sets `data-ncm-scanlines/neon="false"` regardless of player prefs.
- **Settings:** client-scoped `adminTheme` (`{ preset }`, `DEFAULTS.ADMIN_THEME`), with `SettingsManager.getAdminTheme/setAdminTheme` — fully independent of `playerTheme`.
- **Picker:** Tools tab "Admin Appearance" (`setAdminTheme` action → `ToolsTab.onSetAdminTheme` saves + re-renders; `ToolsTab.prepareContext` provides the preset list + active state).
- **Window-chrome controls follow the admin theme too.** Foundry colors the `.window-header .header-control` **icons** (`<i>`, close/etc.) near-white by default, and `window-chrome.css`'s `.header-control { color }` rule doesn't reach the inner `<i>`. That's invisible on the dark presets but **white-on-white on `clean-light`**. `admin-theme.css` forces both the button and its `> i` to `--ncm-text-secondary` (hover `--ncm-text-primary`; close-hover `--ncm-danger`), **scoped to `.ncm-app.ncm-admin-panel`** so the player theme's chrome is untouched.

**Admin CSS must use `--ncm-*` vars, not hardcoded brand values, or it won't follow the admin theme.** A 2026-06 sweep converted ~600 solid brand hexes → `var(--ncm-*)` and ~380 brand `rgba(r,g,b,a)` → `color-mix(in srgb, var(--ncm-X) N%, transparent)` across all `admin-panel/tab-*.css` (color-mix is fine in Foundry v12's Chromium). When adding admin-panel styles, follow that discipline. **Intentionally left hardcoded:** network-**type** colors (CorpNet blues etc.), per-preset icon colors, and black/white `rgba` (shadows/overlays — theme-agnostic). Note: much shard-tab CSS reads `var(--sp-X, var(--ncm-Y))` / `var(--ncm-color-X, var(--ncm-X))` — `--sp-*` is undefined outside `.shard-preset-*` scopes and `--ncm-color-*` doesn't exist, so both **fall through to the themed `--ncm-*`**.

## Quick Import Actor → contact (admin Contacts tab)

The Contacts-tab toolbar button **Import Actor** (`importActorAsNpc` action → `ContactsTab.onImportActorAsNpc`) opens `ActorImportPickerApp` (`scripts/ui/GMContactManager/ActorImportPickerApp.js`) — a standalone `BaseApplication` listing world actors that are **not** player-owned and **not** already linked to a master contact, with live client-side search (no re-render; rows hidden via `style.display`). Picking a row closes the picker and calls `GMContactManagerApp.startCreateFromActor(actorId)`, which builds a `_createDraft` (name, `actor.img`, NCM email flag, CPR role item → role slug, pre-set `actorId`) and opens the create form pre-filled. The GM form's create branch binds to `createDraft` (not `null`); `_createDraft` is cleared whenever create mode is left (cancel / save / select / new / keyboard-N). Template `templates/gm-contact-manager/actor-import-picker.hbs`; styles `styles/components/actor-import-picker.css`.

## Tools tab — Purge Messages (scoped)

Admin → Tools → Danger Zone → **Purge Messages** (`purgeMessages` action → `ToolsTab.onPurgeMessages`) is a **scoped** purge, not all-or-nothing. It enumerates targets — character + contact inboxes (via `MessageRepository.identifyInbox`, with per-inbox message counts) and data shards (via the `isDataShard` flag, world + actor-owned, counted by `DataShardService.getShardMessages`) — and presents a grouped `<select>` (plus an "ALL inboxes" option) in a `Dialog`; empty targets are skipped. A confirm dialog shows the exact count, then it deletes. `_purgeInboxJournal(journalId)` deletes only message pages (`flags.<MODULE>.messageId`) so the empty inbox survives; `_purgeShard(uuid)` removes entries via `DataShardService.removeMessage` so the shard item survives. Deletions fire the normal document-sync hooks, so open viewers update. (Read the select via `html.find(...)` in the Dialog callback — `FormDataExtended` is unreliable.)

## Networks tab — Scene Signal list controls

`NetworksTab._gatherSceneStrip()` returns the full enriched scene list (used for the dead-zone stat); `_buildSceneView()` applies search + hide-imported + sort + pagination (8/page, `static SCENE_PAGE_SIZE`) and returns `{ scenes, controls }`. Defaults: sort `current` (current scene first), `_sceneHideImported = true`. "Imported" = compendium-derived, detected via `scene._stats.compendiumSource` (v12) with a `flags.core.sourceId` (v11) fallback; such scenes are hidden **only** when they have no NCM config (`deadZone` / `defaultNetwork` / any truthy `networkAvailability` entry) — configured/jammed scenes always show. The hide button only renders when hideable scenes exist (`controls.canHide = importedCount > 0`), so it can't flip-off-and-vanish. The sort `<select>` and the search input get manual listeners in `onRender` (selects don't fire on change via `data-action`).

## Network Management app — Scenes tab (split-panel + auto-save)

This is the **standalone `NetworkManagementApp`** Scenes tab (`scripts/ui/NetworkManagement/NetworkManagementApp.js` + `templates/network-management/network-management.hbs`), distinct from the AdminPanel Networks tab above. Layout = a **split-panel** mirroring the app's Subnets tab: a fixed summary strip (Scenes / Configured / Dead Zones) on top, then a **searchable, paginated scene list** on the left (`_buildSceneListView()`, 12/page, `static SCENE_PAGE_SIZE`; current scene sorts first; clamps page on shrink) and the **selected scene's config** on the right. The scenes content div carries `ncm-netmgr__content--scenes` (flex column) and the split carries `ncm-netmgr__split--scenes` (`flex:1; height:auto`) so the summary stays pinned and the panes scroll internally. Selection persists across pages/search via `_selectedSceneId`; `_prepareContext` auto-selects current/first when unset or stale.

**Scene config auto-saves on change — there is no Save button.** Default network (`<select.ncm-netmgr__scene-default-select>`) and each availability checkbox (`input.ncm-netmgr__scene-avail-check[data-network-id]`) write the scene flag immediately, matching the dead-zone toggle. Both get **manual `change` listeners in `_onRender`** (selects/checkboxes don't fire reliably via `data-action`); they call the **instance** methods `_saveSceneDefaultNetwork(value)` / `_saveSceneAvailability()` (the latter rebuilds the full availability map from all panel checkboxes so the just-toggled box is included), which call `NetworkService.setSceneDefaultNetwork` / `setSceneNetworkAvailability`. A transient **"✓ Saved"** chip shows via `_flashSavedAndRender()`: it sets `_sceneSavedFlash`, awaits one `render`, then clears the flag so an unrelated later re-render can't replay it (the chip auto-fades via the `ncm-netmgr-saved-flash` CSS keyframes). The pre-redesign bug was that default-network only persisted via a separate Save button buried below an all-scenes chip wall, so it read as "not saving" — the underlying `setFlag` was always correct. The old `saveSceneConfig`/`refreshScenes` actions and the scene-selector/chip-strip markup are gone.

## Architecture: data shard conversion + entries

Two convert paths, both gated through `ShardSheetOverride._launchConversionFlow(item, actor)` (the right-click "Convert to Data Shard" on actor sheets and the Items directory):
- **GM** converts **instantly with the default config** — `DataShardService.convertToDataShard(item)` (no overrides) — mirroring the Admin → Shards tab "Convert" button. **No wizard.** The GM customizes afterward via the "Configure Shard" context option. (Pre-change the GM also got the player wizard; that was deliberately removed.)
- **Players** get the tier-gated **`ShardConversionFlow`** wizard (skill check → ceiling → form), gated by the `playerShardFloor` setting.

**Shard entries must be written through `DataShardService.addMessage(item, entryData)`** — never by hand-writing a journal page. The reader `DataShardService._pageToShardMessage` (used by `getShardMessages`/`getVisibleEntries`, which the `ItemInboxApp` viewer renders) **discards any page whose flag `type !== 'shard-message'`** and keys on `messageId`/`contentType`. `addMessage` stamps exactly that shape. The wizard's initial entry is built by `ShardConversionFlow._buildInitialEntryData(formData)` returning the canonical `addMessage` shape (`{ contentType, from, subject, body, timestamp, contentData }`); a prior bug wrote a raw page with `entryType`/no `messageId` and the entry was silently invisible. **Per-entry `icon`/`accentColor` are NOT stored** — the viewer derives icon/accent from `CONTENT_TYPE_INFO[contentType]`.

**Players can't write to the GM-owned shard journal** (created `OBSERVER`). So the wizard's initial entry **rides along in the conversion socket relay**: `_requestPlayerConversion(item, config, entryData)` → `SHARD_CONVERT_REQUEST` carries `entryData` → the GM handler in `SocketHandlers.js` runs `convertToDataShard` then `addMessage` in one round-trip (entry failure is non-fatal). Eddies debited up-front in the wizard are **refunded on any conversion failure** (`_refundActorWealth`).

**Integrity bar is opt-in per shard, not a regression.** It renders only when `config.integrity.enabled` is true (`{{#if integrityEnabled}}` ← `checkIntegrity().enabled`). `DEFAULTS.SHARD_CONFIG.integrity.enabled` is **`false`** and **no preset enables it**, so default-converted shards (incl. GM instant-convert) show no bar until the GM ticks Integrity in Configure Shard.

**Index strip open/close animation.** The viewer's Index nav chips cascade in/out via CSS keyframes staggered by a per-chip `--ncm-chip-i` custom property (set in `item-inbox.hbs`). `_onToggleIndexStrip` adds `--anim` (flow-in, forced reflow to restart) on open and `--closing` (flow-out) on close, then a JS timer (`220 + chipCount×25`ms) adds `--collapsed` (`display:none`) once the out-animation finishes. Rapid toggles resolve via an "is collapsed OR closing" check + `clearTimeout`; `prefers-reduced-motion` collapses instantly.

## Architecture: embedded media (audio/video)

`resolveMediaEmbed(rawUrl, mediaType)` in `helpers.js` is the **single** source resolver, shared by shards and normal messages. It returns `{ kind: 'none'|'native'|'embed', src, isVideo }`: YouTube/Vimeo links → `embed` (iframe, `src` rebuilt from the parsed video ID — never raw user HTML); direct file/URL → `native` (`<video>`/`<audio>`, audio-vs-video inferred from extension, else `mediaType`); non-`http(s)` schemes (`javascript:`/`data:`) → `none`. Two surfaces:
- **Shard AV Log** content type — `mediaUrl` field added to the composer (`DataShardComposer`, with a `browseMedia` FilePicker) and the player wizard. `ItemInboxApp._enrichEntry` resolves it; `item-inbox.hbs` renders player-or-waveform.
- **Normal messages** — a new media **attachment** (`{ isMedia: true, mediaUrl, mediaType }`) via the composer's "Embed Audio/Video" toolbar action (`_onAttachMedia`). Reuses the existing `attachments[]` persistence (no repo/service change). `MessageViewerApp` splits `isMedia` attachments out of the cards/encrypted-classifier and `_buildMediaEmbeds` renders inline players in `message-detail.hbs` (normal/unlocked branch only — locked/encrypted messages don't leak the player).

## Architecture: sound feedback

All audio goes through `SoundService.play(id, {volume,loop})` (IDs in `SOUND_PATHS`), which gates on the `soundEnabled` pref and scales by `soundVolume` — that one NCM slider governs **everything** below.

**UI interaction sounds are centralized in `BaseApplication`** (every NCM window extends it) — do **not** sprinkle `play('click')` in handlers (that drifted inconsistent; the manual calls were removed). Wired once via `_wireUiSounds()`: document-level **capture** listeners with a `this.element.contains()` containment guard (element-level listeners are unreliable in Foundry), torn down in `close()`. So only the window containing the event plays, and capture means a handler's `stopPropagation` can't swallow it. Coverage: `click` on actionable controls (`button, [data-action], a[href], [role="button"], .ncm-clickable`), `hover` (deduped per entered control), `open` (first render), `close`. Two dialogs that extend raw `ApplicationV2` (`ShardConversionFlow`, `EmailSetupFlow`) are **not** covered.

**The click is varied + quiet** via `SoundService.playClick()`: base `CLICK_GAIN = 0.25`, plus per-press random pitch (playback rate 0.94–1.06) and volume jitter (0.85–1.15×) using a one-shot Web Audio buffer source (the click `.ogg` decoded once + cached), so repeats don't sound identical. Falls back to `play('click', {volume})` if Web Audio is unavailable. `soundVolume` is baked into the gain so the slider still applies. Hover is a flat `0.2`. Tuning knobs: `CLICK_GAIN` + the jitter ranges in `playClick()`, hover volume in `BaseApplication`.

**Shard/security outcome audio: the animated UI owns the climax, not the service.** `DataShardService.attemptHack` and `validateKeyItem` accept a `silent` option; the `ItemInboxApp` calls that drive an animation pass `silent: true` so the service skips its immediate result sounds (which otherwise fire ~6s early / double the animation). The breach sequence (`_playHackSequence`) plays `hack-start` → `hack-progress` (scan + inject) → at the climax `hack-success` **or** `hack-fail` + `black-ice` (on damage) + `lockout` (on lockout); the key-item accept splash plays `key-accepted`, the reject shake plays `key-rejected`. **Non-animated / macro-API callers leave `silent` off and keep the immediate sounds** (`silent` also threads into `_applyBlackICEDamage` → `ICEService.applyDamage`). The **"Shard Unlocked" splash plays `shard-decrypt`** — deliberately distinct from `hack-success` (which is the dice-roll climax, not the shard opening). The 5 once-orphaned sounds are now wired: `hack-start`/`hack-progress` (sequence), `shard-compile` (encoding overlay), `shard-expire` (`_destroyShard`), `trace-fire` (`NotificationService.showShardTrace`).

## Architecture: templates

All `.hbs` paths are constants in `TEMPLATES` (in `scripts/utils/constants.js`) and preloaded by `scripts/init/registerTemplates.js`. **A "Partial not found" error at render time means the file isn't in `TEMPLATES`** — add it there.

CSS is a single entry: `styles/cyberpunk-messenger.css` `@import`s every other stylesheet. New stylesheets must be added there.

## Foundry v12 / ApplicationV2 gotchas

These have all bitten the project. Don't relearn them:

- `data-action` on `<select>` fires on **click** (dropdown opens), not on value change. Add a manual `addEventListener('change', ...)` for selects.
- Element-level `addEventListener` is unreliable in Foundry (DOM focus issues). Use `document.addEventListener` with an app containment guard, and remove it in a `close()` override.
- `item.update()` uses `mergeObject` on nested flag paths — for reliable resets, do `await item.unsetFlag(...)` then `await item.setFlag(...)`.
- `Dialog` callbacks don't return values to a Promise — use a mutable variable in the callback, read it after `close: () => resolve()`.
- `FormDataExtended` is unreliable with selects/checkboxes in ApplicationV2 — read DOM directly via `querySelector`.
- ApplicationV2 template parts must have a single root element.
- `render(true)` forces a template re-render; `render(false)` only repositions.
- `CONTACT_DECRYPTED` and similar EventBus events fire **synchronously** inside their producer methods. Use a guard flag (e.g. `_breachInProgress`) to prevent premature renders that detach animated DOM.
- `_onRender()` is the only safe post-render DOM manipulation point. Use a `_pendingReveal` flag pattern when you need to defer animation work to the next render.
- **Static methods aren't on the prototype.** `this.foo()` from inside another static method (where `this` is the bound instance) silently fails when `foo` is also `static` — `this.foo` returns `undefined`. If a method needs to be invoked via `this.x()` from a static context (such as ApplicationV2's static action handlers), it must be an instance method. This bit `ContactsTab._showShareDialog` and was a latent bug for an unknown amount of time.
- **A button's `disabled`/enabled state driven by a template variable won't update for live inputs that don't re-render.** Sliders, color pickers, `<select>`s, and text fields wired via `addEventListener` typically mutate working state without a `render()`, so a `{{#unless dirty}}disabled{{/unless}}` button stays stuck. Toggle the `disabled` attribute (and the disabled class) directly in the DOM from the change handler. This bit the Theme Customizer Save button — fixed via `_markDirty()`, which sets the flag *and* pokes the button.
- **Script macros run with `speaker, actor, token, character, scope` predefined** as the macro function's parameters. Declaring a local `const actor`/`token`/`character` is a redeclaration error — use other names (`_who`, etc.). Foundry wraps the body in an **async** function, so top-level `await`/`return` are legal (validate macro source the same way — see Compendium packs).

## CSS specificity patterns

- Foundry's globals require `!important` on most `ncm-actlog__` and Network Manager rules.
- `border:` shorthand with `!important` kills inline `border-color` — split into `border-width` + `border-style`.
- `background:` shorthand with `!important` kills `background-image` SVG arrows on selects — split into `background-color` + `background-image`.
- CSS custom properties must be scoped to `:root` (not `.ncm-app`) for ThemeService overrides to apply.
- Foundry button reset must be element+class at specificity 0,2,1 — kill structural defaults only (height, min-height, appearance, box-shadow, margin, background-image), never visual properties.
- `overflow: hidden` vs `visible` is a tradeoff — `visible` fixes dropdowns but breaks flex scroll chains. Resolve by ensuring dropdowns open into a non-clipped area.
- **Foundry's global `.flexrow > *, .flexcol > * { flex: 1 }`** stretches every direct child of a flex row. Anything you inject into a Foundry sheet/sidebar (badges, wrap spans, custom widgets) needs `flex: 0 0 auto !important` or it will fill the row and push sibling content aside. The `.ncm-shard-thumb-wrap` span around inventory data-shard thumbnails is the canonical example.
- **`display: inline-block` on a flex item can render invisible.** When the wrap also has `line-height: 0` (or other line-box-collapsing styles), the element computes to zero size. Use `display: inline-flex` (with `align-items: center`) instead — it gives the element its own flex context and sizes reliably to its content.
- **CSS variable typos render as invisible, not error.** `var(--missing-name)` with no fallback resolves to the property's initial value (often `transparent` for backgrounds/borders, blank for colors). If a UI element looks empty/blank, grep `styles/base/variables.css` to confirm the var name. The actual NCM names are `--ncm-primary`, `--ncm-secondary`, `--ncm-accent` — there is **no** `--ncm-color-*` prefix. The blank shard preset's loading bar was invisible for this reason.
- **Standalone (non-admin) NCM windows still need explicit Foundry button/input resets.** A bare button (e.g. `.ncm-aip__row`) renders with Foundry's white default; scope rules as `.ncm-app button.<class> { … !important }` and reset `appearance` / `box-shadow` / `background` / `height`. This bit the ActorImportPickerApp.
- **A bare `<hr>` renders with the Cyberpunk RED system's gradient, not your border.** The CPR system styles `hr` with a gradient `background`/`border-image`; a divider rule that only sets `border-top` lets that gradient show through underneath. To force a flat line, raise specificity (`.ncm-app hr.<class>`) and add `background: none !important; border-image: none !important; height: 0`. This bit `.ncm-form-divider` (the "GM-ONLY FIELDS" divider in the contacts form).
- **Decorative gradient accents were deliberately flattened to solid lines** (per dev preference). Converted: the player Contacts app top accent (`.ncm-contacts-v5::before`), the date-range picker top accent (`.ncm-time-config-dialog::after` in `tab-tools.css`), and the GM Contact Manager top bar (`.ncm-gm-bar`) + top accent line (`.ncm-gm-contacts::before`). All use solid `var(--ncm-*)` now. If adding new chrome accents, prefer a flat line over a `linear-gradient`.
- **Foundry defaults `<button>` to `width: 100%`.** Converting an inline `<span>` badge/pill into a `<button>` (to make it clickable) makes it stretch full-width — and a flex-row parent stretches it further. Add `width: auto !important; flex: 0 0 auto !important`. This bit `.ncm-viewer__detail-thread` (the Thread pill) the moment it became a button.
- **Search fields: use the flex pattern, not an absolutely-positioned icon.** An `position:absolute` magnifier over a padded input overlaps the placeholder in Foundry. Instead use a bordered flex wrapper holding the `<i>` as a sibling beside a borderless, `padding:0` input — see `.ncm-net-config-search` / `.ncm-scene-ctl__search-wrap`.
- **Tooltips use Foundry's native `data-tooltip` (+ optional `data-tooltip-direction="UP|DOWN|LEFT|RIGHT"`), NOT CSS-pseudo tooltips.** Foundry renders `#tooltip` on `document.body`, so it escapes the window and auto-flips at edges. The old `data-ncm-tooltip` CSS-pseudo approach was clipped by `.window-content { overflow:hidden }` (pseudo-elements can't escape an overflow-hidden ancestor; the contrast `filter` + viewer `container-type` made fixed-escape impossible too — note the contrast `filter` has since been removed in favor of OKLCH palette tone-mapping, but `container-type` remains, so the native-tooltip decision stands). All usages were migrated; the dead `[data-ncm-tooltip]` rules linger inert in `styles/base/interactions.css`.
- **Text elements must declare `font-family: var(--ncm-font-*)` to follow themes.** A rule with no `font-family` silently inherits Foundry's default and won't respond to the Theme Customizer's font selection — it looks fine until a player switches fonts and that one element stays put. The slots are `--ncm-font-title`/`--ncm-font-ui` (Orbitron chrome), `--ncm-font-display`/`--ncm-font-body` (Rajdhani; use for prominent names/subjects), `--ncm-font-mono` (Share Tech Mono; technical values only). This bit `.ncm-viewer__detail-sender-name`, which had only `font-size`/`color` and ignored theme fonts.
- **`overflow-y: auto` with no explicit `overflow-x` spawns a phantom horizontal scrollbar.** Per the CSS overflow spec, setting one axis to a non-`visible` value computes the other (`visible`) axis as `auto` — so a 1px content overrun shows a horizontal scrollbar. Always pair them: add `overflow-x: hidden` next to any `overflow-y: auto`. This bit the date-range picker dialog content (`.ncm-time-config-dialog .window-content` in `tab-tools.css`).
- **Indentation comes from a section wrapper, not the row.** In the Theme Customizer, rows get their 16px horizontal inset from a padded `.ncm-tc__font-section` (`padding: 8px 16px`) / `.ncm-tc__slabel`/`.ncm-tc__name-hint` (`… 16px`), NOT from `.ncm-tc__srow` itself (which is `padding: 6px 0`). A `.ncm-tc__srow` placed directly in the panel (outside a section) sits flush-left and misaligns — wrap it in a section. This bit the Agent Name row.

## Conventions

- Console logging: use `log.info/warn/error/debug` from `scripts/utils/helpers.js`, not raw `console.*`. The `debug` channel respects the `debugMode` setting.
- BEM: `ncm-component__element--modifier`. Class prefix is `ncm-`.
- Fonts: Orbitron (UI chrome/titles), Rajdhani (body/display), Share Tech Mono (technical data values only).
- Cyberpunk RED lore: **Blackwall = red**, not purple.
- All timestamps use UTC getters; stored ISO strings end in `Z`.
- **All countdowns/expiries go through the time provider, not raw `Date.now()`.** Use `game.nightcity.timeService.getCurrentTime()` / `getCurrentTimeMs()` so timers respect the configured mode (real-time / world-time / manual / disguised). This covers self-destruct, network-access lockout (`MessageAccessService`), security/shard-hack lockouts (`SecurityService` — its auto-expiry is a poll-and-reschedule, not a single real-time `setTimeout`, so a paused game clock doesn't clear early), ICE breach lockout (`ContactBreachService`), the trace countdown, and the message "X ago" display. Only record timestamps and real-time animation legitimately use `Date.now()`.
- **Display dates via `formatCyberDate(iso, opts)` (helpers.js), never hand-format.** It honors three world settings: `dateFormat` (order — `YMD`/`DMY`/`MDY`), `dateMonthStyle` (month as `number` 03 / `short` Mar / `long` March, composes with the order), and `timeFormat` (24h/12h). Options: `{ dateOnly }`, `{ timeOnly }`, `{ seconds }`. The message-viewer HUD clock uses the default (date + time) at a reduced font so it fits the header.
- CPR roles are actor items (`actor.items.filter(i => i.type === 'role')`), not `actor.system.role`.
- ICE actors detected by `type blackIce`/`black-ice`, flag `isBlackICE`, or name containing "black ice".
- Contact avatars resolve via `PortraitService.resolvePortrait`: `contact.portrait` → linked-actor `img` (when `contact.actorId` set) → `contact.customImg` → initials. When creating a contact programmatically (e.g. "Add" from a message), pass the sender's `actorId` and/or a `portrait` — name+email alone yields initials. `ContactRepository.addContact(actorId, contactData)` is `(ownerActorId, data)`; the contact's own linked actor goes in `data.actorId`.
- **"Burned" contacts are retired from scope but only CSS-hidden, not removed.** The burn/restore logic still lives in `MasterContactService` / `ContactRepository` / the tab + GM handlers. The UI is hidden via two reversible blocks marked `Burned UI hidden` in `styles/components/admin-panel/tab-contacts.css` (stat, filter pill, row badge, batch-burn, per-contact burn) and `styles/components/gm-contact-manager.css` (burn/restore buttons + `.ncm-chip--burned`). Delete those blocks to restore the UI. Burned references in the message viewer / email / toasts were intentionally left visible.

## Data layout

Inboxes are Foundry journals identified by **flags**, not name: `flags.cyberpunkred-messenger.{ type: 'inbox', actorId }` (actor inbox) or `{ type: 'contactInbox', contactId }` (contact inbox). Current/migrated worlds use **human-readable names** like `"V — Inbox"` / `"Fixer — Mail"`; the legacy `NCM-Inbox-<id>` / `NCM-Inbox-Contact-<id>` names are only a fallback.

**To scan `game.journal` for inboxes, ALWAYS use `MessageRepository.identifyInbox(journal)`** → `{ isContact, ownerId } | null` (flag-first, legacy-name fallback, skips archived inboxes in the Deleted folder). **Never key on the `NCM-Inbox-` name prefix** — a prefix scan silently matches nothing on current worlds, which is what made the admin Message Activity feed (and several other scans) come up empty. Callers: MessagesTab, MessageService, ContactsTab, CharacterSelectApp, MessageAccessService, DocumentSyncBridge.

Each message is a journal page with flags under the `cyberpunkred-messenger` namespace (`messageId`, `subject`, `body`, `status.read/deleted/spam/eddiesClaimed`, `timestamp`, `eddies`, `selfDestruct`, `references[]`, etc.). Sent copies have IDs ending in `-sent`. The four-subfolder hierarchy (Inboxes / NPC Mail / Data Shards / Deleted) under "Night City Messenger" is built and kept in sync by the migration tool in `MessageRepository.migrateJournalOrganization()`.

## Compendium packs (macros)

The module ships two Macro compendiums declared in `module.json` `packs[]`:

- `packs/ncm-macros-player.db` — 6 player-safe macros, default ownership `OBSERVER`
- `packs/ncm-macros-gm.db` — 13 GM automation macros, default ownership `NONE`

Every macro body is a thin guarded wrapper over the existing `game.nightcity.messenger.*` API (`MacroAPI.js`) and carries `flags.cyberpunkred-messenger.{managed:true, sourceId, pack}`.

**Format is intentionally NeDB `.db`** (newline-delimited JSON, one Macro doc per line), not LevelDB. This keeps the "no build step / no `package.json`" rule literally true — Foundry v12 loads `.db` packs directly (with a *deprecation warning* in console; NeDB removal is slated for a future Foundry major). Migrating to LevelDB later is a one-time `fvtt package pack` run, deferred to a future-Foundry compat pass.

**Do not hand-edit the `.db` files.** They are generated. The source of truth is `tools/gen-macros.cjs` — a plain Node script Foundry never runs. After changing a macro, regenerate:

```bash
node tools/gen-macros.cjs
```

It re-emits both packs, validates every line round-trips as JSON, and parses every `command` the way Foundry runs it (an **async** function with `speaker, actor, token, character, scope` predefined — so don't declare locals named `actor`/`token`/`character`; use `_who` etc.). Macro bodies use only double-quoted strings + concatenation (no backticks/template literals) so they JSON-encode cleanly.

**Icons:** each macro's `img` is a fixed path `assets/icons/macros/<icon>.svg` (player icons cyan, GM icons neon-red; `assets/icons/macros/README.md` is a generated macro→file map). The generator seeds a neon placeholder SVG there **only when the file is missing** — it never overwrites existing art, so custom icons (same filename) survive every regen. Replacing a file in place takes effect immediately: no regen, no reinstall, Foundry just loads whatever is at the path. Keep the `.svg` extension (baked into the docs); to switch to PNG/WebP, change the extension/`ICON_WEB_BASE` in the generator, rerun, and reinstall via Admin → Tools.

**NeDB gotcha:** Foundry rewrites the module's `.db` pack files on disk when a world loads (NeDB compaction reorders lines and may add fields). This is harmless — the source of truth is `gen-macros.cjs`, and the Import/Reinstall flow copies into independent world Macro documents — but it means a post-load `.db` will not be line-for-line what the generator emitted. Diff packs **keyed by `_id`**, never by line order.

The packs never auto-write to a world. **Admin Panel → Tools → "Import / Reinstall Macros"** (`ToolsTab.onImportMacros`) is the explicit installer: it creates missing macros in world folders `NCM — Player Tools` / `NCM — GM Tools`, resets `managed:true` macros to the shipped version, and never touches macros the GM authored or detached (matched by `sourceId`).

## Memory

Long-lived context about the developer, workflow, project state, and architectural decisions lives at `C:\Users\cphan\.claude\projects\C--Users-cphan-AppData-Local-FoundryVTT-Data-modules-cyberpunkred-messenger\memory\`. Read `MEMORY.md` for the index when something feels missing.
