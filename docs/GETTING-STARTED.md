# Getting Started with Night City Messenger

Night City Messenger (NCM) is a big module, but you don't need to learn all of it at once. Start with messaging. Add the other parts when your table is ready for them.

**If you're the GM:** read Part 1 to set up (about 15 minutes). Come back to the later parts when you want them.

**If you're a player:** Part 2 is all you need.

---

## Contents

1. [What is this module?](#what-is-this-module)
2. [Part 1 — GM setup](#part-1--gm-setup)
3. [Part 2 — Players: your Agent](#part-2--players-your-agent)
4. [Part 3 — GM: sending mail](#part-3--gm-sending-mail)
5. [Part 4 — Data shards](#part-4--data-shards)
6. [Part 5 — Terminals](#part-5--terminals)
7. [Part 6 — Hacking and consequences](#part-6--hacking-and-consequences)
8. [Three rules to remember](#three-rules-to-remember)
9. [Settings that matter](#settings-that-matter)
10. [How to run your first sessions](#how-to-run-your-first-sessions)

---

## What is this module?

NCM adds phones, computers, and hacking to your Cyberpunk RED game. Everything looks like the real thing, not like a menu.

- Every player character gets an **Agent**: an in-game phone with messages, contacts, and money transfers. Players can customize how theirs looks.
- Scenes have **networks**. Your phone only picks up networks that exist where you are. Some need a password or a skill check to join. Some areas have no signal at all.
- The GM can turn any Item into a **data shard** (an encrypted file players crack open) or a **terminal** (a computer players log into). Both can hold all kinds of content: spreadsheets, camera feeds, bank accounts, chat logs, and more.
- Players can steal data from machines, or plant fake data and malware on them. Risky actions use real Cyberpunk RED skill rolls. Failed rolls build up **heat** that the GM can punish.
- The GM controls everything from one **Admin Panel**.

Most tables add features in this order: **messages → contacts → networks → shards → terminals → hacking**. Each step works fine without the ones after it.

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
| **Network Management** | GM only | set up networks |
| **Admin Panel** | GM only | the GM control center |

### 2. Open the Admin Panel

This is your control center. It has 9 tabs: **Overview, Messages, Contacts, Networks, Shards, Spam, Terminals, Security, Tools**. The Overview tab shows your players' characters and recent messages.

### 3. Set up networks (5 minutes)

Open **Network Management**. The module comes with some networks already. Add your own for districts, corporations, or locations. Each network gets a name, a color, and (if you want) security: a password, a skill check, a key item, or a mix.

Then go to the **Scenes tab** and pick which networks work on which scenes. You can also mark a scene as a **dead zone** — no signal at all. Changes save automatically.

Tip: skip the security stuff at first. Open networks are fine to start with.

### 4. Add some contacts (5 minutes)

Go to Admin Panel → **Contacts**. This is your master list of every NPC that players can message. From here you can:

- **Import Actor** — turn an existing actor into a contact in two clicks. The portrait and email come with it.
- **Push contacts to players** — give an NPC's contact card to one player or the whole party.
- Mark an address as **send-only** — good for system addresses like `alerts@arasaka.com`. Players get mail from it but can't reply.
- **Groups** — the Groups card at the top of the tab. Make a named list of contacts ("The Crew", "Arasaka Leads"), then **Push** it to a player and it lands in their contact book, contacts included. Re-pushing updates their copy.

Don't build the whole city. Two or three NPCs your party actually talks to is plenty for the first night.

### 5. Install the macros

Admin Panel → **Tools** → **Import / Reinstall Macros**. This adds two macro folders with handy shortcuts for you and your players. Optional, but nice to have.

### 6. Pick a clock

In Module Settings, find **Time Provider**. This controls what clock the module uses for timestamps and countdowns. Your options: real time, world time (works with Simple Calendar), manual (you move it forward yourself), or a fake in-game date. Real time is fine to start. You can change it later.

### 7. Bring in the players

That's it. Tell your players to click **Open Inbox**. The module walks them through the rest.

---

## Part 2 — Players: your Agent

### First time

Click **Open Inbox** (the envelope icon under the satellite dish). The module will ask you to:

1. **Pick your character**, if you own more than one.
2. **Pick your email address** — a name plus a domain, like `v.wraith@nightcity.net`. It suggests names based on your character. The GM decides which domains exist.

Done. NPCs and other players can now message you at that address.

### Using your inbox

- **Folders** — Inbox, Sent, Saved, Trash, and Spam. There's a "Mark all read" button at the end of the filter row.
- **Networks** — at the top of the window. You only see networks that reach the scene you're on. A padlock means the network needs a password or a skill check. Some messages only open on certain networks.
- **Threads** — click the **Thread** button on a message to see the whole conversation in one view.
- **Reply All** — a message sent to several people shows a party chip next to the To line and a **Reply All** button beside Reply.
- **Share to chat** — posts a message as a chat card. Anyone reading the card who doesn't have the sender in their contacts gets an **Add contact** button right on it.
- **Money** — a message can have eddies attached. Click **Claim** and the money goes straight to your character sheet. It can only be claimed once.
- **Self-destructing messages** exist. If you get one, read it carefully. It won't be there later.

### Contacts

The **Contacts** button opens your personal contact book. You can set trust levels, write notes, and mark favorites. When a stranger messages you, use **Add to Contacts** right from the message. Some contacts are protected by ICE and need a skill check to unlock.

**Groups** sit in a row of chips under the search bar. A group is a named list of your contacts — make one with **New**, or the GM can hand you one (it shows a shield). Each chip shows a few member faces; click it to see everyone in it, message them all at once, or edit the list. Clicking a face opens that contact. The groups you message most stay at the front, and past six the rest fold behind **+N more**. In the composer, typing a group's name offers it as one chip that sends to everybody in it.

### Make it yours

Open the **Theme Customizer** from your inbox. You can change colors, fonts, text size, wallpaper, and effects, and give your Agent a custom name. Only you see your theme.

### If you own more than one character

Terminals and shards act as your **operator** — the character who rolls the dice, pays, and gets paid. If you own several characters, an **OPERATOR chip** shows up on terminal screens. **Check it before you roll.** If the wrong character is picked, the wrong character gets the money.

---

## Part 3 — GM: sending mail

Once messaging works, here's what you can do with it:

- **Send as anyone.** Put any contact in the From field. When players message an NPC, you get a popup, and the mail collects in the **NPC Inbox** panel (Admin → Messages) where you can reply.
- **Anonymous send.** Turn this on in settings, and the composer gets a checkbox that hides who you are. Players see a glitchy masked avatar instead. They can reply without knowing who they're talking to, and if you allow it, they can roll to trace you. Great for mystery employers.
- **Self-destruct.** Set a message to delete after it's read, or after 1, 6, or 24 hours.
- **Scheduled messages.** Write now, send later.
- **One message, many people.** Type a group's name in To and it goes to everyone in it; each recipient gets their own copy and can Reply All. **Mass Broadcast** (Admin → Messages) has a **Send to** picker for the whole party or one of your groups, and tells you by name if anyone couldn't receive it. In the Messages activity feed a group send folds into one row you can expand.
- **Spam.** The Spam tab has ready-made junk mail you can send to players, and can even send it automatically when they join certain networks. It sounds silly, but a "spam" message can carry anything a real message can. Use that.

---

## Part 4 — Data shards

A data shard is an Item that has been turned into an encrypted file. It's loot that players crack open.

### Make one

Right-click any Item and pick **Convert to Data Shard**. As GM, it converts right away. Right-click again and pick **Configure Shard** to set the difficulty, the skill needed, lockouts, and Black ICE that attacks players who fail.

Players can convert items too, but they have to pass a skill check first.

### Put stuff inside

Open the shard and add entries. There are **18 kinds of content**, and each one looks like the real thing:

| Group | Types |
|---|---|
| Messages & records | message, chat log, records database, calendar, note |
| Data & money | spreadsheet, bank account, password vault, eddies drop |
| Media & intel | photo gallery, live camera feed, document, dossier, audio/video log, building plan, location pin |
| Dangerous | program, malware, system log |

Every type has a **Load example** button. That's the fastest way to learn: load the example, look at it, change it.

**Bringing text in from elsewhere.** Paste straight into a Document paragraph (or a message body) from a journal, Word, a web page or a PDF. The module strips the source's colours and fonts so nothing lands black-on-dark, turns headings into new sections, keeps lists and images as their own blocks, and rejoins the hard-wrapped lines a PDF copy produces. A strip appears after the paste with **Undo** and, when several paragraphs landed in one block, **Split into N blocks**. For a whole page at once, use **Import from Journal** under the Document body.

Almost anything can be locked. Encrypted photos, blacked-out paragraphs, hidden identities — each one takes a skill roll to open, and you can set failed rolls to trigger a trace.

### Give it to the players

The shard is a normal Item. Hand it over however you like: drop it as loot, put it on a body, trade it, or attach it to a message. The player cracks it open with a skill check. There's a whole animated hacking sequence, and lockouts if they keep failing.

You do **not** need to give players permission on the shard. A shard attached to a message stays a world item nobody can see in the Items sidebar; when a player breaks into it, the module asks the GM's client to record that, so the reveal is never spoiled by a permissions change. If you really do want to hand a shard over outright, the **Permissions** button on the shard's row in Admin → Shards opens Foundry's ownership dialog.

### Letting players write on them

Players can encode their own shards (Admin → Shards → **Player Authoring** switches it on). By default a shard **you** made is read-only for players, and a shard a **player** made can only be reopened by the character who encoded it. To change that for one shard, open Configure Shard → Security → **Player Editing**: locked, maker only, or anyone who passes the encoder gate. A player re-encoding a shard adds files to it and re-rolls how convincing the whole chip is; the lock stays as it was.

---

## Part 5 — Terminals

A terminal is an Item turned into a computer that players log into. A corp workstation, a ripperdoc's records, a street bulletin board.

### Make one

Right-click an Item and pick **Convert to Terminal**. The setup screen has six tabs:

- **Identity** — name, organization, folder names.
- **Accounts** — the important one. Each account is a login with its own mailbox. Set a username, portrait, admin rights, and security (password, skill check, or key item). Accounts can be **hidden** — players only find them if they learn the username somewhere else.
- **Theme** — colors, fonts, and wallpaper for this machine. There's a **preset library** with 12 ready-made looks (Arasaka workstation, NCPD precinct, Trauma Team, street BBS, and more) that set everything up in one click.
- **Boot & Login** — the startup screen, six different login screen styles, a message of the day, and a screensaver. Each terminal can have its own sound effects too.
- **Network** — which network the machine itself is connected to.
- **Exfil** — what players are allowed to do with what they find (see below).

### Put it in the world

**Drag the terminal Item onto the map.** It becomes a pin that players double-click to log in. You can require their token to be standing near it. Or skip the pin and let players open the Item directly.

### What players see

Boot screen, then login, then the machine's mailbox — all in that machine's own look. Machines hold both mail and files (camera feeds, spreadsheets, logs). If an account belongs to an NPC, mail sent to that NPC also shows up on the machine. The paper trail is really there.

### Taking data

The Exfil tab controls what players can do with files they find. Each action can be off, allowed, or allowed-with-a-roll:

**Download · Burn to shard · Forward · Leak** (posts it to public chat) **· Sell** (instant eddies) **· Wipe** (delete it — you can restore it from a recycle bin)

Failing a gated roll triggers a trace. One fun detail: live camera feeds can't be downloaded, but players can save a single frame, loop a camera, or cut it. A looped camera shows a frozen timestamp — which someone might notice.

---

## Part 6 — Hacking and consequences

This is the deep end. Skip it until your table wants it.

### Trace & heat

Every risky roll reports to Admin → **Security**:

- **Activity Log** — a full record of who did what and whether it worked.
- **Heat** — failed rolls build heat on whoever failed them. Heat fades over time. When it gets high, you can hit back: lock them out, attack with Black ICE, or start a **countdown** the player watches tick down on their screen ("Arasaka is closing in").

### Planting fake data

Players can also put things ON a machine. They carry a forged file (a fake chat log, a doctored photo) to a terminal and upload it. A forge roll decides how it goes: **clean**, **sloppy** (it works, but an inspection will reveal it's fake), or **rejected**. Planted files go off the next time someone logs in. You choose in settings whether they fire on their own or wait for your go-ahead.

### The Malware Workshop

Admin → Security → **Programs** opens the **Malware Workshop**. Build programs with real effects: keyloggers, secret backdoor accounts, ICE traps, logic bombs, file wipers. You can disguise them as harmless files. Give them to players as Items; they carry and use them through the **Program Deck**.

### Fighting back

Players have tools too. **ANALYZE** checks whether a file is really what it says it is. It is the magnifier button on a file's header, in a terminal and on a shard alike — but only on *typed* files (a spreadsheet, a photo gallery, a program…); a plain message has nothing to analyze, so it shows no button. **SYSTEM SWEEP** scans a whole terminal for planted programs — it reveals what the roll is good enough to find, and never says whether it missed anything. It lives in the terminal mailbox's **OPS** menu (top bar, next to the operator chip), beside UPLOAD; both are locked with a tooltip for an operator who doesn't meet the Operator Access rule in Admin → Security.

### How hack rolls get resolved

There's a setting called **Netrunning Resolution** with three modes. Pick what fits your table:

1. **Auto** — the module rolls and resolves everything. Fast. This is the default.
2. **Flagged** — same as auto, but you get a card telling you what happened so you can work it into the story.
3. **GM decides** — no auto-roll. The player's screen waits while you get a prompt. Run the netrun at the table however you like, then click the result. Both screens can minimize while you play it out.

### Who can hack at all

Admin → Security → **Operator Access** lets you limit who can use terminals: by role, by skill level, by gear they need to own, or by naming specific characters.

---

## Three rules to remember

These three things cause almost every "it's broken" report. Tell your players up front:

1. **A GM has to be online for player actions to count.** When a player claims money, decrypts a file, or uploads something, the change goes through the GM's computer. If no GM is connected, nothing happens. That's on purpose.
2. **Check the OPERATOR chip.** It picks which character rolls and gets paid. Wrong chip, wrong wallet.
3. **"The button does nothing" is usually a setting.** Exfil rules, operator access, network range, resolution mode — check the setting before assuming it's a bug. Turning on **Debug Mode** makes the module explain every decision in the console.

Two more things worth knowing: self-destructing messages never destroy when a GM reads them (so you can check inboxes safely), and GMs skip most login checks — so if you want to see what players see, log in from a player account.

---

## Settings that matter

All in Module Settings. The important ones:

| Setting | What it does |
|---|---|
| **Time Provider** | which clock the module uses |
| **Require Contact Verification** | players can only message addresses they know |
| **Smart Conversation Grouping** | groups same-subject mail into threads |
| **Anonymous Send** | the masked-sender feature |
| **Spam: Unknown Sender** | chance for mail from strangers to land in Spam |
| **Netrunning Resolution** | auto / flagged / GM decides |
| **Planted Program Firing** | fire on their own, or ask you first |
| **Exfil Folder Name** | what the players' stolen-files folder is called |
| **Notify GM of NPC Mail** | popup when players message NPCs |
| **Terminal Pins Auto-Show** | map pins visible without extra clicks |
| **Debug Mode** | the module explains its decisions in the console |

---

## How to run your first sessions

A pacing that works:

1. **Before session 1:** set up two networks and a dead zone, add three contacts, and send each player one message from someone their character knows. It'll be waiting when they first open their phone.
2. **Session 1:** players make their addresses, style their phones, and message each other and an NPC. You answer in character. That's enough. Let it breathe.
3. **Session 2:** a job offer arrives by mail — maybe anonymously. Payment attached as eddies. The job involves a data shard with three entries: a plain message, a locked photo, a bank account.
4. **Session 3:** the job leads to a terminal pinned on the map. Two accounts, one hidden. A camera feed, an incriminating spreadsheet, and a download action that needs a roll. Let someone fail and watch the heat show up on your Security tab.
5. **Later:** forged evidence, malware, countdowns. Add them when the table asks, not before.

---

## If you're making a video

Suggested chapters, in the order tables actually learn the module:

1. What is NCM? (show a styled phone and a terminal login)
2. GM setup: networks, scenes, contacts
3. The player side: making an address, the inbox, themes
4. GM mail tricks: NPC replies, anonymous send, self-destruct, spam
5. Your first data shard: convert it, fill it, watch it get hacked
6. Your first terminal: a preset look, a hidden account, a map pin
7. Hacking and heat: traces, escalation, malware, sweeps
8. The three rules (don't skip this one)
