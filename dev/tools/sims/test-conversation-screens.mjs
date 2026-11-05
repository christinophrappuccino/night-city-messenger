// Conversations: the screens against the code they lean on. The pane and the admin view are strings, so a wrong name fails silently.
import { FOUNDRY_APP_PKGS } from './lib/foundryApp.mjs';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

const pane = read('scripts/ui/MessageViewer/conversationPane.js');
const admin = read('scripts/ui/AdminPanel/tabs/conversationsView.js');
const css = read('styles/components/conversations.css');
const service = read('scripts/services/ConversationService.js');
const viewer = read('scripts/ui/MessageViewer/MessageViewerApp.js');
const vTpl = read('templates/message-viewer/message-viewer.hbs');
const tab = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
const tTpl = read('templates/admin-panel/tab-messages.hbs');

/* every data-cv button has a case, and every case has a button */
const cases = new Set([...pane.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]));
const buttons = new Set([...pane.matchAll(/data-cv="([a-z]+)"/g)].map((m) => m[1]));
for (const b of buttons) ok(cases.has(b), `the button "${b}" does something`);
for (const c of cases) ok(buttons.has(c), `the action "${c}" has a button`);

/* every class the screens draw is styled */
const drawn = new Set([...`${pane}\n${admin}\n${vTpl}`.matchAll(/ncm-conv__[a-z]+(?:--[a-z]+)?/g)].map((m) => m[0]));
for (const c of drawn) ok(css.includes(`.${c}`), `.${c} is styled`);
ok(css.includes('.ncm-msg2-convwrap') || read('styles/components/admin-panel/tab-messages.css').includes('.ncm-msg2-convwrap'), 'the admin frame is styled');
ok(read('styles/night-city-messenger.css').includes("components/conversations.css"), 'the stylesheet is imported');
ok(!/#[0-9a-f]{3,8}\b/i.test(css.replace(/var\([^)]*\)/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/#fff\b/gi, '')), 'tokens only');
ok(!/border-left:\s*[2-9]px/.test(css), 'no left accent bar');

/* every service method the screens call exists */
const calls = new Set([...`${pane}\n${admin}`.matchAll(/(?:svc\(\)|\bs)\??\.([a-zA-Z_]+)\??\(/g)].map((m) => m[1]));
for (const m of calls) ok(new RegExp(`^\\s+(?:async )?${m}\\(`, 'm').test(service), `the service has ${m}()`);

/* no line is written as HTML: everything from a person goes through esc */
ok(!/innerHTML = [^;]*\bl\.text/.test(pane), 'a line never reaches innerHTML unescaped');

/* a paint keeps its host, so its listeners must go on once */
ok(/if \(h === this\._wiredHost\) return;/.test(pane), 'listeners go on once, or every button fires twice');

/* dialogBodyHtml's field is an object; a string draws an empty box and a select never appears */
ok(!/field: *[`'"]/.test(pane), 'no dialog field is passed as a string');

/* a GM picks NPCs quickly, and lands where the NPC is */
ok(/startConversationDialog\(\{ host: this\.element\.querySelector\('\.ncm-viewer'\) \|\| this\.element, actorId: this\.actorId, gm \}\)/.test(viewer), 'the inbox opens the GM form for a GM');
ok(/this\.actorId = owner;/.test(viewer) && /inboxOwnerOf\(starter\)/.test(viewer), 'the inbox follows the NPC you joined as');
ok(!/pickPeople\(null/.test(pane), 'Join as is one click, not a multi-select with Done');
ok(/hasPlayerOwner && !identityRole/.test(pane), "the NPC list leaves out the players' characters");

/* the GM mode is invisible */
ok(/_read\(c\) \{\s*if \(this\.admin\) return;/.test(pane), 'watching marks nothing read');
ok(/_mine\(\) \{[^\n]*!this\.admin/.test(pane), 'the GM has no "You" in a chat they are only watching');

/* the inbox */
ok(/'conversations'/.test(viewer.split('MESSAGE_FILTERS')[1].slice(0, 120)), 'the filter is registered');
ok(/filter\(m => !m\.isConversation\)\.map\(m => m\.messageId\)/.test(viewer), 'keyboard nav never lands on a conversation row');
// (select-all was unreachable, no button named it, and was removed 2026-11-05 with the other dead viewer actions)
ok(/enrichedMail/.test(viewer), 'rows skip the mail enrichment');
ok(/data-action="open-conversation"/.test(vTpl) && /'open-conversation': async function/.test(viewer) /* VIEWER_ACTIONS entry since step 12 */, 'a row opens');
ok(/data-action="new-conversation"/.test(vTpl) && /'new-conversation': async function/.test(viewer) /* VIEWER_ACTIONS entry since step 12 */, 'the header starts one');
ok(/conversationsOn/.test(vTpl) && /const conversationsOn = !!convService\?\.enabled/.test(viewer), 'all of it hides when switched off');
ok(/_preRender/.test(viewer) && /_convPane\?\.snapshot\(\)/.test(viewer), 'a redraw keeps what you were typing and where you were');
ok(/this\.selectedConversationId = null;\s*\n\s*this\.selectedMessageId = null;/.test(viewer), 'back leaves the chat');
ok(/ns\.openConversation = /.test(read('scripts/init/registerMessagingSystem.js')), 'the toast has somewhere to go');

/* admin */
ok(/key: 'conv'/.test(tab) && /isConv/.test(tab) && /data-conv-admin/.test(tTpl), 'the sub-tab is in');
ok(/s\.startsWith\('conv:'\)/.test(tab), "the toast's Open in admin lands on the chat");
ok(/data-op="newConversation"/.test(tTpl) && /case 'newConversation':/.test(tab), 'New has Conversation');
ok(/closeConversations\(this\)/.test(tab) && /wireConversations\(this, root\)/.test(tab), 'it wires and unwires');

/* the Purge, the audit, the reset */
const tools = read('scripts/ui/AdminPanel/tabs/ToolsTab.js');
ok(/conversationService|isConversationJournal|'conversation'/.test(tools), 'Purge and the audit know conversations');
ok(/conversationState/.test(read('scripts/core/FactoryReset.js')) || /MIGRATION_SCOPES/.test(read('scripts/core/FactoryReset.js')), 'a Factory Reset clears read positions');

/* the real template compiles, and the row renders what the viewer gives it */
const { createRequire } = await import('node:module');
let H = null;
for (const p of [process.env.NCM_FOUNDRY_RESOURCES, ...FOUNDRY_APP_PKGS, 'C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files/FoundryVTT/resources/app/package.json', 'C:/Program Files/Foundry Virtual Tabletop/package.json'].filter(Boolean)) { try { H = createRequire(p)('handlebars'); break; } catch { /* keep looking */ } }
if (H) {
  H.registerHelper('eq', (a, b) => a === b);
  { const { registerTipHelper } = await import(new URL('../../../scripts/utils/notify.js', import.meta.url).href); registerTipHelper(H); }
  H.compile(vTpl);
  const row = vTpl.slice(vTpl.indexOf('{{#if isConversation}}'), vTpl.indexOf('{{> "modules/night-city-messenger/templates/message-viewer/partials/message-list-item.hbs"'));
  const html = H.compile(`${row}{{/if}}`)({ isConversation: true, id: 'c1', title: 'Crew <b>', unread: 2, selected: true, relTime: '2h ago', count: 3, preview: '<i>x</i>', faces: [{ name: 'V', initial: 'V', color: '#19f3f7', img: '' }] });
  ok(html.includes('data-conversation-id="c1"') && html.includes('ncm-viewer__msg--unread') && html.includes('ncm-viewer__msg--selected'), 'a row renders');
  ok(!html.includes('<b>') && !html.includes('<i>x'), 'a row escapes titles and previews');
} else console.log('(Handlebars not found: skipped the row render)');

console.log(`test-conversation-screens: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
