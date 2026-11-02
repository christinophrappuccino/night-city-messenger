// The Malware Workshop → shard → node / terminal path, end to end through the REAL model and readers.
// Tester 2026-11-01: description not saving, Custom turning into a Forgery, "carries no network program", no way to
// get a library program onto a shard. The earlier sims never saw this: the test macro hand-built its programs.
// Run: node dev/tools/sims/test-workshop-programs.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.error('FAIL:', n)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

globalThis.game = { settings: { get: () => undefined }, i18n: { localize: (s) => s } };
globalThis.foundry = {
  utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'id' },
  applications: { api: { ApplicationV2: class { constructor() {} }, HandlebarsApplicationMixin: (B) => class extends B {} } },
};
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? ''), registerHelper() {} };
globalThis.document = { addEventListener() {}, createElement: () => ({ style: {} }) };
globalThis.window = { matchMedia: () => ({ matches: false }) };

const M = await imp('scripts/ui/content/ProgramModel.js');
const roundTrip = (p) => M.entryToProgram(M.programToEntry(p));

// ═══ 1. network programs can be built ═══
const verbs = M.abilitiesFor('malware').map((a) => a.key);
for (const v of ['nodeWorm', 'nodeTap', 'nodeBomb', 'nodeSniffer', 'nodePatch']) ok(verbs.includes(v), `the Workshop offers ${v}`);
ok(!M.abilitiesFor('payload').some((a) => a.key.startsWith('node')), 'a payload does not');
const worm = { ...M.defaultProgram('malware'), progName: 'Crawler', verb: 'nodeWorm', params: { every: 2, maxNodes: 4, carry: 'tap' }, uploadDV: 11 };
const we = M.programToEntry(worm);
ok(we.contentData.uploadable && we.contentData.uploadEffect === 'nodeWorm', 'a worm is uploadable with its verb');
ok(we.contentData.uploadParams.every === 2 && we.contentData.uploadParams.maxNodes === 4 && we.contentData.uploadParams.carry === 'tap', 'its settings ride uploadParams');
ok(we.contentData.uploadDV === 11, 'its own push DV');
ok(we.contentData.deployable === false, 'it does nothing from the shard itself');
ok(!we.contentData.uploadTrigger, 'no terminal trigger');
const { nodeProgramKind } = await imp('scripts/utils/networkNodes.js');
ok(nodeProgramKind(we.contentData.uploadEffect) === 'worm', 'the node console recognises it');
const wb = roundTrip(worm);
ok(wb.verb === 'nodeWorm' && wb.params.every === 2 && wb.params.carry === 'tap' && wb.progName === 'Crawler', 'it comes back the same for editing');
ok(M.programRunsOn(worm).key === 'node' && M.programRunsOn(M.defaultProgram('malware')).key === 'terminal', 'runs on: node vs terminal');

// ═══ 2. the description ═══
const wsrc = read('scripts/ui/MalwareWorkshop/MalwareWorkshopApp.js');
ok(!wsrc.includes('data-f="__desc"'), 'the box no longer writes into params');
ok(wsrc.includes('data-act="desc"') && wsrc.includes("a === 'desc') { this.S.description = t.value"), 'it writes the description');
const d = { ...M.defaultProgram('malware'), verb: 'keylog', description: 'Dumps the corp ledger' };
ok(M.programToEntry(d).contentData.description === 'Dumps the corp ledger', 'saved on the entry');
ok(roundTrip(d).description === 'Dumps the corp ledger', 'and read back');
ok(M.normalizeProgram({ params: { __desc: 'old text' } }).description === 'old text', 'a library record from before keeps what the GM typed');
ok(!('__desc' in M.normalizeProgram({ params: { __desc: 'old text' } }).params), 'and the stray key goes');
ok(roundTrip({ ...M.defaultProgram('malware'), verb: 'keylog', description: '' }).description === '', 'the blurb fallback is not mistaken for the GM\'s text');
ok((wsrc.match(/const blurb = p\.description \|\|/g) || []).length === 2, 'library cards and shard rows show it');

// ═══ 3. Custom stays Custom ═══
const cust = { ...M.defaultProgram('malware'), progName: 'Elevator', verb: 'adjudicate', description: 'Locks the lifts', mode: 'text' };
const ce = M.programToEntry(cust);
ok(ce.contentData.uploadEffect === 'adjudicate', 'a custom routine keeps its verb');
ok(roundTrip(cust).verb === 'adjudicate', 'it does not reload as a forgery');
const macro = { ...cust, mode: 'macro', macroId: 'm1' };
ok(M.programToEntry(macro).contentData.effect.macroId === 'm1' && roundTrip(macro).mode === 'macro' && roundTrip(macro).macroId === 'm1', 'its macro is kept');
const legacy = { contentType: 'malware', contentData: { payloadType: 'program', name: 'x', description: 'y' } };
ok(M.entryToProgram(legacy).verb === 'adjudicate', 'one saved before the fix still reads as Custom');
const plant = M.programToEntry({ ...M.defaultProgram('malware'), verb: 'plant' });
ok(!plant.contentData.uploadEffect, 'a real forgery still has no verb');

// ═══ 4. settings reach the applier ═══
const back = { ...M.defaultProgram('payload'), verb: 'forgeAccount', params: { username: 'ghost', ttlHours: 6 } };
const be = M.programToEntry(back);
ok(be.contentData.effect.params.username === 'ghost', 'payload settings live where the applier reads them');
ok(roundTrip(back).params.username === 'ghost', 'and read back');
const mb = { ...M.defaultProgram('malware'), verb: 'forgeAccount', params: { username: 'ghost' } };
ok(M.programToEntry(mb).contentData.uploadParams.username === 'ghost', 'malware settings ride uploadParams');
const tv = read('scripts/ui/Terminal/TerminalViewerApp.js');
ok(tv.includes('{ ...(cd.uploadParams || {}) }'), 'a terminal upload passes them on');

// ═══ 5. the scan line ═══
const dis = { ...M.defaultProgram('malware'), disguised: true, scan: 'Personal notes' };
ok(M.programToEntry(dis).contentData.coverScan === 'Personal notes' && roundTrip(dis).scan === 'Personal notes', 'what a scan reports is saved');
ok(read('scripts/ui/content/SiphonFlow.js').includes('Scan: ${cd.coverScan}'), 'and a failed ANALYZE reads it');
ok(read('scripts/ui/content/SiphonFlow.js').includes("contentType === 'payload' || contentType === 'malware') && cd.disguised"), 'ANALYZE can expose disguised malware too');

// ═══ 6. triggers that fire ═══
const act = M.programToEntry({ ...M.defaultProgram('malware'), verb: 'keylog', trigger: 'onAction', params: { __trigAction: 'a siphon' } });
ok(act.contentData.uploadTrigger.action === 'siphon', 'a label saved by an older build becomes the real action');
const flow = read('scripts/ui/content/SiphonFlow.js');
for (const [a] of M.TRIGGER_ACTIONS) {
  if (a === 'exfil') continue;
  ok(new RegExp(`action: '${a}'`).test(flow), `"${a}" is an action the funnel really reports`);
}
const iso = '2045-08-14T08:00:00.000Z';
const date = M.programToEntry({ ...M.defaultProgram('malware'), verb: 'keylog', trigger: 'onDate', triggerDetail: iso });
ok(date.contentData.uploadTrigger.atMs === Date.parse(iso), 'a picked date becomes atMs, which the reaper reads');
ok(roundTrip({ ...M.defaultProgram('malware'), verb: 'keylog', trigger: 'onDate', triggerDetail: iso }).triggerDetail === iso, 'and reads back');
ok(wsrc.includes('CyberTimePicker.open(') && !wsrc.includes('data-f="__trigDate"'), 'dates use the CyberTimePicker');
ok(wsrc.includes("block: 'a date to fire on'") && wsrc.includes('const blocked = this._blocker()'), 'no date, no compile');

// ═══ 7. the library ═══
const L = read('scripts/ui/content/ProgramLibrary.js');
ok(L.includes('normalizeProgram(program || defaultProgram())'), 'the window state is never saved');
const stripped = M.stripProgramUi({ progName: 'x', saved: true, saving: false, lib: true, build: 1, libCat: 'all' });
ok(!('saved' in stripped) && !('lib' in stripped) && stripped.progName === 'x', 'stripProgramUi');
ok(/this\.S\.lib = false; this\.S\.saved = false; this\._mount\(\);/.test(wsrc), 'a loaded program can be compiled on the first click');
ok(wsrc.includes('data-act="libInstall"') && wsrc.includes("case 'libInstall'") && wsrc.includes('async _libInstall(id)'), 'library cards install onto a shard');
ok(/const res = await svc\.addMessage\(item, programToEntry\(rec\.program\)\);[\s\S]{0,120}res\?\.success === false/.test(wsrc), 'a full shard is reported');
ok(/_commitFailed/.test(wsrc) && (wsrc.match(/res\?\.success === false\) return this\._commitFailed/g) || []).length === 2, 'Compile & save checks the result too');
ok(wsrc.includes('this.S.saved = false; this._patch(); }'), 'an edit after a save can be saved again');

// ═══ 8. what each program does where it lands ═══
ok(tv.includes('if (isNodeVerb(uploadVerb)) continue;'), 'a network program is not on a terminal\'s upload list');
ok(tv.includes("(e.contentType === 'payload' && cd.effect?.type) ? cd.effect.type"), 'any payload runs when pushed, instead of landing as a forgery');
const nc = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
ok(nc.includes('_noProgramsMessage') && nc.includes("won't run on a node"), 'the empty message names what they carry');
ok(!nc.includes('Build one in the shard composer'), 'and no longer points at a screen that redirects away');
ok(flow.includes('export const TARGETED_VERBS') && flow.includes('pickHostFiles') && flow.includes('messageIds: targets'), 'Wipe and Corrupt pick their files when they run');
ok(flow.includes("data.kind === 'uploadRun'"), 'a player\'s push that writes is the GM\'s to apply');
ok(read('scripts/services/TerminalService.js').includes("case 'adjudicate': {"), 'a custom routine fires with the GM\'s words');
ok(read('scripts/utils/constants.js').includes("forward: { allow: true, "), 'Forward is on for new terminals');

console.log(`test-workshop-programs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
