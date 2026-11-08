# Changelog

All notable changes to Night City Messenger. Versions follow `MAJOR.MINOR.PATCH`:
patch = fixes, minor = new features, major = breaking changes.

## [2.3.3] — 2026-11-08

### Fixed
- **Saving a caller from a call and adding them from mail made two contacts.** Save from a call now links the contact to the caller, and Add from mail adds the email to a contact who already has that number.

### Changed
- **Clearer caller ID choices (Phone → Numbers → Line types).** "Their screen shows" now reads Their name, to everyone / Their name, only if saved / A name you set / Only the number / Where it is / Nothing. "A trace finds" reads Who holds it / The name you set / Where it is / The number only. Nothing about how calls behave changed.
- **The GM guide has a tip** for setting up line types like real phones (a standard line shows its name to everyone; a burner shows "Unknown").

## [2.3.2] — 2026-11-07

### Added
- **Payphones: Call from it…** The GM can call out from a payphone to any character, NPC or other payphone, or type a number. The other end sees the payphone.
- **Payphones: Number → Change…** Pick the district and the last four digits of a booth's number. Another now keeps the booth's own district.
- **Call log: Add number.** When a call comes from someone who is already a contact, one button adds the number to that contact. Otherwise Save comes filled in with the name and picture from the call.

### Fixed
- **A trace added TECH with Role Ability set to Rank Only.** Interface now counts as a Role Ability for everyone, rank 0 for a non-Netrunner.
- **A successful trace on a withheld call showed nothing, or showed it late.** A trace now always answers, with a "Trace result" card in chat: a regular line gives the name and number, a burner the number only. Only a special number set to a dead end gives nothing.
- **A traced burner still showed the caller's name** in the call and the log. They now show only what the trace found.
- **The call log showed only the number after an NPC call.** It shows the name and picture the call screen showed.
- **Voicemail greetings were cut off** for the caller. A read-out or recorded greeting plays to the end before the tone.
- **"Looks right" on Phone → Numbers → Needs you came back** after a reload. It is saved now.
- **A window could stay stuck to the cursor after a resize.**

## [2.3.1] — 2026-11-06

### Changed
- **The guides cover 2.3.0.** The GM guide explains Call history, Select on the Call log and Voicemail, and New corporation. The Player Guide explains Select and Trash in the inbox.

## [2.3.0] — 2026-11-06

### Added
- **Call history (Admin → Phone, on Calls and on Voicemail).** Write the calls and voicemails a character had before play. Each call is a whole call, From → To: pick either end from your characters and NPCs, or write in any name and number. Add what was said line by line or paste a script ("Name: text"), and set the network, where it was made, a withheld number, a drop reason and who overheard it. A written call shows in both people's logs, and a voicemail lands in the recipient's Voicemail as a real one (typed, read aloud or recorded).
- **Many calls at once.** Keep adding (each new call starts an hour earlier), "Same call to others too", Fill in a week, and CSV import with a plan you check before anything is written.
- **The Call history list shows everything in the person's log,** calls from play too (copy one to write a call like it, or delete it from both ends). Search, Show (incoming, outgoing, voicemail, missed, has a transcript…), Group by date or by person, a date range, folding groups, and Show more.
- **Select on the Call log and Voicemail lists (Admin → Phone).** Tick rows (Shift-click for a range) or select all, then delete, or mark voicemails heard or new.
- **Select in the inbox.** A Select button ticks messages (Shift-click for a range, Select all covers every page), then Move to Trash. A strip says how many went and where Trash is, with Open Trash and Undo. In Trash: Restore or Delete forever. In Spam: Not spam.
- **New corporation.** A button on Phone → Numbers → Corporations, and Places → Add → A corporation. Add a place has a Category.
- **Line types can show the caller's picture to strangers** (the name stays hidden).

### Changed
- **The caller's picture shows more often.** A contact saved from mail is matched by email as well as number.
- **Call logs and voicemails sort by game time.**
- **The payphone Grit and Wiring sliders are full width,** with their value shown.

### Fixed
- **Line types and Corporations saved nothing.** Colours, dial, checkboxes, greetings, art and extensions were dropped ("Add just clears the data"). They save now, and a setting that cannot be saved says so.
- **An empty Corporations screen no longer fails to open.**

### Under the hood
- Calls written with the old log editor move into the people's inboxes once (data version 9), checked after the move.

## [2.2.0] — 2026-11-06

### Added
- **Custom routines on network nodes.** The Malware Workshop has a Custom routine under Network, like the terminal one: a description you rule on and, if you want, a macro of yours. Choose when it fires: when it is inserted, the next time someone else jacks in, or both. A jack-in fires it once, and never for the runner who planted it. You get a whispered card when it fires. Sweeps can find it, Patch cleans it, and the Node Inspector shows when it fires and which macro it runs.
- **The call screen can be moved.** Drag it by its picture, its name or the grip at its left edge. Each player's spot is kept on their own machine; double-click the grip to put it back.

### Changed
- **The call screen stays clear of the left side of the screen.** It sits to the right of the scene controls, including an open tool column and any toolbar another module adds there, and below the scene bar.

### Fixed
- **A custom routine uploaded to a terminal by a player now runs its macro.** Since 2.1 the description showed but the macro never ran.
- **Revealing a node's pin also reveals the node.** A pin revealed on its own (from its right-click menu or Admin → Access) left the node hidden, so players who walked up to it were told "There is nothing there." A GM opening such a pin in an older world gets a warning that explains it.
- **The Workshop's summary of a network program** no longer says it fires on a terminal login.

## [2.1.1] — 2026-11-05

### Fixed
- **The name on a call card matches the face.** When the GM answered a player calling an NPC line, the card showed the caller's portrait beside the NPC's own name. It now shows the caller's name, and the line above says which NPC is being called ("Calling Rogue", then "Holocall · as Rogue").

## [2.1.0] — 2026-11-05

Everything since 2.0.7.

### Added
- **Conversations.** Group chat beside mail: plain lines, pictures, shared contacts and numbers, and members who can be added or removed. A conversation sits in the inbox list with the mail. Off by default: switch it on in Module Settings → Systems. GMs watch and step in from Admin → Messages → Conversations.
- **Phone calls.** Numbers, a dial pad, voicemail, call logs, and calls over the scene. Talk out loud, type, or dictate. Calls follow the networks: a dead zone or a downed node drops them, and taps can catch them.
- **Our own number system.** A number says where it was issued. The GM edits the place table, sets what players can pick, and can give numbers in bulk.
- **Corporations and shared lines.** Switchboards, extensions, and voicemail with a real mailbox.
- **Special numbers and line types.** Hidden lines, hotlines, recordings, burners and business lines.
- **Trauma Team and Lawman Backup calls,** with real dice and a countdown. Each has an opening, a tracker, an on-scene banner and an exit. The GM sets their names, pictures, spoken lines and titles. Backup can also change per organization or per Lawman: callsign, extra groups, colour, lights and sounds. The GM gets a toast and a short tone when one is called.
- **Overheard calls.** Write a conversation between NPCs that players can catch.
- **Payphones.** A booth on the map anyone standing at it can call from: the other end and a trace see the place, never the person. Calling one rings its scene, and the first person at it picks up. Wired, so they work in dead zones. The GM styles each booth (style, colours, grit, exposed wiring, graffiti, screen text, sounds) under Admin → Phone → Payphones, and can ring one as an NPC.
- **What players call a payphone** (Module Settings, beside the shard name): any word, such as Public Comm. Players see it on the booth, on calls from one, on its map pins (renamed when you change it) and in messages. GM windows keep saying "payphone".
- **Search, filters and date folds on every call log and voicemail list.**
- **Watching another player.** A player can share a terminal, shard or node window, and others watch a live copy.
- **A roll panel.** Shows the formula, the DV, your chance, and Luck before the die moves.
- **Network programs in the Workshop,** with Install on a shard from the library.
- **Sharing a contact's address, number or both.** Who knows whom shows them separately.
- **NPCs have their own contact lists.** "Who X knows", and Share with… lists NPCs too.
- **Typed calls, transcripts, voicemail with typed or recorded greetings, recorded voice, and dictation** (the browser's speech recognition, with a consent notice).
- **Calls on the network.** Drops with a reason (dead zone, jammed node, changed network), withheld numbers that a Trace can reveal, and taps that catch answered calls.
- **A call log editor** for any line or terminal account: add, edit or delete entries, fill in a week, CSV.
- **A phone button in the scene controls.**
- **Every NPC has an inbox the GM can read.** The GM's Identity drawer has Switch inbox, and Character Select has an NPCs section, including NPCs with no sheet.
- **Admin → Messages → New is a menu,** with Message as an NPC inside it.
- **Switch whole systems on or off** (Module Settings → Systems): Conversations, Calls, and the three parts of Calls (Payphones, Emergency lines, Overheard calls). A system that is off is not loaded at all, and nothing is deleted.
- **Simple network mode** (the Network simulation switch): every scene is on CitiNet with full signal, with no dead zones, logins, restricted mail or network nodes.
- **A Trace consequences switch.** Heat, the GM's trace alert and the player's trace splash can be turned off and on at once, with no reload.
- **Module Settings are in sections** (Systems, Mail, Email addresses, Anonymous send, Spam filter, GM alerts, Shards & terminals, Date & time, Advanced) instead of one long list.
- **The startup report.** If part of NCM fails to start, the GM gets one notice that names it and says what stopped working.
- **For module authors: public API v2** (`game.modules.get('night-city-messenger').api.v2`, documented in `docs/API.md`). Every call answers `{ ok, data }` or `{ ok: false, code, error }`. 2.1.0 adds GM writes (directory add, update and push to a player, group push), placing calls and reading call logs, and setting a scene's network. The v1 fields still work.

### Changed
- **A tie now fails.** On forge and encode rolls, a tie lands on the sloppy rung.
- **Interface rolls Rank + 1d10 by default.** A world with saved Interface DVs is asked once what to do with them.
- **When the GM decides a roll, players see no DV or chance.**
- **Moves follow the book's table.** The sliding DV reduction and the bonus move for a big margin are off unless the GM turns them on.
- **Rolls follow the chat box's roll mode** (public, GM, blind or self), for the Dice So Nice dice and the chat card.
- **Every NCM dialog uses Foundry's newer dialog window.** It looks and behaves the same, and keeps working when Foundry removes the old one.
- **The trace log and network access log moved to a GM-only journal**, as did the recycle bin. Players no longer download them every time they log in. They are moved across once when the world loads, and the old copy is emptied only after the move is checked.
- **The Items sidebar's right-click entries** (Open, Configure, … options ▸, Convert) are part of Foundry's own menu now, and "options ▸" opens just under the item.
- **The admin panel's keyboard tooltip names what each number key opens.** It said "in the order shown", but Phone has no key, so from 5 on every key opened the tab after the one you counted to.
- **Forward is on by default for new terminals.** Terminals that saved it off stay off.
- **Old phone numbers are cleared on upgrade.** They were free text from before the number system.
- **Needs a reply is a list.** One line per NPC and the identity they wrote to: who is waiting, for how long, and the last thing they wrote. **Reply** opens the composer as that NPC or alias, to everyone waiting; the inbox button opens the NPC's inbox at the message; ✓ marks it answered. Search, four sorts, grouping by NPC or player, a page at a time, and the answered lines folded at the bottom. The thread, persona panel and inline reply box are gone (the NPC's own inbox and the composer do that job).
- **The Agent's header has fewer buttons.** Compose has a ▾ with New conversation; a player's ⚙ ▾ holds Settings & theme and the Player guide.
- **The Messages filter row is shorter.** Drafts, Scheduled, the exfil folder, Spam and Trash are behind **More ▾**, which shows a red count when Spam or the exfil folder has something unread. The folder you open shows as a chip. **Mark all read** is a strip under Unread.
- **My line's tools are icons,** and the ? sits beside the label.
- **The inbox footer follows the tab.** Calls lists / Dial · Enter Call · Esc Close (/ jumps to the number box, Esc closes the directory); Chips lists / Search · ↑↓ · Enter Open, and the search box now searches chips by name or sender. The top search box is gone from Calls, whose log has its own. A Chips filter pill no longer resets when the list redraws.

### Security
- **Players can no longer pretend to be the GM or another player** in the messages NCM sends between browsers. Foundry's server now confirms who sent each one.
- **A player can no longer make the GM's browser run a macro.**
- **Every player request the GM acts on is checked:** who is asking, whether that character is theirs, and whether they can reach the shard, terminal, account or node. The GM works out what a player's action does instead of accepting a result the player sent. This covers shard hacks, terminal downloads and sessions, mail, scheduling, contact sharing, traces, network nodes, call logs, emergencies and netrun results.
- **Names, subjects and other text players type can no longer run script,** wherever they appear: toasts, tooltips, GM dialogs, the admin panel, chat cards, stored mail and shard entries, and watched windows.
- **Stored mail and shard text keep their formatting,** but scripts, `javascript:` links and dangerous styles are removed when shown.
- **Mail a player sends is checked again by the GM before delivery** (send-only addresses, "must be in the directory"). In a group send, only the refused people are dropped, and the player is told who and why.
- **A payphone hides its caller on screen.** Whoever answers sees the booth, not the person on it.

### Fixed
- **The phone directory filled the whole Agent and could not be closed.** It covered the header, whose buttons sat over its Close. It now opens inside the Calls area.
- **The phone directory was white on white.** The Cyberpunk RED system's button style won over its tabs and rows, and its search box had no style at all.
- **The ? on My line was clipped by the card's corner** once Text Size went above 100%.
- **The Call button covered the keypad's bottom row** (7, 8, 9 and 0) at the Agent's normal size, worse with a second line or Call for backup. The button no longer floats over the pad; a tall dial column scrolls instead.
- **The inbox's Dates / Sort / Filters row ran off the message column** once a date range was set. It wraps now, and Filters is no longer the only one in capitals.
- **Held mail survives a reload.** Mail queued in a dead zone or with no GM online used to be lost when the page reloaded, along with any eddies taken for it. If held mail is refused when it finally sends, the player is now told why.
- **Add on mail from an alias saved the main address.**
- **Scheduled mail to several people read "Unknown".** Edit also lost its recipients and settings.
- **Cancelling or editing scheduled mail lost the eddies on it.** It now refunds them.
- **Refused scheduled mail retried forever without saying so.** It now stops, refunds and shows in Outbox.
- **A timed self-destruct on scheduled mail could arrive already expired.**
- **A player's To search showed addresses they had not been given.**

**Other modules and Foundry**
- **The token HUD's elevation box was locked for everyone.** NCM's `or` / `and` template helpers replace Foundry's for every template, and they gave the wrong answer inside a subexpression. They now answer exactly like Foundry's.
- **Grid Scaler (and other modules) opened instead of the messenger** from the scene controls. NCM's button group now has its own layer.
- **NCM no longer fails to start on a slow host:** everything it sets up at startup is in place before the game loads. Its templates no longer depend on helpers other modules can replace.
- **Dragging a terminal or shard to the hotbar works with the Cyberpunk RED system,** and a terminal's item sheet opens the terminal.
- **Map notes are switched on once per user,** instead of coming back on at every load.
- **Dragging an item from inside a compendium no longer throws an error.** Chat-card buttons work in a popped-out chat log.
- **NCM's stylesheet no longer styles other modules' elements.**
- **A phone preview no longer changes `game.user.isGM`** for the rest of the session.

**Mail**
- **With two GMs logged in, mail, traces and plants no longer happen twice.** One GM handles each request.
- **A message sent while the GM's answer is slow is no longer delivered twice or refunded too early.** With no answer it is held, not failed, and goes out shortly after a GM connects.
- **Scheduled mail:** the delivering GM confirms adding, cancelling and editing, and eddies come back only once that is confirmed. A player's scheduled mail obeys the player's rules when it is delivered.
- **The broadcast icon in Admin → Messages shows again.** Low-signal garble and the Reconstruct roll apply again, to a player's sends only. Tapped conversations keep their running log.
- **Taps, exfil copies, tap logs and files no longer pop a "new message" toast,** and a second GM is no longer toasted for every player's mail.
- **Saving one field of a message no longer re-sends the whole record,** so an out-of-date copy can't undo a just-claimed eddies payment or a just-read flag.
- **Rich text keeps the space between two formatted words** ("**Hello** *world*" no longer becomes "Helloworld").

**Contacts and identities**
- **Changes to the GM directory reach every client without a reload.**
- **Deleting an NPC's main identity makes one of its aliases the new main,** so the aliases' mail still has a home. Mail to a deleted character reaches its directory entry.
- **If the sender's sent copy can't be saved, the GM is told.**
- **Contact-list changes from different places** (sharing, phone numbers, the contact manager) no longer overwrite each other.
- **Sharing an alias never gives away its main person or number.**

**Shards, terminals and programs**
- **No money or program charges are lost when no GM is online:** siphons, eddies claims and program runs are refused instead.
- **A program spends one charge each time it runs;** one with no charges set runs once.
- **Destroying an archive copy of a shard no longer wipes the player's real shard.** Purging a real shard also unconverts its archive copies.
- **Backdoor accounts and timed programs on terminals carried by a character now expire and fire,** not only on terminals in the Items directory.
- **Lockouts and failed tries survive a reload.**
- **The Shard Encoder handles two conversions at once.**
- **Shard and terminal badges keep fixed colours** on sheets and in the Items directory, whatever the player's theme.
- **Simultaneous terminal logins no longer overwrite each other.**
- **Workshop programs:** descriptions save and show; custom malware stays Custom and keeps its macro; program settings reach the effect (Backdoor's username and duration work); "After an action" and "On a date" triggers fire; "What a scan reports" is stored and shown, and Analyze can expose disguised malware; Wipe and Corrupt ask which files; other payloads run when pushed; a full shard is reported instead of claiming success.
- **Setting a shard's price or unconverting it no longer loses the GM's answer** when two requests cross.

**Calls and payphones**
- **When someone disconnects, their calls end on every client** and their payphone is freed.
- **A payphone caller can leave voicemail,** and only the person who answered can talk into a call.
- **The booth's handset cord reaches the handset in the Foundry desktop app.** Hanging up puts the handset back and no longer reopens the booth. Key tones play, and long numbers no longer push the dial pad aside.
- **A ringing payphone's bell stops by itself** once the call ends.
- **The Admin → Phone call log and voicemail were always empty.** They fill in now, and update live.

**Admin panel and performance**
- **The unread badge no longer creates empty inboxes.** Orphan Audit lists empty ones and deletes them only if you tick the box, and also repairs aliases whose main was deleted and contacts linked to a deleted character.
- **Admin → Messages and the GM's inbox roster no longer rescan every page in the world on each redraw.**
- **With two GMs online, they no longer erase each other's network access log entries.**
- **Admin → Tools → Force Refresh does what it says:** every client re-reads NCM's contacts and redraws its open NCM windows.
- **Create Network opens again,** and windows no longer stack duplicate listeners on each redraw.
- **Watched windows no longer flood the network** while they animate.
- **The weak-signal wave redraws about 12 times a second instead of 60,** and stops while the inbox is minimized or motion is turned down.
- **Cut corners keep their border** on toasts, terminal tabs and rows, inbox postmarks and the ICE hexagon.

### Under the hood
- Ready for Foundry v13: moved Foundry functions go through one compatibility file, and NCM runs cleanly in a v13 test world. Cyberpunk RED data is read through one file, so a system update is a one-file fix.
- Every check (syntax, file-name case, about 170 simulations) runs automatically before every dev build and release, once as Foundry v12 and once as v13.
- A dev channel: every change to the dev branch publishes a test build on its own manifest, which never reaches normal installs.

## [2.0.7] — 2026-10-31

### Added
- **Players can send from their aliases.** If your GM has given your character an alias, click your portrait in the inbox and pick the address under **Sending as**. New messages go out from it until you change it, and an **ALIAS** tag shows on the composer's From line. To change it for one message, click your name at the top of the composer. Replies still go out from the address the mail reached. Players pick between aliases; the GM still creates them.
- **A Player Guide.** A short, spoiler-free PDF covering mail, aliases, contacts, shards, terminals, nodes and themes. It opens from the **?** button at the top of a player's inbox and from **Player Guide** in the panel behind their portrait. The GM guide's player section now points to it.

### Fixed
- **Open Mailbox asked a GM to set up email.** Picking a character on the Character Select screen asked for email setup even though the same inbox opened fine from the Admin Panel. A GM is no longer asked, and **Require Email Setup** now applies on that screen.
- **Players were asked to register an address they already had.** An address the GM gave a character could still trigger the setup screen. Any address on the character, or on its linked directory contact, now counts. A burned address doesn't.

### Changed
- **The button beside your address is now a flame.** It always burned the address permanently, but a pencil made it look like an ordinary edit. If you have aliases, its warning now also points you to **Sending as**.

## [2.0.6] — 2026-10-30

### Fixed
- **Containers, demons and Black ICE could be picked as a character.** Biometric Handoff offered any of them a player owned, and they could also appear in the viewer's character list, the composer's To search and Send as, Spam recipients, the contact share list, the GM's link pickers and the default actor when nobody is selected. They no longer appear in any of these.
- **Hidden characters still showed in a few places.** The contact share list, the node inspector's Pick a character and the default actor now leave them out too.

## [2.0.5] — 2026-10-30

### Added
- **Hidden Characters.** Admin → Tools → Hidden Characters (or Hide on a character in Contacts → Players) keeps vehicles and other player-owned actors that aren't people out of the character lists: Who knows whom, Players, broadcasts, recipient pickers, and the players' own character pickers. Their sheet, mail and contacts are untouched, and you can untick them any time.

## [2.0.4] — 2026-10-30

### Fixed
- **Restricting a terminal entry to specific networks did not stick.** Editing the entry again showed no restriction, and saving it wiped the restriction. It now stays, from both the terminal and Configure Terminal → Accounts.
- **Editing a terminal message from the terminal moved it back to the Inbox.** It now stays in its folder.
- **The network tag in Security & Access looked broken.** It was a bare name over a default button; it is now a compact tag with a small ✕. Picking a network adds it and switches Restrict on, removing the last one switches Restrict off, and your picks survive changing the entry type.
- **Network Reachability on terminals did not do what it appeared to.** With the access mode on `any`, ticked networks were ignored; on `type`, nobody could get in. The choices are now **Any network** and **Only these networks**, and the list only shows when it applies. A terminal saved as `type` now follows its ticked networks. A terminal saved as `any` stays open to every network until you change it to Only these networks, so no one is locked out mid-campaign.
- **The terminal's network gate.** Clicking a secured network now opens its login (it did nothing); denied networks can't be clicked; it lists every allowed network and only says "secured" when one is; and it lifts by itself when the player switches to an allowed network from their Agent. It is only checked on the way in: leaving the network later does not log anyone out.
- **A shard's Min Signal of 0 saved as 40.** It now stays 0.

### Changed
- **New warnings** when a terminal entry or network-gated account is set to a network the terminal has no Machine Uplink for, or to no network at all. Players could never have seen it, and nothing said so. Configure Terminal → Network warns when Only these networks has nothing ticked.
- **Signal threshold is gone from Configure Terminal.** It never did anything on a terminal.

## [2.0.3] — 2026-10-30

### Fixed
- **Sharing one address of a character marked all of their aliases as shared.** Every alias of a character is linked to that character, and "who knows this contact" matched by the character — so after sharing the main address, Admin → Contacts showed the player as knowing every alias (Who knows them, Players → Who they know, the map and the table). A player's contact now stands for the one address they were given. Hovering a player in Who knows them says which address they have.
- **Sharing an alias with a player who already had the main address did nothing.** It was treated as a duplicate of the main. It is now added as its own contact, and taking an alias back leaves the main address alone.

## [2.0.2] — 2026-10-29

### Fixed
- **Security → Hacking rules lost unsaved edits.** The page repainted itself in the background every 30 seconds (and on clock and log changes), which put every card back to its saved state: adding a second role snapped Terminal operator access back to Anyone, and new skill rows or DVs on the other cards vanished. The rules page no longer repaints by itself, saving one card no longer wipes edits on another, and a card with unsaved changes says "not saved" in its header.
- **Saving a rule card now says so on the card** ("Saved", or the reason it failed). A failed save of Terminal operator access used to show nothing at all; the usual notification can also wait behind permanent warnings, so it was not proof.
- **The Admin Panel tab bar slides instead of jumping when you switch tabs.** When the bar is too narrow for every label, the tabs outside your current group fold to icons; moving to another group used to snap the bar into its new shape. The labels now slide closed and open.

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
