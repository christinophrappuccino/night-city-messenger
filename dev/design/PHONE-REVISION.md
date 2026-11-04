# Phone revision: everything decided in mock Rounds 1–4

Written 2026-11-01. **All four rounds are approved by the dev as mocks. None of this is in the module yet.**
This is the spec to build from. Where it disagrees with `CALLS.md`, this document wins.

| Where | What it holds |
|---|---|
| `dev/design/CALLS.md` | The phone as built (phases 1–5, §14–§20) and the older design. §2 (numbers) and §19 (staged calls) are replaced by this document. |
| `dev/mockups/phone-numbers-round1-mock.html` | Round 1: what players see, plus the first GM table |
| `dev/mockups/phone-numbers-round2-mock.html` (+ `.js`, `.css`) | Round 2: GM tools and sharing |
| `dev/mockups/phone-numbers-round3-mock.html` (+ `.js`, `.css`) | Round 3: line types, corporations, shared lines, terminals, call logs, Trauma Team, Backup |
| `dev/mockups/phone-numbers-round4-mock.html` (+ `.js`, `.css`) | Round 4: Overheard calls |
| `dev/mockups/phone-numbers-data.js` | The place table, number parsing and the item rule, shared by the mocks |

Serve the mocks with `node dev/tools/serve-mockups.cjs`, then open `http://127.0.0.1:8123/dev/mockups/<file>`. Most pages use `?f=<frame>`.

**What runs today:** phases 1–5, using the old real-world style in `scripts/utils/phoneNumbers.js` (`+81 3-1234-5678`, `generateNumbers` defaulting to 1-555).

---

## 1. The goals

- **Our own fictional number system**, separate from real-world numbers.
- **Teaching it is the main goal, alongside the generator.** It must be easy to understand and easy to generate from, for GMs and players.
- It works with no setup, and every table can be edited by the GM.
- It never assumes Night City: a campaign can be set in Texas, overseas or anywhere else.

---

## 2. The number format

| Form | Example | When |
|---|---|---|
| Local | `WAT-4471` | Same city as your number |
| Same region | `SEA DWN-2210` | Another city in your region. The `+72` form shows in the breakdown |
| Full | `+72 SEA DWN-2210` | Anywhere else |
| No districts | `+83 OSK-1234` | A city with no book districts dials city plus number, so nothing is invented |

Rules:
- The parts are region code, city letters, three-letter district, then the line number. State and area are labels only and are never dialled.
- **Region codes are invented** and never match the real country's code (Japan is not +81).
- Region and city names show in words under the number.
- **A number says where it was issued and stays with the person when they move.** It never stores a network.
- The current connection decides whether a call works, which phase 4 (`utils/callNet.js`) already does. A Trace can also name the network the caller is on.
- Calls connect live at any distance.
- Each district has 10,000 lines. Draw at random, check against taken numbers, and claim only on save, with the GM client re-checking. Overflow is 5-digit lines or more districts.
- Matching ignores case and punctuation.
- Short words such as `TRAUMA` are special numbers (§9).
- One `parse` rule explains a number everywhere: picker, dial box, hover, GM tools.

**Old numbers are wiped at upgrade**, with no conversion or flag. They were flavour text, and the phone has never shipped.

---

## 3. The place table

One GM table drives everything, about 243 rows in the default list. Columns:
`Region code · Region · State · City code · City · Area · Code · District · Category · Players can pick · Status · Source · Listed`

- **Categories:** District, City, Corporate, Dead zone, Military, Burner. GMs can add their own, plus extra columns and new rows.
- **Players can pick** and **Listed** are separate ticks. A hidden number can exist and be dialled, but nothing says whose it is ("Unlisted number").
- **In-app editing:** pencil edits a row, plus Add a row, Add a branch, and find rows then Hide or Show. A row people hold numbers on locks its code and can't be deleted.
- **CSV export and import:** one row per place, shows a plan before applying, keeps the GM's extra columns, keeps places people hold numbers in. A blank template is available.
- **Starting lists:** 2045 (default), 2077, Blank. It reads **Custom** by itself once edited. A place in both eras keeps its code.
- **Sample campaigns:** Dallas and Tokyo.
- **Campaign home** drives short dialling, the picker start, the intro card and the Calls tab.
- Every column head has hover help, and each setting says in plain words what it does to players.

**Regions (invented codes):** 72 Pacifica Confederation · 10 NUSA · 14 Free State of Texas · 15 Free State of Southern California · 16 Free State of Nevada · 12 Canada · 53 Mexico · 40 EuroTheatre · 41 Southern Europe · 47 Neo-Soviet Russia · 83 Japan · 88 China · 84 Korea · 89 Taiwan · 66 Singapore · 67 Thailand · 68 Vietnam · 69 The Philippines · 70 Indonesia · 71 Malaysia · 63 Australia · 64 West Australia · 62 New Zealand · 93 India · 58 Brazil · 56 Colombia · 27 Africa · 30 Drift Nations · 31 The Deepdown · 48 Uzbekistan · 54 Cuba · 49 Israel · 90 Highrider Confederation

**The name is NUSA, not NUS.** It appears only in the Edgerunners kit; CORE and Night City 2045 say New United States.

**Night City 2045 districts (from the book; the codes are ours):**
- Island: LEU UMR DTN HOT (dead zone) LCH UNI GLN OJT SNC PRT REC OCZ
- Northside: NCM WAT KAB
- Mainland: NWB CHH EXZ HDK NHW HIZ SDO
- Southside: PPG RCO
- Outside: OUT PLY

Players can pick all of these except HOT, NCM and EXZ. BRN is a hidden exchange for burners.

**Corporations (Category Corporate, GM-held, 116 office rows):** ARA Arasaka · BIO Biotechnica · CBR Continental Brands · DGL Danger Gal · MIL Militech · NFF Network 54 · PCH Petrochem · RKL Rocklin Augmentics · SOV SovOil · TTI Trauma Team · ZIG Ziggurat · ZTM Zhirafa. One corp keeps the same three letters with one row per city, from CORE's Regional Offices, plus a Night City office for each. Arasaka's Night City and North America offices ship hidden in 2045 and listed in 2077.

**Judgment calls to keep visible:**
- Pacific Rim, Eurosource and Land of the Free are 2020-era sources. The dev accepted them.
- "Southern Europe" is my grouping.
- Which NUSA state a city sits in is real-world geography, not lore.
- Exchanges outside Night City are invented, and the few invented districts say "Placeholder district".
- The dev rejected `CP` for Crystal Palace; it is `PAL`.
- The 2077 names were checked against the Edgerunners Mission Kit handbook, except Little China.
- No RED book I searched defines a phone number format.

---

## 4. Player side: the Calls tab

- **My line card:** a cut-corner SIM shape, never a left accent bar. It shows the full number, never truncated, with a copy button and the voicemail, greeting and ring state in words.
- **With several lines, the number on the card is the dropdown.** It opens downward with every line, picking closes it, and the new number lands with its own settings. The card patches in place so the chip's animation never restarts.
- **SIM chip:** a pulse walks the four contacts, a key press flickers it, and ringer off turns it amber and slower.
- **Dial pad:** keys spell districts (9-2-8 = WAT). `+` replaces `*`. Typing on the keyboard lights the matching key with the same animation, and keys stay lit while held.
- **Dial box:** names only people in your contacts. Otherwise it shows the place. It never says a number is unused. A hidden special number gives no hint until the whole number is typed.
- **Scroll bug to fix:** every button on the Calls tab re-renders the viewer and jumps to the top, because the viewer only restores the mail list's scroll. Fix it for the whole tab.
- **Hover help on every control** across the Calls tab, call screen and Admin → Phone, guarded by a sim.
- **First-open intro** for players and GMs, reopenable from a ?, plus a "try a number" box. Use plain words, such as "district" for players. Guide examples are checked by a sim so they can't drift.
- **Clickable numbers** in mail, shards and terminal files. They fill the dial box and never name the owner.
- **Save number** from the call log and incoming calls, with no name needed. **Share my number** hands it over.

### Get a number (the picker)
- Top down, one level at a time: Region, State, City, Area, District, number. Picking moves on, and a trail goes back.
- All five levels always show, even with one option. A blank in the table is an option ("Whole city", "No state", "No district"). Numbers only come after step 5.
- Opens on the home city with numbers ready.
- **Directory** ("See the districts"): search on top, tabs for Home city, Other places, Corporations and Service. A row starts dialling it.
- GM rules limit the choices: reach (home city, region, anywhere; default anywhere), and whether players may pick their own digits.

### Several numbers
- Each identity has its own number.
- **Extra lines:** a label on the character, with no alias needed. Players add their own up to the GM's limit (default 1, 0 = off), and GMs can hand out more. No eddie cost for now.
- **Burners** are a line type on an extra line and retire when burned.
- **Numbers are never reused.** Changing, burning or deleting retires the old one, which then says "not in service". Extra lines get Retire in place of Change.
- **Changing a number needs GM approval by default.** It's a setting.
- A GM can release a retired number from GM tools. It asks first, because anyone who saved it would reach the next owner.
- There is no Move to. Change and Retire are how a number ends. GMs can switch a line off and on.
- **Deleting an actor or contact retires its numbers.** Factory Reset and Orphan Audit cover lines and retired numbers.

---

## 5. GM side: Admin → Phone

**Nav:** Live · Numbers · Overheard calls · Setup · Call log · Voicemail · Settings. The Round 2 and 3 mocks call Setup "Number setup"; Round 4 shortens it to **Setup**, and the build uses Setup, because the eavesdropping rules live there too.

### Numbers
- **People:** every identity and line, searchable by name or number. Tracks who holds what, kind, label and burn state. Shows soft sense-checks that never block, a "why this number" line and how the number reads to players. Change warns who loses the old number.
- **Walk through it (GM generator, dev 2026-11-01: "easier for GMs rather than just winging it"):** the same five steps as the player's Get a number, then the number. **In the build it is one component with a GM mode, never a second picker.** Details below.
- **Give numbers (bulk):** each row proposed from the contact's details with its reason, wearing a source chip (Organization, Location, Alias, Random, Your pick). Org-mates get neighbouring lines. An alias stays off its main's district. Players are left out unless ticked. Undo after applying.
- **Districts:** a board of tiles. Arm someone from No number, then click a tile; click with nobody armed to see who is on it. Tiles show GM-only and hidden. Area heads fold, and a closed head still shows who is inside.
- **Requests:** number changes and extra lines over the limit. Approving a change retires the old number.
- **Retired:** the list, with Release.
- **Corporations:** §7.
- **Shared lines:** §7.

### Walk through it: how a GM makes a number

Opened from **Walk through it** on someone with no number, on Change, on Add a line and on a Give numbers row. Mocked in Round 2: `?f=numbers&sel=tv`.

- **Same steps as players:** Region, State, City, Area, District, then the number. All five always show, picking moves on one step, and the trail goes back to any step.
- **GM mode differs in three ways:** it lists every row (corporate, hidden and GM-only, each tagged), it ignores the player reach limit, and it starts from the contact's details.
- **It starts filled in from `suggest`, with the numbers ready**, and says why with a source chip. The GM can accept it in one click or change any step.
- **From their details:** shortcuts that jump straight there, such as "Militech, Night City", their Location, or "Away from <main>" for an alias. On each step, what fits their details is starred and listed first.
- **The number step:** four free lines plus choose your own digits, checked against taken and retired numbers. It shows how the number reads from home and from far away.
- **Soft checks that never block:** "Works at Militech, whose Night City office is MIL. Fine if this is a personal line." with **Use their office**, and a warning when an alias lands on its main's district.
- **The one-click Use this stays** for GMs who trust the suggestion, and bulk rows keep a quick move.

**How it ties to the organization (a Militech contact):**
- The contact's Organization field finds the corp's office in their Location's city, so Tess Valdez starts on `+72 NC MIL-…`.
- Someone at the same organization already on that office gets a neighbouring line ("Next to Harlan Cole's line").
- The office row makes it a **Corporate line**, and the step says what players will see on a call: "Tess Valdez, Militech".
- A hidden office says players see Unlisted number.
- An alias uses its own organization, never its main's.
- Reaching a person by extension on the main number is set under Corporations (§7).

### How a contact's Organization finds an office

**Contacts don't need updating.** Master contacts already have free-text `organization` and `location`. Mocked in Round 2 (`orgMatch`).

| Organization says | Result |
|---|---|
| `Militech`, `militech`, `Militech International`, `Militech Security`, `Militech Corp` | Matches by itself: case and punctuation are ignored, and filler words (Security, Corp, International, Group…) don't count |
| `Trauma Team` | Matches: a corp's distinctive words must all be present |
| `Milltech`, `Rocklin`, `Danger Zone` | **A question, never a silent match:** "Did you mean Militech?" |
| `Maelstrom` | No match. It says so and offers an office, or Not a corporation |
| Empty | Falls to Location, then a random district players can pick |

- **It says when it misses.** The contact card, the walkthrough and Give numbers (a "to check" count plus a line on the row) all say "Organization says X, and no office matches".
- **Decide once.** Use, pick an office, or Not a corporation applies to everyone whose Organization reads the same, is kept in a world setting and is listed under Setup → Rules ("Which names mean which office?"), where it can be forgotten. Undo is offered.
- **The contact is never rewritten.** Players keep seeing what the contact says.
- A corp with no office in the contact's city says so and offers its other offices.
- Coworkers count across spellings, so `Militech Security` lands beside `Militech`.
- **Suggestions on the contact form:** Organization offers the corporations from the table and the organizations already in use, while staying free text. Not mocked; it goes on the real form.
- **Location needs the same care** (`rowForLoc`): looser matching, and saying when it misses. Not mocked.
- **Fix at build:** `MasterContactService.addContactIdentity` (line 180) copies the main's organization and role onto a new alias, which would land a burner on the main's corporate office and link them. A new alias starts with its own blank organization.

### Setup
- **How it works:** shown first the first time. "Try a number" shows what you see and what a player sees, side by side.
- **Rules:** each sentence changes as you change the rule.
- **Places:** §3.
- **Special numbers:** §9.
- **Line types:** §6.
- **Trauma Team, Backup:** §10.
- **Eavesdropping rules:** §12.

### Colour hierarchy
Toned section heads, hue words for role, org and place, violet for hidden, red only for burned and dead. Line types get a colour only in logs and lists.

### The digestible pattern (for every tab)
Question folds with the current answer on the closed head (first open), sub-tabs inside a detail, a single Needs you row, line cards folded except the first, menus instead of icon rows, search and filter on anything long.

### Other agreed items
Export for assigned numbers and the retired list; a Phone column in the address directory CSV; macro API; player actions that need a GM online say so. With no GM online, businesses go to voicemail, and service lines can't connect and charge nothing.

---

**Later decision (dev, 2026-11-02):** the Phone nav has one **Call log** button holding **Calls** and **Voicemail** tabs, with the unheard count on the button. It opens Voicemail when messages wait. **Edit a log** is a button on the Calls tab, not a Numbers tab.

---

## 6. Line types

GM-editable data. Built in: **Standard, Corporate, Burner, Payphone, Business.** New line type adds your own.

Each type sets the word on the call screen, the dial's timing (steady, slow, fast, flicker), what the other end sees, what a Trace finds, who may hold one, whether it can burn, whether it has a switchboard or extensions, and whether it sits in one place.

| Type | Screen shows | Trace finds | Other |
|---|---|---|---|
| Standard | Name or number | Owner | No word |
| Corporate | Person, then organization | Owner | Extensions, slow dial |
| Burner | Number only | Dead end | Can burn, flicker |
| Payphone | Its place | The place | Fixed, fast dial; anyone there can call from it |
| Business | Its label | The label | |

### The call screen is off limits
- **Do not change the call screen's icons or layout.** It stays in the player's theme with the same phone in the dial.
- A type shows only through the small word ("Incoming · Burner"), the name it displays and the dial's timing.
- **No colour or icon per type on the call screen** (dev: icons read as corny).
- **Mocks and code must render the real `CallHud._callHtml` and `_paintBadge`, never a hand copy.**

Approved additions on top: the type word while ringing, the company line with its small mark, and an **initials swirl** when there is no portrait (two dots swirling around the initials, in the real frame; "?" for unknown). The real screen shows no portrait while ringing, only once live, so a type's art appears after pickup.

---

## 7. Corporations and shared lines

- An office is a line with a switchboard, sitting at the corp's real HQ or branch. Players can call them.
- Main number reaches a switchboard (the GM, else voicemail). Extensions like `x17`. An extension can reach a person with no number of their own, and an unlisted extension works if typed.
- **A corporate call shows the person first and the organization under them ("John Anderson, Militech")**, read from the contact's Organization field. The company name alone shows only when nobody is named, or when a player dials the main number.
- Portrait is the person's. Corp art is GM-uploaded, a small mark beside the company, and the big picture only when nobody is named. **No game logos ship.**
- Alias lines use the alias's own organization, never the main's.
- GMs can call withheld; players can Trace.
- The Corporations list holds up at 116 offices with search, Show, Group and folds.

**CORE's HQs, for reference:** Arasaka Tokyo · Biotechnica La Jolla · Continental Brands Tulsa · Danger Gal Night City · Militech Washington D.C. · Network 54 Santa Fe · Petrochem Dallas · Rocklin Augmentics Austin · SovOil Moscow · Trauma Team Seattle · Ziggurat Night City · Zhirafa Vladivostok.

**Shared lines:** several people answer one number. Pressing Answer updates everyone's screen. It shows its name and hides who dialled. Add or remove people.

---

## 8. Sharing, and the alias leaks

**Sharing a contact:** Email, Number or Both per push. A contact shows only what you were given. Re-sharing adds the missing part. Who knows whom shows email and number separately (two buttons per cell). Choose which line of an alias to share. Hand a number over with a chat card or journal link. The contact form has a Generate button.

**Sharing an alias must never give away the main person or number.** Leaks found in today's code, all to fix:
1. `numberForContact` falls back to the directory or linked actor, so a player who only got an email still gets a Call button, and an alias falls back to the character's main line.
2. `pushToPlayer` copies `actorId` onto the player's alias copy (email shares too).
3. `phoneLines` is world-readable with owner actorId and name.
4. A call object carries the callee's actorId to the caller.

**The rule:** a player's alias copy holds only the alias's contact id, name, picture and what was shared. Mail and calls route through the contact id on the GM side, so **retest alias mail after removing `actorId`**. A Trace of an alias reveals the alias, not the owner; the GM reveals more by hand.

---

## 9. Special numbers and other systems

**Special numbers:** any string, with its own rules. Portrait, listed or hidden, what dialling does (including a macro or a recording), who gets through, what the screen and a Trace show (a Trace can return a false name), and an alert when dialled. There is no NPC behind one; the GM speaks for it, and each can call players itself. TRAUMA and NCPD are entries. Samples: BLACKWALL (macro), 666 "The Voice" (recording).

**Terminals:** a terminal gets a number. The GM picks what a caller hears (recording, modem tone, voicemail); no remote login for now. Accounts linked to a person show that person's call log and voicemail under the mail-mirror switch, in a Calls folder. No calling as an account yet.

**Call log editor:** for any line or terminal account. Whose log is a searchable picker (chip per kind, Has calls). Add, edit, delete, voicemail text, "add it to their log too", Fill in a week, CSV. Written entries always show; real calls follow the mirror.

**Trace:** writes to the Security log and adds heat.

**Access points:** a "call this number" chat card and journal link.

---

## 10. Trauma Team and Backup

Rules come from the book. Read the pages rather than copying them here: **CORE p.223–224** (Trauma Team), **p.158–159** (Backup). Printed page numbers; the PDF page is one less. Team stats stay in the book, and actors can be linked later.

**Trauma Team**
- Silver and Executive are monthly plans. The steps across the top of the screen are the whole rule: they have a plan, they get hurt, the call goes out, they arrive.
- **Plan source:** "I set it here" (default) or "From an item". Each plan takes a list of items, and having any one counts.
- **Auto-call:** an Agent linked to a Biomonitor calls by itself under the book's conditions. The item list is editable.
- An Exec's Teamwork rank can give cover (a switch).
- GM-uploaded logo, not a shipped one. A character with no plan gets no button.

**Backup (Lawman)**
- Only characters with the Lawman role get it, and it depends on their faction. **Each organization names its own groups**, and a rank can have several.
- 10 sample organizations through the real ScopePicker, whose search reaches the groups inside. Group search, rank filter, add and remove groups. Call as is a searchable picker.
- Sample NCPD and Militech group names are mine, not the book's.
- **Added 2026-11-02 (dev):** the GM can change a call's words per person, then per organization (lines, titles, callsign, who answers), and its colour, lights and sounds the same way. A person can have extra groups. Trauma Team's words are one set for the service. As built: CLAUDE.md, "what an emergency call says and looks like".

---

## 11. Gear and cyberware detection

Anywhere an item matters, the UI shows the item's own icon and who has it, read from character sheets.

- **Every gear setting holds a LIST, and any one item on it counts.** Picked with `showNamePicker({ multi: true, preselected, doneLabel })`, each item removable by its own ✕. A list of two or more says "any one counts".
- Any item type can be picked (gear, cyberware, programs). An item with no art shows a plain box.
- **Rule for the build:** match by normalized name, use `item.img`, and **cyberware counts only once installed: `item.system.isInstalledInActor`**, not the plain `isInstalled`. It follows a nested item up to its parent, so Amplified Hearing inside a Cyberaudio Suite counts. This was read in CPR's `cyberware-datamodel.js`, and the mock only fakes it with sample sheets.
- **Store the item's real type as well as its name.** CPR has the Radio Scanner as both gear and cyberware under one name.
- States shown: Carried, Installed, Not installed, Doesn't have it. Rows show who has it ("1 has it, 1 not installed"), with faces and a hover list.
- Never copy CPR art into the repo. The mock server serves it at `/_vendor/cpr-icons/`.
- CPR item names used: Radio Scanner/Music Player, Scrambler/Descrambler, Voice Stress Analyzer, Amplified Hearing, Biomonitor.
- I could not confirm a Trauma Team card item in the CPR compendium. The mock's card items are placeholders using the memory chip icon.

---

## 12. Overheard calls (replaces `CALLS.md` §19, "staged calls")

**The one sentence on screen:** "Write a conversation between two NPCs. It plays whether or not anyone is listening, and players only hear it if they have a way in."

**The path:**
1. **List of calls:** one row per call, saying who could hear it or "Nobody could hear". Foldable How this works. Search reaches names, people, networks and what is said. Show filter, New call.
2. **Write:** Who is talking → What they say → Start it.
3. **Running screen:** appears only once a call has started.

The **player preview** is an eye button on a player, and says it's a preview. **Eavesdropping rules** live under Setup.

**Who is talking:** two NPCs or aliases, where each is, what listeners can tell about them (name, number or nothing), their voice, and the network.

**What they say:** from a script (a reusable library with save, export and plan-first import), or "I type it live" (a side switch and a text box on the call screen). Each line has a side, text, voice (text, read out, recorded), a wait and marks. One line record; voice is a layer; **text is always there**.

**Marks, each explained on screen:**
- **Clue:** only the GM sees it. The running screen counts who has heard it, per listener.
- **Lie:** a listener with a voice stress analyzer sees the line flagged. Nobody else can tell.
- **Code word:** listeners hear the words as written. Only the GM sees "What it really means".

**Start it:** lists every player with how they could get in, or why they can't. If nobody can, it warns but still lets you start. When: on Start, or at a game time. Leave a record on terminals. Encrypted.

**Four ways in, each a choice the player makes:**

| Way | How it reaches them | Hears | Default clarity |
|---|---|---|---|
| In the room | A prompt when in range of someone on a call, even mid-call. **Never automatic** | The side they're near only, clean, no roll | Clear |
| A tap on a node | An alert from a tap they planted | Both sides | 45% |
| Jacked in | Listen to traffic in a node session: a roll and a move | Both sides | 70% |
| A radio scanner | A Scan button while they have one, with no node needed | Both sides, on that scene | 25% |

- **Anyone can join at any point and hears from that line on.** The screen says "Picked up on line 3. Earlier lines were missed."
- Two ways at once: the best one wins for each side.
- An intercept's name box shows one identifiable side only. It uses the real call screen with the word Intercept, violet, Stop listening and no talk modes.
- **Encrypted:** tap, jack-in and scanner get noise without a descrambler. The room still hears it.
- **Garble is decided before text reaches the listener.** The real word is never on the page. Per-word thresholds mean lowering the garble only ever reveals more.
- Lines **type out like a real call** (`typeOutMs`, caret, real subtitle markup), and garbled words type as garble.
- **Enhance:** a skill roll against a DV clears more words. **Save** goes to EXFIL as an audio log, as garbled as heard, from the line they joined on.

**Running screen:** Play, Pause, Next line, End the call, click a line to jump. What is being said (code word meanings shown to the GM). Who is listening, with way, clarity, joined line, clue count, preview, Cut, and Cut with a trace. Everyone else, with how they could join. **A click on the line:** every listener sees it. **Nothing notices a listener by itself**, except a failed jack-in roll, which traces as it does today. A call with no listeners carries on anyway. The two "Mock:" buttons are not part of the real build.

**Rules (Setup):** who counts as in the room (tokens in range or same scene; squares, default 6; hearing items double it), which gear matters, what rolls need (Enhance skill and DV 15, Listen to traffic DV 11), and whether calls leave a trail.

**Live listening is for these calls only.** Real player-to-player calls keep today's after-call tap copy: out-loud calls have no text, and players haven't agreed to being overheard live.

**`waysFor` in the Round 4 mock is the rule.** The build reads tokens, taps and node sessions. A node only carries a call when it stands on a scene with one of the speakers, the same rule as mail taps.

---

## 13. Decided against, or reversed

Don't reintroduce these without asking.

| Idea | What happened |
|---|---|
| Delayed long-distance | Dropped. Calls connect live; a slow line, if wanted, is a line type |
| Networks with a city; exchanges tied to nodes | Dropped. A number never stores a network |
| Moving a number to someone | Dropped. Change and Retire only |
| Blocking numbers | Dropped |
| Data Term lookup, calling shards, phone-specific malware | Dropped |
| Utility Codes | Left out |
| Eddie charges of any kind on calls or lines | Dropped: not fun |
| Group calls | Out of scope for this launch |
| Colours or icons per line type on the call screen | Rejected |
| Caller ID showing only the corp name | Replaced by person first, organization under |
| Calls being watchable (the watch feature) | Not watchable, on purpose |
| Live listening to player calls | Not for now |
| "Switch to code words" while running | Removed: nothing changed for a listener |
| "They heard a click" as a GM-only note | Became A click on the line, which listeners see |
| Left-bar accent strokes on phone UI | Dev dislikes them |

---

## 14. Still open

- **A phone icon inside the name box:** the dev says there is one. The real code and git history have none, and I read "the phone by the name" as the arcs. Waiting on a screenshot; do not add it until then.
- **Code word "key":** the old design said "nonsense without the key", but nothing defined a key. Currently a GM-only meaning note.
- **Hidden numbers sit in world data**, readable from the browser console. Accepted so far as a known limit.
- **Theme:** a line type's colour must stay readable wherever logs and lists show it. Phone number parts stay coloured from the theme unless told otherwise.

---

## 15. Build order

1. Commit the mocks locally.
2. **Number system:** format, places, picker, generator, GM tools and sharing (Rounds 1–2), wipe old numbers, fix the alias leaks and the Calls tab scroll bug.
3. **Round 3:** line types, corporations, shared lines, terminals, call log editor, then Trauma Team and Backup last.
4. **Two-client test** of calls. Phases 1–5 have never had one, though the dev has live-tested phase 4.
5. **Overheard calls** (Round 4).
6. Guides, `CALLS.md` as-built notes, changelog, then release 2.1.0, which is held until the phone is finished.

---

## 16. Gaps found in the 2026-11-01 audit

Checked by comparing this document with the mocks and the real code.

### Not mocked yet: Round 5

These are screens people will use, and no mock shows them.

1. **GM Live tab with the new systems.** Live hasn't been revised since phases 1–5. It has to show an incoming call to a corp switchboard or extension, a shared line, a special number and running overheard calls, and how the GM answers as each.
2. **"I type it live".** A one-line description so far: the GM's call screen with a side switch and a text box.
3. **A player's real prompts for overheard calls.** The Listen prompt in range and the tap alert appear only as preview cards, not as the real toast or prompt.
4. **Where Scan lives.** Nothing says where the Scan button goes. My pick is the Calls tab, only while they have a scanner.
5. **Listen to traffic in the real node console.** Shown as a card; not placed among the real session actions.
6. **Payphones.** One line of design: placed like a map pin, and anyone there can call from it. Should reuse access points, with how a player actually calls from one still to be shown.

### Written down, needs no mock

- **Data model (write before building).** Where each thing is stored: place table overrides (ship the defaults in code and store only GM changes, the `encoderConfig` pattern), lines, retired numbers, requests, line types, special numbers, shared lines, scripts, organization names. This document doesn't define it.
- **What the upgrade wipes.** Numbers on actors, master contacts and player copies, `phoneLines`, and the settings `callHomeCode` and `callDefaultRegion`. My pick: call logs and voicemail stay as history, and their old numbers read "not in service" if redialled.
- **Existing sims assert the old format:** `test-call-rules`, `test-call-service`, `test-calls-tab`, `test-admin-phone`. They need rewriting with the new rules, and new sims for parsing, generation and the leaks.
- **Cleanup.** Factory Reset and Orphan Audit don't mention lines or retired numbers today. World settings do reset, but Orphan Audit needs lines whose owner is gone. Deleting an actor or contact must retire its numbers.
- **Macro API.** Nothing for phones exists in `MacroAPI.js` yet. Needs at least: get a number, give a number, call, start an overheard call.
- **Admin Overview.** Number requests and a special number's dial alert should reach the NEEDS YOU queue. Not designed.
- **Sound Board.** New sounds join `soundCatalog.js` so a GM can replace them: Trauma Team monitor and dispatch tones, the radio squelch, arrival stingers, and a payphone ring. Line types change the dial's timing, not the ring.
- **Clickable numbers.** To avoid false hits like a licence plate `ABC-1234`, only text that matches a real row in the place table becomes a link.
- **Theme coverage.** Round 1 was checked on the default and Arasaka player themes, not all of them. The build needs the contrast and text-scale checks across the player presets.
- **Guides.** Player Guide and Getting Started need number sections, with examples checked by a sim.

### Decided 2026-11-01

- **No eddie charges for calls.** The dev: not fun. This covers per-call and service-line charges. It replaces the earlier "shared way to charge eddies". The plan fee for Trauma Team stays a story detail, never charged by the module.
- **Player characters get no Organization field.** The GM uses the walkthrough for them.
- **Group calls are out of scope for this launch.** Fine to think about; not to prioritize.

---

## 17. Round 5: screens and the emergency calls

Mock: `dev/mockups/phone-numbers-round5-mock.html` (`?f=trauma|backup|live|typelive|prompts|pay`, `&o=<case>`, `&still=1`). Awaiting a verdict. It settles the six items in §16's "Not mocked yet".

### Trauma Team and Backup calls (dev: "an immersive animation that makes sense")

**They are built on the real call screen.** `CallHud._callHtml`, the dial with the phone in it, the arcs, the name box, the network line and the keys all stay. Added: colours through the real `--ch-*` variables, the picture frame's contents, one panel under the meta line, and the room around the card. This is the one approved exception to "the call screen stays in the player's theme", because these calls should read as emergencies.

**Trauma Team (red and white):**
1. The call starts by a press, or by itself with "HP 4 is under BODY 6. Your Biomonitor is calling for you." and the word Biomonitor alert.
2. It connects. **The picture frame becomes a live heart trace** that speeds up and gets shakier as HP drops, with HP in the corner and the plan on the frame's tab. The room's edges pulse red in time with it.
3. Four steps tick off under the name: Plan, Location, Dispatch, En route.
4. A d6 rolls for the rounds. Dispatch speaks, typed out like any call.
5. Ambulance pips count down. Hanging up leaves a small countdown strip, and the team still comes.
6. **On arrival, everyone looking at that scene** gets sweeping searchlights and "TRAUMA TEAM ON SCENE, first in the order".

No plan refuses ("This number is for subscribers."), and no signal says no call went out, both through the real ended state.

**Lawman Backup (a radio, blue, with soft red and blue at the room's edges):**
1. The word is Radio and the name is the organization's dispatch. Hang up reads Release.
2. **The picture frame shows the transmission** as a voice waveform, tagged with the channel, and the Lawman's words type out.
3. A d10 lands against their rank ("you need 5 or lower").
4. Success: the group responds, a d6 sets the rounds, and shield pips count down. A 6 brings the next group up.
5. Failure: the waveform bursts into static, "No units free", and Call again stays disabled until their next Turn.
6. On arrival, everyone on the scene gets red and blue sweeps and "NCPD ON SCENE".

**Rules for the build:**
- Rounds follow the combat tracker when one is running; otherwise the GM moves them on from Live.
- Rolls use real dice, wait for Dice So Nice, and post their chat card at the climax, like every other roll (`deferChat`).
- **Flashing limit:** nothing flashes faster than about twice a second, and red and blue never strobe. Reduced motion or the module's animation preference shows still frames.
- Dispatch wording here is ours, never the book's.

**Pace (dev: "goes so fast"):** about nine seconds from dialling to en route, longer with Dice So Nice. A click skips ahead. The timings are one list per call, so they're easy to tune.

**Rolls in chat (dev):** every roll posts a card in the chat log, in the real `ncm-cc` family, the moment the die lands: the Trauma d6, the Backup d10, and the Backup d6. It follows the user's roll mode, so a player can whisper it.

### Live
Emergencies come first: who, plan, HP, place, pips, −1 round, They arrive, call off. They never wait in the queue.

**The call queue (dev: "chaotic if all players are calling the GM at once"):** replaces Ringing for you.
- Longest wait first, numbered, with one call open at a time, so a busy table stays one short list. A Show filter narrows it by kind or to On hold.
- The open call says what the player will see. Its buttons are **Answer as <who they asked for>**, **Answer as…**, Hold, voicemail and decline.
- **Answer as… is the real name picker** (dev's idea): who they asked for, then the rest of that company with the switchboard, then anyone else, searchable with filter chips. So a Militech call can lead to someone else at Militech.
- **Pass to…** keeps the call and changes who the GM is, and the caller hears "One moment".
- **Hold** shows the caller the real On hold state and stops their ring clock, so they don't drop to voicemail. Answering another call holds the current one, using the real call-waiting flow.
- **Hold everyone** and **Voicemail for all** handle a pile-up. Calls still go to voicemail at the ring time if nobody touches them, so no one is stuck.
- Players just hear it ring. The queue is never shown to them. Overheard calls running get their own section with listeners and Open. The Switchboard section is unchanged.

### I type it live
The real call screen with a bar under it: who is talking, the text box, then Text, Read out or Hold to speak. **Enter sends and passes to the other person. Tab switches.**

### What players actually get
- **In range:** the module's normal toast, "Someone nearby is on a call", with Listen and Leave it. Never automatic, and it asks once per call.
- **A tap:** a toast with Listen and Let it record; a copy lands in EXFIL when the call ends.
- **Scan:** a strip at the top of the Calls tab showing the scanner's real icon, only while their sheet has one.
- **Listen to traffic:** one more action in the real node console's session list, with a DV and a move.

### In range: how it is decided

Mock frame `?f=range`. All must be true:
1. **The NPC has a place on a scene.** Set per call under Where they are: **Their token** (follows it, the default when one exists), **A spot I click** (for an NPC with no token, including contact-only NPCs), or **Off-screen** (nobody can be in the room; a tap, node or scanner still can).
2. **The player has a token on that same scene.** Their owned, non-hidden token, the same test terminal pins use.
3. **Close enough:** centre to centre in grid squares, within the rule's range (default 6, half a square of grace), doubled by a hearing item from the list. The rule can instead be Same scene.
4. **Optional, off by default: Walls block it.** Uses the map's walls; which wall type counts (sound) is to confirm in the build.

The GM's client checks when the call starts and whenever a token moves, so walking up mid-call works. It asks once per call, and declining is final for that call. Hidden NPC tokens still count, so a player can overhear someone they can't see.

### Payphones

**Lowest priority (dev: not very common in the setting).** Built last, and it can slip from the launch without affecting anything else.

Placed with the existing **Place on a scene…** dialog as a new access-point kind: pin, step-on area or both, reach in squares, hidden until revealed. Listed under Access points, with the number under Numbers. Double-clicking in reach opens the dial pad with Calling as set to the payphone: the other end sees the place, and a Trace finds the place. Out of reach says you are too far. When someone calls it, the pin rings on the map for anyone in reach, who get Pick up; otherwise it rings out. It has no owner and keeps only a call log.

#### Decided 2026-11-03 (in 2.1; supersedes "lowest priority")

Approved mock: `dev/mockups/payphone-booth-mock.html` (three rounds; reference screenshots `cyberpunk2077phone1/2.png` beside it — the layout and feel, drawn our own way, never a trace of that art).

**The booth window.** Clicking a payphone opens a mechanical booth, not the dial pad. It is for dialling and picking up only; once a call connects it hands off to the normal call screen, which stays untouched. Parts: chipped top plate with a credchip slot (flavour, nothing is charged) and a hook gauge whose needle tilts when the handset is off; a display window held by two screws (status, number, ad ticker); the handset hung in a recess on the left (click to lift / hang up / pick up); four speed-dial keys (the character's first four phone contacts); REDIAL, BOOK (the character's phone contacts on the touchscreen), SPKR, and an optional red Help key; a small touchscreen keypad (0–9, delete, OK); Eject / Vol round buttons (flavour); stickers; speaker grille; a plate with the place and number. Keyboard digits / Backspace / Enter work. Out of reach: the booth does not open, one line says why.

**GM customizing, per booth:** style preset (street booth, corporate kiosk, NCPD call box, bar wall phone), brand line, casing / handset / screen colours, a **Grit** slider 0–100 (one `--pb-grit` fades grime, paint flaked to bare steel, scratches; tiers switch on rust from the screws ≥40, heavier rust ≥60, wrecked ≥85 = cracked flickering screen, dead 7 key — still works), **graffiti**: up to three tags (text ≤24 + paint colour) in fixed spots (big on the casing, small low down, smaller on the top plate), empty = none, independent of Grit; an **Exposed wiring** slider 0–100, separate from Grit (≥10 the handset cover cracked open with its wiring showing; ≥40 a hole torn in the casing bottom-left with a board and a few wires; ≥75 the metal peeled back, a cable bundle with a zip tie hanging below the booth, swaying, the odd spark; the hole ages with Grit — sooty, a rusting rim, a dirty board and flap, dusty wires; in the dark behind it a back plate, a second board, a heat sink, a ribbon cable and a blinking LED sit barely visible, and the cursor over the hole works as a torch that lights them where it points), stickers on/off, waiting text, ad ticker lines, condition (working / out of order: no dial tone, can't be called), who can hear, the Help key (NCPD / Trauma Team / none), ring / key / hook sounds (Sound Board defaults, a file per booth). Saved booth styles so many booths share one look. Place, number, reach and hidden come from Place on a scene….

**Several people.** One handset, one caller: anyone else in reach sees "<name> is on this phone" and a dead keypad. A ringing booth: first click picks up, the active GM decides who was first; others see who picked up. **Who hears:** the handset is private; the caller's SPKR puts the call on the speaker and everyone in reach follows it read-only. Per booth: caller's choice (default) / always private / always speaker.

**Rules.**
- Reach is checked only on the map pin / step-on area. A hotbar macro, chat card or journal link opens the booth without a reach check (the terminal rule).
- A booth call is **not** in the character's own Agent call log; the booth keeps the log. The GM's call log shows who really called ("Rache via Payphone · Kabuki"). The other end and a trace see only the place.
- Payphones are **wired**: they work in dead zones, through jams and with a node down, and node taps don't hear them.
- A ringing booth is **heard by the whole scene**; only people in reach can pick up. Nobody picks up → it rings out (no voicemail).
- The GM can ring a booth as any NPC from its admin page ("Ring this payphone as …"). Macros: open a payphone, ring a payphone.
- The Help key's call still checks the caller's own Trauma Team plan. The character picker is the terminals' (`resolveOperator`).
- Cleanup: Factory Reset, Orphan Audit, a deleted scene removes its booths. Reduced motion stills the booth; its text follows Text Size.

**Where the GM edits it (dev, 2026-11-03: "put this in where we can customize payphones in the admin panel").** Admin → Phone gains a **Payphones** nav item: every booth in the world (scene, number, style swatch, condition, who's on it / ringing now), and picking one opens the booth editor from the mock (style, colours, grit, wiring, graffiti, screen text, condition, who can hear, help key, sounds) beside a live preview of that booth, plus Ring this payphone as…, Open it, Go to its scene, saved booth styles. Admin → Access points lists payphones as a kind and links to the same editor; Place on a scene… → Payphone creates one. The Round 5 mock's payphone pieces carry over: payphones in the Live call queue (the Payphones filter), the "A payphone is ringing — Pick up / Let it ring" prompt (now shown to everyone on the scene, Pick up only in reach), and the Calling-from-the-payphone context — the booth replaces Round 5's plain dial pad.

---

## 18. Data model

Written 2026-11-01, before the build. Rules live in `scripts/utils/phoneNumbering.js` (pure; sim `test-phone-numbering.mjs`). The shipped table is `scripts/data/phonePlaces.js`.

**The rule for shipped data:** defaults live in code, and a setting stores only what the GM changed, laid over them (the `encoderConfig` pattern). A later version can then add places to existing worlds with no migration. Sanitizers never throw.

**World settings** (`config: false`; written by the GM, and a player's write relays):

| Setting | Holds |
|---|---|
| `phonePlaces` | `{ list: '2045'\|'2077'\|'blank', changed: { [rowKey]: row\|null }, added: [row], extraCols: [] }`. `null` removes a shipped row. Any edit makes the list read Custom |
| `phoneRules` | `{ home: {rc, city}, reach: 'home'\|'region'\|'all', ownDigits, extraLines, changeNeedsGm }` |
| `phoneLines` (exists) | `{ [key]: line }`, key from `keyOf` (`+72-NC-WAT-4471`), line below |
| `phoneRetired` | `[{ key, number, was, why, at }]`. Never reused |
| `phoneRequests` | `[{ id, actorId, kind: 'change'\|'extra', to, label, at }]` |
| `phoneOrgNames` | `{ [orgKey]: officeName\|'' }`. `''` = not a corporation |
| `phoneLineTypes` | Changes to built-in types, plus the GM's own |
| `phoneSpecial` | `[{ id, num, name, img, listed, act, text, macro, who, allow, show, trace, falseName, alert }]`; TRAUMA and NCPD ship as entries |
| `phoneOffices` | `{ [rowKey]: { answers, recording, art, exts: [{ x, contactId, listed }] } }` |
| `phoneShared` | `[{ id, key, name, members: [ownerRef] }]` |
| `phoneEmergency` | `{ trauma: { source, itemSilver, itemExec, auto, bioItem, teamwork, noPlan, logo, plans: { [actorId]: plan } }, backup: { orgs } }` |
| `phoneEavesdrop` | `{ room, range, amp, scanner, desc, stress, walls, skill, dv, jackDv, records }` |
| `overheardCalls` | Scripts plus scheduled and running state |

**A line:** `{ number, kind: 'main'|'alias'|'extra'|'burner', type, label, off, owner, settings, why, at }`. `number` is the full form. `settings` keeps today's greeting and voicemail shape.

**Where a number shows up:**
- The `phoneLines` entry is the source of truth. `phone` on the actor flag and on master contacts stays as the existing mirror (`CallService._mirror`), so other readers don't change.
- A player's contact copy holds what was shared with them: `phone` and a `shared` field (`email`, `number` or both).

**Aliases (§8):** an alias line's `owner` carries only its `contactId`. The character it belongs to is resolved on the GM's client when a call routes. Ringing an alias relays through the GM, so the caller's client never needs the actor. World settings are readable from the console, so this removes the leak from every screen and from call objects. **Known limit:** a determined player reading a setting from the console can still see contact ids and hidden numbers.

**Call logs and voicemail stay as they are:** journal pages in the owner's inbox.

**Migration v4** (`MigrationRunner`, GM only, no prompt, as the dev decided):
- Clears `phoneLines`, and `phone` on actors, master contacts and players' contact copies. Call logs and voicemail stay as history, and their old numbers read "not in service" if redialled.
- Stops reading `callHomeCode` and `callDefaultRegion`. Their stored values stay on disk, inert, as with other retired settings.

**Cleanup:** deleting an actor or contact retires its lines. Orphan Audit lists lines whose owner is gone. Factory Reset covers these through the settings reset, and migration keeps its stamp.
