// Sim: the clean composer (2026-10-28 — dev/mockups/composer-clean-mock.html).
//   1. drafts.js — the per-character LIST: a legacy single draft lifts once,
//      the cap prunes the oldest, a fresh open restores nothing by itself (the
//      Cobain bug), a reply draft keeps its original's id.
//   2. previewModel.js — anonymous masks the sender, encryption hides the body,
//      a group To line names the party, the body is cleaned.
//   3. MessageTemplateService — the envelope round-trips, names de-dupe
//      case-insensitively, ids are fresh, the summary says what a template carries.
//   4. Wiring guards — actions ↔ template both ways, every data-id the JS reads
//      exists, insertSignature is gone, the CSS is tokens-only and text-scaled,
//      the viewer's Drafts tab reads the list, the launcher whitelists draftId,
//      the setting + service are registered, Send re-enables in finally.
//   5. A real Handlebars render of the template (GM: drawer + preview; player).
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');

const D = await import(pathToFileURL(`${ROOT}/scripts/utils/drafts.js`).href);
const { buildPreview } = await import(pathToFileURL(`${ROOT}/scripts/ui/MessageComposer/previewModel.js`).href);

// ═══ 1. Drafts ═══
{
  const NOW = Date.parse('2045-10-17T22:14:00Z');
  const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();

  // lift: a fresh legacy draft joins the list; an old one is dropped; an absent one is a no-op
  let r = D.liftLegacy({ composerDrafts: { a: { id: 'a', savedAt: iso(5) } }, composerDraft: { subject: 'old single', savedAt: iso(30) } }, NOW);
  ok(r.lifted && Object.keys(r.map).length === 2 && Object.values(r.map).some(d => d.subject === 'old single' && d.mode === 'compose'), 'legacy single draft lifted into the list with an id + mode');
  r = D.liftLegacy({ composerDrafts: {}, composerDraft: { subject: 'stale', savedAt: iso(60 * 48) } }, NOW);
  ok(r.lifted && r.dropped && Object.keys(r.map).length === 0, 'a legacy draft older than a day is dropped, not lifted');
  r = D.liftLegacy({ composerDrafts: { a: { id: 'a', savedAt: iso(1) } } }, NOW);
  ok(!r.lifted && Object.keys(r.map).length === 1, 'no legacy draft → nothing to lift');

  // prune at the cap, oldest first
  const many = {};
  for (let i = 0; i < 25; i++) many[`d${i}`] = { id: `d${i}`, savedAt: iso(i) };
  const { kept, dropped } = D.pruneDrafts(many);
  ok(Object.keys(kept).length === D.DRAFT_CAP && dropped.length === 5, `prune keeps ${D.DRAFT_CAP}, drops 5`);
  ok(dropped.every(id => Number(id.slice(1)) >= 20) && 'd0' in kept, 'the OLDEST are the ones dropped');
  ok(D.sortDrafts(Object.values(kept))[0].id === 'd0', 'sorted newest first');

  // readDrafts over a mock actor: lifts once and persists the lift
  const writes = [];
  const actor = {
    flags: { composerDraft: { subject: 'legacy', savedAt: iso(2) }, composerDrafts: null },
    getFlag: (_m, k) => actor.flags[k],
    unsetFlag: async (_m, k) => { writes.push(['unset', k]); actor.flags[k] = undefined; },
    setFlag: async (_m, k, v) => { writes.push(['set', k]); actor.flags[k] = v; },
  };
  const rd = D.readDrafts(actor, 'night-city-messenger', { nowMs: NOW });
  ok(rd.list.length === 1 && rd.list[0].subject === 'legacy', 'readDrafts returns the lifted draft');
  await new Promise(res => setTimeout(res, 5));
  ok(writes[0]?.[0] === 'unset' && writes[0][1] === 'composerDraft' && writes[1]?.[0] === 'set' && writes[1][1] === 'composerDrafts', 'the lift is persisted: unset the legacy flag, then set the list');
  ok(D.readDrafts({ getFlag: () => undefined }, 'x').list.length === 0, 'no flags → empty list, no throw');

  // content / labels / age
  ok(!D.draftHasContent({ recipients: [], subject: ' ', body: '<p><br></p>' }), 'an empty window has no content');
  ok(D.draftHasContent({ recipients: [], subject: '', body: '<p>hi</p>' }) && D.draftHasContent({ recipients: [{ email: 'a@b' }] }), 'a body or a recipient is content');
  ok(D.draftLabel({ subject: '' }) === '(no subject)' && D.draftLabel({ subject: 'Hey' }) === 'Hey', 'draft label');
  ok(D.draftKind({ mode: 'reply' }) === 'reply' && D.draftKind({ mode: 'forward' }) === 'forward' && D.draftKind({ mode: 'compose' }) === '', 'draft kind');
  ok(D.draftRecipientName({ recipients: [{ groupId: 'g', name: 'The crew' }] }) === 'The crew (group)', 'a group recipient reads as a group');
  ok(D.draftRecipientName({ recipients: [{ actorId: 'v' }] }, (id) => (id === 'v' ? 'V' : null)) === 'V', 'an actor-only recipient resolves by id');
  ok(D.relativeAge(NOW - 30000, NOW) === 'just now' && D.relativeAge(NOW - 5 * 60000, NOW) === '5 min' && D.relativeAge(NOW - 3600000 * 2, NOW) === '2 h' && D.relativeAge(NOW - 86400000, NOW) === 'yesterday', 'relative age on the real clock');
  ok(/^d[a-z0-9]{10}$/.test(D.newDraftId()) && D.newDraftId() !== D.newDraftId(), 'draft ids are fresh');

  // the composer never restores by itself; a reply draft keeps its original
  const comp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
  ok(!/_restoreDraft\(/.test(comp), 'the old auto-restore is gone');
  ok(/this\._pendingDraftId = options\.draftId \|\| null/.test(comp) && /if \(!id\) return;/.test(comp.match(/async _loadPendingDraft\(\) \{[\s\S]*?\n  \}/)[0]), 'a fresh composer only loads a draft it was ASKED to open');
  ok(!/getFlag\(MODULE_ID, 'composerDraft'\)/.test(comp), 'the composer never reads the legacy single flag');
  ok(/originalMessageId: this\.originalMessage\?\.messageId \|\| null/.test(comp) && /originalActorId:/.test(comp), 'a reply/forward draft records its original (message + inbox)');
  ok(/getMessage\?\.\(inboxActorId, draft\.originalMessageId\)/.test(comp) && /_initReply\(\{\}\)/.test(comp), 'a reply draft reloads the original through the repository and rebuilds the reply');
  ok(/opening it as a new message/.test(comp), 'a gone original opens as a plain draft and says so');
  ok(/if \(!this\._draftId\) this\._draftId = newDraftId\(\)/.test(comp), 'each window mints its own draft id on the first autosave');
  ok(/if \(!draftHasContent\(record\)\) return false;/.test(comp), 'an empty window writes no draft');
  ok(/pruneDrafts\(map\)/.test(comp) && /patch\[`-=\$\{id\}`\] = null/.test(comp), 'autosave prunes past the cap with deletion keys');
  ok(/static async _onSaveDraft[\s\S]*?this\.close\(\{ noDraft: true \}\)/.test(comp), 'the Draft button saves and CLOSES');
  ok(/async _clearDraft\(\) \{[\s\S]*?_deleteDraft\(this\._draftId\)/.test(comp), 'a successful send deletes only THIS window\'s draft');
  ok(/else if \(this\._draftId\) await this\._deleteDraft\(this\._draftId\);/.test(comp), 'closing without content deletes the draft');
  ok(/showNamePicker\(\{\s*title: 'Your drafts'/.test(comp) && /admin: false/.test(comp.match(/title: 'Your drafts'[\s\S]*?\}\);/)[0]), 'the footer link opens the shared picker on the player theme');
}

// ═══ 2. Preview model ═══
{
  const base = {
    fromName: 'Rogue', fromEmail: 'rogue@afterlife.nc', fromImg: 'rogue.png', fromInitials: 'R',
    networkName: 'CitiNet', when: '14 Aug 2045 20:40', priority: 'urgent', subject: 'Job',
    body: '<p style="color:#191813;background:#fff">Hello <b>V</b></p>',
    recipients: [{ name: 'V', email: 'v@nc' }], attachments: [{ name: 'Eddies', isEddies: true, eddiesFormatted: '250 eb' }],
  };
  let p = buildPreview(base);
  ok(p.sender.name === 'Rogue' && p.sender.img === 'rogue.png' && !p.sender.anon, 'plain sender shows name + portrait');
  ok(!/color:#191813|background:#fff/.test(p.bodyHtml) && /<b>V<\/b>/.test(p.bodyHtml), 'the body is cleaned (source colours dropped, bold kept)');
  ok(p.priority.show && p.priority.label === 'Urgent' && p.priority.attn, 'priority flag');
  ok(p.attachments[0].name === '250 eb' && p.attachments[0].isEddies, 'eddies attachment shows its amount');
  ok(p.lock === null && p.notes.length === 0, 'no lock, no notes');

  p = buildPreview({ ...base, anon: true, anonAlias: 'GHOST_7F', anonStyle: 'ghost', anonMaskedEmail: 'unknown@relay.darknet', anonAllowReplies: true });
  ok(p.sender.anon && p.sender.name === 'GHOST_7F' && p.sender.email === 'unknown@relay.darknet' && p.sender.img === null && p.sender.style === 'ghost', 'anonymous masks the sender — no real name, address or portrait');
  ok(!/Rogue|rogue@/.test(JSON.stringify(p)), 'the real identity is nowhere in the preview');
  ok(p.notes.some(n => /back to the mask/.test(n.text)), 'replies-to-the-mask note');
  ok(buildPreview({ ...base, anon: true, anonAlias: '', anonAllowReplies: false }).sender.name === 'UNKNOWN', 'blank alias → UNKNOWN');

  p = buildPreview({ ...base, encryption: { enabled: true, dv: 18, type: 'BLACK_ICE', failureMode: 'damage' } });
  ok(p.lock && p.lock.dv === 18 && p.lock.typeLabel === 'Black ICE' && p.lock.lethal && /deals damage/.test(p.lock.text), 'encryption → the lock block');
  ok(p.bodyHtml === '' && !/Hello/.test(JSON.stringify(p)), 'an encrypted preview carries NO body');

  p = buildPreview({ ...base, recipients: [{ name: 'The crew', isGroup: true, members: [{ name: 'V' }, { name: 'Judy' }, { email: 'p@x' }] }, { name: 'Panam' }] });
  ok(p.toLine === 'V, Judy, p@x, Panam' && p.toCount === 4 && /^V and 3 others$/.test(p.who), 'a group To line names the party');
  p = buildPreview({ ...base, selfDestruct: { enabled: true, mode: '6h' }, schedule: { enabled: true, timeFormatted: '15 Aug 08:00' } });
  ok(p.notes.length === 2 && /in 6 hours/.test(p.notes[0].text) && /Arrives 15 Aug/.test(p.notes[1].text), 'self-destruct + schedule notes');
  ok(buildPreview({}).subject === '(no subject)' && buildPreview({ isReply: true }).subject === '', 'subject fallback (none on a reply)');
}

// ═══ 3. Templates ═══
{
  let stored = [];
  globalThis.game = { user: { isGM: true }, settings: { get: () => stored, set: async (_m, _k, v) => { stored = v; } } };
  globalThis.foundry = { utils: { randomID: (n) => Math.random().toString(36).slice(2, 2 + (n || 8)) } };
  const { MessageTemplateService: Svc } = await import(pathToFileURL(`${ROOT}/scripts/services/MessageTemplateService.js`).href);
  const svc = new Svc();
  let r = await svc.save({ name: 'Bounty notice', subject: 'WANTED', body: '<p>Pay out</p>', priority: 'urgent', encryption: { enabled: true, dv: 14, type: 'RED_ICE', failureMode: 'lockout' }, selfDestruct: { enabled: true, mode: '24h' } });
  ok(!r.overwrote && stored.length === 1 && stored[0].id && stored[0].encryption.dv === 14, 'save stores a sanitised template');
  const firstId = stored[0].id;
  r = await svc.save({ name: 'bounty NOTICE', subject: 'WANTED v2' });
  ok(r.overwrote && stored.length === 1 && stored[0].id === firstId && stored[0].subject === 'WANTED v2', 'the same name (case-insensitive) overwrites, keeping the id');
  ok(Svc.summary(stored[0]) === 'subject' && /Red ICE DV 14/.test(Svc.summary({ ...stored[0], body: 'x', encryption: { enabled: true, dv: 14, type: 'RED_ICE' }, selfDestruct: { enabled: true } })), 'summary says what a template carries');
  ok(Svc.sanitize({ name: 'x', priority: 'nope', encryption: { enabled: true, dv: 99, type: 'LOL', failureMode: '?' }, selfDestruct: { enabled: true, mode: 'never' } }).priority === 'normal', 'unknown priority falls back');
  const s = Svc.sanitize({ name: 'x', encryption: { enabled: true, dv: 99, type: 'LOL', failureMode: '?' }, selfDestruct: { enabled: true, mode: 'never' } });
  ok(s.encryption.dv === 30 && s.encryption.type === 'ICE' && s.encryption.failureMode === 'nothing' && s.selfDestruct.mode === 'after_read', 'unknown lock values fall back, DV clamps');
  ok(Svc.sanitize({ name: '  ' }) === null, 'a nameless template is refused');

  const env = svc.exportTemplates();
  ok(env.ncmMessageTemplates === 1 && env.exportedAt && env.templates.length === 1, 'export envelope');
  stored = [];
  let imp = await svc.importTemplates(env);
  ok(imp.imported === 1 && imp.skipped === 0 && stored[0].id !== firstId && stored[0].name === 'bounty NOTICE', 'import round-trips with a FRESH id');
  imp = await svc.importTemplates([{ name: 'Bounty Notice' }, { name: 'New one', body: 'b' }, { nope: 1 }]);
  ok(imp.imported === 1 && imp.skipped === 2 && stored.length === 2, 'a bare array imports; same-name and nameless rows skip');
  let threw = false; try { await svc.importTemplates({ junk: true }); } catch { threw = true; }
  ok(threw, 'an unknown payload throws (the caller toasts it)');
  ok(await svc.remove(stored[0].id) && stored.length === 1 && !(await svc.remove('nope')), 'remove by id');
  game.user.isGM = false;
  threw = false; try { await svc.save({ name: 'player' }); } catch { threw = true; }
  ok(threw, 'writes are GM-only');
  game.user.isGM = true;
}

// ═══ 4. Wiring ═══
{
  const comp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
  const hbs = read('templates/message-composer/message-composer.hbs');
  const css = read('styles/components/message-composer.css');

  // actions ↔ template, both ways
  const mapBlock = comp.match(/actions: \{([\s\S]*?)\n    \},/)[1];
  const mapActions = [...mapBlock.matchAll(/^\s*(\w+): MessageComposerApp\._on\w+,/gm)].map(m => m[1]);
  const tplActions = [...new Set([...hbs.matchAll(/data-action="(\w+)"/g)].map(m => m[1]))];
  const jsOnly = new Set(['cancel']);
  const missingInMap = tplActions.filter(a => !mapActions.includes(a));
  const missingInTpl = mapActions.filter(a => !tplActions.includes(a) && !jsOnly.has(a));
  ok(missingInMap.length === 0, `every template action is in the map (${missingInMap.join(', ') || 'ok'})`);
  ok(missingInTpl.length === 0, `every mapped action is used by the template (${missingInTpl.join(', ') || 'ok'})`);
  for (const a of mapActions) ok(new RegExp(`static (?:async )?_on${a[0].toUpperCase()}${a.slice(1)}\\(`).test(comp), `handler exists for ${a}`);
  ok(!/insertSignature|InsertSignature/.test(comp + hbs + css), 'insertSignature is gone everywhere');

  // data-ids the JS reads exist in the template
  const tplIds = new Set([...hbs.matchAll(/data-id="([\w-]+)"/g)].map(m => m[1]));
  const jsIds = new Set([...comp.matchAll(/\[data-id="([\w-]+)"\]/g)].map(m => m[1]));
  for (const id of ['overflow-menu', 'tpl-menu']) jsIds.add(id);
  const gone = [...jsIds].filter(id => !tplIds.has(id));
  ok(gone.length === 0, `every data-id the JS queries is in the template (${gone.join(', ') || 'ok'})`);
  ok(tplIds.has('preview-pane') && tplIds.has('drawer'), 'the new surfaces carry ids');

  // the drawer rule
  ok(/_drawer = \(this\._drawer === key\) \? null : key/.test(comp), 'a chip toggles its drawer; only one is ever open');
  for (const k of ['sd', 'anon', 'sched']) ok(new RegExp(`this\\._drawer = '${k}'`).test(comp), `switching ${k} on opens its drawer`);
  ok((hbs.match(/data-id="drawer"/g) || []).length === 5 && /\(eq drawer 'enc'\)/.test(hbs), 'five drawers, one rendered at a time');
  ok(/data-action="cycleEncryptionType" data-type="\{\{id\}\}"/.test(hbs) && /const picked = target\?\.dataset\?\.type/.test(comp), 'the lock type is a segment carrying its type');
  ok(/data-action="toggleSelfDestruct" data-on="0"/.test(hbs) && /static _wantOn\(target, current\)/.test(comp), 'drawer switches pass data-on; the toggle still toggles without it');

  // errors rendered, send re-enabled, paste listener, queued branch
  for (const k of [...new Set([...comp.matchAll(/_errors\.([A-Za-z_]+)\s*=/g)].map(m => m[1]))]) ok(new RegExp(`\\{\\{errors\\.${k}\\}\\}`).test(hbs), `errors.${k} renders`);
  ok(/finally \{[\s\S]*?sendBtn\.disabled = false;/.test(comp), 'Send is re-enabled in finally');
  ok(/editor\.addEventListener\('paste'/.test(comp) && /pasteToHtml/.test(comp), 'the paste listener survived');
  ok(/_playSendAnimation\('success', \{ queued: !!result\.queued/.test(comp), 'queued ≠ delivered');
  ok(/terminalSend\.impersonating/.test(hbs) && /canSwitchFrom/.test(hbs) && /ncm-composer__chip--group/.test(hbs) && /isAnonTarget/.test(hbs), 'terminal lock, group chip and anon-reply chip survived');
  ok(!/SUBJ:|>PRI<|>ENC</.test(hbs) && /What is it about\?/.test(hbs), 'plain-language labels');

  // CSS: tokens only, scaled
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stripped = cssNoComments.replace(/var\(--[\w-]+,\s*#[0-9a-fA-F]{3,8}\)/g, '');
  const hexes = [...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
  ok(hexes.length === 0, `no literal hex outside a var() fallback (${hexes.slice(0, 3).join(' ') || 'ok'})`);
  const fontSizes = [...cssNoComments.matchAll(/font-size:\s*([^;!]+)/g)].map(m => m[1].trim()).filter(v => !/^(\.?\d*\.?\d+em|0|inherit)$/.test(v));
  const unscaledFonts = fontSizes.filter(v => !/calc\(.*var\(--ncm-text-scale, 1\)/.test(v));
  ok(unscaledFonts.length === 0, `every font-size is text-scaled (${unscaledFonts.slice(0, 3).join(' | ') || 'ok'})`);
  const heights = [...cssNoComments.matchAll(/(?:^|[;{\s])(?:min-)?height:\s*([^;!]+)/g)].map(m => m[1].trim());
  const unscaledH = heights.filter(v => /^\d+px$/.test(v) && parseInt(v) > 11);
  ok(unscaledH.length === 0, `every control height over 11px is text-scaled (${unscaledH.slice(0, 3).join(' | ') || 'ok'})`);
  ok(/\.ncm-composer button\.ncm-composer__opt,[\s\S]*?\.ncm-composer \.ncm-composer__seg > button \{[\s\S]*?appearance: none !important/.test(css), 'the Foundry/CPR button reset covers the new controls at 0,2,1');
  for (const t of ['act', 'attn', 'bad', 'secret', 'money']) ok(new RegExp(`\\[data-tone="${t}"\\]\\s*\\{ --tc: var\\(--ncm-${t}`).test(css), `tone ${t} maps to its meaning token`);
  ok(!/--ncm-color-/.test(css), 'no nonexistent --ncm-color-* vars');
  const used = new Set([...cssNoComments.matchAll(/var\((--ncm-[\w-]+)/g)].map(m => m[1]));
  const defined = new Set([...(read('styles/base/variables.css') + read('styles/themes/admin-theme.css')).matchAll(/(--ncm-[\w-]+)\s*:/g)].map(m => m[1]));
  const undefinedVars = [...used].filter(v => !defined.has(v) && !/^--ncm-(text-scale|scrollbar-)/.test(v));
  ok(undefinedVars.length === 0, `every --ncm-* the composer reads is defined somewhere (${undefinedVars.join(', ') || 'ok'})`);
  ok(!existsSync(`${ROOT}/styles/components/composer-atmosphere.css`) || !/composer-atmosphere/.test(read('styles/night-city-messenger.css')), 'composer-atmosphere.css is not imported (dead file)');

  // viewer Drafts tab, launcher, settings, service, getters
  const viewer = read('scripts/ui/MessageViewer/MessageViewerApp.js');
  const viewerHbs = read('templates/message-viewer/message-viewer.hbs');
  ok(/readDrafts\(a, MODULE_ID\)\.list/.test(viewer) && /composeMessage\?\.\(\{ fromActorId: actorId, draftId \}\)/.test(viewer), 'the Drafts tab reads the list and opens a draft by id');
  ok(/data-action="open-draft" data-actor-id="\{\{this\.actorId\}\}" data-draft-id="\{\{this\.draftId\}\}"/.test(viewerHbs) && /data-action="delete-draft"[^>]*data-draft-id/.test(viewerHbs), 'Drafts rows carry the draft id');
  ok(/\[`-=\$\{draftId\}`\]: null/.test(viewer), 'deleting a draft removes one key');
  ok(/draftId: options\.draftId \?\? null/.test(read('scripts/init/registerMessagingSystem.js')), 'composeMessage whitelists draftId');
  ok(/'messageTemplates'/.test(read('scripts/core/SettingsManager.js')), 'the messageTemplates setting is registered');
  ok(/game\.nightcity\.messageTemplateService = new MessageTemplateService\(\)/.test(read('scripts/init/registerMessagingSystem.js')), 'the service is exposed on game.nightcity');
  for (const svcName of [...new Set([...comp.matchAll(/this\.(\w+Service)\b/g)].map(m => m[1]))]) ok(new RegExp(`get ${svcName}\\(\\)`).test(comp), `composer getter for this.${svcName}`);
  ok(!/new Dialog\(|Dialog\.confirm\(|Dialog\.prompt\(/.test(comp), 'no raw Dialog in the composer (wrappers only)');
  ok(/message-composer\.hbs/.test(read('dev/mockups/composer-netpicker-probe.html')) && /contrast/.test(read('dev/mockups/composer-netpicker-probe.html')), 'the probe still fetches the real template and has the contrast walker');

  // template balance
  const opens = (hbs.match(/\{\{~?#(if|unless|each|with)/g) || []).length;
  const closes = (hbs.match(/\{\{~?\/(if|unless|each|with)/g) || []).length;
  ok(opens === closes, `template blocks balanced (${opens}/${closes})`);
}

// ═══ 5. A real render ═══
{
  let Handlebars = null;
  for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
    if (!existsSync(p)) continue;
    try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
  }
  if (Handlebars) {
    const H = Handlebars.create();
    H.registerHelper('eq', (a, b) => a === b); H.registerHelper('gt', (a, b) => a > b); H.registerHelper('gte', (a, b) => a >= b);
    H.registerHelper('ncm-net-icon', () => new H.SafeString('<i class="fas fa-wifi"></i>'));
    H.registerHelper('ncm-anon-avatar', (s) => new H.SafeString(`<span class="ncm-anon-av" data-anon-style="${s}"></span>`));
    H.registerHelper('ncm-term', (form, cs, o) => { const h = (o && o.hash) || (cs && cs.hash) || {}; return `${h.pre || ''}${h.a ? 'a ' : ''}data shard${h.post || ''}`; });
    const tpl = H.compile(read('templates/message-composer/message-composer.hbs'));
    const base = {
      mode: 'reply', isReply: true, isGM: true, canSwitchFrom: true, fromName: 'Rogue', fromEmail: 'r@x', fromInitials: 'R', fromHue: 'var(--ncm-hue-1)',
      networkName: 'CitiNet', netPillState: 'connected', netPillBars: [{ active: true }], fxTags: [], netPicker: { rows: [], filters: [] },
      currentGameTime: 'now', recipients: [{ name: 'V', email: 'v@x', initials: 'V', hue: 'x', locked: true }], recipientLocked: true,
      priorities: [{ id: 'normal', label: 'Normal', active: true }], priorityLabel: 'Normal', priorityTone: 'act',
      encryptionEnabled: true, encryptionDV: 18, encryptionType: 'BLACK_ICE', isLethalICE: true, lockLabel: 'Black ICE', lockTone: 'bad',
      encTypes: [{ id: 'BLACK_ICE', label: 'Black ICE', active: true }], encryptionFailureMode: 'damage', iceSource: 'actor', iceActorId: 'h',
      iceActors: [{ id: 'h', name: 'Hellhound', atk: 6 }], selfDestructOptions: [], anonStyleList: [], anonFeatureEnabled: true,
      attachments: [], errors: {}, charCount: 0, body: '', drawer: 'enc', draftCount: 2, templateCount: 1,
      originalMessageCard: { sender: 'V', email: 'v@x', initials: 'V', hue: 'x', formattedTime: 't', network: 'CitiNet', subject: 'Job', body: '<p>hi</p>', encrypted: true, encDV: 15, attachments: [], hasAttachments: false },
    };
    const html = tpl(base);
    ok(/Replying to/.test(html) && /ICE · DV 15/.test(html), 'GM reply: the quote card + ICE tag render');
    ok(/data-id="drawer"/.test(html) && /Hellhound/.test(html) && /is-sel/.test(html) && /On a miss/.test(html), 'the lock drawer renders the ICE actor cards and the miss row');
    ok(/2 drafts/.test(html) && /data-action="togglePreview"/.test(html) && /data-id="tpl-menu"/.test(html), 'GM footer: drafts link, Preview, templates menu');
    ok((html.match(/data-id="drawer"/g) || []).length === 1, 'exactly one drawer in the DOM');
    ok(!/Subject<\/span>/.test(html), 'no Subject row on a reply');
    const prev = tpl({ ...base, preview: { who: 'V', sender: { anon: true, style: 'ghost', name: 'GHOST', email: 'm@x', initials: '?' }, meta: 'm', priority: { show: false }, subject: 'Re: Job', toLine: 'V', lock: { dv: 18, typeLabel: 'Black ICE', lethal: true, text: 'x' }, attachments: [], notes: [{ icon: 'fa-bomb', text: 'Self-destructs after reading' }] } });
    ok(/data-id="preview-pane"/.test(prev) && !/data-id="editor-content"/.test(prev) && /Back to editing/.test(prev) && /data-anon-style="ghost"/.test(prev), 'preview swaps the form for the recipient card (masked sender)');
    const player = tpl({ ...base, isGM: false, canSwitchFrom: false, mode: 'compose', isReply: false, recipientLocked: false, originalMessageCard: null, drawer: null, draftCount: 0, encryptionEnabled: false, isDeadZone: true });
    ok(!/data-drawer="enc"|data-drawer="anon"|data-drawer="sd"/.test(player) && /data-drawer="pri"/.test(player) && /data-drawer="sched"/.test(player), 'a player gets Priority + Schedule only');
    ok(/data-action="queueMessage"/.test(player) && /Dead zone\./.test(player) && !/togglePreview|tpl-menu/.test(player), 'player dead zone: Queue on the line, no GM footer');
    ok(/Subject<\/span>/.test(player) && /data-id="subject-input"/.test(player) && /data-action="toggleCC"/.test(player), 'player new message: Subject row + Cc link');
  } else {
    fail++; console.error('FAIL: Handlebars not found in a Foundry install — the render checks did not run');
  }
}

console.log(`test-composer-clean: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
