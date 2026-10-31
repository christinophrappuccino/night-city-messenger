# Calls — design (draft, 2026-10-29)

Mocks: **the call HUD** `dev/mockups/calls-overlay-mock.html` (dev-approved 2026-10-29; `?f=incoming|dialing|voice|typed|speak|gm|ended|anim|waiting|held|missed|vm-greet|vm-rec|vm-type|vm-sent`,
`?opts=1`, `?scheme=`, `?modes=`) · **the Calls tab** `dev/mockups/calls-tab-mock.html` (`?f=tab|match|vm|transcript|empty|getnum|myline|myline-burner|callbtn|arm|hovers|msg|msg-drafts|msg-sched|contacts|sender`, `?theme=`) · **the GM Phone tab** `dev/mockups/admin-phone-mock.html` (`?f=live|numbers|log|vm|settings|contacts`) · the first
windowed mock `dev/mockups/calls-mock.html` (superseded except the voicemail-leaving frame).
Status: **design done — build plan in §11; nothing built.** Decisions marked **(decided)** came from the dev; **(proposal)** are mine to confirm.

---

## 1. What a call is

The Agent becomes a phone. You dial a number (or pick a contact), it rings, the other side answers, a call window shows
who is on the line, and either side hangs up. The point is the **fiction and the paper trail**, not audio: most tables
already talk at the table or on Discord.

A call is **always** the same visual call. What changes is only **how words get into it** — chosen per person, per call,
switchable mid-call (the switch at the bottom of the call window):

| Mode | What happens | Works on |
|---|---|---|
| **Out loud** | Nothing to type. The HUD shows who, how long, the signal. People talk on Discord / at the table. | everything |
| **Type** | A text line; each line plays in on both screens as a subtitle (2077 / Edgerunners), speaker name in their colour. | everything |
| **Dictate** | The mic is turned into the same subtitle line through speech-to-text. | where the browser can (see §9) |

Each chip carries a one-line tooltip saying what it does ("Talk at the table or on Discord. The call just shows." /
"Write your lines. They appear as subtitles." / "Your mic is turned into subtitles as you talk."). The names were
Voice / Type / Speak until 2026-10-29; Voice and Speak read as the same thing, and neither said what happens.

**The GM decides the modes** (decided 2026-10-29): which modes exist at the table (any of the three, at least one) and
the default a call opens in. A mode the GM switches off is **not shown at all** (a dead chip is worse than none); with
only one mode left, the mode chips disappear entirely. Dictate is also hidden on a client whose browser cannot do it
(with the reason in a tooltip where it is greyed during a call).

Type and Dictate are **one renderer with two inputs**, and a call can mix them (one side types, the other talks on
Discord). **(decided: the three options, the GM's control; proposal: one call, switchable modes)**

Non-goals for the first versions: live voice audio through NCM, video, group calls (later, §11.5).

## 2. Numbers

- Contacts already carry a free-text `phone` (master contacts and players' own copies).
- **Player characters have no number today** (Email Setup gives an address only). **(proposal)** Email Setup also offers
  a number in a Night City format (`+1 (555) 0177-42`), editable; stored as an actor flag `phone`, beside `email`.
- **Any format, any country** (dev 2026-10-29: "+1, +81, etc."). A number is free text: `+81 3-1234-5678`,
  `+44 20 7946 0958`, `(555) 0119-07`, `1-800-ARASAKA`. Matching is on the **normalised** form: letters become their
  keypad digits (vanity numbers), everything that isn't a digit is dropped, and the country code is kept — so
  `555-0119-07`, `(555) 0119 07` and `+1 555 011907` are one number, while `+81 555 011907` is a different one.
- **A number typed without a country code** is read as the caller's home code: a world setting **`callHomeCode`**
  (default `+1`; a Tokyo-set table sets `+81`). So a player in Night City dials `555 0119-07` and reaches `+1 555 0119-07`.
- **Area codes (dev 2026-10-29):** the number picker has **Where is it from** — a country (its code) and, for the US, a
  state with its real area codes (California: 415 SF · 510 Oakland · 213 LA · 916 Sacramento …) plus the fictional
  **555 "Night City"** (the default). Generated numbers take that area code, and their local part **always comes from
  555-0100…0199** — the block reserved for fiction — so a made-up number is never a real person's. Real states and area
  codes are public facts (a small built-in table per country; other countries list their city codes the same way). The
  GM sets the table's default region in Admin → Phone → Settings, beside the home code.
- **Shown as it was written** — no reformatting into one country's pattern; the dial box groups digits as you type
  only until you type a `+`, a space or a dash yourself.
- **The keypad**: `+` is the 0 key held (or typed), letters come from the keyboard, Enter calls.
- **Short service numbers** (GM-made, optional): a directory contact can carry a short number like `911`, `#77` or
  `TRAUMA` — NCPD, Trauma Team, a Delamain cab — which matches exactly, with no country code.
- Numbers ride the identity system: **an alias can have its own number** (a burner). The owner is resolved like an
  address: master contact by `phone` → its linked actor / root NPC (the identity routing that mail already uses).
- **A number nobody owns** plays "not in service". **(proposal)** A world setting can instead send unknown numbers to the
  GM as "Rache is calling an unknown number 555-…" — the GM decides who picks up.
- The GM's directory form and Admin → Contacts show the number; the composer-style search finds contacts by number.

## 3. Dialing

Agent → **Calls** tab. **The Agent becomes three tabs — Messages · Calls · Shards** (decided 2026-10-29): the old
Scheduled and Drafts tabs fold into Messages as two dashed chips at the end of its chip row (after a divider — they are
outgoing, not received mail), shown only when they hold something; the Messages badge still counts unread mail only; the
composer's "N drafts" link opens the Drafts chip. Mock `calls-tab-mock.html?f=msg|msg-drafts|msg-sched`. Left: a dial pad (type a number or start typing a name — it matches contacts, the
matched name shows under the number). Right: the log — All / Missed / Voicemail, newest first; each row calls back.
Also: **Call** buttons on a contact card, on a message's sender, and on the Contact Manager.

**The log** (mock `calls-tab-mock.html`): one toolbar row — quick chips for what needs you (All · Missed · Voicemail,
with counts), **Show** (everything · incoming · outgoing · missed · voicemail · with a transcript · one person),
**Sort** (newest · oldest · longest · by person, grouped · most called) and a search over name, number and transcript.
Grouped by day under Newest/Oldest. **25 a page** with a page bar ("1–25 of 132 calls", page numbers).

**Who you can call (decided 2026-10-29):**
- **Only someone with a number is callable.** Speed dial, the name matches under the dial box, and the Call buttons on
  contacts / senders list or show ONLY people who have a number. A contact without one shows no Call button (no dead
  button); in the dial matches they are left out.
- **You do not need someone in your contacts to call them.** Typing a number rings whoever owns it (or plays not in
  service). Their name shows on your screen only if you have them in contacts; otherwise you see the number.
- **You can also call from your contacts**: the Contact Manager's contact card and detail panel get a Call button when
  that contact has a number, and so does a message's sender row.
- What number a player sees for a contact is the number on THEIR copy of the contact (pushed from the directory or
  typed by the player), the same as addresses — knowing a number is part of knowing the contact.

Before ringing, the caller's client checks:
1. **Signal**: no network or a dead zone → "No signal" (never rings). A network a node cuts here counts as no signal.
2. **Send-only** numbers can't be called (system lines).
3. The number resolves (§2) or → not in service / GM.

## 4. Who answers

| Caller → callee | Rings on | Answered by |
|---|---|---|
| Player → player character | every client that owns that character (a player online) | that player |
| Player → NPC (directory contact / NPC actor) | the **GM's** client(s) | the GM, **as that identity** |
| GM (as an NPC or anonymous) → player | the player's client | the player |
| anyone → a character nobody is playing right now | nobody | voicemail |

- The GM's ring (mock frame 9) says who is calling which identity (alias in violet), from where, on which network, and
  shows the NPC's **voice note** so the GM answers in character. Buttons: **Answer as …**, **Voicemail**, **Decline**.
- **Unanswered after 30 s** (a setting) → voicemail. **No GM online** for an NPC call → straight to voicemail (the NPC's
  greeting, then the caller leaves one).
- **Two GMs online (proposal):** both ring; the first to answer takes it; the other's ring closes.
- **Anonymous calls** reuse anonymous send: the masked avatar, "Unknown caller / number withheld". **(proposal)** A trace
  while the line is open — keep them talking and roll (the anon-trace rules), success reveals the caller in the log.

## 5. The call is a HUD on the scene, not a window (dev, round 2)

Mock: `dev/mockups/calls-overlay-mock.html` (`?f=incoming|dialing|voice|typed|speak|gm|ended`, `?still=1`), drawn over a stand-in
Foundry screen with a real CPR map. Dev: "more like the 2077 calls… not in a box, an overlay on top of the scene".

- **No window.** Two pieces float on the scene, body-mounted, `pointer-events: none` except the prompts:
  - **Top-left, inside Foundry's toolbar: the call badge** — a dial on the far left (round 12, option B): a broken outer ring that
    turns slowly and 12 segments around a smartphone that fill one by one each ring, stay full once answered and go dark
    when it ends; signal arcs pulse out of it toward the name on the same beat. then the call word above (INCOMING CALL / CALLING… /
    HOLOCALL / CALL DROPPED) and the name in caps inside a chip-shaped box with cut corners and a small handset before
    it. Red while ringing, cyan while live, grey when ended. Above the whole badge, unboxed, a signal line in small mono: a signal meter that hunts while it rings
    ("▸ INCOMING SIGNAL // 0x… · CH15", the hex changing), "SIGNAL LOCKED // CH11 · ENC-256" once live, "SIGNAL
    LOST" when it ends. Under it: an alias in violet, the number and network with
    signal bars, the timer, the mode chips and the prompts. **While it rings there is no portrait** (as in 2077: the
    face comes up once you pick up).
  - **Once answered, the caller's portrait opens to the left of the badge** (rounds 4–6): about 132×146, the
    character's or contact's own image (the same portrait the module already resolves — an alias never borrows its
    main identity's face), cropped to an angled frame with a cut corner and a notch on the right and a label tab on top
    (● LIVE, then ENDED). Faint scanlines, a light tint and one slow sweep, all clipped inside the frame. No glitching.
    Grey when the call ends. A contact with no picture shows initials in the frame.
  - **Colours are a scheme** (proposal: a per-player choice in the Theme Customizer, default NCM): ringing colour, live
    colour, key-cap colour. **NCM** = ringing red / live cyan; **2077** = ringing cyan / live red / yellow keys; **From
    my theme** = ringing primary / live secondary / keys accent of the player's Agent theme; **Custom** = two pickers.
    Fixed whatever the scheme: Decline / Hang up red, ended grey, anonymous violet, a network in its own colour.
    **The Calls tab follows the player's Agent theme** (backgrounds, text, borders, accents — every fill is the theme's own
    surface tinted by its colour, never a hard black); fixed by MEANING in every theme: Call green, missed / no signal red,
    voicemail amber, an alias violet, a network its own colour.
  - **The signal line is generated from the call** (pure, deterministic): channel and code are seeded from caller name
    + number + network, so a caller always reads the same; the network TYPE picks the cipher and band (public ENC-128 /
    OPEN BAND, corp AES-512 / VERIFIED, darknet ONION / 3 HOPS, military MIL-QX, home ENC-64); the network's SIGNAL
    STRENGTH sets how many rings the code takes to resolve (strong 2, fair 3, weak never — WEAK SIGNAL in amber, the
    dial slips back, the arcs go out ragged); a darknet churns katakana, turns the dial the other way and puts the
    cipher in violet; an anonymous caller shows ID MASKED. Once live: SIGNAL LOCKED (or UNSTABLE) // ch · cipher · code
    · band; ended: SIGNAL LOST. In the build this reads the real call: sender identity, number, the network it rides
    and that network's signal on the receiver's scene.
  - **In:** the phone tile drops in from a line and flares; the words decode letter by letter through random glyphs
    (the 2077 text reveal); the name box opens left to right behind a bright edge; the rows under it slide in. On
    answer the portrait frame draws as a horizontal line, opens to full height, and the picture comes up from a
    blown-out flash. **Out:** the words scramble away, the name box shuts, the picture blows out, the frame closes back
    to a line and the line shrinks to nothing. About half a second each way. Reduced motion (the OS setting or the
    module's animation preference) skips all of it.
  - **Bottom-centre, above the hotbar:** the subtitles (typed / spoken calls only) — name in caps in the speaker's
    colour, white text with a heavy shadow so it reads on any map, newest line bright, older ones fading, up to four.
    Typing happens on a thin underline under them, never a box.
- **Prompts are key chips:** **Y Answer** (a short hold, so a stray click doesn't pick up), **N Decline / Hang up**,
  **V Voicemail**, **M Mute** (Dictate). Click or press the key (keys only while a call is ringing or live, and never
  while focus is in a text field). The mode chips (VOICE / TYPE / SPEAK) sit under the portrait while connected.
- Ringing: two pulses expand from the portrait frame; the ringtone plays. Connected: the pulses stop, the timer runs.
- Ended: the portrait drains to grey, one word says how (CALL ENDED · CALL DROPPED · NO SIGNAL · NOT IN SERVICE · NO
  ANSWER), and it fades out after three seconds.
- **The GM's ring is the same HUD** in the GM's view: "Rache is calling", the identity's name, "alias of Rogue", where
  from, the NPC's voice note under it, and **Answer as …**.
- Placement avoids Foundry's own UI (toolbar left, scene navigation top, sidebar right, hotbar and players bottom); it
  follows a collapsed sidebar and a module setting can move it (top-left / top-right).
- The Agent still owns dialing, the call log and voicemail (the first mock, `calls-mock.html`, frames 1, 7, 8). Once you
  press Call the Agent can close; the call lives on the scene.
- Reduced motion / the animation preference veto the pulses, glitch and scan, as everywhere else.
- A second incoming call while on one → a smaller second HUD under the first: "call waiting — Judy" with Y / N.

## 6. Typed and spoken lines

- A line is `{ from, text, at }`. Sending puts it on both screens at once; the receiver sees it **type out** (about
  30 ms a character, capped so a long line doesn't take ages), the sender sees it settle at once.
- "X is typing…" while the other side has text in the box (debounced, cleared after 4 s of nothing).
- Up to ~5 lines on screen, older ones fade up; the full set is the **transcript**.
- Dictate: interim recognition shows grey and italic on the speaker's own screen and is sent only when final.
- Lines are plain text (escaped), with a length cap (500 chars).

## 7. Voicemail

Three ways to leave one (mock frame 7):
1. **Type it** — always available.
2. **Record** — the mic (`MediaRecorder`, Opus/WebM), up to 60 s (a setting). Needs a mic **and a secure connection**;
   when either is missing the option is greyed with the reason ("your connection doesn't allow the mic — the GM can turn
   on HTTPS"), never a silent failure.
3. **Speak it for me** (GM) — typed, played on the recipient's screen with the browser's synthetic voice
   (`speechSynthesis`, works offline everywhere). A per-NPC voice choice (pitch/rate) could live beside the voice note.

**Greetings — My line (2026-10-29; mock `calls-tab-mock.html?f=myline|myline-burner`).** Every NUMBER has its own
greeting and voicemail settings, so a main line and each burner sound different. Players set theirs in Agent → Calls:
the gear beside **Call as** opens **My line** in the right pane, for the number picked on top.
- **Greeting**: **Typed** (the words as a subtitle) · **Recorded** (your voice, with optional words shown under it;
  greyed with the reason where the browser can't use a mic; saved through the GM because players usually can't upload)
  · **Read out** (the browser's synthetic voice, a voice picker over the voices this browser has — so a burner need not
  sound like the player) · **Default** ("The person you are calling is not available."). A new number starts on Default.
- **Preview**: a strip showing the greeting exactly as a caller sees it (the HUD subtitle + the tone line), and a play button.
- **Voicemail**: take messages on/off (off = callers get "No answer", no greeting plays) · send calls straight to
  voicemail (do not disturb) · the longest message, within the GM's limit. A message left for a burner lands under that
  burner in the log.
- Only the player and the GM can change it. **NPC greetings** are set by the GM in Admin → Contacts beside the NPC's
  Voice note, per identity / alias; the GM can also edit any player's.

Playback (frame 8): a scrubbable waveform, the transcript (typed text, or the Dictate text, or nothing for a plain
recording), Call back, Delete. Unplayed voicemails count on the Calls tab badge and on the Agent icon.

**Storing a recording:** players can't upload files, so the recording goes to the GM's client over the socket (base64,
~150 KB a minute) and the GM writes it — into the world's `ncm-voicemail/` folder via `FilePicker.upload` (preferred: real
files, cacheable) or, when uploads aren't possible, as a data URL in the page flag (size-capped). Decide at build time.

**On screen (2026-10-29, the HUD; mock `calls-overlay-mock.html?f=vm-greet|vm-rec|vm-type|vm-sent`):** leaving a voicemail
stays on the same badge, in **amber** (the voicemail colour in the log), with no arcs (nothing is ringing).
1. **Greeting** — the badge says VOICEMAIL, the signal line "No answer // routing to voicemail"; their greeting plays as
   a subtitle (typed out, or their recorded voice with the words under it), then a tone line "Leave a message after the
   tone". Hang up any time.
2. **Recording** — the badge says RECORDING, the phone in the dial becomes a mic, and **the dial is the clock**: its 12
   segments fill over the time allowed. At the bottom: the ways to leave it (only those the GM allows and the browser
   can do — Record, Type, GM Read it out), a REC line with a live level and "0:15 / 1:00", the Dictate transcript under it
   when Dictate is allowed, and the keys **Enter send · R start over · N hang up**.
3. **Typing** — the same, the dial counting characters against the length limit, the thin type line.
4. **Sent** — VOICEMAIL SENT decodes in green, the dial closes full with a check, and it folds away like a call ending.

## 8. Networks, nodes and security

- Calls need signal on both ends **at connect**; a node going down on either caller's scene **mid-call drops it** ("Call
  dropped — the node at Watson Docks is jammed").
- **Taps:** a tap (session effect or infection) on a node of the network a call goes over, on the caller's scene,
  receives the **transcript** of typed/spoken calls in the tapper's EXFIL folder (like mail), and a "call intercepted"
  line for voice-elsewhere calls (who, when, how long). Same rules as mail: never the participants themselves.
- **Sniffers** record call metadata (and transcripts) for collection.
- **Backdoor / anonymous**: no change.
- Admin → Networks → Activity log gets call rows (who called whom, network, scene, duration, how it ended).
- Countermeasures: none planned for calls (they're not locks).

## 9. Mic, speech and the "not everyone runs Chrome" problem

What matters is each **player's** browser, not where Foundry runs.

| Opened in | Mic | Built-in speech-to-text | Text-to-speech |
|---|---|---|---|
| Chrome / Edge | yes | yes (audio to Google / Microsoft) | yes |
| Safari | yes | yes (Apple) | yes |
| Firefox | yes | **no** | yes |
| Foundry desktop app | yes | **usually no** (Chromium without Google's speech keys — verify) | yes |

- **The mic needs a secure context.** `https`, The Forge, or `localhost` are fine. A player joining a self-hosted game
  at `http://192.168.x.x` gets **no mic in any browser**. Fixes for the GM: Foundry's SSL options (a self-signed cert is
  enough), a host with https, or a per-browser flag. The call window explains this when it applies.
- **Dictate v1 = the browser's built-in recognition**, where present, opt-in, with a clear "speech goes to Google /
  Microsoft / Apple" note. Elsewhere the switch says why and offers Type.
- **Later, if transcripts matter for everyone:** an offline model loaded on demand (Vosk ~40 MB streaming, or a small
  Whisper via WebGPU/WASM). Same everywhere, nothing leaves the machine; costs a download and CPU. A cloud engine is
  possible only through the GM's client (an API key in a module setting is readable by every player).
- Recognition only hears **your own** mic — each side transcribes itself and sends text, which suits §6.

## 10. GM tools

**Admin → COMMS → Phone** (mock `dev/mockups/admin-phone-mock.html?f=live|numbers|log|vm|settings|contacts`, `?t=` preset).
Five sub-tabs, admin vocabulary:
- **Live** — the **Switchboard**: every call now as a patch cord between two people in the network's colour (a packet
  riding it), timer, mode. **Listen** to a typed / dictated call (a private live transcript only the GM sees), **Glitch
  the line** (garble a few lines — interference), **Drop the call** ("Call dropped"). Calls the GM is on as an NPC say
  "you" with Switch identity / Hang up; a weak signal is flagged. **Ringing for you**: NPC lines ringing — caller, the
  identity (alias violet), the NPC's voice note, a clock to voicemail; Answer as / Voicemail / Decline; a dialled number
  nobody owns rings here too (when the setting says so) — answer as anyone or make it a contact on the spot. **Network
  load** (calls per network now · today, bars in the network colour, a jammed network hatched red, click → Networks).
  **Dialled, not in service** (numbers players fished for this session → make one a contact). Head buttons: **Call a
  player as…** and **Make a phone ring…** (an NPC calls a player now).
- **Numbers** — the exchange: every number grouped by owner type (players' characters with mains + burners, NPCs with
  aliases nested, services / short numbers), greeting kind, voicemail on + new count, last call; Call · Edit greeting ·
  **Burn** (the number stops working → not in service). A character with no number shows amber **Give one**. Import /
  export rides the address directory.
- **Call log** — a 24-hour strip on the game clock with every call as a mark (in green · out cyan · missed / dropped red
  · voicemail amber), then Who / Show / Network filters + search over transcripts, 25 a page; the detail: numbers,
  network + cipher, the two scenes, how they talked, **who else heard it** (a node tap, violet), the transcript, Share /
  Save to a shard / Open the inbox.
- **Voicemail** — one box per NPC identity with its unheard count; each message with a waveform + transcript and
  **Call back as** / **Reply as** (a message) / Heard; edit the box's greeting.
- **Settings** — calls on, the ways to talk, the default mode, home country code, rings before voicemail, unowned numbers
  (not in service | ring the GM); recorded voicemail, longest message, how long recordings are kept (transcripts stay),
  the "the GM can see typed calls" notice, the dictate engine, storage + purge.

**Folds everywhere (dev 2026-10-29: "collapse things… as little clutter as possible")** — the module's standing fold
rule: the first group open, the rest closed; a closed head keeps its count and anything that needs you (amber / red
badges); a search or filter opens everything; the GM's own fold wins for the session (DOM-only, never a re-render).
Live: a call the GM is not watching folds to ONE line (names · timer · network, a weak-signal flag kept); the call being
listened to and calls the GM is on stay open; **ringing lines never fold**; Network load and Not-in-service fold to a
one-line summary (a jam stays red on it). Numbers: Players open, NPCs / Services closed with their badges (new
voicemail, ringing), plus Open all. Call log: grouped by day, Tonight open, older days closed with what went wrong.
Voicemail: heard messages fold under one Heard head. Settings: both cards fold.

**Call as on contacts (2026-10-29):** Admin → Contacts' detail gets a green split button **Call as <name> ▾** beside
Write as / Inbox: the menu picks the identity to call FROM (main or alias, each its own number), then WHO (the
characters who know them, with numbers; one without a number offers Give one), or Dial a number. The same Call buttons
sit on directory rows, Players → a character, and the NPC Switchboard's correspondent card.

- The ring as above, plus **calling out as any NPC** (Send-as for calls: the Calls tab in GM view, or Admin → Contacts →
  a contact → Call).
- **Calls in the admin panel (proposal):** Admin → Messages gets a **Calls** view (or calls appear in All mail as rows
  with a phone icon): who, when, duration, mode, how it ended, transcript, voicemail playback. The Overview's "needs
  you" gets **voicemails for NPCs** unheard.
- **Live list (proposal):** calls in progress, with Listen in (read the live transcript) and Drop call.

## 11. Build plan (2026-10-29)

Everything is designed and mocked; this is how it gets built. Standing rules apply throughout: GM-owned writes go
through the GM (players relay over the socket, and refuse with a reason when no GM is online); pure rules live in
Foundry-free modules with a sim in `dev/tools/sims/`; every `--ncm-*` colour a token; `node dev/tools/check-syntax.mjs`
and the Handlebars balance check before anything is presented; nothing is live-tested until the dev does it.

### 11.1 Data

| What | Where | Who writes |
|---|---|---|
| A character's own number | actor flag **`phone`** (string, as typed) beside `email` | the player (they own the actor) or the GM |
| An alias / NPC / service number | master contact **`phone`** (the field already exists; add it to the directory index and `updateContact`'s whitelist if missing) | GM |
| **Line settings** for every number (greeting, voicemail on/off, do-not-disturb, longest message, silent mode is per player) | world setting **`phoneLines`** `{ [normalisedNumber]: { owner: {actorId?, contactId?}, greeting: {kind: typed\|recorded\|tts\|default, text, audio, voice}, voicemail: {on, dnd, max} } }` | GM; a player's edit relays (`CALL_LINE_REQUEST`) |
| Silent mode | client setting **`callSilent`** | the player |
| Call colour scheme | inside `playerTheme` (`callScheme: ncm\|2077\|theme\|custom`, `callRing`, `callLive`) | the player |
| Call log | one journal page **per participant inbox**, flag `kind: 'call'` (`callId`, `direction`, `with {actorId, contactId, number, name}`, `fromNumber`, `startedAt`, `endedAt`, `outcome` answered\|missed\|declined\|voicemail\|dropped\|no-signal\|not-in-service\|busy, `mode`, `lines[]` when typed / dictated, `network`, `scenes`, `heardBy[]` taps) | GM |
| Voicemail | a page in the recipient's inbox, flag `kind: 'voicemail'` (`text`, `audio` path, `duration`, `played`, `from…`) | GM |
| Recorded audio | **files** under `worlds/<world>/ncm-voicemail/` uploaded by the GM's client (players send the blob over the socket in chunks); size cap from settings; purge in Admin → Phone → Settings | GM |
| Live calls | **memory only** on the participants' clients and the active GM's; nothing persists until a call ends | — |

Using the inbox journals for calls and voicemail means orphan audit, purge, factory reset and document-sync keep working
with no new storage. No migration: every field is new.

### 11.2 Pure modules (Foundry-free, simmed)

- **`scripts/utils/phoneNumbers.js`** — `normaliseNumber(raw, homeCode)` (letters → keypad digits, punctuation
  dropped, a missing country code gets `homeCode`), `sameNumber(a, b, homeCode)`, `formatAsTyped`, the per-country
  **fiction ranges** table (`FICTION_RANGES`: +1 → `555-0100…0199` in any area code; +44 → Ofcom drama ranges,
  e.g. `020 7946 0000–0999`, `07700 900000–900999`; +61 → the reserved drama numbers; a country with none → an
  obviously fake pattern, flagged), `AREA_CODES` (country → region → `[code, label]`, US states first, Night City 555),
  `generateNumbers({country, region, code, count, taken})` (memorable / run / repeating / random, always inside the
  fiction range, never one in `taken`), `isShortNumber`.
- **`scripts/utils/callProfile.js`** — lifted from the mock: `callProfile({name, number, net, anon})` → channel, code,
  cipher, band, quality, lock rings, classes; `signalLine(profile, state, rings)`. Deterministic (seeded djb2).
- **`scripts/utils/callModel.js`** — the call state machine as a pure reducer: `idle → ringing → live ↔ held → ended`,
  plus `voicemail-greet → voicemail-record → sent`, call waiting (a second `ringing` beside a `live`), outcomes, the
  ring timer, `allowedModes(settings, browser)` (the GM's list minus Dictate where the browser can't), `canCall(caller,
  callee, world)` (number known, signal, send-only, dead zone, node cut), `resolveCallee(number, world)` (actor flag →
  directory by normalised number → a service short number → unowned).

### 11.3 Services and plumbing

- **`scripts/services/CallService.js`** — `game.nightcity.callService`, constructed in a new
  **`scripts/init/registerCallSystem.js`** (added to `main.js`'s list of nine register files — the tenth; `ready` for the
  service, `postReady` for the socket handlers and the missed-call badge). Holds live calls, drives the reducer, talks
  to the socket, the HUD, the sound board and the GM.
- **Socket**: one op **`SOCKET_OPS.CALL`** with a `type` (`ring`, `ringCancel`, `answer`, `decline`, `toVoicemail`,
  `busy`, `waiting`, `hold`, `resume`, `line`, `typing`, `mode`, `hangup`, `drop`, `glitch`, `listen`), routed by
  `userIds` the way `SECURITY_NOTIFY` is; plus **`CALL_LINE_REQUEST`** (a player's line-settings edit),
  **`CALL_LOG_REQUEST`** (each side's summary at hang-up → the GM writes the pages), **`CALL_AUDIO_UPLOAD`** (chunked
  voicemail audio → the GM uploads). Multi-GM: only `game.users.activeGM` answers NPC lines and writes; both GMs see
  the ring, the first answer wins and the other's ring stops.
- **No GM online**: a player↔player call still connects (sockets between the two clients) but is not logged, and says
  "not logged — no GM online"; NPC numbers go straight to their greeting / voicemail and the voicemail waits on the
  caller's client until a GM is online (the held-mail queue pattern).
- **EventBus**: `EVENTS.CALL_RINGING / CALL_STARTED / CALL_ENDED / CALL_MISSED / VOICEMAIL_LEFT / LINE_UPDATED`;
  IntegrationBridge mirrors them as Foundry hooks (`ncm.callStarted` …) and INTEGRATION.md documents them.
- **Settings** (SettingsManager, literal names/hints): `callsEnabled` (on), `callModes` (all three), `callDefaultMode`
  (out loud), `callHomeCode` (+1), `callDefaultRegion` (Night City 555), `callRingSeconds` (30), `callUnknownNumbers`
  (not in service | ring the GM), `voicemailRecording` (on), `voicemailMaxSeconds` (120), `voicemailKeepDays` (30),
  `callTranscriptNotice` (on), `callDictateEngine` (browser); client `callSilent`.
- **Sound board ids** (`SOUND_PATHS` + `SOUND_INFO`): `call-ring`, `call-ringback`, `call-connect`, `call-end`,
  `call-drop`, `call-waiting`, `voicemail-beep`, `call-decode` (the dial/decode tick).
- **Macro API** (`MacroAPI.js`): `ringPlayer(actorIdOrName, {as})`, `callNumber(number, {as})`, `getCallLog(actor)`,
  `leaveVoicemail(to, text, {as})`; GM macros in the pack ("Make a phone ring", "Call as NPC").
- **Keybindings** (`game.keybindings.register`): answer Y, decline N, voicemail V, mute M, hold H, decline-waiting D —
  rebindable, only active while a call is ringing or live.

### 11.4 UI

- **The call HUD** — `scripts/ui/Calls/CallHud.js` (body-mounted, `pointer-events: none` except the prompts),
  `templates/calls/call-hud.hbs`, `styles/components/call-hud.css` (prefix `ncm-call-*`; the badge, dial, arcs, signal
  line, portrait frame, subtitles, voicemail, call waiting, hold, missed-call badge). The decode / scramble, the dial
  fill and the rain are small JS helpers in `scripts/ui/Calls/callFx.js`; one rAF loop; reduced motion (OS or the
  module's animation pref) paints the end frames and skips every animation. Portraits through
  `resolveDisplayPortrait` (an alias never borrows its main's face; anonymous → the masked avatar).
- **Agent → Calls** — `MessageViewerApp` primary tabs become **Messages · Calls · Shards** (`TAB_ORDER`); Scheduled
  and Drafts move into the Messages chip row as two dashed chips (`set-filter` `drafts` / `scheduled`, shown only when
  non-empty; the existing lists are reused). The Calls tab is a new part `templates/message-viewer/partials/calls-tab.hbs`
  + `styles/components/calls-tab.css` (dialer, the Call button with arming + Decode hover, speed dial, log with Show /
  Sort / search / 25 a page, voicemail and transcript drawers, My line, the number picker with area codes, the
  No-line screen). It reads the player theme; Call green / missed red / voicemail amber stay fixed.
- **Call buttons elsewhere** — Contact Manager card + detail (only with a number), the message detail's sender chips
  (only with a known number, never anonymous / send-only), Admin → Contacts **Call as ▾** (identity, then who, then
  Dial a number).
- **Admin → COMMS → Phone** — `scripts/ui/AdminPanel/tabs/PhoneTab.js` + pure `tabs/phoneModel.js` +
  `templates/admin-panel/tab-phone.hbs` + `styles/components/admin-panel/tab-phone.css` (prefix `ncm-ph2-*`), context
  `ph2`, sub-tabs Live / Numbers / Call log / Voicemail / Settings, `tabAct` ops, the standing fold rule, Pop out. The
  tab bar has no number key left (`TAB_KEYS` is full 1–0) — Phone gets none; it is one click in COMMS.
- **Theme Customizer** — a Calls section: the colour scheme (NCM / 2077 / from my theme / custom) and Silent mode.

### 11.5 Phases (refreshed)

1. **Numbers + the call** — `phoneNumbers.js`, `callModel.js`, `callProfile.js`, `CallService`, the socket, the HUD
   (ringing, dialing, live, ended, in/out animation, colour schemes), **Out loud** only, the Calls tab (dialer, Call
   button, number picker with area codes, log, missed calls), Messages · Calls · Shards with the two chips, Call
   buttons on contacts / senders, call waiting + hold, the missed-call badge, the GM answering NPC lines as an identity,
   Admin → Phone **Live** (ringing + switchboard without listening) and **Numbers**, the call-log pages, sounds,
   settings. Works at every table.
2. **Type** — the subtitle play-out, typing indicator, transcripts in the log; the GM's **Listen in** and the
   transcript notice; Admin → Phone **Call log**.
3. **Voicemail** — typed first, then the GM's read-out (speechSynthesis), then recorded audio (MediaRecorder, the GM
   upload relay, the size cap, the purge); greetings and **My line**; Admin → Phone **Voicemail**; the voicemail screens
   on the HUD.
4. **Networks** — no signal, dead zones, node cuts and jams dropping calls, **Glitch the line** / **Drop**, taps and
   sniffers catching transcripts (`heardBy`), anonymous callers + trace, Activity-log rows, Network load.
5. **Dictate** — the browser's speech recognition with its notice; later an offline engine.
6. **Staged calls + eavesdropping** (§19) — independent of Dictate, so it can be built before phase 5.
   - **6a** — the line model (one line, three voices), listeners on a call, the setup dialog, scripted + live delivery,
     identities per side, in-the-room listening (one side), the intercept HUD, Admin → Live showing staged calls.
   - **6b** — network listening: live taps, the jack-in action "Listen to traffic", garble + enhance, cyberware by item
     name, Save as an audio log.
   - **6c** — encryption + descrambling, the GM's "they noticed" tools, call records on terminals, scheduled and triggered
     calls (the Overview timeline, access-point areas, a tap being installed).
7. **Later** — conference calls (contact groups; reuses the listener/party model from 6a), payphones as access points,
   a desk phone on a terminal, bugging a person's number, number cloning, blocking numbers, call costs, sharing a shard
   mid-call, Foundry A/V bridge.

### 11.6 Tests

- **Sims** (`dev/tools/sims/`): `test-phone-numbers.mjs` (normalising, vanity letters, home code, fiction ranges per
  country, generator never leaves the range or picks a taken number, area-code table shape), `test-call-model.mjs`
  (every transition, call waiting, hold, ring timeout → voicemail, busy, allowed modes, canCall / resolveCallee against
  a mocked world), `test-call-profile.mjs` (deterministic per caller, network type → cipher, strength → lock rings),
  `test-call-service.mjs` (the REAL service over a scripted two-client socket: ring → answer → lines → hang-up → the
  GM writes both log pages; no GM online; two GMs first-answer; a node cut drops the call), `test-admin-phone.mjs`
  (the real tab, a real Handlebars render, ops ↔ template both ways, folds), `test-calls-tab.mjs` (viewer tabs + chips,
  the Calls part render, Call buttons only with a number), plus the wiring guards the module always has (templates
  registered, CSS imported, tokens only, no `../` past an `{{#if}}`, no helper-named fields).
- **Phase 7 verification** (`scripts/tests/Phase7Verification.js`, under `debugMode`): service and socket contracts,
  settings registered, templates load, sound ids exist.
- **Probes**: the three mocks become real-template probes (`dev/mockups/call-hud-probe.html`, the viewer / admin
  previews gain `?view=calls|phone`), with the contrast walker in all three admin presets and several player themes.
- **Live test list** for the dev (two clients): call player↔player and player→NPC (GM answers as an alias), decline,
  no answer → voicemail, call waiting + hold, a node jam mid-call, the mic on http (refused with the reason) vs https,
  Dictate in Chrome vs Firefox vs the desktop app, recorded voicemail upload as a player with a GM online and without.

## 12. Open questions for the dev

**Answered 2026-10-29:**
- **Numbers:** a character picks one the first time they open Calls (a few generated ones, or type your own); the GM
  can also hand numbers out (Admin → Phone → Numbers → Give one). Not automatic, not in Email Setup.
- **On a call when another comes in:** **call waiting** — you see the second caller and can Hold & answer or Decline
  (they go to voicemail).
- **Recorded voicemail audio:** **files**, uploaded into the world folder through the GM's client (players relay),
  with a size cap and the purge in Settings; the page keeps only the path + transcript.
- **Group calls:** later (a later phase, using contact groups).
- Defaults taken unless the dev says otherwise: two GMs — both ring, first answer wins; players get a **silent mode**
  (the phone flashes, no ringtone); blocking numbers and call costs later; the GM **listens in live**, with the
  "the GM can read typed calls" notice on by default.

The original list:

1. Should every character get a number automatically, or only when the player picks one in Email Setup?
2. Unknown numbers: always "not in service", or ring the GM (a setting)?
3. Two GMs: both ring, first answer wins?
4. Can calls be blocked or cost money (a corp building that jams phones = a node; anything else)?
5. Group calls: phase 1, or later?
6. Should the GM see live transcripts of player↔player calls (Listen in), or only after?
7. Recorded voicemail storage: real files in the world folder (needs the GM's upload permission at the time), or data
   in the page?

## 13. Testing notes

Needs two clients (a GM and a player) at minimum; three for player↔player with the GM logging. Check: ring/answer/
decline/timeout both directions; a player with no GM online; a dead zone and a node jam mid-call; anonymous; voicemail
each way; the mic on http (refused with the reason) vs https; Dictate in Chrome vs Firefox vs the desktop app.

## 14. As built (phase 1, 2026-10-29) — not live-tested

- **Rules (pure):** `scripts/utils/phoneNumbers.js`, `callProfile.js`, `callModel.js`. **Service:** `scripts/services/CallService.js` (`game.nightcity.callService`), registered by `scripts/init/registerCallSystem.js` (keybindings init/40, service + HUD + sockets ready/125, `game.nightcity.placeCall` ready/126). Sounds `assets/sounds/calls/*.wav` (generated by `dev/tools/gen-call-sounds.cjs`), in the Sound board's **Calls** group.
- **Call HUD:** `scripts/ui/Calls/CallHud.js` + `styles/components/call-hud.css` (`ncm-ch-*`), probe `dev/mockups/call-hud-probe.html`.
- **Agent → Calls:** `scripts/ui/MessageViewer/callsTab.js` (context, wiring, `calls-*` clicks) + `templates/message-viewer/partials/calls-tab.hbs` (`TEMPLATES.VIEWER_CALLS`) + `styles/components/calls-tab.css` (`ncm-calls-*`). The Agent's primary tabs are **Messages · Calls · Shards**; Drafts and Scheduled are dashed chips (`ncm-pill--out`) at the end of the Messages chips, shown only when they hold something.
- **Call buttons:** player Contact Manager card / list row / detail (`callContact`, shown only when `CallService.numberForContact(contact)` finds a number — own phone → the directory line it copies → its linked character's line; never a send-only address) and the message viewer's action bar (`call-sender`: the GM by directory/line, a player only through their own contact; never masked, system, file or sent mail).
- **Sims:** `test-call-rules.mjs` (234), `test-call-service.mjs` (50), `test-calls-tab.mjs` (81, incl. a real Handlebars render of all three faces).
- **Admin → COMMS → Phone:** `tabs/PhoneTab.js` + pure `tabs/phoneModel.js` + `templates/admin-panel/tab-phone.hbs` (`TEMPLATES.ADMIN_TAB_PHONE`) + `styles/components/admin-panel/tab-phone.css` (`ncm-ph2-*`); context `phone2`, built only while open; no number key (TAB_KEYS is full). Sub-tabs **Live** (Ringing for you: answer as the identity / decline — an unowned number says Not in service; the Switchboard: every call with its state, timer, network, Drop or — when you are on it — Hang up; timers tick on the DOM) · **Numbers** (Players' characters with their burners, NPCs, lines whose owner is gone; Show filter, search, folds by the standing rule; Give a number / Give one / change / take away; Call a player as an NPC) · **Call log** (every call once, from `CallService.allLogs()`, by day, outcome chips, search, 40 a page) · **Settings** (calls on, ways to talk, start mode, home code, ring seconds, unknown numbers — each saves on change). The tab badge = NPC lines ringing for the GM (`stats.callsRinging`); the panel re-renders on call events while the tab is open. `CallService.allCalls()` / `allLogs()` are the GM readers; an NPC caller ignores the GM's own signal. **Admin → Contacts** directory detail has **Call as** when the NPC has a line.
- **Theme Customizer → Effects → Calls:** the four colour schemes (NCM / 2077 / My theme / Custom + two colour pickers) and Silent calls — client settings `callScheme` / `callSilent`, saved as you pick (not part of the theme's Save); the HUD repaints at once.
- **Sims:** + `test-admin-phone.mjs` (84, a real Handlebars render of all four views); `test-calls-tab.mjs` now 84.
- **Phase 1 done.** Phases 2–3 (voicemail, greetings, transcripts, listen-in, group calls) unchanged.

## 15. As built (phase 2 — Type, 2026-10-30) — not live-tested

- **Each side picks its own mode.** `CallService.modeFor(callId)` / `setMode(callId, mode)` keep this client's mode per call (`_myMode`); the other side keeps theirs. `usableModes` = the GM's list ∩ the browser ∩ **`BUILT_MODES`** (`loud`, `type`) — Dictate is never offered until phase 5 (a dead chip is worse than none). The HUD shows the chips only when there is more than one mode to pick.
- **Lines** — pure `makeLine` (one line, trimmed, 500 max, a real side), `addLine` (an echo kept once, 300 kept), `typeOutMs` (30 ms a character, 2.4 s cap), `sideOf`, `transcriptOf` in `callModel.js`. `sendLine(callId, text)` (live calls only; never on hold) sends socket type **`line`** with just that line — **`_send` never ships the transcript** (each client keeps its own copy, so merges on answer/hold never drop it). `sendTyping(callId, on)` → type **`typing`**, throttled to one notice every 2 s. Every GM gets every line (the audience already includes them) — that is what Listen in reads. Events `EVENTS.CALL_LINE` / `CALL_TYPING`.
- **The HUD subtitles** — a separate `.ncm-ch-subs` layer bottom-centre over the scene (`--ncm-ch-subs-bottom`, default 92px): the last 4 lines (newest bright, older dim; their side in the ring colour, yours in the live colour), a received line types out once (reduced motion: no type-out), "X is typing…" (cleared after 4 s of nothing), "On hold" while held, and — for a side in Type mode — the thin type line (`.ncm-ch-say`: Enter sends, Esc leaves, its keydown never reaches the Y / N / H call keys). The type line is created once per call and kept across redraws, so typing is never lost. Names follow the contacts rule (someone not in your contacts is their number).
- **The notice** — world setting **`callTranscriptNotice`** (default on; Admin → Phone → Settings): "The GM can read typed calls." under the type line (never on the GM's own).
- **The log** keeps the transcript: `_summary` adds `lines` (`transcriptOf` — side, name, text, at) and marks the call `mode: 'type'` when anything was typed. **Admin → Phone → Live**: a **Listen** toggle per call (`listen` op, `_listen`) opens what they type under the row, live (the panel re-renders on `CALL_LINE`); the switchboard's Typed / Out loud tally counts a call as typed once it has lines. **Call log**: a "Transcript · N lines" fold on every typed call, and search reads transcripts. **Agent → Calls**: the same fold on the player's own log — "You" for their lines, the other side by the contacts rule (an unknown caller stays a number in the transcript too; the stored name never reaches the view).
- **Sims:** `test-call-service.mjs` 71 (+21: the line rules, per-side modes, Dictate never offered, typing throttle, lines both ways without the transcript riding along, the GM holding the lines, hold/resume keeping them, both log pages carrying the transcript); `test-admin-phone.mjs` 99 (+12); `test-calls-tab.mjs` 90 (+5). Probe `dev/mockups/call-hud-probe.html?s=typed` (serve it).
- **Still to come:** phase 3 voicemail (typed first, then read-out, then recorded) + greetings / My line; phase 4 networks (taps catching transcripts); phase 5 Dictate.

## 16. As built (phase 3a — voicemail: greetings, typed + read-out messages, 2026-10-30) — not live-tested

- **Rules (pure):** `scripts/utils/voicemail.js` — `sanitizeLineSettings` (greeting `{kind: default|typed|tts, text ≤300, voice, rate, pitch}` + voicemail `{on (default true), dnd}`; a typed/tts greeting with no words falls back to the default), `greetingFor`, `goesToVoicemail({toKind, settings, why})` (only a player's or an NPC's line that takes messages; why = missed / declined / busy / dnd / offline — never not-in-service / no-signal / a number nobody owns), `greetMs`, `makeVoicemail` (text ≤1000, kind typed|tts), `voicemailOwner`. Speech: `scripts/ui/Calls/speech.js` (`speak` / `voices` / `canSpeak` / `stopSpeaking` — the browser's speechSynthesis, the player's own sound switch + volume).
- **Line settings** live on the number: `phoneLines[number].settings`. `CallService.lineSettings(number)` / `saveLineSettings(number, settings)` (GM writes; a player relays `CALL_LINE_REQUEST` op `settings`, only for a line of a character they own). Re-assigning a number keeps nothing (the old line goes).
- **The flow (caller's client):** an unanswered ring (`cancel(id, 'timeout')`), a decline or busy (socket), an offline callee, or **do not disturb** (no ring at all) → `_toVoicemail(callId, why)` — the call becomes `state: 'voicemail'` with `vmStep: 'greet'` and the callee's `greeting`; after `greetMs` (or Skip) `_vmTone` → `vmStep: 'leave'` + the `voicemail-beep`; `leaveVoicemail(callId, text, {kind})` → the active GM writes it (`writeVoicemail`), a player relays **`SOCKET_OPS.CALL_VM_REQUEST`** op `leave` (the GM refuses a message "from" a character the sender doesn't own; no GM online → refused with a reason); the call ends `outcome: 'voicemail'` ("Voicemail sent"). Hanging up on the voicemail screen leaves nothing (no answer). The callee's side still records a missed call. A voicemail box left open 3 minutes gives up.
- **Storage:** a page in the line owner's inbox (`voicemailOwner`: the character, else the directory identity), flag `voicemail` (`vmId, callId, from, to, text, kind, voice, at, gameTime, heard`), **no messageId** (no mail reader shows it). `getVoicemails(ownerId)`, `allVoicemails()` (GM, every inbox), `setVoicemailHeard` / `deleteVoicemail` (GM writes; a player relays op `heard` / `delete` for their own lines). `EVENTS.VOICEMAIL_LEFT` + a socket `voicemail` notice to the line owner's players and every GM.
- **HUD:** the badge in voicemail amber (`--ch-vm`, fixed by meaning), no arcs; the signal line says "No answer // routing to voicemail" then "● Recording // voicemail · n / 1000"; the dial sweeps during the greeting and becomes the length clock while leaving; the greeting types out as a subtitle (read out when it is a read-out greeting, once), then the tone line and the amber type line (Enter leaves it; the GM gets **Typed | Read it out** — a read-out message plays in the NPC line's greeting voice). Sent: "Voicemail // delivered" in green, the dial closes full with a check, then the usual fold-away. The recipient: an amber notice top-right (name by the contacts rule) with **Play** (read-out messages) and **Call back**.
- **Agent → Calls:** a **Voicemail** pill (count of unheard) showing the messages (who, which burner, the text, read out / Play, Call back, mark heard / new, delete); the tab badge counts unheard voicemail with unseen missed calls; **My line** (the voicemail button beside Call as) for the number picked in Call as — greeting Default / Typed / Read out (the browser's voices), Preview, Take messages, Do not disturb, Save.
- **Admin → Phone:** a **Voicemail** sub-tab (one box per line owner, NPCs first, unheard first, the standing folds; Play, Call back as the identity, Reply by mail as them, heard / new, delete; the nav counts unheard NPC messages) and a **Greeting & voicemail** button on every Numbers row (the GM edits an NPC's greeting — or a player's — with a voice list and Preview).
- **Sims:** `test-call-service.mjs` 97 (+25 — the rules, timeout → greeting → tone → message → the GM writes it → the owner is told / hears / deletes, a forged message refused, do not disturb, messages off, an NPC's voicemail, a number nobody owns), `test-calls-tab.mjs` 112, `test-admin-phone.mjs` 113. Probe `dev/mockups/call-hud-probe.html?s=vm-greet|vm-leave|vm-sent|voicemail-note` (serve it).
- **Next — 3b:** recorded voice messages (MediaRecorder, needs a mic and https; the GM's client uploads the file; a size cap and a purge) and recorded greetings.

## 17. As built (phase 3b — recorded voice, 2026-10-30) — not live-tested

- **Recording:** `scripts/ui/Calls/recorder.js` — `micStatus()` (a secure page, a mic, MediaRecorder — else the reason in words: "This connection does not allow the microphone. The GM can turn on HTTPS (Foundry's SSL settings), or play on localhost."), `VoiceRecorder` (`start({maxMs, onLevel, onTick, onLimit})` / `stop()` → `{blob, ms, mime}` / `cancel()`; Opus in WebM at 32 kbps where it can; a live level from an AnalyserNode), `blobToBase64`, `playAudio(src)` (the player's sound switch + volume).
- **Saving (players can't upload):** `CallService._sendAudio(base64, mime, meta)` — the active GM saves it here; a player sends it in 120 000-character pieces over **`SOCKET_OPS.CALL_AUDIO`** with what to do riding the last piece (`meta.purpose` `vm` | `greeting`). `handleAudio` (active GM) collects them per upload id (pieces from another user never join; abandoned uploads are dropped after 2 minutes; ~2.2 MB cap), then `_audioArrived` checks the sender (a voicemail "from" a character they own; a greeting for a line they own) and `_storeAudio` saves a file in **`worlds/<world>/ncm-voicemail/`** through `FilePicker.upload` (`forgevtt` on The Forge). When uploads are impossible, a short recording (≤ ~500 KB) is kept inside the message as a `data:audio/…` URL; otherwise it is refused and both the GM and the sender are told. `voicemail.js` filters every stored audio reference (a plain path, an http(s) link, or `data:audio/…;base64` — nothing else).
- **Settings** (Admin → Phone → Settings): `voicemailRecording` (on), `voicemailMaxSeconds` (60, 10–180), `voicemailKeepDays` (30, 0 = forever); the row "Recordings stored" counts them (and those kept inside messages) with **Purge old…** — `purgeRecordings(days)` clears the recording from voicemails older than the setting (their words stay) and also runs once per session on the GM's client. **Files on disk stay — Foundry cannot delete files** (the purge says so).
- **On the call screen:** the message step's ways are **Record** (greyed with the reason when the GM switched it off or the browser can't) · **Type** · the GM's **Read it out**. Record: ● Record / ■ Stop / Again, a 10-bar live level, "0:15 / 1:00", Enter sends (stopping first), R starts over, it stops itself at the limit; the dial is the clock and the signal line reads "Recording // voice · 0:15 / 1:00" (the badge reads the HUD's own state — the badge is redrawn after the box is built). A recorded greeting plays when a caller reaches it (stopped at the tone); its line reads "♪ (their recorded greeting)" when it has no words.
- **Greetings:** a fourth kind, **Recorded** (`greeting.audio` + `duration`; the tone waits for it; words optional, shown as subtitles; 20 s at most). Recorded from **My line** (Record / Stop / Play; Save uploads it through the GM, or keeps the saved one) and from the GM's **Greeting & voicemail** dialog for any number.
- **Playback:** a voice message has a small player in the Agent's Voicemail list (playing it marks it heard) and in Admin → Phone → Voicemail; the recipient's notice has **Play**; a purged one says the recording was cleared.
- **Sims:** `test-call-service.mjs` 113 (+16 — pieces / the GM saves the file / the voicemail points at it, a forged recording, pieces from two users never mixing, the size cap, recordings switched off, the inline fallback when uploads fail, a recorded greeting saved through the GM and heard by a caller, the 20 s cap, the purge rule), `test-calls-tab.mjs` 114, `test-admin-phone.mjs` 115. Probe `call-hud-probe.html?s=vm-rec` (serve it).

## 18. As built — phase 4: calls and the network (2026-10-30)

Rules = the pure `scripts/utils/callNet.js` (`dropReason`, `maskCaller`, `callerFor`, `interceptMail`, `networkLoad`). Not live-tested.

- **Signal at both ends.** Each client remembers the network its side of a call rides (`_myNet`: the caller's at `placeCall`, the callee's at `answer`). `checkSignal` (on `NETWORK_CHANGED`, which node changes also emit) drops every call whose side lost its line — dead zone, a node jammed / off / damaged on the viewed scene (named: "Watson relay is jammed"), or moved to another network — and sends `drop` with the reason; the other end reads "Their end: …". A callee with no signal never rings: it answers the ring with `noSignal`, and the caller goes to voicemail (`offline`) or ends `no-signal`. A GM's side never drops (an NPC is wherever the NPC is). The reason rides `call.dropReason`, shows under the HUD (`.ncm-ch-why`, also added during the end morph), on the call log (Agent and Admin) and in the Activity row.
- **The GM drops with a reason** (Admin → Phone → Live → Drop opens a picker: signal broke up / jammed / dead zone / line went dead / traced) and **glitches** a live call (`glitch` → `CALL_GLITCH` on both ends: the badge stutters, the call word reads "Signal unstable", subtitles scramble then come back; reduced motion = no stutter).
- **A withheld number (GM only).** Call a player as… asks "Their screen shows…" — the NPC, or Number withheld (`from.anon`). `_send` splits the audience: GMs and the caller get the real caller, everyone else `maskCaller` (no name, number or ids). Merges never overwrite the caller a client holds. The callee's log page is masked (`anonCall`); the NPC side's keeps the truth. **Trace**: a key on the live HUD (T) and a crosshairs button on a withheld log row → `traceCall` = `performCheck` (the anonymous-mail `anonTraceSkill` / `anonTraceDV`, Roll Reveal) → on a hit `traceRequest` to the active GM → `_revealTo` sends `reveal` to that user alone (`CALL_TRACED` toast) and un-masks their log page; a later page for that call logs the real caller (`summary.traced`).
- **Fixed on the way: call socket events were never filtered by `userIds`** — every client received (and the GM's real-caller copy reached) every call event. `handleSocket` now drops an event not addressed to this user. The sim asserts a client outside a call ignores it.
- **Taps and sniffers hear calls.** The GM's `writeLog` runs `_intercept`: an ANSWERED call with a network and the caller's scene goes through `NetworkService.tapDelivery(mail, heard)` as a mail-shaped copy (`interceptMail`: the typed transcript, or "a voice call — only who, when and how long"; a withheld caller stays withheld). `tapDelivery` gained an optional `heard` array (who caught it). `heardBy` is stored only on a page whose owner is NOT a player's character (the GM's business); `allLogs` merges it; Admin → Phone → Call log shows "heard by N".
- **Activity log**: every call writes a `call` row (`_activityRow`: who called whom, how it ended, the reason, the tap count, the caller's scene — `addEntry` now carries `sceneId/sceneName`); Admin → Networks → Activity log has a **Calls** chip.
- **Network load** (Admin → Phone → Live): calls on each network now and today on the game clock, a bar per network in its colour, and a red "jammed here" when a node cuts it on the viewed scene.
- Sim `test-call-service.mjs` §6e (142 total); probe `call-hud-probe.html?s=drop-why|anon|glitch`.


## 19. Staged calls and eavesdropping (phase 6 — design, 2026-10-30, not built, no mock yet)

The GM runs a call between two NPCs; the players are never on it, they listen in — and how much they hear depends on
how they got in. Dev decisions: all three voices are offered and **interchangeable**; whether "in the room" needs
tokens is **configurable**; listening is only ever noticed **when the GM decides**.

### 19.1 One line, three voices

Every line, in every kind of call, is the same record:
`{ id, side: 'a'|'b', text, voice: { kind: 'text'|'tts'|'audio', audio?, duration?, voice?, rate?, pitch? }, delay, marks: [] }`

- **The text is always there.** It is the subtitle, the transcript, what a tap copies and what garble/enhance act on. A
  recorded line's text is its subtitle (the GM may leave it short; a line with no text is "[voice only]" to a tap).
- **The voice is a layer on top**, chosen per line, with a default per side (side A reads out with voice X, side B is
  recorded). Swapping a line's voice never changes anything else: same timing rules, same listeners, same garble.
- Timing: text = typed-out speed (`typeOutMs`); tts = speech end (or its estimate); audio = the clip's duration.
- Marks: **clue**, **lie** (voice-stress tools flag it), **code word** (nonsense without the key).
- Garble, per voice: **text** — the paint-over garble (the real text never reaches a listener who has not earned it);
  **tts** — only the cleared words are spoken, a burst of static covers the rest; **audio** — played through a Web
  Audio chain (band-pass, noise, dropouts) whose strength is the garble level. Enhance lowers the level for that listener.
- Phases 2–3 already store lines and greetings this way in spirit; 6a makes it the one shape (`callModel.makeLine` gains
  `voice`), so player calls, voicemail and staged calls share it.

### 19.2 The staged call

- **Setup dialog** (Admin → Phone → "Stage a call"): side A + side B (any NPC or alias), each side's **location**
  (a token on a scene / a scene / off-screen), the **network**, how each side is **identified to listeners** (name /
  number only / withheld — the phase 4 mask; tracing still works), the default voice per side, the **delivery**
  (scripted or live), when it starts (now / later — 6c).
- **Scripted:** the lines are written ahead (per line: side, text, voice, delay, marks; a recorded line is recorded in
  the dialog with the phase 3b recorder) and play out in real time. The GM can pause, skip, jump, end.
- **Live:** the GM speaks for both sides from the HUD — a side toggle, a text box, and per line the voice: send as text,
  read out, or push-to-record (the 3b relay). Lines can be mixed freely.
- It shows on Admin → Live's switchboard with who is listening and how; it writes a GM-only log entry.

### 19.3 Listeners (replaces the GM's Listen in as a special case)

A call carries `listeners: { [userId]: { actorId, sides: ['a'|'b'], garble: { a, b }, via: 'room'|'tap'|'jack'|'scanner'|'gm' } }`.
The GM is a listener on both sides at garble 0. Events go only to listeners (the phase 4 `userIds` rule); a listener
gets only the sides they hear, and the text already garbled for them — never the clean text to be hidden client-side.

Ways in:
1. **In the room** — near one side: hears that side only, clean, no roll. Setting: tokens within N squares, or just on the
   same scene. Amplified hearing (by item name) extends the range.
2. **A tap / sniffer** on a node of the call's network on either end's scene — both sides, live, garbled by signal and
   by how well the tap was made; the after-call copy (phase 4) stays.
3. **Jacked in** — a node session action "Listen to traffic" (a roll, costs a move): both sides, live.
4. **A radio scanner** (gear) — calls on this scene with no node; heavier garble.
5. **Descrambler** (gear) — required to get anything but noise from an encrypted call (6c).

**Enhance**: a roll (Interface or Electronics/Security Tech; the GM sets it) that lowers the listener's garble — the
margin buys more. **Voice stress analyzer** flags lie lines. **Save** writes what this listener heard (as garbled as
they heard it) into their EXFIL folder as an audio-log file (transcript playback; recorded lines keep their clips).

### 19.4 Being noticed — the GM decides

Nothing detects a listener on its own. The GM sees every listener on the switchboard (who, how, since when) and has
tools: **They heard a click** (a toast on the NPCs' side of the HUD for the GM's own reaction), **Switch to code words**
(the remaining scripted lines marked code word), **Hang up**, **Cut this listener** (drops one listener, optionally
with a trace / heat via the existing funnel). A failed jack-in roll still traces as it does today.

### 19.5 What it changes in what exists

- `makeLine` gains `voice`; the HUD's subtitle layer plays a line by its voice (speech.js / an audio element / the
  garble chain).
- The GM's Listen in becomes a listener entry; the HUD's intercept variant (violet, "INTERCEPT", no speaking) renders any
  listener, including a GM listening to a player call.
- `tapDelivery` gains a live path for staged calls (taps become listeners while the call runs).
- Node sessions gain one action; jackIn rules gain its DV / rank / move cost.
- Phone settings: in-the-room mode + range, the enhance skill + DV, the item names for each piece of cyberware/gear.
- Conference calls (phase 7) reuse sides → parties and the listener model.

### 19.6 Open

Answered by the dev (2026-10-30):
- A listener can be in two ways at once (in the room for side A + a tap) — **yes**, the best per side wins.
- Staged calls leave call records on the network's terminals — **yes, configurable** (a setting, per call overridable).
- Scripts live in a **reusable library**, like the composer's message templates (world setting, import / export).

## 20. As built — phase 5: Dictate (2026-10-30) — not live-tested

- **`scripts/ui/Calls/dictation.js`** — the browser's speech recognition. Pure helpers take the globals: `speechVendor(ua)` (Google / Microsoft / Apple, named on the notice), `dictateStatus(g)` → `{ok, reason, vendor}` (no API → "Firefox cannot…" / "This browser cannot…"; the Foundry desktop app (Electron) → "use Chrome, Edge or Safari"; an http page → the HTTPS fix), `dictateError(code)` (silence / abort are not errors), `spokenLines(text)` (folded, capitalised, cut at word breaks under `LINE_MAX`), `dictateLang(g)`. `Dictation` = one continuous session with live words; the browser closes it after a silence and it reopens while wanted; a session that keeps closing at once (<1.5 s, 6 times) gives up and says so; a refused mic stops with the reason and is never reopened.
- **Each side transcribes its own mic and sends ordinary lines** (`sendLine(id, text, {via:'dictate'})`; `makeLine` keeps `via`), so subtitles, transcripts, Listen in, taps and the call log need nothing new. The typing indicator carries `how: 'talk'` → "is talking…".
- **Modes**: `BUILT_MODES` now includes `dictate`. `usableModes` = GM list ∩ what this browser can do; `offeredModes` = the GM's list — the HUD shows Dictate even where it can't work, greyed (`is-off`) with the reason as its tooltip; clicking it toasts the reason and switches to Type. `dictateBlock` = the reason ('' when it works).
- **The notice, once per browser**: picking Dictate the first time asks (themed confirm) — the speech goes to <vendor>, NCM keeps only the words, the mic is on only while Dictate is picked and can be muted; yes → client setting `callDictateConsent`.
- **The HUD bar** (`_dictBar`, `.ncm-ch-say.is-dict`): the speaker's name, a mic button (pulses while listening, mute / listen again), the words being heard (or "Listening — just talk" / "Mic muted" / the error in red), "Type instead" after an error, and a note "Your speech goes to <vendor> to become text · the GM can read dictated calls". The mic closes whenever the mode changes, the call is held, ends, or another call takes the screen (`_stopDict`).
- Admin → Phone → Settings offers Dictate; the switchboard counts a call with dictated lines as Dictated.
- Sim `test-dictation.mjs` (38, a fake SpeechRecognition through the real module); `test-call-service` updated. Probe `call-hud-probe.html?s=dictate|dictate-off|dictate-err` (a fake engine — set both `SpeechRecognition` and the webkit name: current Chrome has the unprefixed one).
- Not built: an offline engine (Vosk / Whisper) for Firefox and the desktop app.

### 20.1 Fix (2026-10-30, dev: "Live, Voicemail and Call log aren't tracking anything")

- **Admin → Phone → Call log and Voicemail were always empty**: `MessageRepository.identifyInbox` is STATIC, and `allLogs` / `allVoicemails` called it on the instance (`repo?.identifyInbox?.(j)` → undefined → every journal skipped). The sims mocked it as an instance method, which hid it. Now `CallService._inboxOf(repo, journal)` asks the class (an instance method still works for mocks); `test-call-service` §6f asserts no call site asks the instance, §6g drives the REAL PhoneTab over the REAL service with the real repository shape (Live during ring / connected, gone after, the log and voicemail after).
- **Nothing refreshed when a log page or voicemail was written** (the call ends first, the GM writes the pages a moment later). `registerCallSystem` hooks create/update/delete of any page carrying `callLog` / `voicemail` → `EVENTS.CALL_LOGGED`; Admin → Phone (plus `CALL_MISSED`) and the Agent viewer (its missed badge + Calls tab, also on `LINE_UPDATED`) re-render on it. The Agent viewer had no call subscription at all before.
