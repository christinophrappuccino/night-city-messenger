// Watching another player's window: the protocol, over a scripted socket between clients.
// The real snapshot + mirror are DOM work, driven by dev/mockups/watch-probe.html.
// Run: node dev/tools/sims/test-watch.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : (fail++, console.error('FAIL:', n)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

let mode = 'player', asGM = false;
globalThis.game = {
  user: { id: 'op', name: 'Player', isGM: false }, users: { activeGM: null, get: () => null },
  settings: { get: (m, k) => (k === 'watchMode' ? mode : undefined) }, actors: { get: () => null }, nightcity: {},
  i18n: { localize: (s) => s },
};
Object.defineProperty(game.user, 'isGM', { get: () => asGM });
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'id' } };
globalThis.Hooks = { on() {}, once() {}, off() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = {};
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? ''), registerHelper() {} };

const { WatchService, MAX_PICTURE } = await imp('scripts/services/WatchService.js');
const { diffText, applyText, fitLayout } = await imp('scripts/utils/watchMirror.js');

// the edit
for (const [a, b] of [['', ''], ['', 'x'], ['x', ''], ['abc', 'abc'], ['abc', 'axc'], ['aaa', 'aaaa'], ['aaaa', 'aaa'], ['<a>1</a><b>2</b>', '<a>9</a><b>8</b>'], ['😀a', '😁a']]) {
  ok(applyText(a, diffText(a, b)) === b, `edit round-trips: "${a}" to "${b}"`);
}
ok(diffText('x'.repeat(5000) + 'a' + 'y'.repeat(5000), 'x'.repeat(5000) + 'b' + 'y'.repeat(5000))[2] === 'b', 'one changed character is one character on the wire');

// the fit never leaves a gap
for (const [w, h, aw, ah] of [[800, 500, 1600, 900], [800, 500, 1100, 400], [800, 500, 400, 900], [800, 500, 400, 250], [1100, 800, 1114, 736], [620, 430, 1900, 1000]]) {
  const f = fitLayout(w, h, aw, ah);
  ok(f.scale <= 1 && f.width * f.scale >= aw && f.height * f.scale >= ah, `fills ${aw}x${ah} from ${w}x${h}`);
  ok(f.width >= w && f.height >= h, `never lays out narrower than the operator (${aw}x${ah})`);
}
ok(fitLayout(800, 500, 1600, 900).scale === 1, 'room to spare: full size, not blown up');
ok(fitLayout(0, 0, 0, 0).scale === 1, 'nothing to measure: no crash');
ok(fitLayout(560, 900, 760, 500).scale === 1 && fitLayout(560, 900, 760, 500).height === 900, 'a tall window keeps its size and scrolls: height never shrinks the text');
ok(fitLayout(800, 500, 400, 900).scale === 0.5, 'a window too narrow does fit the width');
const big = fitLayout(800, 500, 1200, 700, 1.5);
ok(big.scale === 1.5 && big.width === 800, 'the watcher picks a size, and the layout fills what that leaves');
ok(fitLayout(800, 500, 600, 700, 2).width === 480, 'zoomed far in, the layout stops narrowing and scrolls sideways');

class App { static WATCHABLE = true; constructor(id) { this.id = id; this.item = { name: 'WS-7F' }; this.title = 'WS-7F'; this.element = { querySelector: () => null }; } }
class Other { constructor() { this.id = 'x'; } }

// A wire: what the operator sent, delivered to a watcher client on demand.
const sent = [];
const socket = { emit: (op, data) => sent.push({ op, data }) };
let snapBody = { html: '<b>one</b>' };
const op = new WatchService({ socket, snapshot: () => snapBody });
const app = new App('term');
const last = (t) => [...sent].reverse().find((s) => s.data.type === t)?.data;

// who may share
ok(op.canShare(app), 'a player can share a watchable window');
ok(!op.canShare(new Other()), 'not one that is not watchable');
asGM = true; ok(!op.canShare(app), 'a GM never shares (GM chrome, hidden accounts)'); asGM = false;
mode = 'off'; ok(!op.canShare(app), 'off is off'); mode = 'player';

// nothing happens until they choose
op.onRender(app);
ok(!sent.length && !op.shares.size, 'players-choose: nothing is offered by itself');
const rec = op.startShare(app);
ok(last('offer')?.what === 'WS-7F' && last('offer')?.shareId === rec.shareId, 'turning it on offers it, naming the machine');

// no watchers = no pictures
op._send(rec, { force: true });
ok(!last('snap'), 'nothing is sent while nobody watches');

// a watcher joins → an immediate picture, addressed to them
op.onSocket({ type: 'join', shareId: rec.shareId, userId: 'w1' }, 'w1');
ok(rec.watchers.has('w1') && last('snap')?.snap.html === '<b>one</b>' && last('snap')?.userIds.join() === 'w1', 'a joiner gets a picture at once');
const before = sent.length;
op._send(rec);
ok(sent.length === before, 'an unchanged screen sends nothing');
snapBody = { html: '<b>two</b>' };
op._send(rec);
ok(applyText('<b>one</b>', last('edit').edit) === '<b>two</b>' && last('edit').edit[2] === 'two', 'a change sends only the change');
ok(last('edit').seq === last('snap').seq + 1 && last('edit').meta === null, 'numbered, and an unchanged look is not resent');
const seqBeforeBig = rec.seq;
snapBody = { html: 'x'.repeat(MAX_PICTURE + 10) };
op._send(rec);
ok(last('tooBig')?.userIds.join() === 'w1' && rec.seq === seqBeforeBig && rec.html === '<b>two</b>', 'too big: the watcher is told, the socket is spared, the next edit measures from what they have');
snapBody = { html: '<b>three</b>' };
op._send(rec);
ok(applyText('<b>two</b>', last('edit').edit) === '<b>three</b>' && last('edit').seq === seqBeforeBig + 1, 'and it picks up afterwards');
snapBody = { html: '<b>three</b>', w: 900 };
op._send(rec);
ok(last('edit').edit === null && last('edit').meta?.w === 900, 'a look change alone sends the look');
snapBody = { html: '<b>three</b>' };
op._send(rec);

// a second watcher gets the whole picture; the first gets only the edit
snapBody = { html: '<b>four</b>' };
sent.length = 0;
op.onSocket({ type: 'join', shareId: rec.shareId, userId: 'w3' }, 'w3');
ok(last('snap')?.userIds.join() === 'w3' && last('snap')?.snap.html === '<b>four</b>', 'a second watcher gets the whole picture');
ok(last('edit')?.userIds.join() === 'w1' && last('edit').seq === last('snap').seq, 'the first gets the edit, on the same numbering');
sent.length = 0;
op.onSocket({ type: 'resync', shareId: rec.shareId, userId: 'w3' }, 'w3');
ok(last('snap')?.userIds.join() === 'w3' && last('snap')?.seq === rec.seq, 'a watcher who missed an edit can ask for the whole picture');
sent.length = 0;
op.onSocket({ type: 'resync', shareId: rec.shareId, userId: 'stranger' }, 'stranger');
ok(!sent.length, 'someone who is not watching gets nothing');
op.onSocket({ type: 'leave', shareId: rec.shareId, userId: 'w3' }, 'w3');

// pacing
snapBody = { html: 'y'.repeat(100000) };
op._send(rec);
ok(rec.nextAt - Date.now() > 300, 'a big edit slows the next one');
snapBody = { html: 'y'.repeat(99999) + 'z' };
rec.nextAt = 0;
op._send(rec);
ok(rec.nextAt - Date.now() < 400, 'a small one does not');
ok(last('edit').edit[2].length === 1, 'and costs next to nothing');
snapBody = { html: '<b>five</b>' };

// someone loading late hears what is on offer
sent.length = 0;
op.onSocket({ type: 'ask', userId: 'w2' }, 'w2');
ok(last('offer')?.to === 'w2' && last('offer')?.shareId === rec.shareId, 'a late client is told');

// a watcher drops
op.onUserGone('w1');
ok(!rec.watchers.size, 'a dropped user stops counting');

// stop
sent.length = 0;
op.stopShare(app);
ok(last('end')?.shareId === rec.shareId && !op.shares.size, 'stopping ends it for everyone');

// always
mode = 'always';
sent.length = 0;
op.onRender(app);
ok(op.shares.size === 1 && last('offer'), 'always: offered on the first render');
sent.length = 0;
op.onRender(app);
ok(!last('offer'), 'and only once');
op.stopShare(app, { closing: true });
mode = 'player';

// ─── the watcher ───
game.user.id = 'w1';
const w = new WatchService({ socket });
const win = { got: [], update(s) { this.got.push(s); }, ended() { this.over = true; }, tooBig() { this.big = true; } };
let opened = 0;
w._openWindow = () => { opened += 1; return win; };
sent.length = 0;
w.onSocket({ type: 'offer', shareId: 'op:term', userId: 'op', who: 'Rache', what: 'WS-7F' }, 'op');
ok(w.offers.size === 1, 'an offer is remembered');
w.onSocket({ type: 'offer', shareId: 'mine', userId: 'w1', who: 'me', what: 'x' }, 'w1');
ok(w.offers.size === 1, 'my own offer does not come back to me');
w.onSocket({ type: 'offer', shareId: 'other', userId: 'op', who: 'x', what: 'y', to: 'someone-else' }, 'op');
ok(w.offers.size === 1, 'an offer addressed to someone else is not mine');
w.watch('op:term');
ok(opened === 1 && last('join')?.shareId === 'op:term' && last('join')?.userId === 'w1', 'Watch opens the copy and joins');
w.watch('op:term');
ok(opened === 1, 'a second click does not open a second copy');
w.onSocket({ type: 'snap', shareId: 'op:term', userIds: ['w1'], seq: 5, snap: { html: 'a', w: 800 } }, 'op');
ok(win.got.length === 1, 'my picture lands');
w.onSocket({ type: 'snap', shareId: 'op:term', userIds: ['w9'], seq: 5, snap: { html: 'b' } }, 'op');
ok(win.got.length === 1, 'someone else\'s does not');
w.onSocket({ type: 'edit', shareId: 'op:term', userIds: ['w1'], seq: 6, edit: [1, 0, 'b'], meta: null }, 'op');
ok(win.got[1]?.html === 'ab' && win.got[1]?.w === 800, 'an edit updates the picture and keeps the look');
w.onSocket({ type: 'edit', shareId: 'op:term', userIds: ['w1'], seq: 7, edit: null, meta: { w: 900 } }, 'op');
ok(win.got[2]?.html === 'ab' && win.got[2]?.w === 900, 'a look change keeps the picture');
w.onSocket({ type: 'edit', shareId: 'op:term', userIds: ['w1'], seq: 7, edit: [0, 2, 'old'], meta: null }, 'op');
ok(win.got.length === 3, 'a stale edit is ignored');
w.onSocket({ type: 'snap', shareId: 'op:term', userIds: ['w1'], seq: 6, snap: { html: 'stale' } }, 'op');
ok(win.got.length === 3, 'so is a stale whole picture');
sent.length = 0;
w.onSocket({ type: 'edit', shareId: 'op:term', userIds: ['w1'], seq: 9, edit: [0, 2, 'skip'], meta: null }, 'op');
ok(win.got.length === 3 && last('resync')?.userId === 'w1', 'a gap is never applied: it asks for the whole picture');
sent.length = 0;
w.onSocket({ type: 'edit', shareId: 'op:term', userIds: ['w1'], seq: 10, edit: [0, 2, 'skip'], meta: null }, 'op');
ok(!last('resync'), 'and does not ask again for every edit until the answer comes');
w.onSocket({ type: 'snap', shareId: 'op:term', userIds: ['w1'], seq: 10, snap: { html: 'whole', w: 900 } }, 'op');
ok(win.got[3]?.html === 'whole', 'the whole picture puts it right');
w.onSocket({ type: 'tooBig', shareId: 'op:term', userIds: ['w1'] }, 'op');
ok(win.big, 'too big is said');
w.onSocket({ type: 'end', shareId: 'op:term' }, 'op');
ok(win.over && !w.watching.size && !w.offers.size, 'the operator stopping ends the copy');
w.onSocket({ type: 'offer', shareId: 'op:o2', userId: 'op', who: 'R', what: 'S' }, 'op');
w.dismiss('op:o2');
ok(w.offers.get('op:o2').dismissed, 'dismiss sticks');
w.onSocket({ type: 'offer', shareId: 'op:o2', userId: 'op', who: 'R', what: 'S' }, 'op');
ok(w.offers.get('op:o2').dismissed, 'and survives a repeat offer');
w.onUserGone('op');
ok(!w.offers.size, 'an operator dropping withdraws their offers');
game.user.id = 'op';

// ─── wiring ───
for (const f of ['scripts/ui/Terminal/TerminalViewerApp.js', 'scripts/ui/ItemInbox/ItemInboxApp.js', 'scripts/ui/NetworkNodes/NodeConsoleApp.js']) {
  ok(read(f).includes('static WATCHABLE = true'), `${f.split('/').pop()} is watchable`);
}
const reg = read('scripts/init/registerWatchSystem.js');
ok(read('scripts/main.js').includes('registerWatchSystem(initializer)'), 'registered');
ok(reg.includes('SOCKET_OPS.WATCH') && reg.includes("'renderApplicationV2'") && reg.includes("'closeApplicationV2'") && reg.includes('service.hello()'), 'hooks + hello');
const C = read('scripts/utils/constants.js');
ok(C.includes("WATCH: 'watch:event'") && C.includes('WATCH_WINDOW:'), 'socket op + template constant');
ok(fs.existsSync(`${ROOT}/templates/watch/watch-window.hbs`), 'template exists');
ok(read('styles/night-city-messenger.css').includes('components/watch.css'), 'stylesheet imported');
const sm = read('scripts/core/SettingsManager.js');
ok(/'watchMode'[\s\S]{0,500}default: 'player'/.test(sm), 'setting: players choose by default');
const mirror = read('scripts/utils/watchMirror.js');
ok(mirror.includes("SECRET_TYPES = new Set(['password', 'hidden', 'file'])") && mirror.includes('ncmSetMasked'), 'secret fields leave their values behind');
ok(/n\.removeAttribute\('id'\)/.test(mirror), 'ids are stripped: a copy must not collide with a window the watcher has open');
ok(mirror.includes("name.startsWith('on')") && mirror.includes('javascript:') && /MIRROR_DROP = new Set\(\['script', 'style', 'link'/.test(mirror), 'scripts and handlers cannot travel');
const css = read('styles/components/watch.css');
ok(/\.ncm-watch__mirror \{[\s\S]*?position: absolute !important/.test(css), 'the copy is pinned back from .ncm-app\'s position: fixed');
ok(css.includes('.ncm-app.ncm-watch-window > .window-content'), 'the watch window\'s content rule stops at its own content');
ok(!/transition: none|animation-duration/.test(css), 'the copy runs the operator\'s animations');
ok(/\.ncm-watch__mirror \* \{[^}]*pointer-events: none !important/.test(css), 'nothing in the copy can be clicked');
const svc = read('scripts/services/WatchService.js');
ok(["'scroll', 'input', 'change'"].every((s) => svc.includes(s)), 'scrolling and typing are heard');
ok(!mirror.includes('stage.replaceChildren'), 'a picture updates the copy in place');
ok(mirror.includes("setProperty('zoom'") && !mirror.includes("setProperty('transform'"), 'the copy scales with zoom, which keeps text sharp');
const tpl = read('templates/watch/watch-window.hbs');
const winJs = read('scripts/ui/Watch/WatchWindowApp.js');
ok(['out', 'fit', 'in'].every((z) => tpl.includes(`data-watch-zoom="${z}"`)) && winJs.includes('_setZoom(pick)'), 'the watcher has text size buttons');
ok(/localStorage\.getItem[\s\S]*catch/.test(winJs), 'the size is remembered, and storage failing is harmless');
ok(/\.ncm-watch__fit \{[^}]*overflow: auto/.test(css), 'the watch area scrolls');
ok(mirror.includes(':scope > [data-watch-overlay]') && read('scripts/ui/NetworkNodes/NodeConsoleApp.js').includes("el.setAttribute('data-watch-overlay', '')"), 'the node console\'s flash reaches watchers');

console.log(`test-watch: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
