// test-admin-tabs — the admin panel's tabs are ONE list (R16, after stage 2): AdminPanelApp.TAB_GROUPS. The tab
// controllers, the number keys, the nav buttons and the keys tooltip all come from it, so the bar, the keys and the
// tooltip can no longer disagree (they did: the tooltip said "1–9 and 0 in the order shown", but Phone, the 5th tab,
// has no key, so from 5 on each digit opened the next tab over). The list and tabNav are lifted out of the real file and run with stub tab classes
// (AdminPanelApp itself needs Foundry); the nav part of the REAL admin-panel.hbs is rendered through Handlebars.
// Run: node dev/tools/sims/test-admin-tabs.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';
import { FOUNDRY_APP_PKGS } from './lib/foundryApp.mjs';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const src = read('scripts/ui/AdminPanel/AdminPanelApp.js');
const grab = (start, end) => { const a = src.indexOf(start); const b = src.indexOf(end, a); if (a < 0 || b < 0) throw new Error(`cannot find ${start}`); return src.slice(a, b + end.length); };
const groupsSrc = grab('static TAB_GROUPS = Object.freeze([', '\n  ]);');
const navSrc = grab('static tabNav(activeTab, stats) {', '\n  }');
const tipSrc = grab('static get TAB_KEYS_TIP() {', '\n  }');
const keysSrc = grab('static get TAB_KEYS() {', '\n  }');
const tabClasses = [...new Set([...groupsSrc.matchAll(/Tab: (\w+)/g)].map((m) => m[1]))];
// eslint-disable-next-line no-new-func
const App = new Function(...tabClasses, `return class AdminPanelApp { ${groupsSrc} ${navSrc} ${tipSrc} ${keysSrc} };`)(...tabClasses.map((n) => class { constructor(app) { this.app = app; this.name = n; } }));

const all = App.TAB_GROUPS.flatMap((g) => g.tabs);
const keys = all.map((t) => t.key);
ok(new Set(keys).size === keys.length && keys.length === 11, `eleven tabs, no key twice (${keys.join()})`);
ok(keys.join() === 'overview,messages,contacts,spam,phone,networks,security,terminals,shards,access,tools', 'in the bar\'s order');
const hk = all.filter((t) => t.hotkey).map((t) => t.hotkey);
ok(new Set(hk).size === hk.length && hk.every((k) => /^[0-9]$/.test(k)), 'each digit used once at most');
ok(JSON.stringify(App.TAB_KEYS) === JSON.stringify({ 1: 'overview', 2: 'messages', 3: 'contacts', 4: 'spam', 5: 'networks', 6: 'security', 7: 'terminals', 8: 'shards', 9: 'access', 0: 'tools' }), 'the number keys are unchanged');
ok(App.TAB_KEYS_TIP.startsWith('Keys: 1 Overview · 2 Messages · 3 Contacts · 4 Spam · 5 Networks') && !App.TAB_KEYS_TIP.includes('Phone') && App.TAB_KEYS_TIP.endsWith('/ search · N new'), `the keys tooltip says what each digit opens (${App.TAB_KEYS_TIP})`);

// the controllers are built from the list (as the getter does)
const inst = {}; for (const t of all) inst[t.key] = new t.Tab({});
ok(Object.keys(inst).length === 11 && inst.phone.name === 'PhoneTab' && inst.access.name === 'AccessTab', 'one controller per tab, the right class');
ok(/for \(const g of AdminPanelApp\.TAB_GROUPS\) for \(const t of g\.tabs\) this\._tabs\[t\.key\] = new t\.Tab\(this\);/.test(src), 'the tabs getter builds from the list');
for (const n of tabClasses) ok(new RegExp(`^import \\{ ${n} \\} from`, 'm').test(src), `${n} is imported`);

// every tab has its content partial
const shell = read('templates/admin-panel/admin-panel.hbs');
for (const k of keys) ok(shell.includes(`templates/admin-panel/tab-${k}.hbs`), `tab-${k}.hbs is included`);

// view-model
const nav = App.tabNav('phone', { unreadMessages: 3, callsRinging: 2 });
const flat = nav.flatMap((g) => g.tabs);
ok(flat.filter((t) => t.active).map((t) => t.key).join() === 'phone', 'only the open tab is active');
ok(flat.find((t) => t.key === 'messages').count === 3 && !flat.find((t) => t.key === 'messages').hot, 'messages badge counts unread');
ok(flat.find((t) => t.key === 'phone').count === 2 && flat.find((t) => t.key === 'phone').hot, 'phone badge counts ringing calls, hot');
ok(App.tabNav('overview', {}).flatMap((g) => g.tabs).every((t) => t.count === 0), 'no stats, no badges');
ok(flat.find((t) => t.key === 'access').aria === 'Access points' && flat.find((t) => t.key === 'access').tip.startsWith('Access points · '), 'Access is labelled "Access", named "Access points"');
ok(flat.find((t) => t.key === 'networks').tip.endsWith('(key 5)') && !flat.find((t) => t.key === 'phone').tip.includes('(key'), 'each tooltip names its key, if it has one');

// REAL Handlebars render of the nav
let Handlebars = null;
for (const p of FOUNDRY_APP_PKGS) { try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ } }
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars — render checks did not run'); }
else {
  const a = shell.indexOf('<nav class="ncm-admin-tabs ncm-admin-tabs--grouped">');
  const b = shell.indexOf('</nav>', a) + '</nav>'.length;
  const { registerTipHelper, tipText } = await import(new URL('../../../scripts/utils/notify.js', import.meta.url).href); registerTipHelper(Handlebars);
  const html = Handlebars.compile(shell.slice(a, b))({ tabNav: nav, tabKeysTip: App.TAB_KEYS_TIP });
  const btns = [...html.matchAll(/<button class="ncm-admin-tab ?([^"]*)" data-action="switchTab" data-tab="(\w+)" data-tooltip="([^"]*)" aria-label="([^"]*)">\s*<i class="fas ([\w-]+)"><\/i><span class="ncm-admin-tab__lb">([^<]*)<\/span>(<span class="ncm-admin-tab__count([^"]*)">(\d+)<\/span>)?/g)];
  ok(btns.map((m) => m[2]).join() === keys.join(), `every tab renders a button, in order (${btns.length})`);
  ok(btns.filter((m) => m[1].includes('ncm-admin-tab--active')).map((m) => m[2]).join() === 'phone', 'the active class lands on the open tab');
  ok(btns.find((m) => m[2] === 'phone')?.[8] === ' ncm-admin-tab__count--hot' && btns.find((m) => m[2] === 'messages')?.[9] === '3', 'badges render (hot on phone)');
  const groups = [...html.matchAll(/data-tab-group="(\w+)">\s*<span class="ncm-admin-tabgrp__cap">([^<]*)<\/span>/g)].map((m) => `${m[1]}:${m[2]}`);
  ok(groups.join() === 'home:&nbsp;,comms:Comms,net:Net,world:World,tools:&nbsp;', `the five groups and their captions (${groups.join()})`);
  ok(html.includes(`data-tooltip="${Handlebars.escapeExpression(tipText(App.TAB_KEYS_TIP))}"`) || html.includes(`data-tooltip="${Handlebars.escapeExpression(Handlebars.escapeExpression(App.TAB_KEYS_TIP))}"`), 'the keys tooltip is the derived one, through ncm-tip');
}

console.log(`test-admin-tabs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
