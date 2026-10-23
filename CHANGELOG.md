# Changelog

All notable changes to Night City Messenger. Versions follow `MAJOR.MINOR.PATCH`:
patch = fixes, minor = new features, major = breaking changes.

## [Unreleased]

### Added
- **Paste hygiene for Documents and message bodies.** Pasting from a Foundry journal, Word, a web page or a PDF into a shard Document paragraph or a message body no longer brings the source's colours and fonts with it (the "black text on a dark shard / white blocks" report). Headings become new sections, lists and images become their own blocks, and hard-wrapped PDF lines are rejoined into paragraphs. An Undo strip appears after every paste, with **Split into N blocks** when several paragraphs landed in one.
- **Import from Journal** under the Document body: pull a whole journal page in as blocks (Replace or Append).
- A per-block **split paragraphs** tool in the Document editor.

### Changed
- Development material (tools, sims, mockups, design notes) moved under `dev/`; `docs/` now holds only the Getting Started guide, which ships in the release again.
- `module.json` carries `manifest` and `download`, so the module installs and updates from the GitHub release URL.

### Fixed
- Document list items were rendered without escaping (a typed `<3` broke the list).
- The Document page background stayed near-black under the light admin preset.
- The Document editor's heading looked different from the viewer's (white while typing, accent when displayed).
- Mail bodies had no viewer styling for headings, quotes, code, rules, lists or tables.
- The terminal flattened message bodies to plain text, losing bold and lists that the Agent and shards kept.
- The Agent composer's monospace tool wrote a theme-ignoring literal colour.

## [1.3.2] — 2026-10-22

### Fixed
- Admin → Contacts **Groups** card rendered empty (the tab context was cherry-picked instead of spread), which also made Push unreachable.
- The shard breach dialog clipped its Execute/Abort buttons at 120% Text Size.
- The player's group editor opened with the admin theme instead of the player theme.

## [1.3.1] — 2026-10-21

### Added
- **Contact groups**: named lists of contacts on a character or in the GM's master directory; one chip sends to the whole crew. Reply All, group threading, GM push to players, export/import, Mass Broadcast to a group, Activity-feed collapse of a fan-out, Orphan Audit of dead members. Player panel is a rail of group chips with a member tray.
- **Shards players don't own**: every state write a player's hack causes relays to the GM, so a shard attached to a message needs no ownership change. Per-shard **Player Editing** rule (locked / maker only / anyone qualified), **re-encode** of existing shards, and a **Permissions** button in Admin → Shards.
- Player-facing dialogs scale with the Theme Customizer's Text Size.

### Fixed
- Role icons on contact cards were invisible (bare glyph class without the Font Awesome family).
- A Handlebars helper-name collision rendered `NaN` in the group tray.
- Composer: multi-recipient sends used to fail with "Recipient not found"; players now get the real delivery outcome (or a Queued state) instead of a premature "Delivered".
- Browser password managers offered the Forge login on in-fiction login screens.
- Simple Calendar dates read one day behind.

## [1.2.2] — 2026-10-18

- Distribution housekeeping (Discord-only build).

## [1.2.0] — 2026-10-18

### Added
- **Shard integrity rework**: visible corruption (cosmetic garble that preserves the real text for copy and screen readers), per-type data loss in mechanical mode, repair and salvage, GM damage tools.
- **Composer network picker**: players switch network from the composer; the GM can send *via* any network for one message and backdate or schedule it.
- Getting Started guide.

### Fixed
- Composer network pill and the time picker follow the admin theme.

## [1.1.0] — 2026-09-10

### Changed
- **Module id renamed** `cyberpunkred-messenger` → `night-city-messenger`, carried by a one-time world migration (prompted on first load, verifies every copied flag before removing the legacy one).

### Added
- Shard Encoder (player-facing shard and program authoring), shard authoring gate, shard theming rework, boot splash, Factory Reset, Malware Workshop and Program Deck, the player→machine arc (upload/forge, trace and heat, residents, netrunning resolution modes, Admin Security tab), terminal platform (method-card auth, delivery mirror, folders, login styles, sound sets, scene pins, exfil consoles, Admin Terminals manager), the 18-type content catalog with WYSIWYG authoring, anonymous send, GM Admin Panel theme, centralized UI sounds, embedded media.
- Several tester rounds of fixes (admin text size, recipient resolution, player-character enumeration, hard-delete reporting, directory names beating actor labels).

## [1.0.0] — 2026-04

- Initial public release.

[Unreleased]: https://github.com/christinophrappuccino/night-city-messenger/compare/v1.0.0...dev
