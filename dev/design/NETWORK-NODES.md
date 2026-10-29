# Network nodes — networks as access points (design, 2026-10-29)

Status: **all five steps BUILT 2026-10-29** (see CLAUDE.md "NETWORK NODES"); not live-tested. Mocks: network-nodes-mock.html (record), network-nodes-v2-mock.html, network-nodes-jackin-mock.html (the approved jack-in).

## The idea
A **node** is a physical thing on a map — a router, a relay mast, a junction box, an antenna — that carries a
network into a place. Players can find it, connect through it, switch it off, jack into it, and plant malware in it.

## Decisions (dev, 2026-10-29)
- Switching a node off cuts its network **on that node's scene only**. One network may have **several nodes**.
- **Version 1 is scene-level:** if a scene has nodes for a network, the network reaches that scene only while at
  least one of those nodes is on. Scenes with no nodes behave exactly as today (nodes are optional).
  Version 2 (later): a node covers its AREA (its step-on Region) and signal follows the token.
- **Jacking in is a real breach** with its own interface, and its RULES are configurable in
  **Security → Hacking rules → Jacking in**, reusing what terminals already have:
  - *who may jack in* — the Operator-access gate shape (roles · skill + rank · gear as OR-of-AND sets · characters · GM);
  - *how it resolves* — inherit / auto / flagged / GM decides (the existing netrunning modes, with the step-away dock);
  - *the bypass* — default skill + DV, a gear bonus;
  - *failure* — trace, heat, lockout after N tries, Black ICE (bring your own / the node's);
  - *per-node override* of any of it (the countermeasure-override pattern).
  One shared rule, so terminals and shards can later use the same "Jacking in" rules.
- **Inserting a shard** with a malware / payload program on it can **infect the network**.

## Data (sketch)
`network.nodes[]`: `{ id, name, kind: router|relay|mast|junction|jammer, sceneId, pin (Note id), area (Region id),
state: on|off|jammed|damaged, jammedUntil, security (SECURITY_BLOCK — the BOX lock), hidden, alert: 0..3, alertAt,
log: [{ts, who, what, wiped}], residents: [] , override: {jackIn…} }`. Access-point ref kind `network` (id =
`<networkId>|<nodeId>`), pins/areas via the step-3 placer.

## First build (recommended set)
- The **Jacking in** rules card + per-node overrides.
- The **breach** — path *Box lock → Firmware → Network*, the roll through the Roll Reveal, then a **session**
  with actions: **Power off/on · Jam (timed) · Tap · Backdoor (skip the network login 24 h) · Insert a shard ·
  System Sweep**. Present only (a token within range).
- **Node alert level** — each miss raises it (calm → wary → alarmed); alarmed = higher DVs + ICE on a mistake;
  decays like heat.
- **Node logs** — who connected and when; a runner can **wipe their line** (a roll); a sloppy wipe leaves a trace.
- **Knock-on:** players on that network on that scene lose signal (the existing network-lost flow, "CitiNet signal
  lost"); queued mail waits; **a terminal whose uplink runs through the node goes LOCAL ONLY**.

### Infection (inserting a shard)
- Delivery: **Insert a shard** in the node console → the box lock → an upload on the **forge ladder** (clean / sloppy
  with a tell / rejected). The shard's fate is set on the program: **stays plugged in** (evidence — pull it out to
  clean that node), wipes itself, or bricks.
- Effects in the first build:
  - **Worm** — every N game hours it copies to another node of the same network; cleaning one node cleans one node.
  - **Tap** — every message sent over the infected network is copied to the runner (subjects on a sloppy upload,
    full text on a clean one). Messages already carry their network.
  - **Ransom** — the network locks for everyone on it; "pay X eb to this address"; paying moves the eddies (the
    existing eddies path) and unlocks it for the payer.
  - **Blackout bomb** — after a delay / on a trigger every infected node goes off at once.
- Counterplay: **System Sweep** finds it (and a plugged-in shard), cleaning needs a roll; **quarantine** (switch the
  node off) stops the spread but cuts the signal.
- Rules (on the Jacking in card): spread every N hours, most nodes, dormant period, players see symptoms y/n.
- GM: infections in **Security → Machines** beside terminal plants (network, nodes, who, next spread / fire, Clean ·
  Fire now · Remove); infected nodes pulse violet on the dial / scene cards / Nodes step.

## Later
Remote jack-in (while connected, higher DV) · a session trace clock · Demons (an automated defender) · programs as
gear (deck / Sword / Worm items change DVs) · two runners on one node · repair rules · area-level coverage · more
infection effects (spam flood, static, credential harvest, ghost broadcast, hijack terminals).

## Round 2 (dev, 2026-10-29) — mock `dev/mockups/network-nodes-v2-mock.html`
- **Jack in goes harder:** a sequence, not a dialog — plug-in line + static jolt → a data tunnel → each path stop is a WALL
  that cracks and shatters → the roll as hex columns locking → IN (cyan flash, the session unfolds) or MISS (red
  static, shake, the ICE glyph slams, the alert meter jumps). GM decides = the tunnel idles. Skippable; reduced motion
  = the final frame.
- **Console:** more cyberpunk, still clean — cut corners, hex address, a live traffic waveform (flatlines when off), a
  packet ticker, breathing bars, glitch on a state change.
- **Every session action's DV is configurable** (one table in the Jacking in card: action · DV · min rank · time · on),
  per-node override.
- **Skill matters, three switchable dials:** **Unlocks** (min rank per action — more options), **Edge** (−1 DV per
  rank above the minimum, capped — easier), **Moves per session** (from a rank table the GM sets, +1 for beating the
  jack-in DV by 5+ — more done per run). Gear: a deck adds to rolls; a program on a carried shard can unlock an action.
- **Shard programs for the first build:** Worm · Tap · Ransom · Blackout bomb + **Sniffer** (plug in, walk away; it
  records traffic ONTO the shard — come back for it as loot) · **Spoofed credentials** (skip the box lock or the network
  login once) · **Patch** (cleans an infection / repairs a node). Program quality from the build roll (clean = stealthier
  and stronger); blank tiers limit what fits (a Worm needs Standard+); chaining (a logic bomb carrying a worm).
- **Admin at scale:** Nodes step grouped by scene folder (standard fold rule) + search + filter chips with counts
  (infected / alarmed / jammed / damaged / hidden) + sort + bulk (switch off all, reset alert, clean all); a **topology
  view** per network (nodes clustered by scene, animated violet spread lines, amber blinking jams); an infection
  **timeline** per worm (hops, the next hop as a ghost dot); node timers on the Overview now-line; node-state dots on
  the Scenes atlas.
- **Hidden-node discovery:** SET UP, not decided — a node carries `hidden` + `discoverable`, the Jacking in card has a
  "Discovery" slot that says the scan rules are not set yet. The scan mechanic itself is later.
- Later still: node presets, a network-owner response, sounds per action, macros for node actions.

## Notes for the build (dev, 2026-10-29)
- **Console ticker = real events, not canned lines.** Traffic over the network on this scene (hex address, sender → recipient
  addresses, size, direction — NEVER subject or body; content is Tap's job), connections joining / dropping, the node's own
  events (jammed, back on, alert raised, sweep run, log line wiped), infection symptoms only when "players see symptoms" is
  on (a stray retry / garbled packet, never the program's name), quiet filler chatter in the network's naming when nothing
  happens, "no carrier" / noise when off or jammed. Per node: show traffic y/n + optional GM flavour lines mixed in.
- **Jack-in sequence: NOT settled** — the dev isn't sure about the v2 tunnel/walls version; revisit before building it.
- **Jack-in v3 mock:** `dev/mockups/network-nodes-jackin-mock.html` — a three-ring lock (one ring per layer clicks into a slot), the last ring is the roll with a stall + heartbeat vignette, IN splits the lock apart with a shockwave and blooms the network out, MISS grinds red, cracks, slams shut + ICE skull. Supersedes the v2 tunnel if approved.

## Counterplay — stopping an infection (dev-agreed 2026-10-29)
**GM — always, no roll:** Security → Machines lists every infection (Clean · Fire now · Remove); topology + the Nodes step
have per-node Clean / Quarantine and bulk Clean all; switching a node off stops spread through it; Remove kills the
infection on every node and cancels any pending timer.

**Player — has to work for it:**
- *Find it:* System Sweep in a node session rolls vs the infection's stealth (clean build = harder to find); a shard left
  plugged in is visible on opening the box.
- *Clean:* a session action with its own DV in the Jacking in table; cleans ONE node (a spread worm has to be chased).
- *Patch program:* cleans a node without the roll; a clean build also adds a bonus against the worm's next hop.
- *Pull the shard:* unplugging a "stays plugged in" shard cleans that node; the shard is evidence.
- *Quarantine:* switch the node off — stops the spread, cuts the network there.
- *Ransom:* paying unlocks it for the payer; cleaning ends it for everyone.

**Additions:**
- The **planter can recall** their own infection from a session on any infected node, no roll — removes it everywhere.
- **Symptoms** (when "players see symptoms" is on): the console ticker glitches, mail on that network arrives late or
  garbled, signal flickers.
- **Visible countdowns** for blackout bombs and ransom deadlines once someone has found the infection (the existing
  trace-countdown HUD).
- Later: the **network owner fights back** (an automated clean-up after N hours, or a corp netrunner); until then the
  GM does it with Clean.
- Jack-in v3 cyberpunk pass (2026-10-29, dev loved the lock): hex rain, radar sweep, ring text, yellow hazard accents, chromatic split + glitch slices on every click.
- **Tailor the jack-in to the content (dev, 2026-10-29):** ring count = the layers the node really has (no box lock = no L1 ring), ring text = node name / firmware by kind / network name, hex address from the node id, the network colour, the real DV + skill, the HUD from real alert/trace state, and the bloom = that network's REAL nodes (this scene first). Same rule as the console ticker.
