# Changelog

All notable changes to Night City Messenger. Versions follow `MAJOR.MINOR.PATCH`:
patch = fixes, minor = new features, major = breaking changes.

## [2.0.1] — 2026-10-29

### Fixed
- The first v2.0.0 download contained the 1.6.0 code. 2.0.1 is the real 2.0 release — everything listed under 2.0.0 below.

## [2.0.0] — 2026-10-29

A big one. Nothing in an existing world breaks: no settings are lost and no data is rewritten.

### Added
- **Network nodes.** A node is a router, relay, mast, junction box or antenna that carries a network into a scene (Admin → Networks → a network → Nodes). A scene with nodes only gets that network while one of them is up; switch them off, jam them or damage them and the network goes dark there — players are moved off it (or queue their mail), machines go local-only. Nodes are optional.
  - **The node console** (players): signal, state, alert, live traffic; Connect, and **Jack in** — a skill roll (Interface by default) behind a three-ring lock, then a session of **moves** by rank: switch it off/on, **jam** it, **tap** it (mail sent from that scene lands in your inbox), open a **backdoor** (skip the network's login), **insert a shard** of network programs — **worm** (spreads to other nodes), **tap**, **blackout bomb**, **sniffer**, **patch** — **system sweep** for what others left, **wipe your log line**.
  - **Jacking-in rules** (Security → Hacking rules → Jacking in): who can jack in (anyone / the terminal operator rule / chosen roles and skills), skill and DV, what rank unlocks, eases and gives, each action's DV, failure costs. Saved sessions: jacking out and back in, or a refresh, keeps the moves you spent. A failed jack-in counts against the network's own login lockout.
  - **The GM node inspector**: everything on a node with a control on each — the jam, infections, taps, backdoors, runners (give a move back, **kick** with damage and a lockout), lockouts, the full log — and **Add your own**: a quest infection (whispers you when a player cleans it), an NPC's tap or backdoor, a jam, a log-line clue, damage.
- **Access points.** Every way into a terminal, shard or node, from one menu: **Place on a scene** as a map pin or a step-on area (shown, or hidden until you reveal it), **Add to hotbar** (or drag it there), **Post to chat** (a card in the thing's colours, yours, or the module's), **Copy journal link** (`@NCM[...]`), **Copy macro code / Make a macro** for trigger modules. **Admin → Access points** maps every way in and lists what players can't reach yet.
- **The Admin Panel, rebuilt** — every tab redesigned, grouped Comms / Net / World, pop-out windows, one colour system, a contrast pass (all text 4.5:1 or better in all three admin themes).
  - **Overview**: one timeline — what just happened above the line, what needs you on it (as chips), timers below — with the clock, the table and quick actions beside it.
  - **Messages**: the **Needs a reply** desk (answer as the NPC, their voice note beside you), **All mail** as a calendar you click into, a journey for every message (where it went, and why not), **Inboxes**, and the **Outbox** (failed, held, scheduled, timers). Junk senders by address.
  - **Contacts**: the directory with filters, an NPC's **Correspondents** switchboard, players and **who they know** (orbit, roles, rack of held groups), groups with pictures, a **who-knows-whom map**, a **voice** note per NPC, a role manager.
  - **Networks**: the **This scene** dial, a six-step network editor, the **Scenes** atlas (your scene folders as shelves with pictures, paint networks onto scenes, pre-wire compendium scenes), the activity log (now with node use and scene moves).
  - **Terminals** as a server rack, **Shards** as cartridges with an integrity track, **Security** as a seismograph and heat thermometers.
- **Roll reveal**: every skill check plays on screen (stat, skill, die, total vs DV) and posts its chat card when it lands; waits for **Dice So Nice**.
- **The composer, cleaned up**: delivery options as chips with one panel at a time, a list of drafts per character, **Preview as recipient**, **message templates**, a searchable **Attach Shard** that takes several at once.
- **Sound board** (Admin → Tools → Sounds): every sound, where it plays, and your own file in its place (upload from the file picker), per-sound volume or off, import/export.
- **Per-skill bypass DVs** on networks and terminal accounts; the operator gate takes several skills; **Role Ability Rolls** setting (stat + rank, or rank only).
- **Countermeasure visibility**: decide whether players see what guards a lock or only that it's locked; an expert can scan.
- Minimize buttons on every NCM window; themed dialogs; mark mail unread.

### Changed
- The Getting Started guide is rewritten for all of the above and ships as a PDF the Overview's **Guide** button opens.
- The Network Manager and the GM Contact Manager windows are folded into their Admin Panel tabs (their buttons and macros open the tabs).
- Macro packs ship as Foundry's LevelDB folders (built at release), so they load on read-only hosts like The Forge.

### Fixed
- **Scheduled messages** failed from an NPC directory contact (or to a contact, several people or a group) — scheduling now accepts what an immediate send does. A player's scheduled message was never saved (now the GM saves it); with two GMs online scheduled mail was delivered twice.
- The macro API's **setNetwork** and **toggleDeadZone** (and the Set Network / Toggle Dead Zone macros) called functions that didn't exist.
- Terminal **Reset** didn't lift a timed lockout on the player's screen.
- Typing in admin search boxes could jumble letters while the tab re-rendered.
- The Netrunner role's Interface rank wasn't read on newer CPR data (it read 0).

## [1.6.0] — 2026-10-26

### Added
- **Admin Overview rebuilt.** It opens on **Needs you**: one ranked list of everything waiting on the GM — player mail an NPC hasn't answered (with **Reply as**), characters running hot or burned, trace countdowns, armed plants, mail sent while impersonating someone, bricked shards, scheduled mail about to go out, players with no address, a dead-zone scene. Every item has its own buttons and filter chips; dismissing one hides it until it changes. Below: **At the table** (each player, their character, online status and the network they're on), a tile per tab, **Recent activity** (saved mail + the Security log, survives a reload), **Coming up** (every timer in one place), the players' characters, and the NPCs players are talking to. Long lists scroll inside their own box.
- **Aliases / identities.** One character — or an NPC with no actor — can have several directory contacts: a main address plus burners and cover names. **+ Add alias** in the GM Contact Manager. Mail to any alias reaches the same inbox, replies go out as the alias that was written to, Send-as keeps the exact alias, and an alias never shows the character's real portrait unless it has its own. Admin → Contacts nests aliases under their main (with an Aliases filter) and Admin → Messages labels mail "alias of …".
- **Terminal ADMIN ACCESS.** An admin account can **View as admin** and browse another account's mail and files. Configure Terminal → Accounts → Admin access: on/off, read-only, include hidden accounts; per-account **Private from admin**. What players see it called (ADMIN OVERRIDE, SYSOP, NETWATCH AUTHORITY…) comes with the theme and can be renamed on the Theme tab. Viewing is logged in the Activity Log.
- **Send mail as a terminal account** (GM switch, Configure Terminal → Accounts → Sending as an account): a logged-in player gets **Write** and **Reply as**; the address book is the account's own correspondents. A player on their own character's machine is just sending their own mail (eddies work). Someone impersonating an account is flagged for the GM: "via <machine> · typed by <character>" on the message in Admin → Messages, it counts as player mail in the NPC Inbox, and it appears in Needs you. The GM verifies every terminal send.
- **An account's existing mail on the machine.** **Import from inbox** on a linked account copies messages from that person's Agent (sent mail into a Sent folder); a **Terminal** button on any message in the GM's inbox copies it to an account. New mail to *and from* that person now appears on the machine automatically; untick **Show this identity's Agent mail here** for a machine that keeps its own mail.
- **What players call a shard** (Module Settings): Data Shard, Memory Chip, Data Chip, or your own word — on every player-facing surface and the item menus. GM windows keep saying "shard".
- **Rename shards** from the right-click menu (shard and item together). **Shard Name Prefix** setting tags every shard's name. Turning a shard back into an item restores its original name and picture.
- **What players can write shards on** (Player Authoring → Blanks): Gear items and listed blanks by default, or listed blanks only, or anything.

### Fixed
- The GM's To search couldn't find a directory contact with no linked actor (it offered "raw address only").
- Replying from a character's alias, or to one, collapsed to the character's main address.

## [1.5.0] — 2026-10-25

### Added
- **Terminal file repository.** A terminal now has a **shared volume** (files on the machine itself, seen from every login) beside each account's own files, and real **folders**. A folder can be limited to **admins**, a **clearance level**, or **named accounts**; locked folders refuse with their reason and their files never reach the player. Players get a **MAIL | FILES** switch in the mailbox with a folder tree and a file listing.
- **Configure Terminal → Accounts holds the content.** Each account (and the shared volume) folds open into **MAIL** and **FILES** tabs: add messages or files straight into a folder, create / rename / delete folders, set who can open them, move files between folders and volumes. Folds animate open and shut.
- **Message or file, made obvious.** The entry composer's Delivery section asks "a message someone sent, or a file on the machine?" up front, and a file picks **Store on** (this account / shared) and a **Folder** from the real tree instead of a typed path.
- **Four mailbox layouts** for terminals: **Classic** (the default), **Tabs** (folders as tabs across the top), **TTY** (one monospace column with a prompt: type a number to open, `m`/`f`, `cd`, `logout`), **Desktop** (icons, one window, a taskbar). Set in Configure → Boot & Login → Mailbox Layout.
- **A theme carries its mailbox layout.** Preset cards bring their own, saved themes remember the layout they were saved with, and theme export/import carries it.
- **Boot video** for terminals and shards: play a video file as the startup screen, with its own audio, for as long as it runs. Click to skip.
- **Custom boot length** in seconds, beside fast / normal / dramatic.
- **One CRT film, redesigned as a pane of glass** over the whole window, title bar included. Four looks (**Off · Glass · Tube · Arcade**), an Intensity slider, vignette and a slow rolling band, plus an **Advanced** panel with one slider per layer (line pitch, light line, cut, softness, RGB grille, glow, fringe, vignette, bloom, sheen, curvature, bezel, band speed, flicker, grain). The same panel is in the Theme Customizer (your Agent), Configure Terminal and — new — **Configure Shard**: shards now have their own film.
- **Accessibility: "Film on terminals & shards"** in Theme Customizer → Effects: As designed / Dimmed / Off. Your own ceiling over every film a GM designed, on your screen only.
- **Address directory export / import** (Admin → Tools → Email Domains & Addresses): export every character and contact address as CSV or JSON, import a file, review the plan, then apply. Email domains export and import too.

### Changed
- Every built-in terminal and shard preset carries a mailbox layout and a CRT film tuned for readability; existing terminals, shards, saved themes and preset libraries are brought down to the new film levels automatically on first load (GM).
- Preset palettes were audited for contrast: 36 text colours lifted so secondary and muted text read on every surface of every Agent, terminal and shard preset.
- Two terminal presets named boot animations that did not exist (they fell back to a plain fade); they now use real ones.

### Fixed
- Boot speed did nothing — every terminal booted for the same time.
- Arasaka (and other red/dark presets) muted text was too dark to read on the boot and mailbox screens.
- A shard sent from a **character's inventory** arrived as "shard not found".
- An NPC sender's address was rewritten to `name@nightcity.net` instead of their directory address.
- The Tabs layout's account switcher was trapped in a tiny scrolling strip; it now opens over the panes.
- TTY had no way to log out or switch account.
- The Desktop layout's account switcher opened far to the right instead of above the account chip.
- Old built-in scanline films kept drawing lines over terminals even with the CRT film off (four of them; all removed).
- The film's lines cut through bright buttons and the active tab.
- "Log out → login screen" in the account switcher had no hover state.
- The Theme Customizer's tabs never showed which one was open.
- Encrypted-message attachments showed dead "Breach" buttons after the message was decrypted.

## [1.4.0] — 2026-10-23

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

[1.4.0]: https://github.com/christinophrappuccino/night-city-messenger/releases/tag/v1.4.0
