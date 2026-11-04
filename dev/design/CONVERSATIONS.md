# Conversations

Status: **design agreed 2026-10-30, revised 2026-11-02, not built.** Target 2.1. Mockup: `dev/mockups/conversations-mock.html`
(`node dev/tools/serve-mockups.cjs`, then `http://127.0.0.1:8123/dev/mockups/conversations-mock.html`).

## Revision, 2026-11-02 (these win over anything below)

- **It stays apart from the rest of the module.** Keep: names, portraits and aliases; its own badge; an off switch (world setting); Purge and Factory Reset; Send as mail, which only opens the composer and leaves no line behind. Cut from the first version: the Call button and clickable numbers, Desk, Voice notes, Overview, trace, sniffers, terminal mirrors, Contact Manager's Last Interaction and Recent sort.
- **Shard and terminal chat logs are left alone.** They are files, and stay that way. No shared code or look is required for this release.
- **Privacy is the same standard as mail.** Foundry's server appears to check permissions on writes only, so page ownership hides lines in the UI, and a player could read them from the browser console. Accepted by the dev. Removing someone still means they see nothing new and get no notification.
- **Notifications:** the badge counts conversations, never lines. One toast per conversation, updated in place ("Dockside crew: 6 new"), leaving by itself. One sound on the first new line, then silence until it is read. Nothing while it is open. Muted = no toast, no sound, no badge, one click from the head. The GM gets ONE combined toast ("NPC conversations: 3 waiting") under its own setting, and only for conversations with an NPC, unless they switch one on. Its own event, never mail's toast or sound. Needs a two-client burst test.
- **You are one identity per conversation, fixed when you join** (agreed by the dev; the admin view is approved too). Switching mid-chat would show that two names are one person. The player picks **Join as** when starting one; if added, they are in as the identity they were added by. Each identity is its own member, so an NPC's alias is a separate member, and the GM's Speaking as switches between the NPC members.
- **No owner link on an alias.** An alias member or line carries the alias's contact id and no `actorId`; the GM side works out the owner. Same rule as phone aliases.
- **Why you would use each (agreed):** a message is something you send, a conversation is something you are in. Mail has a subject, carries things (eddies, shards, files, encryption, self-destruct, scheduling, anonymity), and gives each person a copy. A conversation is short lines and pictures in one shared chat, with no subject. Mail keeps every feature it has.
- **Stripped from conversations (agreed):** plain text only; about 500 characters a line, pointing longer text at Send as mail; no Show earlier messages when adding; no Hide; only the starter or a GM renames. Kept: pictures, add / remove / leave, Send as mail, search inside the open conversation.
- **Sharing in the chat (agreed, mocked):** the + in the bar offers Picture, My number and A contact. A contact shows as a Data Drop card in the line: address, number or both, only what the sharer has. It plays a small animation once, when it arrives while the chat is open, never the full-screen overlay. Nothing is added by itself: each person clicks Save contact, which follows the Data Drop merge rule (adds what they lack, overwrites nothing). A card carries no owner link. A contact locked with ICE can't be shared and never appears in the picker (dev). The animation is approved. The inbox list mixes conversations and mail by latest activity (dev confirmed).
- **Taps (agreed, mocked):** a tap on an up node logs lines sent from that node's scene over its network, simply. One running log per conversation per tapper, in their Exfil folder, updated in place with a cap, and no toast or sound. A picture reads [picture], a card reads [shared a contact: name]. Speakers show as the identity they are in the chat as. Sniffers ignore conversations. The GM sees a Tapped tag on the conversation in Admin.
- **Speaking as (agreed):** defaults to the last NPC who spoke in that conversation, and the box names them ("Write as Mox…"). One NPC per line.
- **The NPC tag is GM-only:** it shows in Admin and in a GM's own view, never to a player, who must not be able to tell an NPC from a player by the line.
- **Fallback for one-line writes:** a key by dot path, then pages of about 25 lines, then one page per line.

## Gap tracker

Every known risk, how it is fixed, and what proves it. A row closes only when the check named here passes. A new gap goes here as soon as it is found.

| Risk | Fix | Proven by | Status |
|---|---|---|---|
| A sent line redraws everyone's Journal sidebar | Summary update passes `render: false`. The probe counted 0 redraws either way, so it proved nothing (a normal save should redraw, per Foundry's source). Measure in the stress test with the tab open | Stress test | Open |
| Read position writes the actor per line and can redraw sheets | Hold in memory; write after a pause and on leaving | Sim + two-client | Open |
| A new line wipes what you are typing and the scroll | Patch the chat in place; no `MESSAGE_*` or `INBOX_REFRESH` per line; a draft per conversation | Sim + two-client | Open |
| Removed then added back cannot be stored | A list of membership spans | Sim | Open |
| A forged relay: another member's name, or after removal | GM checks owner, membership and rights on every write; a late queued line is refused and says so | Sim | Open |
| Two GMs for a moment, or a retry, fork the order | Sort by `seq` then `lineId`; `lineId` makes a retry a no-op | Sim + stress test | Open |
| Queued lines lost on reload | localStorage per character, like mail now | Sim | Open |
| Base64 pictures bloat pages | A card keeps a path; line pictures are paths or http(s), never `data:` | Sim | Open |
| A short number means something else to someone elsewhere | Cards store the full form; Save goes through `normaliseNumber` | Sim | Open |
| A saved address fails with Contact Not Found when mailed | Check the send gate with a player-added address; fix or explain | Two-client | Open |
| Send as mail shows the real address behind an alias | The composer starts as the identity you are in the chat as | Sim | Open |
| An alias member or line reveals its owner | Contact id only, no `actorId`; the GM side works out the owner | Sim | Open |
| A tap log marks itself unread or toasts | Written read; an update never notifies; a tapper who is a member logs nothing for that chat | Sim | Open |
| Notifications flood | One toast per conversation, one sound until read, badge counts conversations, one GM toast | Two-client burst | Open |
| Two of your characters in one chat | One toast; the viewer filters by the open character; your own line never notifies you | Two-client | Open |
| A row moves while you read it | Selection follows the id; a selected row on another page stays open | Sim | Open |
| Oldest sort, date range, From filter, Mark all read | Use `lastAt`; From does not apply; Mark all read includes conversations | Sim | Open |
| A burned or deleted member | Keeps `fromName`, can't receive, listed by Orphan Audit; a chat with nobody left is offered for deletion | Sim | Open |
| Page ownership or the one-key write do not behave as assumed | **Ownership answered by the probe, 2026-11-02, player fresh load:** a page or journal the player has no access to is still ON their client with its text readable, and only hidden in the UI. So a removed member, or anyone with a console, can read everything. Accepted by the dev as the same level as mail. A conversation never holds a real secret; that is what mail is for. Burst: 20 of 20 lines survived twenty writes at once, and each client held all 175. That also shows each write carried only its own line: a whole-page write would have overwritten the others. Removing a line by key works. Measured 33,896 characters for 175 lines, about 194 a line, so 1,000 lines is about 190 KB. The player's wire-size report never arrived, so the stress test still measures it | Two-client probe, 2026-11-02 | **Answered**, plan stands |
| Switching it off mid-game | Rows and buttons hide, data stays, relayed writes refuse with a reason | Sim | Open |
| ICE-locked contact shared in a chat | Never appears in the picker; the GM refuses one in a relay | Sim | Open |
| A removed line stays readable in the data | The GM write replaces the line with a marker, so the text is gone, not hidden | Sim | Open |
| Mail: queued mail lost on reload, with its eddies | Saved per user in the browser; a refused flush is named | `test-mail-queue-persist.mjs` | **Fixed**, not live-tested |
| Mail: a held message refused at flush keeps the eddies taken for it | The player is told to ask the GM. No automatic refund yet |  | Open, mail |

**Decided by the dev, 2026-11-02:** no chat with no GM online (lines queue, as mail does). Enter sends, Shift+Enter makes a new line. The GM can remove a line for everyone, leaving "Line removed by the GM" in its place.

**Admin → Messages → Conversations, observing:** every conversation in the world, with search, Show, Who and Sort. Reading is invisible: no member is added, nobody is told, and no read state changes. A **Watching** tag says so. New lines appear live. Members shows who plays each one, how far each has read, and the truth behind an alias, none of which players see. In a conversation with an NPC the GM writes through **Speaking as**; in a players-only one there is no reply box, only **Join as an NPC…**, which adds a visible "joined" line. A bell per conversation decides whether it counts in the GM's toast (on for NPC conversations, off for players-only).

## Why

Tester Danguro asked for threads as a default view, because running a group chat means switching between the thread and
the reply. We first designed a Conversation | Message switch over mail (records: `conversation-view-mock.html`,
`conversation-view-v2-mock.html`). It worked as a view but could not scale. Mail stores one page per message per person,
so six people and 1,000 messages is about 6,000 pages, and the left list gets one row per message.

Tables will run chats that long. So a conversation is **its own thing** that sits beside mail in the inbox. Mail does not
change.

## What was decided

| Decision | Choice |
|---|---|
| Relationship to mail | Separate type. Mail, threads, Reply All and the `Thread · N` pill stay as they are, with no migration. |
| Storage | One shared journal per conversation, with messages as lines on its pages. |
| In the inbox | One row per conversation, however long it gets, plus a Conversations pill. |
| Content | Text and images only. Encryption, self-destruct, trace, eddies and shards stay in mail, reached through **Send as mail**. |
| Removing someone | Real. They keep what they could already see and get nothing new. They cannot drift back in by replying. |
| Adding someone | No history by default, with a **Show earlier messages** option when adding. |
| GM voice | The GM can speak as any NPC or alias through the same Send as list. Anonymous members are out of the first version. |
| Taps and terminal mirrors | Ignore conversations for now. |
| Delivery | Every write goes through a GM client, so conversations queue when no GM is online. |

Not in the first version: converting a mail thread into a conversation ("Continue as conversation" can come later),
typing indicators, online status, read receipts per person, editing or unsending lines.

## Data model

One journal per conversation, in a **Conversations** folder under "Night City Messenger". It is found by flag,
`flags.night-city-messenger.type = 'conversation'`, the same way inboxes are, never by name.

```js
// Journal flags: the record of the conversation
{
  type: 'conversation',
  conversationId,
  title,                 // optional; blank shows the member names
  createdBy: memberKey,
  createdAt,             // game time
  lastSeq,               // the highest line number written
  lastAt,                // game time of the newest line, for sorting the inbox
  lastPreview,           // { from, text }, so a row needs no page read
  members: [{
    key,                 // address first, like participants.js, so it survives export into another world
    actorId, contactId,  // hints, resolved through resolveMember
    role: 'starter' | 'member',
    joinedSeq,           // the first line this member may see
    leftSeq,             // set on removal; null while a member
  }],
}

// Page flags: one page holds a run of lines
{
  firstSeq, lastSeq,
  lines: {               // keyed object, NOT an array (see Writes)
    [lineId]: {
      seq,               // assigned by the writing GM client; this is the order
      at,                // game time, display only
      fromKey, fromActorId, fromContactId,  // names resolve at read time, directory first
      fromName,          // snapshot, used only when the live lookup fails (deleted actor or contact)
      kind: 'text' | 'image' | 'system',
      text,              // cleaned with richText 'inline'
      img,               // kind 'image'
      network,
      system,            // kind 'system': { event: 'added' | 'removed' | 'left' | 'renamed', who, by }
    },
  },
}
```

- **Ordering uses `seq`, never the timestamp.** With a paused or manual clock, many lines share a game time.
- **Pages hold 100 to 200 lines.** A full page is never rewritten. The next line starts a new page.
- **Read state lives on the reader.** `flags.<id>.conversationState` on the member's actor is
  `{ [conversationId]: { readSeq, muted, hidden } }`. A player owns their character, so this needs no relay and no GM.
  NPC members and contact-only identities keep theirs in a GM-only world setting.

## Privacy: page ownership does the work

> **Superseded when built (2026-11-02).** The two-client probe showed a page with no access still reaches every client, so page ownership
> hides nothing. Pages have no ownership maps. The journal is GM-only so it stays out of every sidebar, membership spans decide what a
> screen draws, and privacy is the same as mail: hidden in the UI, readable from a browser console. Read state lives on a user flag.


A member list alone would not hide anything, because lines already on a client can be read from there. So access follows
Foundry page ownership, set from the users who own each member's character:

- A page grants OBSERVER only to the users of the members who may see it.
- **Any membership change closes the current page and starts a new one** with the new ownership.
- Removed: they keep access to older pages and get none on new ones. This is the real enforcement.
- Added without history: they get new pages only. Added with history: ownership is added to the older pages.
- If a character changes owner, the GM client reapplies ownership for that member's conversations.
- `joinedSeq` / `leftSeq` still trim the view when a page was shared by a member's time in and out.

**Check during the build:** that Foundry really withholds a page below OBSERVER from a player, and that page ownership
behaves the way this section assumes. The whole privacy model rests on this.

## Writes

Players cannot write to these journals, so every write relays. `SOCKET_OPS.CONVERSATION_REQUEST` with ops `create`, `send`,
`member`, `rename`, `leave`. One GM lands it (`game.users.activeGM`), the mail-relay and node-write pattern.

- **One writer at a time.** Writes run through a queue on the GM client, like the `NODE_WRITERS` wrapper, so two senders
  cannot overwrite each other and `seq` stays strictly increasing.
- **A send adds one key.** `flags.<id>.lines.<lineId>` is updated by dot path so only the new line goes to every client,
  not a whole page. This is why `lines` is an object. An array would resend up to 200 lines per message. Standing gotcha:
  nested flag updates have been unreliable for resets, so the stress test must prove this path.
- **Sends cannot double post.** The client mints `lineId` before sending. If it retries after a timeout, the GM sees the
  id already there and just acknowledges. This also removes the false failure risk of the 8-second mail ACK.
- **The reply bar shows real state:** Sending, then sent, queued or failed, in place on the line.
- **Queueing:** with no GM online or in a dead zone, lines wait on the sender's client, shown as Queued, and flush when
  possible. Same rules as the mail queue. The reason is stated in the bar.

## The inbox

- **Row:** stacked member faces, title or names, last line, a time from `lastAt`, and an unread count for that
  conversation. It reads only journal flags, so a long conversation costs the list nothing.
- **Pill:** Conversations, with a count of conversations that have unread lines. It sits with the existing category pills.
- **All / Unread:** conversation rows merge with mail by last activity. A conversation counts as one row for paging.
- **Sent, Saved, Trash, Spam, Drafts, Scheduled:** no conversation rows.
- **Search:** title and members from flags; lines only when searching inside an open conversation at first.
- **Dates:** matches on `lastAt`.
- **Unread badge:** the scene-control count adds one per conversation with unread lines.
- **Starting one:** a Conversation button beside Compose in the header, and Start conversation on a contact group.

## The chat pane

Replaces the center pane only. The header, tabs, pills and list stay the same.

- **Head:** title, member faces, Members, and a menu with Rename, Mute, Hide and Leave.
- **Lines:** others on the left with a face, your own on the right and tinted, same-sender runs grouped, day lines, a "new"
  line, and system lines such as "Rache added Mox".
- **Loading:** the newest page or two; Show earlier loads back. It opens at the "new" line, else the newest line.
- **Bar:** grows as you type, with Add image, **Send as mail** and Send. Enter sends. A GM also gets a Speaking as
  picker with the Send as list.
- **Send as mail** opens the composer with the members as recipients and the typed text as the body. A single line in the
  conversation can then say "Rache sent mail to the group" without carrying the mail's content.
- **Members panel:** who is in, who started it, Add, Remove, Rename, Leave. Removing asks first and says what it does.
- **Removed member's view:** read-only, with a line saying who removed them and when.
- **Hidden** (per person) takes it out of the list until a new line arrives. **Leave** is a real membership change.

## Notifications

- A new `EVENTS.CONVERSATION_LINE`, not `MESSAGE_RECEIVED`. Reusing it would pull in mail's toast rules.
- Fired from the page update hook on each member's client, gated on the member's character being owned.
- **Silent when that conversation is open.** Otherwise at most one toast and sound per conversation per 30 seconds. Muted
  means none.
- A GM gets a toast when a line reaches a conversation with an NPC member, under the same `notifyGmNpcMail` setting.

## GM tools

- **Admin → Messages → Conversations** sub-tab: every conversation, members, last activity, read it, speak as any NPC
  member, add or remove people, delete. Conversations with NPC members and unread lines sort first.
- **Overview:** those waiting lines join the Needs you queue under their own chip (second pass).
- **Tools → Purge Messages:** conversations become a target.
- **Tools → Orphan Audit:** conversations with no remaining members, and members who resolve to nothing.
- **Factory Reset:** covered by the folder and flag sweep, to be confirmed by its sim.
- **Export / Import:** not in the first version.

## Scale

| Six people, 1,000 messages | Mail | Conversation |
|---|---|---|
| Pages | about 6,000 | 5 to 10 |
| Stored | about 8 MB and up, more as reference lists grow | about 300 KB |
| Rows in the left list | one per message | one |
| Writes per message | 6 page creates | 1 key added |

Measured 2026-10-30: a mail page is about 1.4 KB; thread grouping takes 100 ms at 10,000 messages. Line size and the
Conversation column are estimates until the stress test runs.

**Stress test before release:** a macro builds a six-person, 1,000-line conversation plus a burst of concurrent senders.
Check, on a real world with a real second client: world load, time to open, send lag, what one send puts on the wire,
ordering under the burst, and a removed member's client really not receiving new pages.

## Effect on other systems

Audited against the code 2026-10-30. **Every recommendation in this section was agreed by the dev on 2026-10-30.**

**Safe by construction.** Mail scanners go through `MessageRepository.identifyInbox`, which needs `type: 'inbox'` or
`'contactInbox'`, so a `type: 'conversation'` journal is ignored. By-id lookups look for a `messageId` page flag, and lines
have none. That covers All mail, Inboxes, the Desk, the Outbox, Overview's mail, Contacts' mail index, Terminals, Shards,
self-destruct, spam, scheduling, relay ACKs, the Call log and voicemail. Add a sim asserting this holds.

**Covered without new work:** Namespace migration (journals and pages are in `MIGRATION_SCOPES`) and Factory Reset (module
flags or the folder tree). Reorganize Journals only acts on inbox and legacy names. To confirm by sim.

**Needs a small connection in the build:**

| System | What to do |
|---|---|
| Viewer selection | `selectedMessageId` has 34 uses. Add a separate `selectedConversationId`; opening one clears the other. Filters, paging, narrow `data-pane`, the character switch and Mark all read all need it. **The largest part of the build.** |
| Scene-control badge, Messages tab badge | Add conversations with unread lines. |
| Contact Manager: Last Interaction, Recent sort | Read `lastAt` for shared conversations too. |
| Deleted actor or contact | Lines stay readable, so each line also stores a `fromName` snapshot used only when the live lookup fails. |
| Address changes, aliases | Members resolve through `resolveMember` (hint first). Names and portraits use `resolveDisplayName` / `resolveDisplayPortrait`, so an alias keeps its own face. |
| Adding people | Refuse send-only addresses. Player pickers use that character's contacts; the GM picker uses the directory. Honour Hidden Characters. |
| Ownership | Reuse `_computeOwnership`. A character on default ownership opens its pages to every player, so warn when adding one. |
| Two characters, one player | Page ownership is per user, so the viewer also filters by the open character. |
| Journal sidebar | Foundry may list pages a player can see. Check it during the build; inboxes already behave this way. |
| IntegrationBridge | Add conversation events to `MIRRORED_EVENTS` and INTEGRATION.md. Existing mail events are untouched. |
| Export Logs, Health Check | Leave out of the first version and say so in the guide. |
| Phone | Add a Call button per member once phone calls ship. Build Conversations after the phone work is committed, since both change the viewer. |

**Connect in a second pass, not required for the first version:** Overview Needs you, Contacts instruments (Orbit,
Switchboard, Mail waiting), Macro API, `@NCM` links and access points, Share line to chat.

**Gameplay decisions (agreed):**

1. **Taps and sniffers:** the first version ignores conversations. A conversation is a channel a netrunner cannot
   intercept, and a hacked terminal or copied inbox will not show it. **Planned soon after:** a tap on a node catches lines
   sent over that network from that scene.
2. **Traced and anonymous network effects:** a traced network does not trace lines in the first version, and the guide
   says so.
3. **Signal garbling:** none. A dead zone or a cut network queues lines through the existing rules.
4. **Being added without asking:** allowed. Conversations have no spam filter, so a line says who added them, with Leave
   and Mute one click away.
5. **Addresses:** visible to every member, as with Reply All. An NPC can stay behind an alias.
6. **Trust and contact locks:** a member's details follow what that viewer could already see, so a locked contact does not
   unlock by sharing a conversation.

## Separate cleanup for mail

Each mail reply stores the full list of earlier message ids, so the list grows with every reply: about 17 KB per page by
message 1,000. Long Reply All threads will keep existing. Cap `references` to the first id plus about the last 20; the
thread id already holds the conversation together. Small and independent of this feature.

## Build checklist

1. Pure rules module `scripts/utils/conversations.js`: sanitize, membership, visibility windows, page rollover, ownership
   maps. Sim first (`dev/tools/sims/test-conversations.mjs`).
2. `scripts/services/ConversationService.js` on `game.nightcity`: create, send, members, queue, ack. Registered through a
   `register*` file, never `main.js`.
3. Socket ops, `EVENTS`, settings; prove the single-key write and page ownership in a two-client test before any UI.
4. Inbox rows, pill, counts, list merge in `MessageViewerApp`. New templates go in `TEMPLATES`, new CSS in the stylesheet
   entry. Prefix `ncm-conv__` (`ncm-convert-*` is a different component).
5. Chat pane, reply bar, members panel, New conversation dialog.
6. Notifications through `NotificationService`, deduped by line id.
7. Admin → Messages → Conversations, Purge, Orphan Audit, Factory Reset.
8. Phase 6 verification, the guide, CHANGELOG. Add `journal`-scoped flags to nothing new: `MIGRATION_SCOPES` already covers
   journals and pages.

Every new button, dialog and list follows the standing rules: shared name picker for world lists, admin vs player dialog
wrappers, `--ncm-*` tokens, text-scaled control heights, 4.5:1 contrast measured in all presets.

## Decided in the mockup, open to change

- **Who can change membership:** any member can add. Only the starter or a GM can remove. Anyone can leave.
- **Who can rename:** any member.
- **Deleting a conversation:** GM only. A player can Leave or Hide.
- **If the starter leaves:** the longest-standing member becomes the starter.
- **Line length:** capped at 2,000 characters, with the bar pointing long text at Send as mail.
- **Network on a line:** the sender's network is stamped and shown on hover. A dead zone queues. Network-locked
  conversations are out of the first version.
