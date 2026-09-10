# Integration Contract — Night City Messenger

This module is part of a three-module constellation, each fully standalone:

- **Cyberpunk Relationships** (in development — the hub: persons, edges, events, knowledge)
  Plan lives at: `Desktop\CyberpunkRED - Phanthasyland\Modules\Cyberpunk-Relationships\MODULE-PLAN.md`
- **Night City Messenger** (this module — comms: contacts, trust, threads)
- **Night City: Style Over All** (perception: style reads, heat, money-class)

## What this module exposes for integrators (added 2026-08)

`scripts/integrations/IntegrationBridge.js` (registered at postReady/95) provides:

- `game.modules.get("night-city-messenger").api` — `apiVersion`, `messenger`
  (macro helpers), `contacts` (per-actor address books), `masterContacts`
  (GM directory), `portraits`, `time` (TimeService — see below), `eventBus`,
  `RELATIONSHIP_TYPES`, `TRUST_LABELS`.
- Foundry hook mirrors of the private bus: `night-city-messenger.contact:updated`,
  `…contacts:masterUpdated`, `…contacts:trustChanged`, `…contacts:burned`,
  `…contacts:verified`, `…contacts:shared`, `…contacts:decrypted`,
  `…contacts:breachFailed`, `…roles:updated`, `…message:sent`,
  `…message:received`, `…shard:decrypted` —
  plus `night-city-messenger.apiReady` (fires once with the api object).

### Mirrored tie-in signals (added 2026-08-14, for the designed moment sources)

- **`…message:sent`** — the "texts write moments" source. Fires on the
  **delivering client** (the GM's, when a player sends — delivery always runs
  GM-side, which is also where relationships writes moments). Payload:
  `{ messageId, toActorId, toContactId, fromActorId, fromContactId, network,
  subject, fromActorName, toActorName }`. Throttling/opt-in is the consumer's job.
- **`…message:received`** — live-refresh signal for Comms panels (unread badge,
  last-3 preview). Fires on clients owning the recipient actor; the same delivery
  can emit from TWO sources (socket notify + journal doc-sync) — **dedupe by
  `messageId`**, exactly as NCM's own toast does.
- **`…contacts:breachFailed`** — the failed-breach → moment tie-in. Payload:
  `{ actorId, contactId, contactName, roll: { success, total, dc, isFumble } }`.
  (`…contacts:decrypted` is the success twin.)
- **`…shard:decrypted`** — the shard-reveals-dossier-knowledge tie-in. Payload:
  `{ itemId, actorId }` (`actorId` is `'gm-override'` on a GM force-decrypt).
- Anything else on the private bus is reachable via `api.eventBus.on(event, cb,
  ownerId)` without a mirror — mirrors are only added for contracted tie-ins.

**Compatibility promise:** integrators target ONLY the api object and the mirrored
hooks. Internals (`game.nightcity.*` service shapes) may change freely, but the api
surface follows semver via `apiVersion`. If you rename an event in `constants.js`,
keep the old name in the bridge's `MIRRORED_EVENTS` mapping.

## What the relationships module will consume

- Master contacts (id = the cross-module join key; `person.messengerId ↔ masterContact.id`)
- Trust (0–5) + status flags (burned/encrypted/verified/blackIce) for display —
  never auto-converted to relationship values (trust ≠ affection)
- Message history summaries ("last contact: 2 days ago") via `messenger.getMessages`
- `pushToPlayer` as a "you've been introduced" signal (creates a relationship edge
  at knowledge level 2)
- **TimeService (user directive 2026-08-10 — EXPORTED 2026-08-14):** when both
  modules are installed, relationships DEFERS to this module's TimeService — one
  clock for Night City. The IntegrationBridge now exposes
  `api.time = { getCurrentTime, getCurrentTimeMs, getProviderInfo }` (null if the
  service failed to boot). Relationships should use it when present instead of
  its own copy of the 6-mode provider, so the two clocks can't drift.

## Render surfaces consuming NCM data (designed 2026-08, mockups 01–07)

- **Scan card**: comms line (viewer's-own-contact-list gated), BURNED/ICE badges.
- **Dossier**: Comms section (email/phone, trust pips, unread, last-3 preview,
  Send / Open thread).
- **People master list** (GM): ⇄ NCM chip on linked tiles; trust pips + "Text ▸"
  in the detail panel; "+ Link NCM" binds person ↔ masterContact.
- **The File** (self-dossier / GM lens): full ◫ Comms panel — handle, trust pips
  (labeled as *their* number), last text, networks, Send / Open thread.
  All panels are source-tagged "NIGHT CITY MESSENGER — DETECTED · OPTIONAL" and
  vanish cleanly when the module is absent.

## Tie-ins now designed (see relationships MODULE-PLAN; "moments" = its events)

- **Texts write moments** (throttled, opt-in): messaging a linked contact logs a
  maintenance moment on the relationship timeline — it's in the canonical
  moment-sources list.
- `contacts:burned` / failed breach → moments on the spine.
- Rumor-mill delivery as anonymous messages; data shards revealing dossier knowledge.
- Reverse: contact detail view rendering the relationships tier chip + "Open
  dossier" / "Open their File".
