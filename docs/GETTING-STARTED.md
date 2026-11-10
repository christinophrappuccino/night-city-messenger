# Getting Started with Night City Messenger

Night City Messenger (NCM) is a big module, but you don't need to learn all of it at once. Start with messaging. Add the other parts when your table is ready for them.

**If you're the GM:** read Part 1 to set up (about 15 minutes). Come back to the later parts when you want them.

**If you're a player:** use the Player Guide instead. It opens from the **gear ▾** menu at the top of your inbox.

---

## Contents

1. [What is this module?](#what-is-this-module)
2. [Part 1 — GM setup](#part-1--gm-setup)
3. [Part 2 — Players: your Agent](#part-2--players-your-agent)
4. [Part 3 — GM: running the mail](#part-3--gm-running-the-mail)
5. [Part 4 — Data shards](#part-4--data-shards)
6. [Part 5 — Terminals](#part-5--terminals)
7. [Part 6 — Ways in: putting things in the world](#part-6--ways-in-putting-things-in-the-world)
8. [Part 7 — Network nodes](#part-7--network-nodes)
9. [Part 8 — Hacking and consequences](#part-8--hacking-and-consequences)
10. [Part 9 — Phone calls](#part-9--phone-calls)
11. [Part 10 — Conversations](#part-10--conversations)
12. [Three rules to remember](#three-rules-to-remember)
13. [Settings that matter](#settings-that-matter)
14. [How to run your first sessions](#how-to-run-your-first-sessions)

---

## What is this module?

NCM adds phones, computers, networks and hacking to your Cyberpunk RED game. Everything looks like the real thing, not like a menu.

- Every player character gets an **Agent**: an in-game phone with messages, contacts, and money transfers. Players can customize how theirs looks.
- Scenes have **networks**. Your phone only picks up networks that exist where you are. Some need a password or a skill check to join. Some areas have no signal at all.
- Networks can run through **nodes**: routers, relays and masts on the map. Switch one off, jam it or hack it, and the network goes dark in that place.
- The GM can turn any Item into a **data shard** (an encrypted file players crack open) or a **terminal** (a computer players log into). Both can hold all kinds of content: spreadsheets, camera feeds, bank accounts, chat logs, and more.
- Players can steal data from machines, or plant fake data and malware on them. Risky actions use real Cyberpunk RED skill rolls, with an animated roll on screen. Failed rolls build up **heat** that the GM can punish.
- The GM runs everything from one **Admin Panel**.

Most tables add features in this order: **messages → contacts → networks → shards → terminals → nodes → hacking**. Each step works fine without the ones after it.

---

## Part 1 — GM setup

**You need:** Foundry VTT v12 and the Cyberpunk RED Core system. NCM uses the real CPR rules for skill checks, money, roles, and Black ICE.

### 1. Find the buttons

After you enable the module, look for the **satellite dish** icon in the left toolbar. It has these buttons:

| Button | Who sees it | What it does |
|---|---|---|
| **Open Inbox** | everyone | opens your phone |
| **Compose Message** | everyone | write a message |
| **Contacts** | everyone | your contact book |
| **Network Management** | GM only | opens the Networks tab in its own window |
| **Admin Panel** | GM only | the GM control center |

### 2. Open the Admin Panel

This is your control center. The tabs sit in labelled groups along the top:

| Group | Tabs |
|---|---|
| — | **Overview** |
| Comms | **Messages**, **Contacts**, **Spam** |
| Net | **Networks**, **Security** |
| World | **Terminals**, **Shards**, **Access points** |
| — | **Tools** |

Number keys jump between them (1 is Overview, 0 is Tools). Most tabs have a **Pop out** button that opens that tab in its own window, so you can keep, say, the Messages desk open beside the map. Three admin looks live in Tools: Clean dark, Clean light and High contrast, plus a text size.

<!-- fig: overview.png | Admin Panel → Overview: the past above the line, what needs you on it, timers below | 92 -->

**The Overview** is one timeline. Above the line is what just happened (mail, rolls, traces), newest closest. **On the line** sits everything waiting for you, grouped into chips: player mail an NPC hasn't answered, characters running hot, trace countdowns, armed plants, bricked shards, setup gaps like a player with no email address. Click a chip to see the items and act on them; dismissing one hides it until it changes. **Below the line** are the timers about to fire (scheduled mail, self-destructs, countdowns), with zoom buttons for 1 hour, 6 hours and a day. On the right: the game clock, who is at the table and which network they're on, quick buttons (write, push a contact, set the time) and a tile per tab.

### 3. Set up networks (5 minutes)

<!-- fig: scenes.png | Networks → Scenes: your scene folders as shelves, painting a network onto them | 92 -->

Open Admin Panel → **Networks**. It has four views:

- **This scene** — the scene you're running. Each network that reaches it is a signal meter in its own colour: drag it, or type a number, to set the signal. Flag the network players start on. The **Dead zone** switch cuts all signal here. Broadcast a message to everyone on a network.
- **All networks** — every network. The module comes with some; add your own for districts, corporations, or locations. **New network** walks you through six short steps: name and colour, where it exists, security (a password, a skill check, a key item, or a mix), effects, and so on.
- **Scenes** — every scene in your world, on shelves by your Foundry scene folders, with their pictures. **Paint with…** picks a network, then each click on a scene card gives it that network or takes it away. **Wire all** on a shelf does the whole folder. Scenes still in a compendium can be wired before you import them. **Grid** shows scenes × networks as a table.
- **Activity log** — who connected, logged in, failed, got locked out, moved scene, or used a node.

Tip: skip the security stuff at first. Open networks are fine to start with.

### 4. Add some contacts (5 minutes)

Admin Panel → **Contacts** is your master list of every NPC that players can message. It has four views:

- **Directory** — your NPCs. **New → From an actor…** turns an existing actor into a contact in two clicks; the portrait and email come with it. Open a contact to edit it in place, see who knows them, and share it with players (**Share**) or take it back.
- **Players** — each player character: what they know, the groups they hold, their identities.
- **Groups** — named lists of contacts ("The Crew", "Arasaka Leads"). **Push** one to a player and it lands in their contact book, contacts and their phone numbers included. Nobody gets themselves: a character is left out of their own copy. Re-pushing updates their copy. When you share a phone number (Admin → Phone), **Tick a group** picks a whole group at once. A group can have a picture.
- **Who knows whom** — a map (or a table) of which character holds which contact.

Also worth knowing:

- **Send as** — the picker in the bar at the top opens the composer as any NPC.
- **Send-only addresses** — good for system addresses like `alerts@arasaka.com`. Players get mail from it but can't reply.
- **Aliases** — one character can have several identities: a main address and burners, cover names, a work account. Open a contact and use **Add an alias** (an NPC with no actor can have them too). Mail to any alias lands in the same inbox, replies go out as the alias the mail reached, and an alias never shows the character's real portrait unless you give it one.
- **Voice** — a short note on how an NPC talks. Only you see it; it shows up when you answer their mail.
- **Correspondents** — on an NPC, this tab shows everyone writing to them and who is still waiting for an answer.

Don't build the whole city. Two or three NPCs your party actually talks to is plenty for the first night.

### 5. Tools worth a visit

Admin Panel → **Tools**:

- **Import / Reinstall Macros** — adds two macro folders with handy shortcuts for you and your players. Optional, but nice to have.
- **Email Domains & Addresses** — the domains players can pick from, and an **Export / Import** for every address in the world (CSV or JSON). You see the whole plan, row by row, before anything is written.
- **Sounds** — every sound the module makes, with where it plays. Press play to hear one, **Browse** to swap in your own file (you can upload it right there), set its volume, or switch it off. Your choices play for everyone, so keep the files somewhere your players can load them.
- **Time Settings** — see the next step.
- **Purge Messages, Orphan Audit, Factory Reset** — clean-up tools. Each one asks before it changes anything.

### 6. Pick a clock

Tools → **Time Settings** (or **Time Source** in Module Settings) controls what clock the module uses for timestamps and countdowns: real time, world time (works with Simple Calendar), manual (you move it forward yourself), or a fake in-game date. Real time is fine to start. You can change it later. The Overview's quick buttons move a manual clock on by an hour or a day.

### 7. Bring in the players

That's it. Tell your players to click **Open Inbox**. The module walks them through the rest.

---

## Part 2 — Players: your Agent

<!-- fig: Inbox.png | The Agent, your in-game phone | 85 -->

Players have their own short, spoiler-free guide: **docs/NCM-Player-Guide.pdf**. It opens from the **?** button at the top of a player's inbox, or **Player Guide** in the panel behind their portrait. You can open it from that panel too. It covers first-time setup, mail, aliases, contacts, shards, terminals, nodes and themes, and it leaves out what your traps do.

Point your players at it on the first night. Two things are worth knowing as the GM:

- **First time.** A player clicks **Open Inbox**, picks a character if they own several, and picks an address. **Require Email Setup** in Module Settings controls whether that step is forced. An address you give a character yourself counts, so they aren't asked again.
- **Aliases.** You create them (Part 1); players choose between them. A player with an alias gets **Sending as** behind their portrait, which sets the address new mail goes out from until they change it, and a picker on the composer's From line for one message. Replies go out from the address the mail reached.

---

## Part 3 — GM: running the mail

<!-- fig: messages-desk.png | Admin → Messages → Needs a reply: who is waiting, on what, for how long | 92 -->

Admin Panel → **Messages** has four views (five with Conversations switched on — see Part 10):

- **Needs a reply** — every conversation a player is waiting on, one line per NPC and the identity they wrote to, with who is waiting, for how long, and the last thing they wrote. **Reply** opens the composer as that NPC (or the alias they wrote to), addressed to everyone waiting; the inbox button opens the NPC's inbox at the message; **✓** marks it answered without replying. Search it, sort it (longest wait, newest, most waiting, NPC A–Z), group it by NPC or by player; answered lines fold away at the bottom. A wait past a day turns red.
- **All mail** — every message in the world on a calendar you click into: year, month, week, day. Search, filter by who, and every count follows your filters. Open a message to see **where it went** (sent, delivered, read, replied — and why not, if it didn't), reply as the identity it reached, open the inbox it's in, share it to chat, mark it read or unread, or delete it.
- **Inboxes** — every mailbox in the world, sorted how you like, with a **Needs a look** list (most unread, gone quiet, owner gone).
- **Outbox** — mail that **didn't arrive** (with the reason and a Retry), mail **waiting to deliver** (queued on a player's phone), **scheduled** mail, and running **timers** (self-destructs).

What you can do when you write:

- **Send as anyone.** Pick any contact in the From field, including one of a character's aliases. When players message an NPC, you get a popup, and the mail collects in **Needs a reply** and on the Overview.
- **Anonymous send.** Turn on **Enable Anonymous Send** (Module Settings → Anonymous send), and the composer gets an option that hides who you are. Players see a glitchy masked avatar instead. They can reply without knowing who they're talking to, and if you allow it, they can roll to trace you. Great for mystery employers.
- **Self-destruct.** Set a message to delete after it's read, or after 1, 6, or 24 hours.
- **Schedule it.** Write now, deliver later — from any sender to anyone, eddies included. The GM's client delivers it when the time comes, so a GM has to be in the game then.
- **Send via a network, or backdate it.** Click the network chip to send through another network for this message only; the date chip backdates a message, or schedules it if you pick a time in the future.
- **Lock it.** The **Lock** chip puts ICE on a message — a DV, Standard / Red / Black ICE, what a miss does, and which Black ICE actor bites.
- **Preview as recipient.** The **Preview** button shows exactly what the player will open — the masked sender if you are anonymous, the lock they have to breach, the self-destruct note.
- **Message templates.** The file icon at the right of the editor toolbar holds your templates: insert one, save what you are writing as a new one, or import / export them as JSON.
- **One message, many people.** Type a group's name in To and it goes to everyone in it; each recipient gets their own copy and can Reply All. **Mass Broadcast** can send to the whole party or one of your groups, and tells you by name if anyone couldn't receive it.
- **Spam.** The **Spam** tab has ready-made junk mail you can send to players, and can send it automatically when they join certain networks. A "spam" message can carry anything a real message can. Use that. You can also mark any address (or a whole `@domain`) as a **junk sender** from the message itself.

---

**Switching inboxes.** Every NPC has an inbox, with or without a character sheet. Click the portrait at the top of any inbox and use **Switch inbox** in the drawer: type a name, address or alias, and press Enter. Your last few are under **Recent**. The Character Select screen lists them too, under **NPCs**.

## Part 4 — Data shards

<!-- fig: gallery-feed.png | A shard holding a live camera feed | 80 -->

A data shard is an Item that has been turned into an encrypted file. It's loot that players crack open.

### Make one

Right-click any Item and pick **Convert to Data Shard**. As GM, it converts right away. Right-click again for **Configure Shard** to set the difficulty, the skill needed, lockouts, and Black ICE that attacks players who fail. Its **Theme** tab sets the shard's look, including its own CRT film, and the startup can be a video. Admin Panel → **Shards** lists every shard in the world as a cartridge, with **+ New** for a blank one, import and export.

**Renaming.** Right-click a shard and pick **Rename…** — the name changes on the shard and the item together. Turning a shard back into a normal item restores its original name and picture. **Shard Name Prefix** in Module Settings can put a tag like `[SHARD]` in front of every shard's name.

**What players call them.** Setting **What Players Call a Shard**: Data Shard (default), Memory Chip, Data Chip, or your own word. It changes what players read everywhere; your GM windows keep saying "shard".

**Integrity.** Turn it on for a shard (Configure Shard → Systems) and every failed hack damages it: text garbles, files go missing, and at zero the shard is bricked. Admin → Shards shows it as a bar you can damage, repair or salvage.

### Put stuff inside

Open the shard and add entries. There are **18 kinds of content**, and each one looks like the real thing:

| Group | Types |
|---|---|
| Messages & records | message, chat log, records database, calendar, note |
| Data & money | spreadsheet, bank account, password vault, eddies drop |
| Media & intel | photo gallery, live camera feed, document, dossier, audio/video log, building plan, location pin |
| Dangerous | program, malware, system log |

Every type has a **Load example** button. That's the fastest way to learn: load the example, look at it, change it.

**Bringing text in from elsewhere.** Paste straight into a Document paragraph (or a message body) from a journal, Word, a web page or a PDF. The module strips the source's colours and fonts, turns headings into new sections, and rejoins the hard-wrapped lines a PDF copy produces. For a whole page at once, use **Import from Journal** under the Document body.

Almost anything can be locked. Encrypted photos, blacked-out paragraphs, hidden identities — each one takes a skill roll to open, and you can set failed rolls to trigger a trace.

### Give it to the players

The shard is a normal Item. Hand it over however you like: drop it as loot, put it on a body, trade it, attach it to a message, or put it on the map (Part 6). The player cracks it open with a skill check. There's a whole animated hacking sequence, and lockouts if they keep failing.

**Attaching one to a message.** In the composer, the microchip button is **Attach Data Shard**. It opens a searchable list of every shard you can reach (yours, the world's, other characters' for the GM), and you can tick several at once. The player opens it straight from the message, and it's also listed on the Agent's **Shards** tab.

You do **not** need to give players permission on the shard. When a player breaks into a shard they don't own, the module asks the GM's client to record it, so the reveal is never spoiled by a permissions change.

### Letting players write on them

Players can encode their own shards with the **Shard Encoder** (Admin → Shards → **Player Authoring** switches it on and sets who may, what blanks they can write on, and what it costs). By default a shard **you** made is read-only for players, and a shard a **player** made can only be reopened by the character who encoded it. To change that for one shard, open Configure Shard → Security → **Player Editing**.

---

## Part 5 — Terminals

<!-- fig: terminal-login.png | A terminal login screen | 80 -->

A terminal is an Item turned into a computer that players log into. A corp workstation, a ripperdoc's records, a street bulletin board.

### Make one

Right-click an Item and pick **Convert to Terminal**, or use **+ New** in Admin Panel → **Terminals**. The setup screen has six tabs:

- **Identity** — name, organization, folder names.
- **Accounts** — the important one. Each account is a login with its own mailbox **and its own files**. Set a username, portrait, admin rights, and security (password, skill check, or key item). Accounts can be **hidden** — players only find them if they learn the username somewhere else. This tab is also where the machine's content lives.
- **Theme** — colors, fonts, wallpaper, and the CRT film for this machine. A **preset library** with 12 ready-made looks (Arasaka workstation, NCPD precinct, Trauma Team, street BBS, and more) sets everything up in one click.
- **Boot & Login** — the startup screen (or a video that plays instead), six login screen styles, four **mailbox layouts** for after login (Classic, Tabs, TTY, Desktop), a message of the day, a screensaver, and the machine's sound profile.
- **Network** — which network the machine itself is connected to, and how close a token has to be to its map pin.
- **Exfil** — what players are allowed to do with what they find (see below).

Admin → **Terminals** shows every machine as a server rack with status lights: someone logged in, a lockout, an armed plant. Pick one to see what's happening right now and clear lockouts or log people out.

### Put things on it

Everything a machine holds is in **Accounts**. Each account row folds open into its **mail** and its **files**. Above the accounts sits the **Shared volume** — files on the machine itself, which every login sees. **+ Message** and **+ File** open the same editor the shards use; **+ Folder** adds a folder, and every folder has a **who can open it** control: everyone, admins only, a minimum clearance level, or named accounts.

**An account's existing mail.** If an account is linked to an NPC or a character, its **Mail** tab has **Import from inbox** to copy that person's Agent mail onto the machine. From then on, new mail to and from that person appears there by itself.

**Admin accounts can look into other accounts** (**View as admin** in the account switcher). **Sending mail as an account** can be switched on too: a logged-in player gets a **Write** button and sends as the account's owner. Someone writing as an account that isn't theirs is flagged for you in Admin → Messages.

### What players see

Boot screen, then login, then the machine — all in that machine's own look. A switch picks **MAIL** or **FILES** (a directory tree). In the **TTY** layout there's a folder bar at the top and a command line: click a folder or a hint, or type a number to open that row, `cd` to open a folder, `?` for the commands, `logout` to switch account.

### Taking data

The Exfil tab controls what players can do with files they find. Each action can be off, allowed, or allowed-with-a-roll:

**Download · Burn to shard · Forward · Leak** (posts it to public chat) **· Sell** (instant eddies) **· Wipe** (delete it — you can restore it from a recycle bin)

Failing a gated roll triggers a trace. Live camera feeds can't be downloaded, but players can save a single frame, loop a camera, or cut it. A looped camera shows a frozen timestamp — which someone might notice.

---

## Part 6 — Ways in: putting things in the world

<!-- fig: access-points.png | Admin → Access points: every way into a terminal, shard or node, on the map | 92 -->

A terminal, a shard or a network node can be reached in several ways. Right-click the item (or use the **Access** button on its admin row) and pick from **Terminal options / Shard options**:

- **Place on a scene…** — put it on the map as a **pin** players double-click, a **step-on area** that opens it when a token walks in, or both. You choose where (the middle of your view, or click on the map), how close a token must be, and whether players **see it right away or only once you reveal it**. A hidden way in is invisible to players until you flip it.
- **Add to hotbar** — a macro that opens it. You can also drag the item (or its admin row) onto the hotbar.
- **Post to chat…** — a card players click to open it. Choose who sees the card, and its colours: matching the thing, the module's look, or your own.
- **Copy journal link** — a link you paste in any journal (`@NCM[...]`), so a handout can open the terminal it describes.
- **Copy macro code / Make a macro** — for other modules that run macros (Monk's Active Tiles, a door, a region trigger): the code opens it for whoever runs it.

Admin Panel → **Access points** shows every way in at once: a **Map** view with each scene's pins and areas, and a **By thing** view listing each terminal, shard and node with all its ways in — and which ones players can't reach at all yet.

---

## Part 7 — Network nodes

<!-- fig: node-inspector.png | The GM node inspector: everything on a node, and your own additions | 85 -->

A **node** is a physical box that carries a network into a place: a router, a relay, a mast, a junction box, an antenna. Nodes are optional. A network with no nodes works exactly as before.

**The rule:** a scene that has nodes for a network only gets that network while at least one of them is up. Switch them all off (or jam or damage them) and the network goes dark on that scene. Players on it are moved to another network, or lose signal and their mail waits in a queue. Machines on that network go to local-only. A node can also carry its network onto a scene that doesn't otherwise have it.

### Add a node

Admin → **Networks** → **All networks** → pick a network → **Nodes** → **Add a node**: a name, a kind, the scene it stands on, and switches for Hidden, Box locked (only a hack can switch it), and Show traffic. Then **Place on the map** from its ⋯ menu so players can find it. Each node row shows its state (click to switch it on or off), an **Inspect** button, and a ⋯ menu for everything else.

### What players do at a node

<!-- fig: node-console.png | A node console, before jacking in | 70 -->

Opening a node shows its **console**: its name, signal, state, alert level and a ticker of what's passing through. The ticker shows the newest lines of the node's log that aren't wiped; lines you made as GM ("GM — switched off") stay with you. **Inspect** the node to delete a line or clear the log. Clearing Admin → Networks → Activity log does not clear a node's own log. Anyone can **Connect** to its network from there. A netrunner can **Jack in**: a skill roll (Interface by default) against the node's DV, with a lock that opens ring by ring. Inside they get a number of **moves** depending on their rank, and can:

- **Switch it off / on**, or **Jam** it for a while.
- **Tap** it — copies of mail sent from that scene over that network land in their inbox.
- **Open a backdoor** — they skip the network's login from then on.
- **Insert a shard** — run a network program from a shard they carry: a **worm** that spreads to other nodes, a **tap**, a **blackout bomb** that takes down every node it reached, a **sniffer** that records traffic for later, a **patch** that cleans the node, or a **custom routine** of your own: your description and, if you want, one of your macros, which fire when it is inserted, the next time someone else jacks in, or both. You get a whispered card when it fires.
- **System sweep** — find what someone else left there, and remove it.
- **Wipe their log line** so the node doesn't remember them.

Moves spent stay spent: jacking out and back in, or refreshing, resumes the same session until it runs out (60 game minutes by default), and coming back raises the node's alert. A failed jack-in counts against the network's own login lockout.

### Your controls

**Inspect** opens the node inspector: its state, alert level and switches; everything on it right now (the jam and who did it, infections, taps, backdoors, the runners inside and how many moves they have left, who's locked out), each with a control; and its full log. **Add** plants your own: an infection (pick the program, who planted it, the DV a sweep needs — tick **Quest** and you get a whisper when a player cleans it), a tap or backdoor for an NPC, a jam, a log line that works as a clue, or damage. **Kick** throws a runner out, and can hit them and lock them out on the way.

The rules live in Admin → **Security** → **Hacking rules** → **Jacking in**: **who can jack in** (anyone, the Terminal operator access rule, or only certain roles and skills), the skill and DV, how rank unlocks actions, makes them easier and gives more moves, each action's DV, and what failure costs. Every node action also shows up in **Networks → Activity log**.

---

## Part 8 — Hacking and consequences

This is the deep end. Skip it until your table wants it.

### Rolls on screen

Before a roll, a small panel shows what is about to be added up, the DV, the chance of beating it, and steppers for **Luck** and a **modifier**. (A locked DV the player can't read stays hidden, chance included. Each player can turn the panel off with **Ask Before Rolling**.)

Then the roll plays on screen — the stat, the skill, the die, the total against the DV — and posts its chat card when the result lands. If you use **Dice So Nice**, the 3D dice roll first.

**Rolls follow the chat box's roll mode** (public, GM only, blind or self), for both the 3D dice and the chat card. When you decide a roll yourself, players see no DV or chance.

**A roll has to beat the DV.** A tie fails, as in the rulebook. On a forge or an encode, a tie lands on the sloppy rung.

**Interface rolls Rank + 1d10**, also the rulebook's way, and has no stat in it. Interface DVs in the module are set for that: about 9 for a fair lock, up to 15 or so for a nasty one. If your world has DVs from before version 2.1, you are asked once what to do with them. To go back to adding TECH, change **Role Ability Rolls** (Admin → Security → Hacking rules).

### Trace & heat

Every risky roll reports to Admin → **Security**. If your table doesn't want consequences, switch off **Trace Consequences** (Module Settings → Systems): failures are still logged, but add no heat, no GM alert and no player splash. It takes effect at once, no reload.

- **Live** — what needs your call right now.
- **Activity** — the full record of who did what, drawn as a seismograph (a failure kicks the line, a success is a tick). Click a spike to see what happened.
- **Heat** — failed rolls build heat on whoever failed them, shown as a thermometer per character. Heat fades over time. When it gets high, you can hit back: lock them out, attack with Black ICE, or start a **countdown** the player watches tick down on their screen ("Arasaka is closing in").
- **Machines** — planted programs and the recycle bin.
- **Hacking rules** — how rolls get resolved, who can use terminals, what players can see of a defence, how role abilities roll, and jacking in.

### Planting fake data

Players can also put things ON a machine. They carry a forged file (a fake chat log, a doctored photo) to a terminal and upload it. A forge roll decides how it goes: **clean**, **sloppy** (it works, but an inspection will reveal it's fake), or **rejected**. Planted files go off the next time someone logs in. You choose in settings whether they fire on their own or wait for your go-ahead.

### The Malware Workshop

Admin → Security → **Programs** opens the **Malware Workshop**. Build programs with real effects: keyloggers, secret backdoor accounts, ICE traps, file wipers, and network programs for nodes (worm, tap, blackout bomb, sniffer, patch, and a custom routine you describe or link to a macro). You can disguise them as harmless files.

The usual route:

1. **Build it.** Pick Payload or Malware, then the ability. Each ability says what it **runs on**: a terminal, or a network node. Write what it does, and set the skill and DV for pushing it onto a machine.
2. **Save it** to your library, then click **Install on a shard** (the chip icon on its card) and pick a shard. Or right-click a shard → **Build a program** to compile straight onto it.
3. **Hand over the shard.** The character needs it on their sheet.
4. **They use it.** A terminal program goes through **OPS → Upload** when they are logged in. A network program goes through **Insert a shard** when they are jacked into a node. A payload can also be run from the shard through the **Program Deck**.

A **Custom** program is yours to adjudicate: when it runs, you get an alert with what you wrote, and it can run a macro. **Wipe** and **Corrupt** ask which files when they run.

### Letting the table watch

When one player is on a terminal, shard or node, the others can watch. The player clicks the **eye** on the window's title bar, and everyone else gets a small chip at the top of the screen with a **Watch** button. It opens a read-only copy of that player's window, updated as they work, consoles and rolls included. Passwords show as bullets, and a playing video stays on their screen. The eye shows how many are watching.

**Watching Other Players** sets the rule: players choose (the default), every session can be watched, or off. A GM's own windows are never shared, because they show hidden accounts and answers.

### Fighting back

Players have tools too. **ANALYZE** checks whether a file is really what it says it is — the magnifier button on a typed file's header, in a terminal and on a shard alike. **SYSTEM SWEEP** scans a whole terminal (or a node) for planted programs — it reveals what the roll is good enough to find, and never says whether it missed anything. On a terminal it lives in the **OPS** menu next to the operator chip.

### How hack rolls get resolved

Security → Hacking rules → **Netrunning resolution** has three modes. Pick what fits your table:

1. **Auto** — the module rolls and resolves everything. Fast. This is the default.
2. **Flagged** — same as auto, but you get a card telling you what happened so you can work it into the story.
3. **GM decides** — no auto-roll. The player's screen waits while you get a prompt. Run the netrun at the table however you like, then click the result. Both screens can step aside while you play it out.

A single terminal or node can override this for itself.

### Who can hack at all

Security → Hacking rules → **Terminal operator access** limits who can use terminal tools (upload, sweep): by role, by skill level, by gear they need to own, or by naming specific characters. **Jacking in** has its own rule (Part 7). **Countermeasure visibility** decides whether players see what guards a lock (the ICE, the DV) or only that it's locked.

---

## Part 9 — Phone calls

Admin → **Phone** is everything about calls. Players call from the **Calls** tab in their inbox. Players pick their own number, or you hand them out.

**Numbers.** A number says where it was issued: `WAT-4471` in the same city, `SF NFF-2210` in a nearby city, `+14 DAL CEN-3345` far away. It stays with the person when they move. The **Numbers** tab lists everyone and can give numbers in bulk, with a reason beside each one. **Number setup** holds the place table, the rules for players, line types and special numbers.

**Answering.** When someone calls an NPC, it rings for you on the **Live** tab, longest wait first. Answer as who they asked for, or as someone else, or send it to voicemail. A call nobody answers goes to voicemail by itself.

**Greetings.** Every number has its own greeting: the default, typed words, words read out, or **Audio** (record one, or paste a link or browse for a sound file in your world). Read out uses each listener's own computer voice, so it can sound different for each player; Audio sounds the same for everyone. Players set their own greeting from **Greeting** on their My line card.

**Corporations.** An office has a main number with a switchboard, and extensions (`MIL-0100 x17`). Choose whether you answer, a recording plays, or it takes a message. A caller first gets the switchboard: the greeting, the listed extensions, a box for an unlisted one, and **0**, which rings you as the operator (when you answer) or leaves a message (Voicemail). An office on Voicemail with no greeting and no listed extension skips the switchboard and goes straight to the tone. If you don't pick up as the operator, the call goes to the office's voicemail. If someone holds the office's main number, calls ring them instead, and Corporations warns you. Voicemail lands with a mailbox made for that office the first time someone leaves a message, or with a contact you pick. **New corporation** (on Numbers → Corporations, or Places → Add → A corporation) makes one in a step.

**Special numbers.** A number that follows its own rules: a hidden line, a hotline, a recording, a macro. Each can have a name and a picture.

**Who sees a caller's name and picture.** The picture shows once a call is answered (live, on hold, and after it ends); while it rings, only a name or number shows. With no picture, the frame shows initials. You, the GM, always see the real name and picture. For players, the caller's line type decides first:

| Line type | What the other end sees |
|---|---|
| Corporate | The person's name and picture, the company name and the office art |
| Business | The line's label, with the office art as the picture |
| Payphone | "Payphone, Kabuki", no picture |
| Burner | The number only, no picture |
| Withheld | Nothing, until a Trace: then the number, and the name unless the line is a burner |
| Standard | Their name only if the player has them saved (below) |

A successful **Trace** on a withheld call always answers, with a whispered **Trace result** card in chat. Each line type sets what a trace finds. Its **A Trace finds** choice is **Who holds it**, **The name you set**, **Where it is**, or **The number only** (the burner default). Only a special number set to **A dead end** gives nothing. The player's call log keeps showing only what the trace found.

On a Standard line (**Their screen shows: Their name, only if saved**), a player who has the caller saved sees the name and picture. A contact matches by its number, the directory entry it came from, its email (a contact saved from mail), or the same character. A player who has not saved them sees "Unknown number" and no picture, unless the line type has **People who don't have them saved still see their picture** ticked: then they see the picture, never the name.

Tip: To make caller ID work like a real phone, set Standard's **Their screen shows** to **Their name, to everyone**: every caller's name and picture shows, saved or not, with their organization (or their number's district) under the name. For burners, set the Burner type to **A name you set** with the Name **Unknown**, and **A Trace finds** to **The name you set**: an open burner call shows the number and the burner's own name ("Unknown" when it has none), and a trace on a withheld burner finds the same. A burner never shows a picture. The picture is the directory contact's portrait or the character's image. So when a player says a friend's picture doesn't show, the contact usually isn't saved under that number, email or character, or the call came from a burner, payphone or withheld line.

**Trauma Team.** Under Number setup → Emergency calls, set who has a plan. Dialling the Trauma Team number with a plan starts the call: real dice, chat cards, and a countdown for the player. The call uses that special number's name, number and picture, so you can rename it or point it at another one. **See the call** plays it for you with nothing rolled or saved.

**Lawman Backup.** Same place. Backup is whoever this Lawman can call, not only the police: a corp's security, a gang, a nomad pack. Pick each Lawman's organization, rename its groups, and set its **Kind**. By default only Police and Government get red and blue lights and a siren. An organization can have a picture, and a group can have its own, which wins.

**You hear about it.** When someone calls Trauma Team or Backup, the table gets one chat card saying who is calling and where (a whispered call stays whispered), and every GM gets a toast and a short tone, even if the dice are whispered. Its button opens Admin → Phone → Live. Turn it off with **Trauma Team and Backup Calls** in Module Settings → GM alerts.

**The team arrives by itself.** Rounds count down with combat, or at about 6 seconds each outside it, and stop while the game is paused. On Live you can **Hold** a team, take a round off, bring them in now, or call them off.

**Changing what a call says.** An organization has **What do their calls say?** and **How do their calls look?**. A Lawman has **Customize**, for their own words, callsign, extra groups, colour, lights, sounds and picture. A blank box inherits: the person from their organization, the organization from the built-in words. Put several lines in a box and one is picked each call. Trauma Team has **What does dispatch say?**, one set for the whole service. **Play** shows the call on your screen. The dice are only for show, and nothing is saved or posted.

**Call log and Voicemail.** Both fold by date, or group by person or mailbox. Search reads names, numbers and transcripts. Filter narrows by who, network and dates. **Select** ticks rows (Shift-click for a range, or select all), then deletes them, or marks voicemails heard or new. Deleting a call removes it from both people's logs.

**Call history.** The **Call history** button on Call log and on Voicemail opens one person's whole log: calls from play and calls you write. Use it to give a character the calls and voicemails they had before the campaign, or between sessions. A new call is **From → To**: pick a character or NPC for each end, or write in any name and number. Add what was said line by line, or **Paste a script** ("Name: text" per line). **Details** holds the network, where it was made, a withheld number, a drop reason and who overheard it. Make it a voicemail and it lands in the other person's Voicemail as a real one: typed, read aloud or recorded. For many at once: **Keep adding** (each new call starts an hour earlier), **Same call to others too**, **Fill in a week**, or a CSV import that shows you the plan first. The list on the left has search, **Show** (incoming, outgoing, voicemail, missed, has a transcript…), **Group** by date or by person, a date range, and folding groups. A call from play can be copied into the form or deleted, but not edited. Terminal accounts have a call history too.

**Overheard calls.** Write a conversation between two NPCs, then start it. Players can catch it in range, through a tap, from a node session or with a scanner. A running call lives on your client and ends if you reload.

**Payphones.** Admin → Phone → **Payphones**. **New** makes one with a free number, then **Place on a scene…** puts it on the map as a pin, a step-on area or both, with a reach in squares. A player who double-clicks it in reach gets the booth: they lift the handset, dial, and the normal call screen takes over. Whoever they call, and a trace, see the place ("Payphone, Kabuki"), never the person; you see who really called in the call log. This hiding is on screen: Foundry sends call updates to every connected browser, so a player who digs into the browser's developer tools could still find out who is on a booth, or behind a withheld number. A call from a booth is not in the character's own call log. Payphones are wired, so they work in a dead zone and taps can't hear them. Calling a payphone rings everyone viewing its scene, and the first person standing at it picks up. **Ring it as…** calls it as one of your NPCs. **Call from it…** calls out from the booth to anyone in the directory (characters, NPCs, other payphones) or a typed number; the other end sees the payphone. **Number → Change…** picks the city and district (the one named like the booth's scene is offered first) and the last four digits; **Another** draws a free number in the same district. Pick a booth to change how it looks: a style, colours, the brand line, **Grit** and **Wiring** sliders, graffiti, the screen text, out of order, who can hear (the caller's **SPKR** key lets everyone in reach follow the call), a help key, and its own sounds. **Save this look** reuses it on other booths. Module Settings → **What Players Call a Payphone** changes the word players see ("Public Comm, Kabuki"); pins already on the map are renamed with it.

**Sharing.** Sharing a contact asks whether to give the address, the number or both. In **Who knows whom**, each contact has separate address and number buttons. A contact only shows what was given.

Tip: open **Number setup → How it works** first. It explains the format and has a box to try a number.

---

## Part 10 — Conversations

Group chat beside mail. **Turn it on in Module Settings → Systems → Conversations.** With it off, nothing about it shows or runs.

**Mail or a conversation?** A message is something you send, and it carries the subject, eddies, encryption and shards. A conversation is something you are in: plain lines, pictures, and shared contacts or numbers. It stays out of the rest of the module on purpose, so it has no trace, sniffers, terminal copies or last-interaction entries.

**Watching.** **Admin → Messages → Conversations** lists every chat in the world. Reading one is invisible: nobody is told and nothing is marked read. **Members** shows who plays each person, how far they have read, and which names are aliases.

**Stepping in.** A chat with an NPC in it shows a **Speaking as** row above the box, with one chip per NPC. Click a chip, or press Alt+1 to Alt+9, to swap. What you typed stays. The **+person** button brings in another NPC and swaps to them, and everyone sees a line saying they joined. It works the same in Admin → Conversations and in any NPC's inbox. In a player's inbox you can also speak as that character or their aliases, because you opened it on purpose. In Admin → Conversations, a players-only chat only offers **Join as an NPC…**. An NPC appears to players as a normal person.

**Starting one as an NPC.** Use **New → Conversation** in Messages, or the chat button at the top of any inbox. **Join as** starts on the NPC whose inbox is open and offers your last few NPCs as one-click chips. **Someone else…** searches everyone. You land in that NPC's inbox with the chat open.

**Removing a line.** Hover over a line and press the eraser. The words are deleted and "Line removed by the GM" stays in their place.

**Telling you about it.** All NPC conversations share one toast. The bell on a chat decides whether it counts: on for chats with an NPC, off for players-only.

**Taps.** A tap on a network node also writes a plain running log of chats sent from that node's scene to the tapper's Exfil folder, with no toast. A chat being tapped shows a **Tapped** tag, to you only.

**Cleaning up.** **Tools → Purge Messages** deletes one conversation for everyone. **Orphan Audit** lists chats where nobody left in them still exists.

Tip: conversations need a GM online to go through. Lines written with no GM online wait on the player's client and send when one connects.

---

## Three rules to remember

These three things cause almost every "it's broken" report. Tell your players up front:

1. **A GM has to be online for player actions to count.** When a player claims money, decrypts a file, jacks into a node, or schedules a message, the change goes through the GM's computer. If no GM is connected, nothing happens (the module says so). That's on purpose.
2. **Check the OPERATOR chip.** It picks which character rolls and gets paid. Wrong chip, wrong wallet.
3. **"The button does nothing" is usually a setting.** Exfil rules, operator access, who can jack in, network range, resolution mode — check the setting before assuming it's a bug. Turning on **Debug Mode** makes the module explain every decision in the console.

If part of NCM fails to start (another module clashing, a broken world record), you get **one notice** when the world loads that names the part and says what stopped working because of it. Send that notice along with any bug report.

Two more things worth knowing: self-destructing messages never destroy when a GM reads them (so you can check inboxes safely), and GMs skip most login checks — so if you want to see what players see, log in from a player account.

---

## Settings that matter

All in Module Settings unless noted. NCM's settings are grouped there under headings:

| Section | What's in it |
|---|---|
| **Systems** | switch whole parts on or off: **Network Simulation** (off = simple network mode: everyone on CitiNet, always connected), **Calls** and its parts (**Payphones**, **Emergency Lines**, **Overheard Calls**), **Conversations**, **Trace Consequences** (off = failed hacks are logged but add no heat or alerts). Most reload the world; nothing is deleted. |
| **Mail** | **Smart Conversation Grouping** (threads), **Require Contact Verification** (players can only write to addresses they know), **Auto-Register NPC Senders**, **Exfil Folder Name** |
| **Email addresses** | whether players must pick an address, the default domain, custom domains, identity burn |
| **Anonymous send** | **Enable Anonymous Send** (a composer option that hides who you are), its default mask, replies, and the trace mechanic players can use to unmask it |
| **Spam filter** | **Filter Unknown Senders**: a chance for mail from strangers to land in Spam |
| **GM alerts** | popups when players message NPCs or write in an NPC conversation, and for Trauma Team / backup calls |
| **Shards, terminals & hacking** | **What Players Call a Shard** (Data Shard, Memory Chip…), **What Players Call a Payphone**, **Shard Name Prefix**, **Terminal Pins — Auto-Show Map Notes**, **Planted Programs — When They Fire**, **Role Ability Rolls (Interface)**, **Ask Before Rolling** (per player) |
| **Date & time** | **Time Source** (which clock the module uses) and how dates are written |
| **Advanced** | **Watching Other Players**, **Debug Mode** (the module explains its decisions in the console) |
| Netrunning resolution, jacking in | Admin → Security → Hacking rules |
| Sounds | Admin → Tools → Sounds |
| Calls, payphones, voicemail details | Admin → Phone → Settings |

---

## How to run your first sessions

A pacing that works:

1. **Before session 1:** set up two networks and a dead zone, add three contacts, and send each player one message from someone their character knows. It'll be waiting when they first open their phone.
2. **Session 1:** players make their addresses, style their phones, and message each other and an NPC. You answer in character from **Needs a reply**. That's enough. Let it breathe.
3. **Session 2:** a job offer arrives by mail — maybe anonymously, maybe scheduled for the middle of the night. Payment attached as eddies. The job involves a data shard with three entries: a plain message, a locked photo, a bank account.
4. **Session 3:** the job leads to a terminal pinned on the map. Two accounts, one hidden. A camera feed, an incriminating spreadsheet, and a download action that needs a roll. Let someone fail and watch the heat show up on your Security tab.
5. **Session 4:** the building's network runs through a node in the basement. Someone has to jack in and jam it before the crew goes in — or plant a tap and listen for a week.
6. **Later:** forged evidence, malware, worms, countdowns. Add them when the table asks, not before.

---

## If you're making a video

Suggested chapters, in the order tables actually learn the module:

1. What is NCM? (show a styled phone and a terminal login)
2. GM setup: the Admin Panel, networks and scenes, contacts
3. The player side: making an address, the inbox, themes
4. GM mail: the Needs-a-reply desk, anonymous send, scheduling, spam
5. Your first data shard: convert it, fill it, watch it get hacked
6. Your first terminal: a preset look, a hidden account, a map pin
7. Network nodes: placing one, jacking in, a worm
8. Hacking and heat: traces, escalation, malware, sweeps
9. The three rules (don't skip this one)
