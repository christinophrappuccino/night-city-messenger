// Junk senders: spam decided by the SENDER, not by whose folder the mail is in.
// Drives the real pure matcher + checks the wiring in SpamService / MessageService /
// MessageRepository / MessagesTab / the template.
//   node dev/tools/sims/test-junk-senders.mjs
import { readFileSync } from 'fs';
const ROOT = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const { buildJunkMatcher, normalizeJunkEntry, sanitizeJunkList, domainOf } = await import(new URL('scripts/utils/junkSenders.js', ROOT));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };

// ── entries ──
ok(normalizeJunkEntry(' Deals@Spam.NC ') === 'deals@spam.nc', 'an address normalises to lower case');
ok(normalizeJunkEntry('*@spam.nc') === '@spam.nc' && normalizeJunkEntry('@spam.nc') === '@spam.nc', 'a domain is written @domain');
ok(normalizeJunkEntry('not an address') === '' && normalizeJunkEntry('@nodot') === '', 'junk input is refused');
ok(sanitizeJunkList(['a@b.nc', 'A@B.nc', '', '@b.nc']).join() === 'a@b.nc,@b.nc', 'the list de-dupes and drops blanks');
ok(domainOf('X@Mega.Corp') === '@mega.corp' && domainOf('nope') === '', 'domainOf');

// ── the matcher ──
const m = buildJunkMatcher({
  templates: [{ fromName: 'Biotechnica', fromEmail: 'health@biotechnica.corp' }, { fromName: '{{randomCorpo}} Careers', fromEmail: 'hiring@{{randomCorpo}}.net' }],
  list: ['scam@zpost.nc', '@cheapdeals.nc'],
});
ok(m('fixer@afterlife.nc') === null, 'an ordinary sender is not junk');
ok(m('Health@Biotechnica.corp')?.reason === 'template', 'a template sender is junk, case-insensitive');
ok(m('hiring@arasaka.net')?.reason === 'template', 'a token in a template address matches anything');
ok(m('hiring@.net') === null, 'a token must match at least one character');
ok(m('scam@zpost.nc')?.reason === 'listed' && m('scam@zpost.nc').entry === 'scam@zpost.nc', 'a listed address is junk and names its entry');
ok(m('anyone@cheapdeals.nc')?.reason === 'listed' && m('anyone@cheapdeals.nc').entry === '@cheapdeals.nc', 'a listed domain catches every address at it');
ok(m('fixer@afterlife.nc', { spamSource: 'generated' })?.reason === 'generated', 'generator mail is junk whatever its address');
ok(m('health@biotechnica.corp', null).reason === 'template' && m('scam@zpost.nc', { spamSource: 'generated' }).reason === 'generated', 'generated beats the rest');
ok(m('') === null && m(null) === null, 'no address = not junk');

// ── wiring ──
const repo = read('scripts/data/MessageRepository.js');
ok(/spamSource: messageData\.metadata\?\.spamSource/.test(repo) && /spamTemplateId: messageData\.metadata\?\.spamTemplateId/.test(repo), 'createMessage keeps the generator tag');
const ss = read('scripts/services/SpamService.js');
ok(/'spamJunkSenders'/.test(ss) && /setJunkSender\(entry, on = true\)/.test(ss) && /junkMatcher\(\)/.test(ss) && /isListedJunk\(email\)/.test(ss), 'SpamService: list setting, add/remove, matcher, listed check');
ok(/if \(!game\.user\?\.isGM\) return this\.getJunkSenders\(\);/.test(ss), 'only a GM edits the list');
const ms = read('scripts/services/MessageService.js');
const filt = ms.slice(ms.indexOf('async _shouldSpamFilter(data)'));
ok(filt.indexOf('isListedJunk') > 0 && filt.indexOf('isListedJunk') < filt.indexOf("'spamUnknownSenderEnabled'"), 'delivery: the junk list routes to Spam BEFORE the unknown-sender switch is read');
ok(/!data\.anonymous\?\.enabled && !data\.status\?\.sent && !data\.isBroadcast/.test(filt), 'anonymous, sent copies and broadcasts are never routed by the list');
const mt = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
ok(/junk: \(!anon && !isSentCopy\) \? \(junkOf\?\.\(flags\.from, flags\.metadata\)/.test(mt), 'All mail: every entry is judged by its sender');
ok(/const isJunky = \(e\) => e\.isSpam \|\| !!e\.junk/.test(mt) && /filtered = filtered\.filter\(e => !isJunky\(e\)\)/.test(mt), 'All mail: junk is hidden with spam unless the filter is picked');
ok(/case 'junkOn': case 'junkOff'/.test(mt) && /canMarkJunk:/.test(mt), 'All mail: mark / unmark junk from the reading pane');
ok(/!e\.fromPlayer/.test(mt.slice(mt.indexOf('canMarkJunk'))), "a player's own address can't be marked junk");
const tpl = read('templates/admin-panel/tab-messages.hbs');
ok(/data-op="junkOn"/.test(tpl) && /data-op="junkOff"/.test(tpl) && /ncm-msg2-note--junk/.test(tpl), 'template: the note and both switches');
ok(/\{\{#if tip\}\} data-tooltip="\{\{tip\}\}"/.test(tpl), 'flags carry the reason as a tooltip');
ok(/ncm-msg2-note--junk/.test(read('styles/components/admin-panel/tab-messages.css')), 'the note is styled');

console.log(`\ntest-junk-senders: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
