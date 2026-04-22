# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Night City Messenger (NCM)** — a Foundry VTT v12 module for the Cyberpunk RED tabletop RPG. Module ID `cyberpunkred-messenger`. Provides in-character messaging, contact management, data shard mechanics, network simulation, and GM tooling. The local working directory IS the live Foundry module install; there is no separate build artifact.

Repo: https://github.com/christinophrappuccino/night-city-messenger

## Workflow

- No `package.json`, no test runner, no build step. Foundry loads `scripts/main.js` directly via `module.json`'s `esmodules` field.
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

## Architecture: how startup works

**Single entry point**: `scripts/main.js` instantiates a `ModuleInitializer` (`scripts/core/ModuleInitializer.js`), then nine `register*` files in `scripts/init/` each push tasks into one of four phases: `preInit`, `init`, `ready`, `postReady`. Tasks have a numeric priority (lower runs first; conventionally increments of 10). Foundry hooks (`Hooks.once('init')`, `Hooks.once('ready')`) drain the phases.

This means: **to add a new service or hook, add a `register(phase, priority, name, fn)` call in the appropriate `init/register*.js` file.** Don't bolt new `Hooks.once` calls into `main.js`.

## Architecture: services

Long-lived stateful objects in `scripts/services/` (MessageService, NetworkService, DataShardService, MasterContactService, SpamService, etc.) are constructed during the `init` phase and exposed on the `game.nightcity` namespace (e.g. `game.nightcity.messageService`). UI code accesses them via `BaseApplication` getters (`this.messageService`, `this.networkService`, etc.). Cross-service communication goes through `EventBus` (`scripts/core/EventBus.js`) using event names from the frozen `EVENTS` enum in `scripts/utils/constants.js`.

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

## Conventions

- Console logging: use `log.info/warn/error/debug` from `scripts/utils/helpers.js`, not raw `console.*`. The `debug` channel respects the `debugMode` setting.
- BEM: `ncm-component__element--modifier`. Class prefix is `ncm-`.
- Fonts: Orbitron (UI chrome/titles), Rajdhani (body/display), Share Tech Mono (technical data values only).
- Cyberpunk RED lore: **Blackwall = red**, not purple.
- All timestamps use UTC getters; stored ISO strings end in `Z`.
- CPR roles are actor items (`actor.items.filter(i => i.type === 'role')`), not `actor.system.role`.
- ICE actors detected by `type blackIce`/`black-ice`, flag `isBlackICE`, or name containing "black ice".

## Data layout

Inboxes are Foundry journals named `NCM-Inbox-<actorId>` or `NCM-Inbox-Contact-<contactId>`. Each message is a journal page with flags under the `cyberpunkred-messenger` namespace (`messageId`, `senderName`, `recipientName`, `subject`, `body`, `status.read/deleted`, `timestamp`, etc.). Sent copies have IDs ending in `-sent`. The four-subfolder hierarchy (Inboxes / NPC Mail / Data Shards / Deleted) under "Night City Messenger" is built and kept in sync by the migration tool in `MessageRepository.migrateJournalOrganization()`.

## Memory

Long-lived context about the developer, workflow, project state, and architectural decisions lives at `C:\Users\cphan\.claude\projects\C--Users-cphan-AppData-Local-FoundryVTT-Data-modules-cyberpunkred-messenger\memory\`. Read `MEMORY.md` for the index when something feels missing.
