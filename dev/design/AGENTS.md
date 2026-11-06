# Agents as devices — design

Status: **design only — parked until after 2.1** (dev, 2026-11-05: "all this agent stuff should be built for later and
we're just designing the ideas now, because we really need to release 2.1 in the current state"). Nothing here is
scheduled; no Agent code goes into 2.1. Before building: settle the head models (§4, v3 note), then phase 1 (§10).
(2026-11-05). Mocks: `dev/mockups/agent-look-mock.html` (the look, current) ·
`dev/mockups/stolen-agent-mock.html` (first pass: locks, admin, flows — its phone LOOK is superseded).
Reference: `dev/mockups/AllAboutAgentsReference.png`, and the *All About Agents* DLC text in the dev's lore folder
(`…/04 - Reference/Book Text/RTG-CPR-DLC-AllAboutAgentsv1.01.txt`). **Names and reworded ideas only — never its text,
statblocks or tables** (the IP rule in CLAUDE.md's canon-vocabulary note).

## 1. The idea

Any item can become an **Agent**: a person's phone, with their mail, calls, chats, contacts and chips on it. An NPC's
Agent can be **looted** (or, later, hacked at range), **cracked**, and read. A player's own Agent can be an item too
(a switch), so it can be lost or stolen. Every Agent — player or NPC — shares **one look**, built around its **AI**,
not around a grid of app icons. The desktop mail window stays as the work view.

## 2. Decisions (dev, 2026-11-05)

1. **Reads come from the GM's client over a socket.** No journal ownership grants (they would show the NPC's inbox in
   the player's Journal sidebar). A GM must be online — already true for every player write.
2. **Live data**: the thief reads the real inbox, so mail after the theft shows (a per-device switch can hide it).
3. **Explicit GM convert**, plus an optional setting "an Agent carried by an NPC is its phone" (auto-detect).
4. **Players' own Agent as an item: yes, a switch, off by default.** Its AI name is the existing Theme Customizer
   agent name (one value). Without it: "No Agent on you"; mail keeps arriving and waits; anyone can pick it up and try.
5. **A feature** (`FEATURES`, Module Settings → Systems). Off = nothing loads.
6. **Each Agent carries its own look**: a full NCM theme (the object the Theme Customizer saves, applied to that
   device only, the way terminals do) + a lock-screen picture + a lock style. A player's Agent = their theme, saved
   onto the item, so a thief sees *their* phone.
7. **Players and NPCs look alike.** One Agent view, two modes (own = full, someone else's = read-only + "held by").
   A player can toggle **Desktop / Agent** view for their own inbox.
8. **Not a stereotypical phone.** The AI's projection is the centre; the **form factor** sets the layout.
   First three: **slab, holo slab, clamshell.** Wrist and internal later.
9. **App names from the setting, editable**: ZPost (mail), BabelChat (chats) by default; a world setting renames them.
   GM tools keep plain words.
10. **Backdated history with a player** (the builder, §8): default **only on the NPC's phone**; tick to deliver both sides.

## 3. What the lore gives us (reworded)

- **The AI is the point.** An Agent runs a self-adaptive pseudo-AI (the setting calls it a SAAI) with a bought
  personality — voice, quirks, accent. People treat it like a friend. It summarises, reminds, nudges, screens calls.
- **Form factors differ physically**: a cheap clamshell with a second display-only screen (Segotari Double Agent), the
  everyday slab (Zetatech Grade A), the slab with a holo-projector (Grade A-Plus), a wrist unit with a holo display
  (Wyzard Merlyn), and internal Agents (audio, or text in the field of view through a Chyron).
- **Quality tiers** (poor / standard / excellent) set how hard one is to crack.
- **Hacking is usually remote** with a dedicated device (a *Breacher*) in line of sight within ~10 squares: an
  Electronics/Security Tech check; a failure makes the victim's AI **warn its owner**. A hack can plant commands for at
  most a day (location, listening in, lock-out, a backdoor); the owner can detect it or reboot.
- **No cloud backup**: the device *is* the AI's learned self — a stolen Agent is a hostage.
- **Short-range device link** (*AltLink*) for files and money Agent-to-Agent.
- **App names**: ZPost (mail), BabelChat (messaging), BangMe! (money), Ask Alex Anything (search), the Garden (social),
  WatchBox (room alarm). Already in `CANON-VOCAB-AND-IDEAS.md`'s "available" list.

## 4. The look

**The AI's projection** sits at the top of every Agent: a line-drawn face / form in the theme colour with one line of
speech ("Three new from Mr. Hands. One moves Saturday's drop."). Content below is **glass slips** (a message, a call, a
chat). You navigate by **asking the AI**: command chips "ZPost · Calls · BabelChat · People · Chips" read as orders to
it. On someone else's Agent the same AI talks to the thief ("You're not Yuri.").

| Form | Layout | Lore model |
|---|---|---|
| **Slab** | one chamfered glass panel, the AI's face inside the glass | Grade A |
| **Holo slab** | the AI's face floats *above* the glass on a projection beam | Grade A-Plus |
| **Clamshell** | a small display-only screen on top where the AI talks; the touch panel below | Double Agent |
| *Wrist* (later) | a compact strip, content projects out of it | Merlyn |
| *Internal* (later) | no device: a HUD on the window edges, text + a voice waveform | cyberaudio Agents |

### The AI — a living hologram

> **v3 is the direction (2026-11-05, dev: "think generic man, Unreal-engine-ish male and woman… you're stylizing too
> much").** Mock `dev/mockups/agent-ai-v3-mock.html`. Realism can't be sculpted from code — it comes from a **real head
> mesh**. v3 loads a realistic head with the **52 ARKit face blend shapes** (the phone face-capture set) in three.js and
> gives it the hologram treatment: a dim body + key light + fresnel rim (a patched standard material, so blend shapes
> keep working), the mesh's own topology as an additive **wireframe** (the reference's look), scanlines, a halo. Looks:
> hologram + wire / wire only / solid glow. The face moves through real shapes: `jawOpen` (talking), `eyeBlink_*`,
> `mouthSmile_*` / `mouthFrown_*`, `browInnerUp` / `browDown_*`, `eyeSquint_*` / `eyeWide_*`, `cheekSquint_*`,
> `eyeLook*` (gaze); the head turns to the cursor. All the behaviour above (gaze, idle glances, blink, talk, moods,
> the line library) carries over.
> - **The mock's model is three.js's example `facecap.glb` ("model by Face Cap", no licence stated) — mock only, NOT
>   shippable.** It is male only and a face/head without a neck.
> - **MetaHuman is out**: its licence only allows rendering inside Unreal Engine.
> - **What we need to ship**: a generic realistic **male** and **female** head (gender-neutral optional), each a
>   compressed glTF (~1–3 MB) with the ARKit 52 blend shapes (at least jawOpen, eyeBlink, mouthSmile, mouthFrown,
>   browInnerUp, browDown, eyeSquint, eyeWide, eyeLook*), plus a licence that allows **redistribution inside a free
>   module** (the .glb ships in `assets/`, anyone can open it — a "royalty-free, no redistribution" asset licence does
>   not cover that). Routes: (1) MakeHuman / MPFB heads (CC0 output) + ARKit shapes made in Blender (e.g. with a
>   face-rig add-on), (2) a bought head pack whose licence explicitly allows distribution in an app/mod, (3) permission
>   from Face Cap for facecap.glb.
> - **Runtime**: three.js (MIT) vendored into the module (~700 KB minified; Foundry does not bundle it), one WebGL
>   canvas per open Agent, paused when hidden; reduced motion as before; no WebGL → name + a static glyph.
>
> v2 (the SDF sculpt) and v1 (the line face) below are kept as the record; their behaviour notes still apply.

> **v2 supersedes the line face (2026-11-05, dev: "I really don't think it's capturing a face").** Mock
> `dev/mockups/agent-ai-v2-mock.html`. Lines on a stretched globe cannot show form, so v2 **sculpts the head** as a
> signed-distance field (smooth-blended solids: skull, face mass, jaw corners, an under-jaw cut for the jawline edge,
> chin, cheekbones, brow ridge + brows, nose bridge / tip / wings, eye sockets with eyeballs and moving lids, lips, the
> mouth opening, ears, neck) and renders it in a **WebGL fragment shader** (one canvas per open Agent, no library):
> a dim body, a key light for form, a fresnel rim + hot edge for the projection, an optional object-space wire grid
> (the reference's look) or scanlines, a halo, stray motes, glitch bands. Builds / jaw / moods / blink / gaze /
> talking jaw / the line library all carry over (uniforms: rotation, jaw, lid, brow, inner brow, smile, gaze, three
> build vectors, colour). If WebGL is unavailable the AI falls back to its name + a static glyph. The v1 notes below
> describe the behaviour (still true) and the old line renderer (replaced).
> **Decided the same day:** no voice for now (text + the moving mouth only); a personality does **not** change the look
> (the look is per Agent).

**v1 (`dev/mockups/agent-ai-mock.html`, dev 2026-11-05: "go in depth… move with the cursor… more humanoid… man, woman or gender neutral")**

- **A real-time 3D wireframe head on a `<canvas>`**, drawn from one parametric head — no images, no library. Modelled
  on the reference image: **bone structure, not hair** — deep eye sockets with the eyeball in them, cheekbones and the
  hollow under them, the jaw corner, a nose bridge / tip / nostril wings, a philtrum, sculpted lips, the groove under
  the lower lip, the chin, ears (rim + inner fold), a neck with the muscle from behind the ear to the collarbone,
  collarbones. The mesh fades over the face and **edge loops** follow it (under the eyes, the socket rim, over the
  cheekbones, nose wing → mouth corner, temple → jaw, under the lip), like the reference's topology.
- **Builds** (dev, 2026-11-05: "the female more feminine, the male more like the reference"): **man** — heavy brow
  ridge, deep sockets, narrower eyes, a sculpted cheek hollow, a wide squared jaw with a defined corner, a chin cleft, an
  Adam's apple, broad shoulders, and the reference's **implant plates** (dark panels with lit edges on the temple and
  cheek) on by default; **woman** — high cheekbones, a soft tapered jaw, a small rounded chin, larger almond eyes with a
  few lashes, thin arched brows, fuller lips with a defined bow, a slimmer neck, narrower shoulders; **gender-neutral**
  — between. **Hair is optional, off by default** (none / short / long); implants are a per-AI option.
- **The mouth moves**: speech drops the whole jaw (everything under the upper lip, front and sides, moves down and
  back), the lower lip follows, and the opening is dark with a hint of teeth; closed = the lips + one meeting line.
  Vowels open it most, m / b / p close it, and the head nods a little while it talks.
- **It looks at you**: the head turns toward the cursor (yaw ±0.8 rad, pitch ±0.4), the **eyes lead the head**; when the
  pointer is still for 2.5 s it glances around on its own in small saccades. Neck and shoulders turn less than the head.
- **It is alive**: blinks on its own clock (sometimes a double blink), breathes (a small bob), **lip-syncs** while
  speaking (the line types out; vowels open the jaw, m/b/p close it), and the mesh fades over the face so features read.
- **Moods** (calm / happy / suspicious / alarm) ease between brow height, the inner brow, eyelid opening, the mouth
  curve and colour (alarm shifts toward red and glitches more). The AI's line and mood come from the situation: a
  stranger at the lock → suspicious; good news → happy; an intrusion → alarm.
- **Projection dressing**: data motes drifting up, an orbiting dashed data ring, a scan band, mesh nodes, a beam and a
  floor glow; a rare **glitch** (slices + a colour split).
- **Per device**: build, name, default mood, colour (from the device theme), mesh style (fine / open / scanned).
- **Cost and care**: one canvas per open Agent at device pixel ratio ≤ 2, paused when hidden (and not drawn at all for
  a slab's tiny face — a static frame). **Reduced motion**: keeps cursor-follow (the user causes it), drops idle
  motion, motes drift and glitches. In the build: `scripts/ui/Agent/agentFace.js` (`new AgentFace(canvas, { build,
  mood, accent, mesh, reduced })` · `say(text, mood)` · `setMood` · `look(yaw, pitch)` · `destroy()`), its pure
  geometry (`BUILDS`, `MOODS`, the head surface) in a rules file a sim can drive.

- **Jaw** (per AI): soft / defined / strong. The jaw is a real mandible — a local corner under the ear (applied to the
  sides and front only, so the back of the skull never flares) and a jaw edge drawn as a feature line: ear → corner →
  chin, brighter as the jaw gets stronger.

### What the AI says — the line library (dev, 2026-11-05: "a long list… editable, importable and exportable… dialog for the holo")

The AI's lines are **data, not code**: a library of short lines, each for one **moment**, in one **personality**, with
a **mood**. Every Agent's AI has a personality (and may have its own extra lines); when a moment happens, the AI picks a
line for it — weighted, never the same one twice in a row — fills in the tokens, says it (typed + lip-synced, and read
aloud if the device has a voice), and takes its mood. The mock has a working sample (Personality + "Something happens").

- **A line** = `{ id, moment, personality, mood, weight, text, device? }`. `personality: '*'` = every personality;
  `device` (optional) = only this Agent ("Hi! Chen's busy.").
- **Moments** (the triggers; each is one place in the code that says "this happened"):
  `lock.stranger` (someone not the owner picks it up) · `lock.wrong` · `lock.lockout` · `lock.bypass-fail` ·
  `lock.cracked` · `lock.biometric-ok` · `owner.welcome` / `home.summary` · `mail.new` · `mail.priority` ·
  `call.missed` · `voicemail.new` · `chat.new` · `idle` (random chatter while open) · `dead-zone` · `trace`
  (an intrusion / hack attempt) · `held-by-stranger` (talking to the thief inside) · `wipe.warning` · `wiped` ·
  `returned` (back with its owner) · `nudge` (a GM hint — see below). The list is a table in code (`AI_MOMENTS`, with
  the tokens each moment provides), so a new moment is one row.
- **Tokens**: `{owner} {holder} {thief} {brand} {model} {ai} {tries} {count} {mail} {chats} {sender} {subject} {caller}
  {place} {time} {date}`; a token a moment cannot fill stays as typed (and the editor warns).
- **Personalities** ship as a few templates — **Assistant**, **Street choom**, **Corp security**, **Sweetheart** — and
  the GM can add their own (a personality is just a name + its lines). The lore idea: personalities are bought templates
  with a voice, quirks and an accent — so a personality can also carry a default **voice** (the browser's speech voice
  the phone already uses for read-out greetings) and a default **mood**.
- **GM nudges**: Admin → Agents → "Make their AI say…": pick a player's Agent, type or pick a line, send. The player's own
  AI says it (the lore's "your Agent has a bad feeling" tool). A nudge can be a one-off or saved to the library.
- **Editing**: Admin → Agents → **AI lines**: a searchable, filterable table (moment, personality, mood, weight, text,
  device) with Add / Duplicate / Delete, a **Try it** button that plays the line on a preview AI, and token help.
  Stored as a world setting (or a GM-only journal if it grows large — the gmLogStore pattern).
- **Import / export**: **CSV** (columns `moment, personality, mood, weight, text, device`) and **JSON**, with the
  address directory's **plan-then-apply** (shows what will be added / changed / skipped, flags unknown moments or
  tokens, before anything is written; `utils/csv.js`). Export filters (one personality, one moment) make it easy to
  share a personality pack between tables.
- **What ships**: an original starter library (written for NCM — no lines lifted from any book) of ~150 lines: every
  moment × the four personalities, a few variants each.

**Theme + lock**: the device's theme colours everything inside the form; the **lock style** sets the lock screen's
layout — **Corporate** (logo, owner line, a legal notice), **Personal** (a full photo, a big clock, a notification
peeking), **Street** (cracked, cheap), **Clean**. Saved looks ("Arasaka issue") reuse a look across devices.

**App names**: world setting `agentAppNames` = `{ mail: 'ZPost', chats: 'BabelChat', calls: 'Calls', people: 'People',
chips: <shardTerm>, money: 'BangMe!', search: 'Ask Alex' }` (labels only; keys never change). Player-facing Agent
surfaces read it; GM tools say Mail / Chats.

## 5. Devices — data

Three-flag item pattern, like shards and terminals:
`flags.<id>.isAgent` · `agentConfig` (GM-authored) · `agentState` (runtime).

- `agentConfig`: `owner` ({ actorId | contactId }), `brand`, `model`, `form` (slab | holo | clamshell), `quality`,
  `ai` ({ name, line (to strangers) }), `look` ({ theme, lockStyle, lockImage, ownerLine, notice }),
  `locks` ({ passcode: { code, tries, lockoutMin }, biometric: { ownerReach, keyItems[] }, bypass: { skill, dv,
  failHeat }, wipeAtZero }), `visible` ({ mail, sent, calls, voicemail, people, chips, chats, afterTaken }).
- `agentState`: `tries`, `lockedUntil` (game clock), `cracked` ({ by, how, at }), `wiped`, `heldBy` (derived).

The owner's data is never copied: the device points at an identity; reads resolve that identity's inbox / call log /
contacts at read time (live — decision 2).

## 6. Access, safety

- **Socket ops** (each gets a `SOCKET_TRUST` class; the handler trusts the server-stamped sender only):
  `AGENT_UNLOCK` (an intent: "tried code X" / "used key item Y" / "rolled"; the GM re-checks and decides),
  `AGENT_READ` (GM returns the visible slice for that device to that user, only while the user's character holds it
  and it is cracked), later `AGENT_SEND` (send as the owner; the GM re-runs recipient checks and stamps
  "sent from <owner>'s Agent by <thief>", like terminal-typed mail).
- **Holding** = the item is on an actor the user owns. Dropping / trading it ends access at once.
- **Locks** reuse: the terminal keypad, the roll panel (`rolls.js`, `beatsDV`), payphone reach (`inReach`) for the
  owner's body, the operator gear check for **key items** (a cloned print film, a severed thumb, a corp ID).
  Wrong tries / failed bypass feed the trace spine (`fireTrace`) when the device says so.
- Masking is on screen, not secrecy (the module rule): socket traffic is not hidden from a determined player.

## 7. The player's own Agent (switch "Players need their Agent")

The character's inbox opens only while they carry their Agent item; otherwise "No Agent on you" (mail and calls wait;
a count of what arrived). The Theme Customizer's agent name is the AI's name; it gains a **Your Agent** section: brand ·
model · form · lock picture · lock style. A player can still use payphones, terminals, others' Agents.

## 8. GM tools

- **Configure** (item right-click → Convert to Agent / Configure): whose · what it is (brand, model, form, quality,
  AI name + line) · look (theme preset / copy a player's theme / customize; lock style + picture + owner line +
  notice; saved looks) · ways in · what a thief can see · **Preview as a thief**.
- **Admin → World → Agents** (a `TAB_GROUPS` row): every device — owner, holder, state (with its owner / locked /
  cracked by X / wiped), actions (lock again, wipe, open as GM, configure, give back) and an activity feed.
- **Make an Agent…** builder: pick or create the NPC (gets an address + number), the device, then their life in
  tabs — **ZPost** (backdated mail, real messages in both inboxes per decision 10), **BabelChat** (a real
  conversation), **Calls** (the existing call-log editor in place, "fill a week"), **People** (writes real
  who-knows-whom), voicemail, notes. Everything goes through the real services so it syncs everywhere.
- **Import / export**: one CSV per tab (mail, chats, calls, contacts) with the address directory's **plan-then-apply**
  (shows what will be created, flags unknown names first; `utils/csv.js`), and a **whole-Agent JSON** (device + look +
  life) to move an Agent between worlds or keep templates.

## 9. Settings

Systems → **Agents** (the feature) · **Players need their Agent** · **An Agent carried by an NPC is its phone** ·
**Agent app names** (a small editor) · GM alerts → **Tell me when an Agent is unlocked**. Everything else is per device.

## 10. Phases

1. **The Agent view** (own + borrowed modes, slab / holo / clamshell, the AI line, slips, command chips, app names),
   **devices** (convert, configure, look, lock styles), **locks**, the **Desktop / Agent** toggle, Admin → Agents.
2. **Make an Agent…** builder + CSV / JSON.
3. **Players need their Agent** (could ride with 1).
4. Later: send as the owner, live ringing on a stolen Agent, report stolen / remote wipe / trace it.
5. Lore-driven, later: **Breacher** remote hacking (range + line of sight, the AI warns the owner on a fail, planted
   commands ≤ 24h reusing call taps / location trace / planted-program timers / heat), **AI nudges** (the GM sends a
   hint the player's own AI speaks), **AltLink** Agent-to-Agent file / eddies hand-off, **quality tiers** with default
   DVs the GM sets, wrist and internal forms.

## 11. Related ideas — `dev/design/FUTUREFEATURESandIDEAS.md`

The Agent is the natural host for §1 (the in-world internet: social networks, forums, marketplaces, news, corp sites,
a GM site builder) and §2 (an application ecosystem across Agents, terminals and decks). Its "ask the AI" command
chips are already a small launcher, and the app-names table already carries the setting's own apps: **Ask Alex**
(search → the browser), **the Garden** (social → social network sites), **BangMe!** (money → marketplaces). A future
app is one more command chip with a panel, read by the same device rules ("what this device can run"). Not in scope
for the first build — noted so the Agent's launcher is built to take more apps later.

## 12. Open questions

- ~~The AI's projection: generated or a picked image?~~ Decided: the parametric 3D head with a build choice (§4). A
  picked image could still be an option later (an "avatar picture" mode).
- Does the Agent view replace the desktop window's header for a player in Agent mode, or open as its own window?
- Chips on someone else's Agent: open them (they are the owner's items) or list only?
