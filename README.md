# Night City Messenger (NCM)

In-character messaging, data heists, and hackable machines for **Cyberpunk RED** on **Foundry VTT v12**.

Every PC gets a diegetic **Agent** — a themed in-fiction phone/inbox — and the world gets things to point it at: NET addresses on scene-based networks, encrypted data shards to crack, terminals to log into, files to steal, and programs to leave behind. The GM runs it all from a single admin panel.

> **Module ID:** `night-city-messenger` · **System:** [Cyberpunk RED Core](https://foundryvtt.com/packages/cyberpunk-red-core) · **Foundry:** v12

---

## Features

### Messaging — the Agent
- Per-character inboxes with a fully themeable cyberpunk UI (presets, custom palettes, fonts, wallpaper, contrast, scanlines — per player).
- Composer with rich text, attachments, embedded audio/video, priorities, eddies transfers (real CPR wealth-ledger money, claimed by the recipient), encryption/network gating, and self-destructing messages.
- Conversation threading with a full-transcript view, smart subject grouping, forwards that stay connected.
- **Anonymous send** (GM): masked sender identities players can attempt to trace-to-unmask with a skill check.
- Unknown-sender **spam filter**, GM spam generator/templates, and per-network auto-spam.
- Scheduled messages, broadcast mail, GM notifications for player→NPC traffic, NPC inbox triage.

### Contacts
- Player contact books (trust, tags, notes, favorites, ICE-protected entries that must be breached) + a GM **master directory** that pushes contacts to players.
- Send-only system addresses, contact verification gates, actor-linked portraits.
- **Contact groups**: named lists on the player's Agent or in the GM directory, pushed GM→player, one chip in the composer that fans out to everyone (per-recipient copies, Reply All, broadcast-to-group).

### Networks
- Scene-based network availability, dead zones, signal strength — the Agent only sees what's reachable.
- Secured networks with password / skill-check / key-item auth (AND/OR logic), lockouts, and Black ICE that bites on failure.

### Data Shards
- Convert any Item into an encrypted **data shard**; players hack them open with real CPR skill checks (animated breach sequence, lockouts, ICE).
- 18 authorable content types that each render like the app that made them: spreadsheets, camera feeds (with PTZ + loop/cut heists), bank accounts (siphonable), documents with redactions, chat logs, dossiers, schematics, syslogs, credentials vaults, calendars, payloads, malware, and more.

### Terminals
- Convert an Item into a **machine you log into**: multiple accounts (hidden ones included), six login-screen styles, per-terminal themes/sound-sets/boot sequences, its own network uplink.
- Account mailboxes with custom folders, file-vs-mail envelopes, per-entry security, and a full **exfiltration** policy (download / burn to shard / forward / leak / sell / wipe — each optionally skill-gated).
- Drag a terminal onto a scene to place a **map pin** players double-click to jack in. Login footprints are recorded per machine.

### Netrunning-adjacent play
- **Upload / forge**: carry forged files or programs to a breached box and leave them behind — a forge-check ladder decides clean / sloppy / rejected.
- **Malware Workshop** (GM): a synthesis-chamber UI for building programs — real module-native effects (keylog, backdoor accounts, ICE traps, logic bombs, wipes, corruption), disguises, triggers, and a reusable program library. Players inspect and run programs through the **Program Deck**.
- **Trace & heat**: failed hacks feed a per-operator heat system with a GM activity log, escalation tools (lockouts, ICE strikes, countdown timers), a player-facing trace HUD, and counterplay (ANALYZE, SYSTEM SWEEP).
- Three table-selectable **netrunning resolution modes**: auto-roll, auto-roll + NET-action card to the GM, or full GM adjudication ("run the NET at the table, then call it").

### GM tooling
- One **Admin Panel** (9 tabs): overview, messages, contacts, networks, shards, spam, terminals, security, tools — with its own clean theme, separate from the player look.
- Ready-made macro compendiums (player + GM), a scoped message purge, journal reorganization, orphan audit, JSON import/export for templates/terminals/themes/spam/programs.
- A **time provider** so timestamps, countdowns, and expiries follow real time, world time, Simple Calendar, or a disguised in-fiction clock.

---

## Requirements

- **Foundry VTT v12**
- **Cyberpunk RED Core** system (skill checks, wealth ledger, role items, and Black ICE actors all use real CPR data)

## Installation

**In Foundry:** Setup → Add-on Modules → **Install Module**, paste the manifest URL into the field at the bottom, and click Install:

```
https://github.com/christinophrappuccino/night-city-messenger/releases/latest/download/module.json
```

Foundry then offers every new release as an update. Enable **Night City Messenger** in your world's module settings.

**By hand:** download `module.zip` from the [latest release](https://github.com/christinophrappuccino/night-city-messenger/releases/latest) and unpack it to `Data/modules/night-city-messenger` (the folder name must match the module ID exactly).

Release notes live in [CHANGELOG.md](CHANGELOG.md).

> **Known console warning:** Foundry v12 prints a deprecation warning about NeDB compendium packs (`.db` files) — this is harmless and expected; the macro packs will migrate to LevelDB in a future release.

## Quick start

1. **GM:** open the **Admin Panel** from the scene controls (or `game.nightcity.openAdmin()`). Set up networks, the master contact directory, and email domains from there.
2. **Players:** open the messenger from the scene controls — pick a character, get a NET address, start messaging.
3. **Macros:** Admin Panel → Tools → **Import / Reinstall Macros** installs ready-made player and GM macro folders.
4. **Content:** right-click any Item → *Convert to Data Shard* or *Convert to Terminal*, then author entries with the built-in composer (18 content types, live preview, templates and examples included).

## Three rules that prevent false bug reports

- **A GM must be connected for player actions to stick.** Almost everything a player does (claiming eddies, decrypting, siphoning, uploading) writes to GM-owned data and *relays* to the GM's client. No GM online → the action silently does nothing. That's the security model, not a bug.
- **Players act as their OPERATOR.** The OPERATOR chip (terminal login screen / mailbox HUD) picks which character rolls, pays, and gets paid. Wrong character selected → money lands on the wrong PC.
- **"The button does nothing" is usually a gate, not a bug.** Many actions are gated — by module settings (spam filter, contact verification, netrunning resolution), by per-object config (exfil policy, operator access), or by who's allowed to operate. Check the setting before filing.

## Documentation

- **[Getting Started guide](docs/GETTING-STARTED.md)** — first-time setup for GMs and players, the feature tour, and a first-session recipe. **Start here.**
- `CLAUDE.md` — full architecture reference (systems, data layout, conventions, gotchas).
- `dev/design/TERMINAL-EXPANSION.md`, `dev/design/UPLOAD-FORGE-TRACE.md`, `dev/design/THREAD6-MALWARE-MODEL.md` — design docs for the terminal / upload / malware arcs.
- `dev/design/TEST-SCRIPT.md` — the manual playtest script.
- `dev/` — development material, never loaded by Foundry and never in the release zip: `dev/tools/` (macro pack generator, i18n audit, logic sims, world-seeding test macros), `dev/mockups/` (design mocks and render probes), `dev/design/` (design documents), `dev/guide-export/` (the guide as HTML/PDF).

## License & credits

- **Code, templates, and stylesheets:** [MIT](LICENSE).
- **Fonts** ([Rajdhani](https://fonts.google.com/specimen/Rajdhani), [Orbitron](https://fonts.google.com/specimen/Orbitron), [Share Tech Mono](https://fonts.google.com/specimen/Share+Tech+Mono)): bundled under the [SIL Open Font License 1.1](assets/fonts/Rajdhani/OFL.txt).
- **Sound effects:** most are from the [Future UI](https://www.shapeforms.com/shop/p/future-ui-sound-effects-library) sound library by **Shapeforms Audio**, used under its royalty-free license. They ship as part of this module only — do not extract or redistribute them as standalone audio assets. See [`assets/sounds/CREDITS.md`](assets/sounds/CREDITS.md).

## Disclaimer

Night City Messenger is unofficial fan content for tabletop play. **Cyberpunk RED** is © R. Talsorian Games; this module is not affiliated with or endorsed by R. Talsorian Games or CD Projekt, and reproduces no book text, stat blocks, or rules tables.
