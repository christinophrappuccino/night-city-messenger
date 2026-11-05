# Night City Messenger — API v2

For other modules and for macros. Version **2.1.0** (2.1.0 added the writes: directory add / update / pushToPlayer, groups.push, calls, networks.set).

```js
const ncm = game.modules.get('night-city-messenger')?.api?.v2;
```

`api` exists only while NCM is active, and only after NCM has finished starting. Wait for the hook rather than reading it in `ready`:

```js
Hooks.once('night-city-messenger.apiReady', (api) => {
  const ncm = api?.v2;
  if (!ncm) return;            // an older NCM, or it failed to start
  // …
});
```

## The rules

- **Every method resolves to a result object** and never throws for an expected failure:
  - `{ ok: true, data }` on success
  - `{ ok: false, code, error }` on failure, where `error` is a sentence and `code` is one of the codes below
  - A few readers (`features.*`, `time.*`, `events.*`) return their value directly. They are marked *(direct)*.
- **Nothing shows a toast.** The caller decides what to say.
- **Plain data in and out.** You pass ids and get plain objects back, never a Foundry document or an NCM service. NCM's internals can change without breaking you.
- **The API is as safe as the UI, and no safer.** Every method goes through the same code the NCM windows use: Foundry's document permissions, and the GM's checks on anything a player relays. A player can do through the API exactly what they could do by clicking. JavaScript in the same browser is not a sandbox. Don't treat a client-side check as security.
- **A player's write needs a GM online.** For example, a message a player sends is delivered by the GM's client. With no GM online, the result says so.
- **Versioning.** `version` follows semver:
  - Adding a method or a field is a minor bump.
  - Changing or removing one is a major bump, after the old shape has been kept for one minor version.
  - To check for a capability, use `features.has(…)` rather than comparing versions.

### Error codes

| Code | Meaning |
|---|---|
| `BAD_INPUT` | a required argument is missing or has the wrong form |
| `NOT_GM` | GM only |
| `NOT_OWNER` | the user does not own that character (GMs own everything) |
| `NOT_FOUND` | no such actor, message, contact, group, item or node |
| `FEATURE_OFF` | the part of NCM this needs is switched off in this world |
| `UNAVAILABLE` | the NCM service did not start (see `game.nightcity.startupReport`) |
| `FAILED` | NCM tried and it did not work; `error` says why |

## features

Which optional parts of NCM are on in this world. Switches that reload the world are read once per load. **Trace Consequences** is a live switch, read every time.

| Method | Returns |
|---|---|
| `features.has(name)` *(direct)* | `true` when that feature is on |
| `features.list()` *(direct)* | `[{ name, label, on, live, requires }]` |

The feature names are `conversations`, `calls`, `payphones`, `emergency`, `overheard`, `networks` and `traceConsequences`. `networks` off means simple network mode.

## events

You can listen to these events. You cannot emit them.

| Method | Returns |
|---|---|
| `events.on(name, callback)` *(direct)* | a function that stops listening, or `null` if `name` isn't a public event |
| `events.names` | the list of event names |

`events.on` is the same as `Hooks.on('night-city-messenger.<name>', callback)`. `message:received` fires once per message per client. The events and their payload fields are listed in **INTEGRATION.md**. At run time the same list is `api.publicEvents`.

```js
const stop = ncm.events.on('message:sent', ({ messageId, toActorId, subject }) => {
  console.log('NCM delivered', subject, 'to', game.actors.get(toActorId)?.name);
});
// later: stop();
```

## time

NCM's clock, so your module and NCM never disagree about the date. The clock follows the GM's Time Source: real time, world time, Simple Calendar, or manual.

| Method | Returns |
|---|---|
| `time.now()` *(direct)* | ISO-8601 game time (UTC) |
| `time.nowMs()` *(direct)* | the same, in milliseconds |
| `time.provider()` *(direct)* | which clock is in use |

## messages

| Method | Who | `data` |
|---|---|---|
| `messages.send({ toActorId \| toContactId, fromActorId \| fromContactId, subject, body, priority? })` | the owner of `fromActorId`; only the GM may send `fromContactId` (as a directory NPC) | `{ messageId }` |
| `messages.listFor(actorId, { limit = 50, unreadOnly = false })` | owner / GM | summaries, newest first (see below) |
| `messages.markRead(actorId, messageId)` | owner / GM | `{ messageId }` |

A message summary has no body. It looks like this:

```
{ id, threadId, subject, from, to, fromActorId, fromContactId, toActorId, toContactId,
  timestamp, priority, network, read, sent, spam, preview }
```

`preview` is the first 140 characters of the body as plain text. Mail sent anonymously shows the mask, exactly as the recipient sees it.

```js
// a button in another module: an NPC writes to the player's character
const res = await ncm.messages.send({
  fromContactId: 'the-fixer-contact-id',      // GM only
  toActorId: game.user.character.id,
  subject: 'New job',
  body: '<p>Meet me at the Afterlife.</p>',
});
if (!res.ok) ui.notifications.warn(`NCM: ${res.error}`);
```

## contacts

| Method | Who | `data` |
|---|---|---|
| `contacts.listFor(actorId)` | owner / GM | `[{ id, name, email, actorId, trust, role, portrait }]`, the character's own contact list |
| `contacts.resolveName({ contactId?, actorId?, email? })` | anyone | the name NCM shows for that person. The GM directory name beats an actor's own name. |
| `contacts.resolvePortrait(contactId)` | anyone | the picture URL NCM shows for a directory contact, or `null` |

## directory (GM)

The GM's master contact directory. It is GM-only because it holds GM notes. The summaries below leave those notes out.

| Method | Who | `data` |
|---|---|---|
| `directory.list()` | GM | `[{ id, name, email, actorId, trust, role, portrait }]` |
| `directory.get(contactId)` | GM | one summary |
| `directory.add({ name, email?, role?, notes?, actorId?, portrait? … })` | GM | `{ contactId }` — the same fields the GM's contact form takes |
| `directory.update(contactId, changes)` | GM | `{ contactId }` |
| `directory.pushToPlayer(contactId, actorId)` | GM | `{ contactId, actorId }` — puts the contact in that character's own list (as the GM's Push does) |

## groups

| Method | Who | `data` |
|---|---|---|
| `groups.list({ actorId? })` | owner of `actorId` / GM | `[{ id, name, scope, ownerActorId, members }]`, where `members` is a count. The GM's own groups (`scope: 'master'`) are listed only for the GM. |
| `groups.recipientsFor(groupId, { actorId? })` | the group's owner / GM | `{ recipients: [{ actorId, contactId, email, name }], unresolved: [names] }` |
| `groups.push(groupId, actorId)` | GM | `{ shared, failed: [names] }` — gives one of the GM's groups to a character, sharing members they don't know yet |

## calls

`FEATURE_OFF` when Calls is switched off in the world.

| Method | Who | `data` |
|---|---|---|
| `calls.place(number, { actorId?, contactId? })` | a player as their own character (or one they own); the GM as any character or directory contact | `{ callId, emergency }` — rings as the call screen would; a refusal ("Not in service", already calling…) is `FAILED` with its words |
| `calls.logFor(ownerId)` | owner / GM (a directory contact's log: GM) | `[{ callId, direction, outcome, otherName, otherNumber, seconds, startedAt, gameTime, seen, written }]`, newest first — never who listened in |

## networks

| Method | `data` |
|---|---|
| `networks.status()` | `{ network: { id, name, type }, signal, deadZone, simple }` for this client |
| `networks.available()` | `[{ id, name, type }]`, the networks on offer on this client's scene |
| `networks.set(networkId)` | GM only: puts THIS client on a network, as the GM's macro does (players switch through their own selector). `FEATURE_OFF` for anything but CitiNet in simple network mode. |

In simple network mode (`features.has('networks') === false`), `status()` always says CitiNet, at full signal, with no dead zone.

## open

Opens NCM windows on this client. The same permissions apply as in the UI.

| Method | Who | Notes |
|---|---|---|
| `open.inbox(actorId, { messageId? })` | owner / GM | opens that character's Agent, at a message if given |
| `open.composer({ toActorId?, fromActorId?, subject?, body? })` | anyone | a new message, pre-filled |
| `open.shard(itemIdOrUuid)` | anyone who can reach it | `NOT_FOUND` if the item isn't a data shard |
| `open.terminal(itemIdOrUuid)` | anyone who can reach it | `NOT_FOUND` if the item isn't a terminal |
| `open.node(nodeId)` | anyone | `FEATURE_OFF` in simple network mode |

## Safe when NCM is absent

```js
const ncm = game.modules.get('night-city-messenger')?.active ? game.modules.get('night-city-messenger').api?.v2 : null;
if (ncm?.features.has('calls')) { /* … */ }
```

## v1

`api.apiVersion` (now `1.2.0`) and the v1 fields (`messenger`, `contacts`, `masterContacts`, `groups`, `portraits`, `eventBus`, `time`, `publicEvents`) are still there for existing integrations. They hand out NCM's internal services, whose methods can change. New code should use `api.v2`. The macro helpers on `game.nightcity.messenger` are a GM convenience layer and are not versioned.
