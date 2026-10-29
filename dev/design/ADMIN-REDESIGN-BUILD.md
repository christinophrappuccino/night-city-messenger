# Admin Panel redesign — build brief (2026-10-27)

Every Admin Panel tab was re-mocked and approved by the developer this session.
This file is the shared brief for building them. Read it fully, then read
`CLAUDE.md` (project rules — especially "Architecture: AdminPanel composition",
"GM Admin Panel theme", the admin visual vocabulary rules, "CSS specificity
patterns", "Foundry v12 / ApplicationV2 gotchas", "Conventions").

## The approved mocks (the source of truth for layout and copy)

| Tab | Mock | Notes |
|---|---|---|
| Security + Countermeasure Visibility | `dev/mockups/admin-security-redesign-mock.html`, `dev/mockups/countermeasure-visibility-mock.html` | |
| Networks (+ Network Manager folded in) | `dev/mockups/admin-networks-redesign-mock.html` (editor CSS/form lifted from `network-manager-redesign-mock.html`) | `?view=all&edit=1`, `?new=1`, `?view=scenes`, `?pop=1` |
| Contacts (+ GM Contact Manager folded in) | `dev/mockups/admin-contacts-redesign-mock.html` | `?edit=1`, `?guard=1`, `?pop=1`, `?view=matrix` |
| Messages | `dev/mockups/admin-messages-redesign-mock.html` | |
| Terminals | `dev/mockups/admin-terminals-redesign-mock.html` | |
| Shards | `dev/mockups/admin-shards-redesign-mock.html` | |

Each mock has a NOTES block (right-hand column) describing intent. Mocks render
off disk in headless Chrome (`--allow-file-access-from-files`); the scope picker
mock module is `dev/mockups/scope-picker.js`.

## The shared pattern (every redesigned tab)

- **Sub-tabs with count badges** at the top of the tab (the mock's `…-nav` row).
- **List + detail** split; long lists scroll in their own box.
- **Edit in place** in the detail pane (no separate window).
- **Pop out**: the whole tab in its own 1120×780 window — already built, see below.
- Plain language in GM copy (CLAUDE.md rule). Admin vocabulary: display font for
  chrome, mono for values only, 2px radius, 1px badges, `--ncm-*` tokens only.
- The `fa-dice-d10` glyph is NOT in Font Awesome free (renders blank) — use `fa-dice-d20`.

## Shared infrastructure ALREADY BUILT (use it, don't rebuild it)

1. **Generic per-tab action** — `data-action="tabAct" data-owner="<tab key>" data-op="<op>"`
   → `this.tabs[owner].onAct(op, event, target)`. Override `onAct` in your tab and
   switch on `op`. Do NOT add new static delegators to AdminPanelApp for new buttons.
   Existing actions may stay; retire ones your redesign no longer renders only if
   nothing else references them (grep).
2. **Pop out** — `data-action="popOutTab" data-tab="<key>" [data-select="<id>"]` opens
   `AdminTabWindow` (`scripts/ui/AdminPanel/AdminTabWindow.js`): the SAME AdminPanelApp,
   pinned to one tab, chrome hidden, root class `.ncm-admin-panel--pop`, context
   flag `isPopout`. Your tab reads `this.isPopout` and widens its layout under
   `.ncm-admin-panel--pop` in its own CSS. Docking back is built (`dockTab`).
3. **`game.nightcity.openAdminTab(tab, { popout, select })`** — opens the panel (or
   pop-out) on a tab; `select` is passed to your tab's `openTo(select)` before render.
   Implement `openTo(select)` to open on that row (contact id, network id, …).
4. **Scope picker** — `scripts/utils/scopePicker.js` (`ScopePicker.html/value/set/on/open/after`),
   CSS `styles/components/scope-picker.css` (already imported). Usage:
   ```js
   import { ScopePicker } from '../../../utils/scopePicker.js';
   const id = this.scopeId('netlog');                       // BaseTab helper — per window
   ScopePicker.on(id, () => this.app.render());
   ctx.myTabX.netPicker = ScopePicker.html(id, { noun:'network', nouns:'networks', multi:true, items, countLabel:'entries' });
   // template: {{{myTabX.netPicker}}} ; read ScopePicker.value(id) ; call ScopePicker.after() in onRender
   ```
   Rule: a `<select>` only for a SHORT enum. Lists of world things that can grow
   (networks, scenes, people, identities) use the scope picker. Whole-world
   item/actor pickers keep using `showNamePicker` (`scripts/utils/namePicker.js`).
5. **BaseTab** gained `onAct`, `openTo`, `isPopout`, `scopeId(name)`.

## Rules for building in parallel (several builders run at once)

- **You own your tab's files**: `scripts/ui/AdminPanel/tabs/<Tab>Tab.js`,
  `templates/admin-panel/tab-<tab>.hbs`, `styles/components/admin-panel/tab-<tab>.css`,
  plus any NEW files you create (prefix them by tab). Other files listed in your
  task are yours too.
- **Shared files** (`AdminPanelApp.js`, `utils/constants.js`, `core/SettingsManager.js`,
  `styles/night-city-messenger.css`, `styles/components/admin-panel.css`,
  `init/register*.js`, `utils/helpers.js`): ONLY small targeted edits with the
  Edit tool (it refuses a stale read — re-Read and retry). NEVER rewrite a shared
  file with Write, sed -i, or a node script — another builder may be editing it.
- **Do NOT edit `CLAUDE.md`** — put a ready-to-paste CLAUDE.md section in your final
  report; the lead integrates docs.
- **Template context keys must be namespaced** (`ctx.<tab>2 = {...}` or similar):
  AdminPanelApp spreads every tab's context into ONE object, so a generic key
  (`list`, `selected`, `filter`) collides with another tab's. A tab's context must
  still be SPREAD by AdminPanelApp (it already is).
- **Class prefixes**: new CSS uses a fresh prefix (check `grep -rn "\.ncm-<prefix>" styles/`
  first — the class-collision gotcha in CLAUDE.md). Suggested: `ncm-sec2-`,
  `ncm-net2-`, `ncm-ct2-`, `ncm-msg2-`, `ncm-term2-`, `ncm-sh2-` (the mocks use these).
- **Preserve every existing capability** of your tab. List what moved where in your report.
- **Do not commit, do not touch git.** Do not run Foundry.

## Verification you must do before reporting

1. `node dev/tools/check-syntax.mjs` (0 broken).
2. Handlebars block balance for every .hbs you touched (CLAUDE.md "Verification").
3. A sim `dev/tools/sims/test-admin-<tab>.mjs` that drives the REAL tab methods
   (prototype.call with mocked globals, like the other sims) and asserts: every
   `data-op` the template uses is handled by `onAct`, every context key the
   template reads is produced, every CSS class the template uses is styled, and
   the key behaviours (filters, edit-in-place save path, guards).
4. Render the REAL template through Handlebars against the real cascade in headless
   Chrome (see `dev/mockups/admin-security-preview.html` for the pattern: fetch the
   real .hbs, register partials, mocked context) at 820px AND the 1120px pop-out,
   dark + clean-light, and LOOK at the screenshots. Fix what you see.
5. `node dev/tools/sims/test-helper-collisions.mjs` and `node dev/tools/sims/test-world-picker.mjs`
   still pass (they guard templates/pickers).

## Final report (keep it tight)

What you built, what moved where (old feature → new home), what you could NOT do
and why, files touched, verification results, and a CLAUDE.md section to paste.
