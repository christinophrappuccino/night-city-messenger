# NCM — v1.2.0 Release Checklist

The live-test pass that has to happen before v1.2.0 goes public. **Nothing below has been run in a real Foundry world yet.** All of it has been checked only by sims and headless-browser renders. Sections run from "release blocker / newest code" down to "older code that was also never live-tested". Tick boxes as you go. Report anything that doesn't match "**Expect:**".

Built through commit `02a6d5b` (2026-10-06).

---

## Part 0 — Setup and smoke test (15 min)

- [ ] **Use a throwaway world** (or a copy of a real one). Factory Reset and the namespace migration both rewrite world data.
- [ ] Keep the browser console open (F12) the whole time. **Any red error mentioning `night-city-messenger` is a finding**, even if the UI looks fine.
- [ ] World loads with no NCM errors in the console.
- [ ] As GM, in the console: `game.nightcity.verify()` then `game.nightcity.verifyPhase6()`. **Expect:** all pass. Phase 6 now covers the Encoder (6.14) and the legibility layer (6.15).
- [ ] Open each window once: Agent inbox, composer, Contacts, Admin Panel (every tab), GM Contact Manager, Network Manager, Malware Workshop, Program Deck. **Expect:** each one opens with no console error.
- [ ] Two clients from here on: a GM in one browser, a player in another (or an incognito window) logged in as a user who owns a PC. Read "Read before any two-client test" below before filing a "player action does nothing" bug.

---

## Part 1 — Upgrade path from v1.0 (RELEASE BLOCKER, 15 min)

Every existing user will go through this, because the module id changed (`cyberpunkred-messenger` → `night-city-messenger`). You need a **backup of a world that ran v1.0** with some messages, contacts and a shard in it.

- [ ] Restore the v1.0 world copy. Make sure the old `cyberpunkred-messenger` module is **disabled/uninstalled** and this build is enabled.
- [ ] Load as GM. **Expect:** a migration prompt asking to move the old data. Accept.
- [ ] **Expect:** it reports what it moved and asks to reload. After the reload, the old inboxes, messages, contacts, shards, terminals and module settings are all still there.
- [ ] Reload again. **Expect:** no second prompt.
- [ ] Player logs in. **Expect:** their inbox and theme are intact (client settings migrate on their first load).
- [ ] Declining instead (on a second copy): **Expect:** the module runs empty and the prompt comes back on the next load.

---

## Part 2 — Shard theming (most likely to be wrong, 10 min)

- [ ] Open a shard using a **non-blank preset** (Corporate Dossier, NetWatch…) → Configure → **Theme** → drag **Contrast**. **Expect:** the shard visibly changes. *This was dead on 8 of the 9 presets before.*
- [ ] **Expect:** the shard window's title bar wears the shard's colours, and the title is the shard's **name** with no "DATA SHARD:" prefix.
- [ ] Theme tab round-trip: pick a preset card, override one colour, change a font, set a wallpaper → **Save**. Close and reopen. **Expect:** it all stuck.
- [ ] Change something, then **close without saving**. **Expect:** any open viewer of that shard snaps back.
- [ ] A **blank-preset** shard now follows the player's Agent theme (it used to be stuck on brand cyan). If that reads wrong, note it; giving it its own palette is a one-line change.
- [ ] Save a **look** and a **full preset** to the libraries. Apply the full preset to a second shard. **Expect:** security only travels if you ticked the box when saving, and the apply confirm says so.

---

## Part 3 — Shard Encoder (brand new, TWO CLIENTS, 45 min)

Setup: as GM, run **`tools/test-encoder-setup.macro.js`** (select the player's PC token first). It switches player authoring on and gives that PC three blanks: Scrap, Standard and Premium. Give the PC some eddies and ranks in Forgery, Interface, Cryptography and Electronics/Security Tech.

**Doors**
- [ ] Agent → Shards tab → **Encode new** pill opens the Encoder.
- [ ] Right-click an item on the PC's sheet → encode option opens it **on the BLANK stage** (not Program).
- [ ] Program Deck → the empty **New program** cartridge opens it on the Program branch.
- [ ] Admin → Shards → Player Authoring → **Who can make them**: set a rule the PC fails. **Expect:** on the player client, the pill, the right-click entry and the Deck cartridge are all **gone**, not present-but-refusing. Set it back.

**Content branch**
- [ ] Pick a blank, write a **dossier** (or document) in the composer, encode it. Hit each rung if you can (adjust DVs in the GM card to force them):
  - [ ] **Clean:** the shard is created and shows up in the Agent's Shards tab and on the sheet. The seal button reads **Open it**.
  - [ ] **Sloppy:** it writes. ANALYZE on that file later flags it FORGED.
  - [ ] **Rejected:** nothing is written. A **Standard** blank is BRICKED (flagged and renamed, not deleted, and no longer offered as a blank). A **Premium** blank is only wiped and can be reused. **Scrap** bricks and fires a trace.
- [ ] A **message / note / cred drop** needs **no roll**: no die, no ladder, and the blank is never at risk.
- [ ] **Cred drop:** the eddies are checked up front and debited from the PC **only** once the shard is written. A rejected encode refunds nothing because nothing was charged.
- [ ] **Several files on one chip:** add a second file (**Write another file** → pick a type → the editor opens). **Expect:** a new file, not an overwrite of the first. The DV rises per extra file. A Scrap blank refuses a second file (capacity 1).
- [ ] Start one type in the composer, switch it to another, save. **Expect:** the roll uses the type you actually wrote.

**Program branch**
- [ ] Payload/Malware tile → Program. Pick family → ability → craft skill. **Expect:** only abilities your Interface rank unlocks are offered. The readout sentence and the actual roll quote the **same** number.
- [ ] Encode it and load it in the Program Deck. Carry it to a terminal and UPLOAD (see Part 7).

**Lock, Look, Market**
- [ ] **Lock** stage: roll Cryptography and Elec/Sec Tech. **Expect:** a roll never fails; it only caps the encryption DV and opens Black ICE / bite-back / key item. Then a GM opens the finished shard and has to breach it like any locked shard.
- [ ] GM card → Basics → disallow Lock. **Expect:** the stage disappears from the spine entirely.
- [ ] **Look** row: pick chip art and a preset, **mix your own** accent + ground (a preset chip un-lights when you do), and write a custom startup title. **Expect:** the finished shard boots with that art and title.
- [ ] **Chip icon builder:** shape + colour + FA symbol or image → the item icon becomes that baked chip.
- [ ] **Market** (pricing = Propose): the player proposes a price at the seal. **Expect:** the GM gets an Approve / Counter / Deny prompt, and the price lands on the item **only** after approval. Closing the prompt counts as deny. With no GM online, the player is told so.

**Optional depth and GM card**
- [ ] GM card → Optional depth: turn on **gear** (list an item the PC carries), **time** and **assist**. **Expect:** the readout names the gear, the game clock advances (or the GM gets a whisper if the player can't move it), and the assistant's bonus shows in "Locked in".
- [ ] Admin text size **150%** (Tools tab) → open Player Authoring. **Expect:** the Types/Programs tables fit with nothing off the right edge.
- [ ] Admin → Shards → **Copy Shards to Items**. **Expect:** world-item copies filed under Player-Made Shards → the character. Deleting a copy does **not** gut the player's shard.
- [ ] Admin → Shards rows show a **"Made by <character>"** badge (gold when the encode was sloppy).

**Accessibility panel**
- [ ] Encoder footer → **DISPLAY**. Try each preset (Large text / High contrast / Calm / Maximum). **Expect:** the change applies live, borrowed Workshop text scales too, and with OS reduced motion on, the Motion setting can't be raised above it.

---

## Part 4 — Boot splash, Factory Reset, tester-round fixes (20 min)

- [ ] **Boot splash:** reload, open the inbox. **Expect:** a ~520px cyan panel (not full-screen, no dark overlay) etches "NCM" and the inbox opens behind it. Switch the tab away mid-splash and back: the inbox still opens. A second open in the same session shows no splash.
- [ ] **Factory Reset** (throwaway world only): Tools → Danger Zone → Factory Reset. **Expect:** a census of what will go, the button stays disabled until you type RESET, then a clean world after the reload, and **no** namespace-migration prompt afterwards.
- [ ] Assign nothing on the user sheet, but give a player **ownership** of a PC. **Expect:** that PC appears in Messages → **View Inbox**, **Mass Broadcast**, Contacts → share dialog, "Known by" pips and the Player Characters group.
- [ ] "Known by" pips actually change after sharing a contact.
- [ ] Share a **Player Character** row to another player. **Expect:** it arrives, and re-sharing doesn't duplicate it.
- [ ] Import Actor (an NPC) → share to a player → the player messages it. **Expect:** it sends, with no "Contact Not Found".
- [ ] Players have a **Remove** button on their own contacts (card + detail panel).
- [ ] Admin hard-delete a message. **Expect:** it really goes, or you get a reason.
- [ ] GM Contact Manager → detail panel **Share** select lists the characters, not just an empty "Players" heading.
- [ ] Networks → **Network Broadcast** reaches every active user **including the sending GM**. With no players online, it is not posted publicly.
- [ ] GM view on **clean-light** admin theme: the message **subject** is readable (no white on white).

---

## Part 5 — Thread 6: EXECUTE malware + SYSTEM SWEEP (never live-tested, 25 min)

Setup: run `tools/test-terminal-setup.macro.js`, then **`tools/test-thread6-setup.macro.js`** (it gives the PC a go-bag with keylog / backdoor / icepick, and pre-arms four residents on the terminal).

- [ ] Log into the terminal as the player → OPERATOR TOOLS → **SYSTEM SWEEP**. **Expect:** a mediocre roll finds the low-DV residents but **not** the DV-22 one, and never says how many were missed. The player sees "UNKNOWN PROCESS". The GM sees type, provenance and the forgery tell.
- [ ] **DEFUSE** one as the player. **Expect:** it relays and leaves the GM's Planted & Resident list.
- [ ] UPLOAD **backdoor.exe** → log out → trigger it. **Expect:** a hidden password account appears on the box, the creds are whispered to the runner, and it closes after 24h of game time.
- [ ] UPLOAD **keylog.exe** → someone logs into the target account. **Expect:** the runner gets that account as a lead.
- [ ] UPLOAD **icepick.exe** → trigger it. **Expect:** the linked Black ICE hits the intruder.
- [ ] **Malware Workshop** (Admin → Security → Programs): create a program, save it to the library, put it on a shard, run it from the Program Deck.

---

## Read before any two-client test (applies to Parts 3–8)

- **A GM must be logged in the entire time.** Almost every player action writes to GM-owned data (world items, terminal/shard journals) and *relays* to the GM to actually happen. **No GM connected → the action silently does nothing.** That is not a bug — it's the security model. If something "does nothing as a player," check this first.
- **Players choose which character they're acting as via the OPERATOR chip** (top of a terminal's login screen / mailbox HUD). Every roll, siphon, and eddies payout uses that character. If money lands on the wrong PC, the wrong operator was selected.
- **Quick triage for "X does nothing as a player":** (a) Is a GM connected? (b) Does that action relay (most content actions do)? (c) Is the button gated (needs the right operator / capability)? Check those three before filing.
- **Seed macros** (paste into a Script macro as GM, run once):
  - `tools/test-terminal-setup.macro.js` — builds a fully-authored test terminal (4 accounts incl. a hidden one, priority-coded mail) and opens it.
  - `tools/test-upload-setup.macro.js` — builds a "go-bag" data shard of forgeries to carry to a terminal and UPLOAD. **The shard must end up owned by the actor your operator chip points at** (the macro handles this; just make sure you operate as that PC).

---

## Part 6 — Netrunning Resolution modes (never live-tested)

Lets the table pick *how* a hack/upload check resolves. Three modes.

1. **Admin Panel → Security tab → "Netrunning Resolution" card → set to "GM adjudicates."**
2. As a **player**, do any gated hack — crack credentials on a terminal, siphon an account, or run an UPLOAD.
   - **Expect:** the player's console shows a pulsing **AWAITING GM — RUN IT AT THE TABLE** stage. The **GM** gets a "NET ACTION // ADJUDICATE" prompt naming who/what/DV. GM clicks **PASS** or **FAIL** → the player's console resolves to match and the action applies.
   - **DISMISS** on the GM prompt → the action is **withdrawn**: nothing happens, no trace fires, the player can retry. (This is intended — it's not a failed hack.)
   - **Cancel** on the player side while waiting → the GM's prompt closes and the action aborts.
   - **The prompt no longer holds Foundry hostage.** On the GM prompt, click **RUN THE NET** (top-right).
     - **Expect:** the prompt collapses into a small chip bottom-right; the whole Foundry UI is usable — switch scenes, move tokens, run the netrun. Click the chip → the verdict prompt returns; call it and the player resolves normally. **ESC while docked does nothing.**
   - **NEW — the GM's minimize AUTO-DOCKS the player, in sync (2026-07-22b).** This is the main fix for "it wasn't obvious." Two clients: player starts the gated hack, GM clicks **RUN THE NET**.
     - **Expect on the PLAYER screen, automatically:** their console collapses to a green **NETRUN IN PROGRESS** chip (animated scan bar, "GM is running it") — they don't have to do anything. When the **GM clicks the chip to restore and calls PASS/FAIL**, the player's console snaps back and plays the outcome — the two stay in lockstep.
     - The player can ALSO dock themselves with **STEP AWAY** (a cyan "AWAITING GM" chip) if they want their screen free first; clicking either chip restores their console.
     - While the player is docked, GM **DISMISS** still cleanly aborts (chip disappears, console closes as withdrawn).
   - The siphon heist's awaiting stage behaves identically (STEP AWAY + auto-dock).
3. Switch the card to **"Auto-roll + NET card."** Run a gated hack.
   - **Expect:** it rolls automatically as before, **and** the GM receives a whispered chat card naming the NET-action shape (Backdoor / Control / Virus / Eye-Dee), the roll, and PASS/FAIL.
4. Switch back to **"Auto-roll (default)."** A gated hack should behave exactly as it always has (a plain skill check). This confirms nothing changed for tables that never touch the setting.
5. **Per-terminal override:** open one terminal's config → **Network tab → "Netrunning Resolution" → set "Auto"** while the world setting stays "GM adjudicates."
   - **Expect:** that one box auto-rolls, while hacks on *other* boxes still wait for GM adjudication.

---

## Part 7a — Escalation consequences (2026-07-22 fixes — TWO CLIENTS REQUIRED)

The last solo pass found five gaps here; all are fixed but unverified. **You need a GM client AND a player client** — the whole bug class (lockout not sticking, toasts only on the GM screen) is invisible solo.

**Setup (2 min).**
- GM + one player logged in; the player has a PC and a terminal they can log into (the seed macro's terminal works).
- **Check your time provider** (Admin → Tools): lockout expiry and countdowns run on **game time**. On `real-time` they just work; on manual/world-time nothing expires until you advance the clock — that's by design, not a bug.
- Optional heat-seeding shortcut (GM script macro), instead of failing hacks to earn heat:
  ```js
  const term = game.items.getName("PUT-TERMINAL-NAME-HERE");
  const who  = game.actors.getName("PUT-PC-NAME-HERE");
  await game.nightcity.traceService.bumpHeat(term.id, who.id, 60);
  ui.notifications.info(`Heat seeded: ${who.name} on ${term.name} → 60`);
  ```

**A · Live panel (2 min).** GM opens Admin → Security and *leaves it open*. Player fails a terminal login twice.
- **Expect:** the Activity Log rows and the Heat bar appear/climb **on their own** — no clicking, no tab switch. Heat also visibly *decays* over time (the panel repaints every 30s).
- Double-click the Admin Panel **title bar** → it minimizes to just the bar; double-click again restores. (This always existed — it's the answer to "can we minimize it".)

**B · Lockout (5 min).** Player logs INTO the terminal and stays in the mailbox. GM: Security → the heat row (needs 25+) → the new **stylized Escalate dialog** (three option cards A/B/C) → **A · Lock them out** → 2 minutes, type a reason, tick **"also warn the player."** → click **Lock out**.
- **Expect on the PLAYER screen, immediately:**
  - Their session is **kicked** and a full-screen red **SYSTEM LOCKDOWN** takeover appears — "ACCESS SUSPENDED", the account name, and a **live countdown ticking down** (this is the "animation of what's happening" that was missing). A **STAND DOWN** button drops them back to the login list.
  - **One** LOCKED OUT toast (terminal + minutes), the lockout sound, and the whispered cue.
  - **The critical re-login test:** from the login list, click **any** account — including an **open (no-password) one** if the box has it. **It must be refused** — the LOCKDOWN takeover re-appears, they cannot get in until the clock ends. *This was the bug: they could walk right back in via an open account or a remembered session.* The locked accounts also show a red **LOCKED OUT** badge on their cards.
- **Expect on the GM screen:** ONE chat card. No toast spam, no "unknown"/"? min".
- A **different** player/PC can still log in fine.
- After ~2 minutes (real-time provider) the countdown hits 0 → the takeover clears itself and they log in normally.
- If you have heat on a **shard**, repeat: escalate-lock while the player has the shard viewer open → **their viewer closes** and hack attempts are blocked.

**C · Countdown (5 min).** GM: Escalate → **B · Someone closes in (countdown)** → fill **Who** (e.g. "Arasaka counterintel" — it's not always a corp), **1 minute**, optionally a **Warn** cue, tick "also warn the player."
- **Expect on the PLAYER screen immediately:** a red **INCOMING TRACE** panel appears **top-right** showing "*Arasaka counterintel → DOCK-TERM-4*" with a **live countdown** — persistent, not a one-off whisper. (This is the "I don't see anything on the player side" fix; it shows even if you DON'T tick "warn the player", as long as they own the targeted PC.) They also get the legible Incoming Trace whisper if warned.
- **Expect on the GM screen:** a **"Trace countdowns"** row in the Heat card (who → what, remaining, **Call off**).
- **Within ~1–2 min** (reaper sweeps every 60s): the player's HUD hits 00:00; a **Trace Complete** whisper naming the source, trace-fire sound, a red **TRACE COMPLETE** row in the Activity Log, heat **+35** (usually → BURNED) + GM alert.
- Start a second countdown → the player's HUD shows it → hit **Call off** on the GM side → the HUD row disappears and nothing fires.

**D · Black ICE (3 min).** Needs a Black ICE actor in the world. GM: Escalate → **C · Wake ICE** → pick it.
- **Expect on the PLAYER screen:** the damage toast — "*N* damage! '*(ICE name)*' fights back!" — with the black-ice sound and HP drop. *(Used to show only on the GM screen, and said "unknown".)* The **X** to dismiss it and the countdown bar under it should both be clearly visible now.
- **Expect on the GM screen:** the ICE-retaliation chat card — bigger, more legible, the ICE portrait pulled in with a red scan sweep. Its title reads **BLACK ICE — Network/Terminal** matching where the strike came from (not always "Shard").

**F · Card legibility (spot-check).** Glance at the chat log through B–D: the heat/lockout/trace whisper cards should be clearly readable (headers, bold names, body text at a real size — not tiny). A hack skill-check card's **SUCCESS/FAILED** badge and TECH/SKILL/1d10 labels should read easily.

**E · Cleanup.** Lockouts expire on their own; Admin → Terminals → **Reset** (relock) clears one early. **Clear all** in the Heat card zeroes heat.

---

## Part 7b — Upload / Forge (your last playtest broke here — fixes unverified)

The blackmail on-ramp: carry a forgery to a box and plant it. Last playtest, failed attempts stacked; this pass verifies the fix.

1. Run **`tools/test-upload-setup.macro.js`** as GM. Operate as the PC that owns the resulting go-bag shard (OPERATOR chip).
2. Log into a terminal → **OPERATOR TOOLS → UPLOAD → pick a forgery.**
3. **Fail the forge a few times, then succeed. Then exit the terminal and come back.**
   - **Expect exactly ONE armed plant — not one per attempt.** (The old bug installed a plant for every failed try, and firing planted them all.) The Security tab's Planted & Resident card should show a single armed entry for that program.
   - Confirm the **three outcome rungs** as you roll:
     - beat the DV → **CLEAN** (green): plants a high-quality forgery.
     - miss by a little → **SLOPPY** (amber): it still lands, but a later ANALYZE will flag it FORGED.
     - miss by a lot → **REJECTED** (red): the box refuses it, **nothing installs.**
4. **Fire the plant:** log in as the target account (or advance to its trigger). A styled **RESIDENT TRIGGERED** prompt should appear.
   - **Expect:** it's themed in *that machine's* colors, states that now is the moment to run the NET, names the closest NET action, and shows the forgery tell (clean / passable / sloppy). Options: **Fire / Defuse / Later.**
5. **Settings → "Planted Programs — When They Fire":** the default is now **Automatically** (fires the moment it triggers, GM just told — no prompt). Try **Ask me** (the styled RESIDENT TRIGGERED prompt above) and **Only when I say so** (never prompts — fire it manually from Admin → Security → Planted & Resident).
6. **ANALYZE** a suspicious file (the magnifier chip on any file) → a good forgery reads clean; a sloppy one gets flagged FORGED.

---

## Part 8 — Standing test debt (spot-check when there's time)

Older features that were never live-tested end to end. Spot-check:

- **Admin → Security tab** overall: activity log (filter/search, the ↗ deep-links to the exact object), heat dashboard, recycle bin (restore/purge a wiped file), operator-access gate editor (the +ROLE / +ITEM searchable pickers).
- **Operator identity:** a player who owns several PCs picks one via the OPERATOR chip; confirm siphon/eddies land on *that* PC. The FUI "BIOMETRIC HANDOFF" switcher.
- **The 18 content types** in the composer + all three viewers (terminal / shard / Agent inbox): spreadsheet, calendar (advance Simple Calendar → countdowns tick), gallery + camera feed + PTZ, banking + siphon heist, dossier (masked identity / combat profile), chatlog, records, schematic, document, payload (RUN/KILL), malware (deploy/honeypot), avlog (transcript playback), eddies claim, location, note.
- **Send-only master contacts:** flag one → a player can't add/reply/message it; TRANSMISSION REFUSED on a direct send.
- **Themes / wallpaper / login styles / sound sets** per terminal; the themed window header.
- **Scene pins:** drag a terminal onto a scene → double-click the pin to log in; proximity gate if set.

Report format: what you did, what you expected, what happened, and — for anything player-side that "did nothing" — whether a GM was connected.

---

## Part 9 — Ship it (after the parts above pass)

- [ ] Fix whatever Parts 0–5 turned up, re-run `node tools/check-syntax.mjs` and the sims, then commit.
- [ ] Finalize the v1.2.0 Discord post (drafted 2026-10-06) and drop anything cut during testing. Keep the **upgrade steps** prominent: back up → disable/uninstall the old module → install the new one → GM accepts the migration prompt → players log in once.
- [ ] Refresh the PDF guide (`docs/guide/`); it predates the Encoder.
- [ ] Push the branch, fast-forward `main` to it.
- [ ] Tag `v1.2.0` and push the tag. The GitHub workflow builds the release.
- [ ] **Fresh-world install from the manifest URL** in `module.json`. This proves the manifest/download links resolve; they 404 today.
- [ ] Decide what to do with the stale `v1.0.0` tag (it points at a commit with no assets).
- [ ] Post to Discord. Optional: list the module in the Foundry package registry.
