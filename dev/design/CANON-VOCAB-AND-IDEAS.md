# Canon Vocabulary & Ideas — from *All About Agents* + CPR CORE

**Status:** advisory / idea-mining, not a build spec. Source: the *All About Agents* DLC and the CPR CORE netrunning chapter. This doc pulls out **vocabulary** and **design inspiration** worth bringing into NCM, mapped to what we already have and what's planned, with an **adopt / consider / skip** call on each. No code here.

> ### ⚠️ IP-safety guardrail (read first)
> The Cyberpunk RED books are copyrighted. Under RTG's homebrew/fan-content terms we may **reference that these things exist in the world** and **use the world vocabulary as flavor**, but we must **not reproduce verbatim descriptions, rules text, or statblocks/tables** — no copied DV tables, exact bonuses, exact durations, or lifted prose. So this doc deliberately keeps things at the level of *names + paraphrased concept*, and everything mechanical is **"invent our own values."** This matches the dev's existing practice (Black ICE / programs are already pulled in as *reworded* originals inspired by the setting, not copies). The reference PDFs are gitignored and stay local — never committed. When in doubt: **reword the description, invent the numbers, keep only the name/idea.**

**The headline:** NCM is already remarkably canon-aligned — the failed-hack-alerts-the-user trace, the Interface-rank hacking, the Data Pool, the network model, and even Thread 7's `NET_ACTION_VERBS` (Backdoor/Control/Virus/Eye-Dee) are all straight out of the books. The biggest single find is that the DLC's **"Implanting Commands" table IS the Thread 6 malware verb set, pre-canonized** — see §3.

---

## 0 · TL;DR — the recommended adoptions

1. **`Breacher`** — the canon name for the device/act of hacking an Agent. NCM's breach/hack flavor should say "Breacher" where it currently says generic "hack." *(§2)*
2. **`SAAI`** ("sigh") — the canon name for the Agent's assistant AI. NCM's "Agent Name" personalization is a SAAI personality template. Cheap, high-flavor rename. *(§2, §6)*
3. **`AltLink`** — the canon short-range protocol for Agent↔device / Agent↔Agent transfer (files, **money**, cameras, drones, cyberware). This is exactly NCM's terminal/device connection + exfil + eddies transfer. Adopt the word. *(§2)*
4. **The setting's "leave one instruction behind" idea** maps cleanly onto the Thread 6 malware verbs — backdoor, surveillance/keylog, lockout, location-track — and validates making left-behind implants **temporary** (our own duration). Fold the *concept* into `THREAD6-MALWARE-MODEL.md`. *(§3)*
5. **A "Reboot" reset** — the obvious counterplay: a device reset that throws off the intruder + wipes what they left behind. This is NCM's SYSTEM SWEEP / defuse with a clean generic name. *(§3)*
6. **Black ICE + program names** (Hellhound, Raven, Sabertooth, Sword, Banhammer, Worm…) as *name references* for the ICE picker and the §5 program-item hooks — our own reworded stats. *(§5)*
7. **App names as content-type flavor** — BabelChat (chatlog), ZPost (email), WatchBox (camera/gallery-feed), BangMe! (eddies), The Garden (social/broadcast), Ask Alex Anything (search). *(§4)*

Everything below is the detail behind these.

---

## 1 · What NCM *is*, in canon terms

NCM simulates **the Agent and its apps** (comms hub, second brain, Data Pool doorway, device manager) **plus the Agent-hacking layer** — *not* full deck-netrunning (NET Architectures, floors, Jack In/Out, Demons). That line matters: it tells us which vocabulary to borrow and which to leave alone.

- **Agent layer (NCM's home turf):** SAAI, apps, CitiNet, Data Pool, AltLink, WorldSat, Breacher hacking, "the SAAI detected the intrusion." **Borrow freely.**
- **Deck-netrunning layer (adjacent, mostly NPC/GM-side):** NET Architecture, floors, Passwords/Files/Control Nodes, Jack In/Out, Rezzed/Derezzed, Demons, the program/ICE combat. **Borrow the NOUNS (Control Node, File, Password, Black ICE, program names), leave the combat system alone.** Thread 7's "NCM never pretends to *be* netrunning" stance is exactly right and canon-respecting.

**Keep the standing distinction:** the dev prefers **"log in,"** not "jack in," for the terminal — correct, because Jack In/Out is *deck* netrunning through interface plugs, while an Agent is used **without** a neural interface (that's literally why Agents exist — no Ihara-Grubb protocols). So: terminal/account access = "log in"; the offensive OPERATOR actions can wear NET-Action verbs (Thread 7 already does this).

---

## 2 · Vocabulary to adopt (canon terms for things NCM already has)

| NCM concept today | Canon term | Call | Notes |
|---|---|---|---|
| hacking a device / breach | **Breacher** (the tool), "to Breach" | **ADOPT** | The setting's Agent-hacking is done with a *Breacher* at short range with line of sight, or more easily with **physical access**. A great "you need to be close" fiction for scene-pin/proximity gating (which NCM already has via `scenePin.range`!). Name/idea only — ranges/DVs are ours. |
| the Agent's assistant / "Agent Name" | **SAAI** ("sigh"), personality templates | **ADOPT** | Voice types, quirks, accents; downloadable from the Data Pool (10–100eb). NCM's per-player agent name/persona is a SAAI template. |
| connect to a terminal/camera/device; transfer files or eddies between Agents | **AltLink** | **ADOPT** | The setting's short-range wireless protocol. Covers: terminal/device connection, camera-feed access (Control Node), exfil "To my Agent," Agent↔Agent eddies + file transfer. One word for the whole transport layer. |
| the searchable content repository | **Data Pool** | **ALREADY HAVE** | NCM has a `DATA_POOL` network constant. Canon: the Data Pool is where you search for content, contact info, personality templates. Library Search is the skill. Validates NCM's model. |
| local network | **CitiNet** | **ALREADY HAVE (confirm as default)** | Canon: CitiNets are the city-run local nets (Ziggurat started them in the '30s). A good canonical default network name. |
| long-distance messaging | **WorldSat** (cellular) | **CONSIDER** | Charges per minute/message. Flavor for "long-distance" mail vs local CitiNet mail — a possible cost/latency distinction if ever wanted. |
| failed hack → target is warned (trace) | "**the SAAI detected the intrusion**" | **ADOPT (flavor)** | Canon: a failed Electronics/Security Tech hack, the SAAI **alerts the user at the halfway mark**. NCM's `fireTrace`-on-fail is canon-exact — just reflavor the trace copy to name the SAAI. |
| Interface rank in hack rolls | **Interface** (Netrunner role ability) + **Crunch Whistle** | **ALREADY HAVE** | Canon: a *Crunch Whistle* (Cyberdeck hardware) lets a Netrunner add Interface Rank to Agent-hack checks. NCM already rolls Interface for hacking. |
| camera / drone / door control | **Control Node** | **CONSIDER** | Canon: Control Nodes run cameras, drones, turrets, doors, elevators, sprinklers. NCM's camera-feed (gallery feed mode), LOOP/CUT, PTZ, TAKE CONTROL are *exactly* Control-Node operations. Could reflavor the camera rail as "Control Node access." |
| a data file / the score | **File** | **CONSIDER** | Canon: Files + Control Nodes are "the treasure of netrunning." NCM's data-shard / typed-file model. The ENVELOPE work (#37, mail-vs-file) already leans this way. |
| account login / encryption gate | **Password** | **ALREADY HAVE (concept)** | Canon obstruction. NCM's account passwords / encryption. |

**Skip / leave alone:** Jack In/Out, Meatspace, Rezzed/Derezzed/REZ, NET Architecture floors, Demon-vs-program combat — these are the deck-netrunning combat layer NCM deliberately doesn't simulate.

---

## 3 · The Agent-hacking model — and why it IS the Thread 6 malware spec

The DLC gives a complete, simple hacking model. NCM already matches most of it; the parts it *doesn't* yet cover are precisely Thread 6.

### 3a · What NCM already gets right (design validation)

- **Hacking a device is a skill check vs a DV, and a failure warns the target.** ✅ (NCM: skill check + `fireTrace`.) The setting's model and NCM's already agree in shape.
- **Physical access is easier than remote.** ✅ conceptually (NCM's proximity/scene-pin gating).
- **Having the credentials already makes the attempt easier.** → NCM could give a small bonus when the player already cracked/keylogged the password. *(consider — pick our own bonus.)*
- **Discovering a hack doesn't reveal who did it.** ✅ — backs NCM's anonymous-trace / masked-sender model.

### 3b · The implant-a-command idea = the Thread 6 malware verb set (conceptually)

The setting has a well-established idea (paraphrased): once you're past a device's security, you leave **one instruction** behind, and the more invasive the instruction, the longer it takes to plant. The invasive tier is the interesting one — its examples line up almost exactly with the Thread 6 EXECUTE verbs we already sketched:

| invasive instruction (paraphrased concept) | NCM Thread-6 verb |
|---|---|
| lock the owner out by changing their credentials | a **lockout** attack (we just built `forceLockout` for heat — same primitive) |
| quietly relay the owner's location for a while | **`track`** — a NEW verb worth adding (a location/keylog cousin) |
| quietly relay the owner's messages/calls for a while | **`keylog` / surveillance** (Thread 6 stub) |
| leave a hidden way back in that eases future access | **`forgeAccount`** (Thread 6 stub) — same "persistent back door" fantasy |

None of this needs the source's exact numbers — it's the **shape** (invasive implants, tiered by effort, temporary) that's useful. Two ideas to fold into the malware-model doc, **with our own values:**

1. **Implants are TEMPORARY by default.** The setting caps left-behind commands at a fixed duration; that's a clean answer to the malware-doc open question **"forgeAccount: time-limited or permanent?"** → **make it time-limited, GM-set duration** (we pick the number; expire via the reaper + time provider we already have). Recommend a sensible default the GM can override.
2. **A "clear it all" reset is the counterplay.** The setting lets a target either *detect* an infiltration or simply *reset the device*, which throws off the intruder and wipes anything they left behind. That's NCM's proposed **SYSTEM SWEEP** (detect) + a **REBOOT** action (wipe all residents/implants on this box). "Reboot" is a clean, generic name — not lifted, just the obvious word — and a good UX primitive. *This informs open questions #3/#4 in the malware doc.*

### 3c · Device Quality → default DV

The setting scales a device's hack difficulty by its **Quality** (a cheap burner is easier than a corp-grade unit). NCM sets hack DVs per-account/network by hand. **Consider** a per-terminal/Agent **Quality** field (our own tiers, our own DV suggestions) that *suggests* a default security DV — a light way to make "burner vs corp workstation" legible without hand-tuning every DV. We'd invent the numbers. *(consider — nice-to-have, not urgent.)*

---

## 4 · App fiction — canon names for NCM's features

The DLC's app roster is free, high-flavor vocabulary. Each maps to something NCM does; naming them makes the world diegetic. **All "consider" — pure flavor, zero mechanics.**

| Canon app | What it does | NCM surface it flavors |
|---|---|---|
| **BabelChat** | *the* instant-messaging app (pre-installed, Ziggurat) | NCM's chat/messaging *is* BabelChat. Chatlog content type = a BabelChat export. |
| **ZPost** | email app (Ziggurat) | NCM's email/message side. |
| **Ask Alex Anything** | Data Pool search/netcrawler (SAAI-powered) | contact/info lookup; the "search the Data Pool for this person" fiction behind master-contact resolution. |
| **The Garden / Garden Patch** | social feed; a "Garden Patch" = your profile/channel | broadcast/spam content; a sender's public presence. Spam blasts = Garden spam. |
| **BangMe!** | tap-to-transfer money between Agents (Eurobank) | the eddies transfer / Claim flow. "Bang me the eddies." |
| **WatchBox** | turns an Agent into a room security cam + alarm | the **camera-feed gallery mode** + terminal-as-security fiction. |
| **HusTool** | gig-work app (hit "PAY ME" → an errand for 10eb) | fixer/job-board flavor; a possible future "gigs" content type. |
| **Big SAAI** | a premium SAAI upgrade that boosts search (and quietly spies on you) | a "premium SAAI" flavor for an upgraded agent; the "your app spies on you" paranoia is very NCM. |
| **Brainwasher** | SAAI therapy app with a suspicious EULA | pure flavor / an NPC-mail hook. |

**Recommended light touch:** reference **BabelChat / ZPost / WatchBox / BangMe!** in composer intro copy or content-type labels where it costs nothing and deepens the fiction. Don't rename core UI — just seed the vocabulary in flavor text.

---

## 5 · NET program & Black ICE names — for Thread 6 + §5

The setting has established rosters of Black ICE and programs that **exist in the world**. We can *reference the names* and build our **own reworded versions with our own stats** — which is exactly what the dev already does. **Do not copy their descriptions or numbers**; the list below is a name-reference for the picker + flavor, nothing more.

**Black ICE names (defensive programs — the "teeth" malware/deployICE reference):**
Hellhound · Sabertooth · Raven · Wisp · Killer · Skunk · Asp · Scorpion · Liche · Kraken · Dragon · Giant (and more across supplements).
→ **Use as suggested names in the ICE actor picker** (the Escalate dialog, malware `iceActorId`, terminal auth ICE). "Arasaka's Hellhound woke up" reads better than a generic "Black ICE." The ICE actors themselves are the dev's own reworded creations — we're just naming which one.

**Attacker programs (offensive kit — for the §5 program-item hooks + Thread 6 flavor):**
Sword · Banhammer · Hellbolt · Nervescrub · Superglue · Vrizzbolt (and others).
→ These are the "equipped program items modify DV" hook in Thread-7 §5. A runner carrying an attack program could shift a DV; the *magnitude is our call*, not lifted. Concrete when that hook is built.

**Booster / Defender programs (utility — payload-side flavor):**
Worm · Eraser · Armor · Flak · Shield · Speedygonzalez (and others).
→ maps to NCM's **payload utility verbs** (icebreaker/skeletonKey/scanner). These are good *names* for utility payloads; any bonus they grant is our own value.

**The NET Actions (the verb vocabulary — Thread 7 already uses these):**
**Backdoor** · **Control** · **Pathfinder** · **Slide** · **Zap** · **Cloak** · **Eye-Dee / Scanner** · **Virus** · **Speedy Gonzalez**. These are generic action *verbs*, not statblocks — safe to use as vocabulary.
→ **Thread 7's `NET_ACTION_VERBS` already uses Backdoor/Control/Virus/Eye-Dee.** Consider adding **Pathfinder** (= SCAN/SWEEP a host), **Slide** (= disengage/abort), **Cloak** (= stealth/mask) as the verb set grows. The **Virus** action — leaving persistent sabotage behind — is conceptually the logicBomb/resident idea.

**Demon** — the setting's name for a system's automated AI defender (the counterpart to a player netrunner). → a good name for **an NPC/automated defender** if NCM ever gives a terminal an active "the system is fighting back" persona (the design doc's heat-driven "corp counterplay"). "The box's Demon noticed you" > "the system alerted."

---

## 6 · GM / feature ideas worth considering

From the DLC's "Agents in Your Game" section:

- **The SAAI nudge.** The setting suggests an Agent's assistant can offer *pattern-based, out-of-game advice in-game* (it notices you keep getting into trouble at a certain bar and suggests booking a medic ahead). **A genuinely new NCM feature idea, in our own words:** the SAAI surfaces diegetic nudges in the Agent — "You've messaged this contact 5× with no reply," "This sender isn't in your contacts — add or block?", "This file is unsigned." Low-effort, high-flavor, makes the Agent feel *alive*. **CONSIDER — good backlog candidate.**
- **"Out of Service Blues" — dead zones & blackouts.** NCM already has dead zones + jammed networks. Canon validates it and names it. ✅
- **"Don't Hurt My SAAI" — no cloud backup, data is on-device.** Canon: an Agent's data lives only on the physical device → it's a target/hostage. Validates NCM's local-data model and is a nice hook for "steal/wipe the Agent" plots (ties to Thread 6 `wipe`).
- **"Beloved Friends" — SAAI personality at the table.** Reinforces the value of NCM's per-player agent personalization.
- **Reboot as a universal reset** (§3b) — already covered, but worth restating: a **REBOOT** action on any Agent/terminal that clears implants is both canon and a clean UX primitive.

---

## 7 · Concrete follow-ups (if the dev wants any)

> **STATUS 2026-07-26 — the dev picked the flavor pass (#2); it is APPLIED, under a rule that
> narrows this whole document.**
>
> ### ⚑ THE PLACEMENT RULE (dev's call — read before adopting anything below)
> **In-world vocabulary goes on PLAYER-FACING IMMERSIVE surfaces only. GM/authoring and
> config UI use plain, normal language.** A GM building an entry should not have to decode
> fiction to use a form. So the app-name table in §4 is *not* a licence to rewrite composer
> intros — the first cut of this pass did exactly that ("a BabelChat scrape", "a parked BangMe!
> transfer", "a live WatchBox camera wall" in the composer's per-type intros, plus SAAI in the
> Theme Customizer hint and canon ICE names in a config hint) and **all of it was reverted**.
> Setting words earn their place where the *player* is inside the fiction: a breach console, an
> action console, a rendered artifact.
>
> **What landed (3 items):** **Breacher** — the shard hack sequence's console banner + status chip
> (the two most-seen strings in a breach; deliberately not sprayed wider, since NCM's existing
> "breach" wording is already canon-adjacent and the module models no Breacher *item*) ·
> **AltLink** — the exfil "To my Agent" console intro · **BabelChat** — the chatlog "Chat app"
> placeholder **and** the enricher's blank-field fallback, which was `NC-MSG`. That last one is the
> instructive case: a placeholder supplying **in-world content** is legitimate (the authored value
> is what the player reads), but placeholder and fallback must match or the field promises a name
> the render contradicts.
>
> **Adopted in principle, not yet placed — no player-facing home exists:** **SAAI** (§2's top
> recommendation; the Theme Customizer's Agent Name is a *config* field, so it was reverted),
> **ZPost**, **BangMe!**, **WatchBox**, and the **Black ICE name suggestions** (§5 — a config-hint
> list is GM UI; if these should surface anywhere it's as seeded actor names, not helper text).
>
> **Two findings from the same pass.** (1) **`languages/en.json` was 104 keys of which 84 were dead
> and 9 were requested-but-absent — and 3 of those were rendering the raw key text as a setting
> label in the GM's Module Settings menu**, because Foundry auto-localizes a setting's `name`/`hint`.
> Fixed separately: all settings now use literal strings, en.json is down to the 6 keys Foundry
> actually resolves, and `node dev/tools/audit-i18n.cjs` guards both directions. Copy is hardcoded in
> JS/HBS — that is where you edit it. (2) The **"no Black ICE actors" empty state exists in FIVE
> different wordings** (composer, shard config, create-network, contact form, network-management)
> plus a sixth in the Escalate dialog's `<option>` — worth unifying if it's ever touched, and a
> reason not to put a suggestion list in just one of them.
>
> **Deliberately NOT done — "the SAAI detected the intrusion" as the shared trace copy.** It
> would misattribute: `showShardTrace` is the ONE toast for every trace source (shard, terminal,
> network, camera), and a SAAI is specifically *an Agent's* assistant — a data shard and a corp
> workstation don't have one. Naming it there would be wrong 3 times out of 4. Doing this properly
> means threading a `context` through the trace payload the way `showShardBlackICE` already reads
> `data.context` (Shard/Network/Message/Terminal) and picking the flavor per source — a plumbing
> change, not a copy edit, so it's left as a follow-up. **Demon** (§5) is the right word for a
> *box's* automated defender if that gets built.

1. **Fold the *concepts* into `THREAD6-MALWARE-MODEL.md`:** left-behind implants map to the verbs; make them **temporary (GM-set duration)** as the answer to "forgeAccount time-limited?"; a **REBOOT** counterplay; add a **`track`** (location/comms surveillance) verb. All with our own numbers. *(pure doc edit — I can do this now if you want.)*
2. **Flavor pass (cheap):** reflavor trace copy → "the SAAI detected the intrusion"; name the breach tool **Breacher**; seed **BabelChat/ZPost/WatchBox/BangMe!** in composer/intro copy; offer **Black ICE names** as picker suggestions. All name/flavor, no lifted text.
3. **SAAI nudge feature** (new backlog item) — the "I have a bad feeling" diegetic hints. Needs its own small design pass; mock-first if it gets any UI.
4. **AltLink** as the umbrella term for the transport layer (connect/exfil/transfer) in UI + docs.
5. **Consider** an Agent/terminal **Quality** field (Poor/Standard/Excellent → default security DV).

None of this is urgent — it's vocabulary and flavor that makes NCM read as *canon Night City* rather than a generic messenger, plus one clean canon answer (the 24h cap) to an open malware-model question. Tell me which threads you want pulled and I'll fold them in.
