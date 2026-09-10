/**
 * Macro pack source-of-truth + generator.
 * @file tools/gen-macros.cjs
 *
 * NOT part of the Foundry runtime. Foundry never runs this. It is run
 * manually ONLY when the shipped macros change:
 *
 *     node tools/gen-macros.cjs
 *
 * It writes the two NeDB compendium packs declared in module.json:
 *   packs/ncm-macros-player.db   (default ownership OBSERVER — players can run)
 *   packs/ncm-macros-gm.db       (default ownership NONE — GM only)
 *
 * Each pack line is one Macro document (newline-delimited JSON, NeDB format).
 * Every shipped macro carries flags.night-city-messenger.managed=true so the
 * Admin Panel "Import / Reinstall NCM Macros" action can overwrite exactly
 * these and never clobber a GM's own macros.
 *
 * ICONS: each macro's `img` is a fixed path under
 *   assets/icons/macros/<icon>.svg
 * The generator seeds a neon placeholder SVG there ONLY when the file is
 * missing — it never overwrites existing art, so dropping in custom icons
 * (same filename) survives every regeneration. Replacing a file in place
 * needs no regen and no reinstall: Foundry just loads whatever is at the path.
 *
 * Macro bodies use ONLY double-quoted strings + concatenation (no backticks/
 * template literals) so they round-trip through JSON cleanly.
 */

'use strict';
const fs = require('fs');
const path = require('path');

const PACKS_DIR = path.join(__dirname, '..', 'packs');
const ICON_FS_DIR = path.join(__dirname, '..', 'assets', 'icons', 'macros');
const ICON_WEB_BASE = 'modules/night-city-messenger/assets/icons/macros/';

// Stable 16-char [a-zA-Z0-9] document id from a slug.
function idFor(slug) {
  const clean = ('ncm' + slug).replace(/[^a-zA-Z0-9]/g, '');
  return (clean + '0000000000000000').slice(0, 16);
}

// ── Shared body fragments (kept identical across macros) ──────────────
const GUARD =
  'const M = game.nightcity && game.nightcity.messenger;\n' +
  'if (!M) return ui.notifications.error("Night City Messenger isn\'t ready yet.");\n';

const MY_ACTOR =
  'const _mine = game.user.character || game.actors.find(a => a.isOwner && a.type === "character");\n';

// Resolve the acting actor: exactly one controlled token, else the user's character.
const ACTOR_FROM_TOKEN =
  'const _tok = (canvas.tokens && canvas.tokens.controlled) || [];\n' +
  MY_ACTOR +
  'const _who = _tok.length === 1 ? _tok[0].actor : _mine;\n' +
  'if (!_who) return ui.notifications.warn("Select exactly one token, or assign your character.");\n';

// Pick one document from a list via a Dialog <select>. Returns the doc or null.
function PICK(listVar, title) {
  return (
    'const _pick = async (list, title) => new Promise(res => {\n' +
    '  if (!list.length) return res(null);\n' +
    '  const opts = list.map((d, i) => "<option value=\\"" + i + "\\">" + foundry.utils.escapeHTML(d.name) + "</option>").join("");\n' +
    '  new Dialog({ title: title,\n' +
    '    content: "<p style=\\"margin:4px 0\\">Choose:</p><select id=\\"ncm-pick\\" style=\\"width:100%\\">" + opts + "</select>",\n' +
    '    buttons: {\n' +
    '      ok: { label: "OK", callback: h => { const r = (h[0] || h); res(list[Number(r.querySelector("#ncm-pick").value)]); } },\n' +
    '      cancel: { label: "Cancel", callback: () => res(null) }\n' +
    '    }, default: "ok", close: () => res(null) }).render(true);\n' +
    '});\n' +
    'const _chosen = await _pick(' + listVar + ', ' + JSON.stringify(title) + ');\n' +
    'if (!_chosen) return;\n'
  );
}

const REPORT =
  'if (_r && _r.success === false) ui.notifications.warn(_r.error || "Action failed.");\n' +
  'else ui.notifications.info("Done.");\n';

// ── PLAYER MACROS (ownership default 2 = OBSERVER) ───────────────────
const PLAYER = [
  {
    slug: 'PlrOpen',
    name: 'Open My Messenger',
    icon: 'player-open-messenger',
    label: 'OPEN',
    command:
      'if (!game.nightcity || !game.nightcity.openNCM) return ui.notifications.error("Night City Messenger isn\'t ready yet.");\n' +
      'game.nightcity.openNCM();\n',
  },
  {
    slug: 'PlrCompose',
    name: 'Compose Message',
    icon: 'player-compose',
    label: 'NEW',
    command: GUARD + 'M.openComposer();\n',
  },
  {
    slug: 'PlrContacts',
    name: 'My Contacts',
    icon: 'player-contacts',
    label: 'CTS',
    command: GUARD + 'M.openContacts();\n',
  },
  {
    slug: 'PlrUnread',
    name: 'Check Unread',
    icon: 'player-check-unread',
    label: 'UNRD',
    command:
      GUARD +
      MY_ACTOR +
      'if (!_mine) return ui.notifications.warn("No character assigned to you.");\n' +
      'const _n = await M.getUnreadCount(_mine.id);\n' +
      'ui.notifications.info(_n > 0 ? (_mine.name + ": " + _n + " unread message(s).") : (_mine.name + ": inbox clear."));\n',
  },
  {
    slug: 'PlrHack',
    name: 'Hack Selected Shard',
    icon: 'player-hack-shard',
    label: 'HACK',
    command:
      GUARD +
      ACTOR_FROM_TOKEN +
      'const _ds = game.nightcity.dataShardService;\n' +
      'const shards = _who.items.filter(i => _ds && _ds.isDataShard && _ds.isDataShard(i));\n' +
      'if (!shards.length) return ui.notifications.warn(_who.name + " is carrying no data shards.");\n' +
      PICK('shards', 'Hack Data Shard') +
      'const _r = await M.hackShard(_chosen, _who);\n' +
      'if (_r && _r.success === false) ui.notifications.warn(_r.error || "Hack failed.");\n',
  },
  {
    slug: 'PlrKey',
    name: 'Present Key Item',
    icon: 'player-present-key',
    label: 'KEY',
    command:
      GUARD +
      ACTOR_FROM_TOKEN +
      'const _ds = game.nightcity.dataShardService;\n' +
      'const shards = _who.items.filter(i => _ds && _ds.isDataShard && _ds.isDataShard(i));\n' +
      'if (!shards.length) return ui.notifications.warn(_who.name + " is carrying no data shards.");\n' +
      PICK('shards', 'Present Key Item To Shard') +
      'const _r = await M.presentKeyItem(_chosen, _who);\n' +
      'if (_r && _r.success === false) ui.notifications.warn(_r.error || "No matching key item.");\n',
  },
];

// ── GM MACROS (ownership default 0 = NONE) ───────────────────────────
const ALL_ITEMS =
  'const _ds = game.nightcity.dataShardService;\n' +
  'const _ctrl = ((canvas.tokens && canvas.tokens.controlled) || []).flatMap(t => t.actor ? [...t.actor.items] : []);\n' +
  'const _all = [...game.items, ..._ctrl];\n';

const GM = [
  {
    slug: 'GmSend',
    name: 'Send NPC Message',
    icon: 'gm-send-message',
    label: 'SEND',
    command:
      GUARD +
      'new Dialog({ title: "Send NPC Message",\n' +
      '  content: "<div style=\\"display:grid;gap:6px\\">"\n' +
      '    + "<label>From (actor name or id)<input name=\\"from\\" type=\\"text\\"/></label>"\n' +
      '    + "<label>To (actor name or id)<input name=\\"to\\" type=\\"text\\"/></label>"\n' +
      '    + "<label>Subject<input name=\\"subject\\" type=\\"text\\"/></label>"\n' +
      '    + "<label>Body<textarea name=\\"body\\" rows=\\"5\\"></textarea></label></div>",\n' +
      '  buttons: { send: { label: "Send", callback: async h => {\n' +
      '    const r = (h[0] || h); const g = s => r.querySelector("[name=\\"" + s + "\\"]").value.trim();\n' +
      '    const res = await M.sendMessage({ fromActorId: g("from"), toActorId: g("to"), subject: g("subject"), body: g("body") });\n' +
      '    ui.notifications[res && res.success ? "info" : "error"](res && res.success ? "Message sent." : ((res && res.error) || "Send failed."));\n' +
      '  } }, cancel: { label: "Cancel" } }, default: "send" }).render(true);\n',
  },
  {
    slug: 'GmSched',
    name: 'Schedule Message',
    icon: 'gm-schedule-message',
    label: 'SCHD',
    command:
      GUARD +
      'new Dialog({ title: "Schedule Message",\n' +
      '  content: "<div style=\\"display:grid;gap:6px\\">"\n' +
      '    + "<label>From (actor name or id)<input name=\\"from\\" type=\\"text\\"/></label>"\n' +
      '    + "<label>To (actor name or id)<input name=\\"to\\" type=\\"text\\"/></label>"\n' +
      '    + "<label>Subject<input name=\\"subject\\" type=\\"text\\"/></label>"\n' +
      '    + "<label>Body<textarea name=\\"body\\" rows=\\"4\\"></textarea></label>"\n' +
      '    + "<label>Deliver at<input name=\\"when\\" type=\\"datetime-local\\"/></label></div>",\n' +
      '  buttons: { sched: { label: "Schedule", callback: async h => {\n' +
      '    const r = (h[0] || h); const g = s => r.querySelector("[name=\\"" + s + "\\"]").value.trim();\n' +
      '    const w = g("when"); if (!w) return ui.notifications.warn("Pick a delivery time.");\n' +
      '    const res = await M.scheduleMessage({ fromActorId: g("from"), toActorId: g("to"), subject: g("subject"), body: g("body") }, new Date(w).toISOString());\n' +
      '    ui.notifications[res && res.success ? "info" : "error"](res && res.success ? "Message scheduled." : ((res && res.error) || "Schedule failed."));\n' +
      '  } }, cancel: { label: "Cancel" } }, default: "sched" }).render(true);\n',
  },
  {
    slug: 'GmConv',
    name: 'Convert Selected Item To Shard',
    icon: 'gm-convert-shard',
    label: 'CONV',
    command:
      GUARD +
      ALL_ITEMS +
      'const pool = _all.filter(i => !(_ds && _ds.isDataShard && _ds.isDataShard(i)));\n' +
      'if (!pool.length) return ui.notifications.warn("No convertible items. Select a token or add a world item.");\n' +
      PICK('pool', 'Convert Item To Data Shard') +
      'const _r = await M.convertToDataShard(_chosen);\n' +
      'ui.notifications[_r && _r.success ? "info" : "error"](_r && _r.success ? ("\\"" + _chosen.name + "\\" is now a data shard.") : ((_r && _r.error) || "Convert failed."));\n',
  },
  {
    slug: 'GmDecrypt',
    name: 'Force-Decrypt Selected Shard',
    icon: 'gm-force-decrypt',
    label: 'DCPT',
    command:
      GUARD +
      ALL_ITEMS +
      'const pool = _all.filter(i => _ds && _ds.isDataShard && _ds.isDataShard(i));\n' +
      'if (!pool.length) return ui.notifications.warn("No data shards found. Select the carrier token.");\n' +
      PICK('pool', 'Force-Decrypt Shard') +
      'const _r = await M.forceDecryptShard(_chosen);\n' +
      REPORT,
  },
  {
    slug: 'GmRelock',
    name: 'Relock Selected Shard',
    icon: 'gm-relock-shard',
    label: 'LOCK',
    command:
      GUARD +
      ALL_ITEMS +
      'const pool = _all.filter(i => _ds && _ds.isDataShard && _ds.isDataShard(i));\n' +
      'if (!pool.length) return ui.notifications.warn("No data shards found. Select the carrier token.");\n' +
      PICK('pool', 'Relock Shard') +
      'const _r = await M.relockShard(_chosen);\n' +
      REPORT,
  },
  {
    slug: 'GmShardMsg',
    name: 'Add Message To Selected Shard',
    icon: 'gm-add-shard-message',
    label: 'SMSG',
    command:
      GUARD +
      ALL_ITEMS +
      'const pool = _all.filter(i => _ds && _ds.isDataShard && _ds.isDataShard(i));\n' +
      'if (!pool.length) return ui.notifications.warn("No data shards found. Select the carrier token.");\n' +
      PICK('pool', 'Add Message To Shard') +
      'new Dialog({ title: "Shard Message",\n' +
      '  content: "<div style=\\"display:grid;gap:6px\\"><label>Subject<input name=\\"subject\\" type=\\"text\\"/></label><label>Body<textarea name=\\"body\\" rows=\\"5\\"></textarea></label></div>",\n' +
      '  buttons: { add: { label: "Add", callback: async h => {\n' +
      '    const r = (h[0] || h); const g = s => r.querySelector("[name=\\"" + s + "\\"]").value.trim();\n' +
      '    const res = await M.addShardMessage(_chosen, { subject: g("subject"), body: g("body") });\n' +
      '    ui.notifications[res && res.success ? "info" : "error"](res && res.success ? "Message added to shard." : ((res && res.error) || "Failed."));\n' +
      '  } }, cancel: { label: "Cancel" } }, default: "add" }).render(true);\n',
  },
  {
    slug: 'GmPushCt',
    name: 'Push Contact To Player',
    icon: 'gm-push-contact',
    label: 'PUSH',
    command:
      GUARD +
      'const cts = M.getMasterContacts() || [];\n' +
      'if (!cts.length) return ui.notifications.warn("No master contacts defined.");\n' +
      'const pcs = game.actors.filter(a => a.type === "character");\n' +
      'if (!pcs.length) return ui.notifications.warn("No character actors found.");\n' +
      'const cOpts = cts.map((c, i) => "<option value=\\"" + i + "\\">" + foundry.utils.escapeHTML(c.name || c.handle || c.id) + "</option>").join("");\n' +
      'const aOpts = pcs.map((a, i) => "<option value=\\"" + i + "\\">" + foundry.utils.escapeHTML(a.name) + "</option>").join("");\n' +
      'new Dialog({ title: "Push Contact To Player",\n' +
      '  content: "<div style=\\"display:grid;gap:6px\\"><label>Contact<select id=\\"ncm-c\\">" + cOpts + "</select></label><label>Player character<select id=\\"ncm-a\\">" + aOpts + "</select></label></div>",\n' +
      '  buttons: { push: { label: "Push", callback: async h => {\n' +
      '    const r = (h[0] || h);\n' +
      '    const c = cts[Number(r.querySelector("#ncm-c").value)];\n' +
      '    const a = pcs[Number(r.querySelector("#ncm-a").value)];\n' +
      '    const res = await M.pushContactToPlayer(c.id, a.id);\n' +
      '    ui.notifications[res && res.success ? "info" : "error"](res && res.success ? ("Pushed to " + a.name + ".") : ((res && res.error) || "Failed."));\n' +
      '  } }, cancel: { label: "Cancel" } }, default: "push" }).render(true);\n',
  },
  {
    slug: 'GmAddCt',
    name: 'Add Master Contact',
    icon: 'gm-add-master-contact',
    label: 'ADDC',
    command:
      GUARD +
      'new Dialog({ title: "Add Master Contact",\n' +
      '  content: "<div style=\\"display:grid;gap:6px\\">"\n' +
      '    + "<label>Name<input name=\\"name\\" type=\\"text\\"/></label>"\n' +
      '    + "<label>Handle<input name=\\"handle\\" type=\\"text\\"/></label>"\n' +
      '    + "<label>Role<input name=\\"role\\" type=\\"text\\"/></label>"\n' +
      '    + "<label>Notes<textarea name=\\"notes\\" rows=\\"3\\"></textarea></label></div>",\n' +
      '  buttons: { add: { label: "Add", callback: async h => {\n' +
      '    const r = (h[0] || h); const g = s => r.querySelector("[name=\\"" + s + "\\"]").value.trim();\n' +
      '    const res = await M.addMasterContact({ name: g("name"), handle: g("handle"), role: g("role"), notes: g("notes") });\n' +
      '    ui.notifications[res && res.success ? "info" : "error"](res && res.success ? "Master contact added." : ((res && res.error) || "Failed."));\n' +
      '  } }, cancel: { label: "Cancel" } }, default: "add" }).render(true);\n',
  },
  {
    slug: 'GmSetNet',
    name: 'Set Active Network',
    icon: 'gm-set-network',
    label: 'NET',
    command:
      GUARD +
      'const nets = M.getAvailableNetworks() || [];\n' +
      'if (!nets.length) return ui.notifications.warn("No networks available on this scene.");\n' +
      'const opts = nets.map((n, i) => "<option value=\\"" + i + "\\">" + foundry.utils.escapeHTML(n.name || n.id) + "</option>").join("");\n' +
      'new Dialog({ title: "Set Active Network",\n' +
      '  content: "<label>Network<select id=\\"ncm-n\\" style=\\"width:100%\\">" + opts + "</select></label>",\n' +
      '  buttons: { set: { label: "Set", callback: async h => {\n' +
      '    const r = (h[0] || h); const n = nets[Number(r.querySelector("#ncm-n").value)];\n' +
      '    const res = await M.setNetwork(n.id);\n' +
      '    ui.notifications[res && res.success ? "info" : "error"](res && res.success ? ("Active network: " + (n.name || n.id)) : ((res && res.error) || "Failed."));\n' +
      '  } }, cancel: { label: "Cancel" } }, default: "set" }).render(true);\n',
  },
  {
    slug: 'GmDeadZone',
    name: 'Toggle Dead Zone (This Scene)',
    icon: 'gm-toggle-deadzone',
    label: 'DEAD',
    command:
      GUARD +
      'const sid = canvas.scene && canvas.scene.id;\n' +
      'if (!sid) return ui.notifications.warn("No active scene.");\n' +
      'new Dialog({ title: "Dead Zone — current scene",\n' +
      '  content: "<p>Set the network dead zone for this scene.</p>",\n' +
      '  buttons: {\n' +
      '    on: { label: "Enable", callback: async () => { const r = await M.toggleDeadZone(sid, true); ui.notifications[r && r.success ? "info" : "error"](r && r.success ? "Dead zone ENABLED." : ((r && r.error) || "Failed.")); } },\n' +
      '    off: { label: "Disable", callback: async () => { const r = await M.toggleDeadZone(sid, false); ui.notifications[r && r.success ? "info" : "error"](r && r.success ? "Dead zone DISABLED." : ((r && r.error) || "Failed.")); } },\n' +
      '    cancel: { label: "Cancel" }\n' +
      '  }, default: "cancel" }).render(true);\n',
  },
  {
    slug: 'GmAdmin',
    name: 'Open Admin Panel',
    icon: 'gm-open-admin',
    label: 'ADMN',
    command: GUARD + 'M.openAdmin();\n',
  },
  {
    slug: 'GmNetMgmt',
    name: 'Open Network Management',
    icon: 'gm-open-network-mgmt',
    label: 'NMGT',
    command: GUARD + 'M.openNetworkManagement();\n',
  },
  {
    slug: 'GmGmContacts',
    name: 'Open GM Contacts',
    icon: 'gm-open-gm-contacts',
    label: 'GMC',
    command: GUARD + 'M.openGMContacts();\n',
  },
];

// ── Placeholder icon (only written when the file is absent) ───────────
function placeholderSvg(label, accent) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">\n' +
    '  <rect x="3" y="3" width="58" height="58" rx="9" fill="#070a0f" stroke="' + accent + '" stroke-width="2"/>\n' +
    '  <rect x="9" y="9" width="46" height="46" rx="5" fill="none" stroke="' + accent + '" stroke-width="1" opacity="0.3"/>\n' +
    '  <text x="32" y="37" text-anchor="middle" font-family="Orbitron, Consolas, monospace" font-size="13" font-weight="700" fill="' + accent + '">' + label + '</text>\n' +
    '  <text x="32" y="50" text-anchor="middle" font-family="Consolas, monospace" font-size="6" fill="' + accent + '" opacity="0.5">NCM</text>\n' +
    '</svg>\n'
  );
}

function ensureIcon(m, accent) {
  const file = path.join(ICON_FS_DIR, m.icon + '.svg');
  if (fs.existsSync(file)) return 'kept';
  fs.writeFileSync(file, placeholderSvg(m.label, accent), 'utf8');
  return 'seeded';
}

// ── Emit ─────────────────────────────────────────────────────────────
function doc(m, ownershipDefault, packKey, sort) {
  const _id = idFor(m.slug);
  return {
    _id,
    name: m.name,
    type: 'script',
    img: ICON_WEB_BASE + m.icon + '.svg',
    scope: 'global',
    command: m.command,
    folder: null,
    sort,
    ownership: { default: ownershipDefault },
    flags: {
      'night-city-messenger': { managed: true, sourceId: _id, pack: packKey },
    },
    _stats: { systemId: null, systemVersion: null, coreVersion: null, createdTime: null, modifiedTime: null, lastModifiedBy: null },
  };
}

function writePack(file, macros, ownershipDefault, packKey, accent) {
  const lines = macros.map((m, i) => JSON.stringify(doc(m, ownershipDefault, packKey, (i + 1) * 100)));
  fs.writeFileSync(path.join(PACKS_DIR, file), lines.join('\n') + '\n', 'utf8');

  // Validate every line round-trips and parses the way Foundry runs it:
  // an async function with speaker/actor/token/character/scope predefined.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const ids = new Set();
  for (const line of lines) {
    const o = JSON.parse(line);
    // eslint-disable-next-line no-new
    new AsyncFunction('speaker', 'actor', 'token', 'character', 'scope', o.command);
    if (!/^[a-zA-Z0-9]{16}$/.test(o._id)) throw new Error('Bad _id: ' + o._id);
    if (ids.has(o._id)) throw new Error('Duplicate _id: ' + o._id);
    ids.add(o._id);
  }

  let seeded = 0;
  for (const m of macros) if (ensureIcon(m, accent) === 'seeded') seeded++;
  console.log(file + ': ' + macros.length + ' macros OK — ' + seeded + ' placeholder icon(s) seeded, ' + (macros.length - seeded) + ' kept');
}

function writeReadme() {
  const row = (m, pack) => '| `' + m.icon + '.svg` | ' + m.name + ' | ' + pack + ' |';
  const md =
    '# NCM macro icons\n\n' +
    'One SVG per shipped macro. **Replace any file with your own art using the\n' +
    'exact same filename.** Your file is never overwritten — `tools/gen-macros.cjs`\n' +
    'only writes a neon placeholder when a file is missing. Replacing a file in\n' +
    'place takes effect immediately (no regen, no reinstall) because the macro\n' +
    'points at this fixed path.\n\n' +
    'Keep the `.svg` extension (the path is baked into the macro documents). To\n' +
    'switch to PNG/WebP instead, change `ICON_WEB_BASE`/extension in\n' +
    '`tools/gen-macros.cjs`, rerun it, then reinstall via Admin → Tools.\n\n' +
    '| File | Macro | Pack |\n|---|---|---|\n' +
    PLAYER.map(m => row(m, 'Player')).join('\n') + '\n' +
    GM.map(m => row(m, 'GM')).join('\n') + '\n';
  fs.writeFileSync(path.join(ICON_FS_DIR, 'README.md'), md, 'utf8');
}

if (!fs.existsSync(PACKS_DIR)) fs.mkdirSync(PACKS_DIR, { recursive: true });
if (!fs.existsSync(ICON_FS_DIR)) fs.mkdirSync(ICON_FS_DIR, { recursive: true });
writePack('ncm-macros-player.db', PLAYER, 2, 'player', '#00E5FF');
writePack('ncm-macros-gm.db', GM, 0, 'gm', '#FF2A6D');
writeReadme();
