# NCM — Playtest Script

A step-by-step test pass for the current (uncommitted) build of Night City Messenger. Ordered **freshest / most likely to break first** — if you only get through Priority 1–3 you've covered this cycle's new code. Report anything that doesn't match "**Expect:**".

---

## Before you start — read this or you'll report false bugs

- **A GM must be logged in the entire time.** Almost every player action writes to GM-owned data (world items, terminal/shard journals) and *relays* to the GM to actually happen. **No GM connected → the action silently does nothing.** That is not a bug — it's the security model. If something "does nothing as a player," check this first.
- **Players choose which character they're acting as via the OPERATOR chip** (top of a terminal's login screen / mailbox HUD). Every roll, siphon, and eddies payout uses that character. If money lands on the wrong PC, the wrong operator was selected.
- **Quick triage for "X does nothing as a player":** (a) Is a GM connected? (b) Does that action relay (most content actions do)? (c) Is the button gated (needs the right operator / capability)? Check those three before filing.
- **Seed macros** (paste into a Script macro as GM, run once):
  - `tools/test-terminal-setup.macro.js` — builds a fully-authored test terminal (4 accounts incl. a hidden one, priority-coded mail) and opens it.
  - `tools/test-upload-setup.macro.js` — builds a "go-bag" data shard of forgeries to carry to a terminal and UPLOAD. **The shard must end up owned by the actor your operator chip points at** (the macro handles this; just make sure you operate as that PC).

---

## PRIORITY 1 — Netrunning Resolution modes (brand new, never run)

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

## PRIORITY 2 — Escalation consequences, re-test round (2026-07-22 fixes — TWO CLIENTS REQUIRED)

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

## PRIORITY 3 — Upload / Forge (your last playtest broke here — fixes unverified)

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

## Standing test debt (fuller pass when there's time)

None of the big uncommitted stack has been live-tested end to end. If you have testers to spare, spot-check:

- **Admin → Security tab** overall: activity log (filter/search, the ↗ deep-links to the exact object), heat dashboard, recycle bin (restore/purge a wiped file), operator-access gate editor (the +ROLE / +ITEM searchable pickers).
- **Operator identity:** a player who owns several PCs picks one via the OPERATOR chip; confirm siphon/eddies land on *that* PC. The FUI "BIOMETRIC HANDOFF" switcher.
- **The 18 content types** in the composer + all three viewers (terminal / shard / Agent inbox): spreadsheet, calendar (advance Simple Calendar → countdowns tick), gallery + camera feed + PTZ, banking + siphon heist, dossier (masked identity / combat profile), chatlog, records, schematic, document, payload (RUN/KILL), malware (deploy/honeypot), avlog (transcript playback), eddies claim, location, note.
- **Send-only master contacts:** flag one → a player can't add/reply/message it; TRANSMISSION REFUSED on a direct send.
- **Themes / wallpaper / login styles / sound sets** per terminal; the themed window header.
- **Scene pins:** drag a terminal onto a scene → double-click the pin to log in; proximity gate if set.

Report format: what you did, what you expected, what happened, and — for anything player-side that "did nothing" — whether a GM was connected.
