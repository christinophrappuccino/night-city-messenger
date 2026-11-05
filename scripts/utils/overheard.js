/**
 * Overheard calls: the rules.
 * @file scripts/utils/overheard.js
 * @module night-city-messenger
 * @description Pure, no Foundry globals. Spec dev/design/PHONE-REVISION.md §12 and §17. A conversation between two NPCs that plays
 *   whether or not anyone is listening. Garble is decided before text leaves the GM's client, so a word a listener has not
 *   earned is never sent to them. Each word has a fixed threshold, so lowering the garble only ever reveals more.
 */

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The four ways in, and how clear each one is by default. */
export const OVERHEARD_WAYS = Object.freeze({
  room: { label: 'In the room', icon: 'fa-person-rays', garble: 0, tip: 'Near one side. Hears that side only, clean. No roll.' },
  tap: { label: 'A tap on a node', icon: 'fa-plug', garble: 55, tip: 'Both sides, live. Garbled by signal and by how well the tap was made.' },
  jack: { label: 'Jacked in', icon: 'fa-network-wired', garble: 30, tip: 'A node session action, Listen to traffic. A roll and a move. Both sides.' },
  scanner: { label: 'A radio scanner', icon: 'fa-tower-observation', garble: 75, tip: 'Gear. Calls on this scene with no node. Heavier garble. Both sides.' },
});

export const OVERHEARD_MARKS = Object.freeze({
  clue: ['Clue', 'is-good', 'fa-key', 'The line that matters. Only you see this mark, and the running screen counts who has heard it'],
  lie: ['Lie', 'is-bad', 'fa-wave-square', 'A listener with a voice stress analyzer sees this line flagged. Nobody else can tell'],
  code: ['Code word', 'is-secret', 'fa-user-secret', 'Listeners hear the words as written. Only you see what it really means'],
});

const items = (v, d) => (Array.isArray(v) ? v : d).map((x) => (typeof x === 'string' ? { name: x, type: '', img: '' } : { name: String(x?.name ?? ''), type: x?.type || '', img: x?.img || '' })).filter((x) => x.name);

/** The eavesdropping rules, defaults filled in. */
export function sanitizeEavesdrop(s = {}) {
  const v = s && typeof s === 'object' ? s : {};
  const num = (x, d, lo, hi) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return { room: v.room === 'scene' ? 'scene' : 'tokens', range: num(v.range, 6, 1, 60), walls: !!v.walls,
    amp: items(v.amp, ['Amplified Hearing']), scanner: items(v.scanner, ['Radio Scanner/Music Player', 'Radio Scanner']), desc: items(v.desc, ['Scrambler/Descrambler']), stress: items(v.stress, ['Voice Stress Analyzer']),
    skill: String(v.skill || 'Interface'), dv: num(v.dv, 15, 1, 40), jackDv: num(v.jackDv, 11, 1, 40), records: v.records !== false };
}

const sanitizeSide = (x = {}) => ({ contactId: x.contactId || null, name: String(x.name ?? '').slice(0, 60), sceneId: x.sceneId || '', anchor: ['token', 'spot', 'off'].includes(x.anchor) ? x.anchor : 'off', x: Number(x.x) || 0, y: Number(x.y) || 0, shows: ['name', 'number', 'anon'].includes(x.shows) ? x.shows : 'name', number: String(x.number ?? ''), voice: x.voice === 'tts' ? 'tts' : 'text' });
const rid = () => Math.random().toString(36).slice(2, 10);

/** One line, every field safe. Text is always there; voice is a layer on top. */
export const sanitizeLine = (l = {}) => ({ id: String(l.id || rid()), side: l.side === 'b' ? 'b' : 'a', text: String(l.text ?? '').slice(0, 500), voice: ['', 'text', 'tts'].includes(l.voice) ? l.voice : '', delay: Math.min(30, Math.max(0, Number(l.delay) || 0)), marks: (Array.isArray(l.marks) ? l.marks : []).filter((m) => OVERHEARD_MARKS[m]), means: String(l.means ?? '').slice(0, 300) });

/** A call as written. */
export function sanitizeScript(s = {}) {
  const v = s && typeof s === 'object' ? s : {};
  return { id: String(v.id || rid()), name: String(v.name ?? 'New call').slice(0, 60), tag: String(v.tag ?? '').slice(0, 30), a: sanitizeSide(v.a), b: sanitizeSide(v.b), net: String(v.net ?? ''), live: !!v.live, enc: !!v.enc, rec: v.rec !== false, at: v.at || '', lines: (Array.isArray(v.lines) ? v.lines : []).map(sanitizeLine) };
}

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };

/**
 * A line as a listener gets it. A word over the level is replaced before this returns: the real word is not in the output.
 * @param {string} id @param {string} text @param {number} level — 0 clear, 100 nothing
 * @returns {string} escaped HTML
 */
export function garbleLine(id, text, level) {
  if (level <= 0) return esc(text);
  return String(text).split(/(\s+)/).map((w, i) => {
    if (/^\s*$/.test(w)) return w;
    return (hash(`${id}:${i}`) % 100) < level ? `<span class="ncm-r4-gl">${'▒░▓▒░'.repeat(2).slice(0, Math.max(2, w.length))}</span>` : esc(w);
  }).join('');
}

/** How a listener hears a side at a line: the best way they have wins. null means they can't hear that side. */
export function garbleFor(listener, side, i, { enc = false, hasDesc = false } = {}) {
  const options = [];
  for (const [k, since] of Object.entries(listener.ways || {})) {
    if ((since ?? 0) > i) continue;
    if (k === 'room' && listener.side !== side) continue;
    let g = OVERHEARD_WAYS[k]?.garble ?? 100;
    if (enc && k !== 'room' && !hasDesc) g = 100;
    options.push(g);
  }
  if (!options.length) return null;
  const best = Math.min(...options);
  return Math.max(0, best - (best < 100 ? (listener.enhance || 0) : 0));
}

/**
 * Every way a character has into a call, or why they have none. The rule behind the Who could hear this panel and the prompts.
 * @param {{here: 'a'|'b'|null, dist: number, tap: ?{node: string}, jack: ?{node: string}, hasAmp: boolean, hasScanner: boolean, hasDesc: boolean}} f
 * @param {{a: {name: string}, b: {name: string}, enc: boolean}} c @param {object} rules
 * @returns {{ways: {k: string, side?: string, text: string}[], why: string[]}}
 */
export function waysFor(f, c, rules) {
  const out = [], why = [], near = f.here === 'a' ? c.a?.name : c.b?.name;
  const clearOk = !c.enc || f.hasDesc;
  if (!f.here) why.push(`Not on a scene with ${c.a?.name || 'them'} or ${c.b?.name || 'them'}`);
  else if (rules.room === 'scene') out.push({ k: 'room', side: f.here, text: `On the scene with ${near}, so one side only` });
  else {
    const range = rules.range * (f.hasAmp ? 2 : 1);
    if (f.blocked) why.push(`A wall is between them and ${near}`);
    else if (f.dist <= range + 0.5) out.push({ k: 'room', side: f.here, text: `${Math.round(f.dist)} squares from ${near}, so one side only` });
    else why.push(`${Math.round(f.dist)} squares from ${near}, and they need to be within ${range}`);
  }
  const viaNet = (k, x, text, had) => { if (!x) return; if (clearOk) out.push({ k, text }); else why.push(`${had}, but it's encrypted and they have no descrambler`); };
  viaNet('tap', f.tap, `Tap on the ${f.tap?.node}`, `Has a tap on the ${f.tap?.node}`);
  viaNet('jack', f.jack, `Jacked into the ${f.jack?.node}: a roll and a move`, `Jacked into the ${f.jack?.node}`);
  if (f.here && f.hasScanner) { if (clearOk) out.push({ k: 'scanner', text: 'Radio scanner on this scene' }); else why.push("Has a scanner, but it's encrypted and they have no descrambler"); }
  if (!f.tap && !f.jack && !(f.here && f.hasScanner)) why.push('No tap, no node session and no scanner');
  return { ways: out, why };
}

/** How many clue lines so far reached this listener. */
export function cluesHeard(listener, lines, idx) {
  const clues = lines.map((y, i) => ({ y, i })).filter(({ y, i }) => y.marks.includes('clue') && i <= idx);
  if (!lines.some((y) => y.marks.includes('clue'))) return null;
  const got = clues.filter(({ y, i }) => Object.entries(listener.ways || {}).some(([k, since]) => i >= since && (k !== 'room' || y.side === listener.side))).length;
  return { got, of: clues.length };
}

/** A garbled line with no markup, for a saved transcript. */
export const plainHeard = (html) => String(html).replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The only markup a line may carry: a garbled word. */
const GARBLE_SPAN = /<span class="ncm-r4-gl">([▒░▓]{1,40})<\/span>/g;

/**
 * A line as received over the socket, made safe to show (audit SEC-10). garbleLine's output is escaped text plus
 * `<span class="ncm-r4-gl">▒░…</span>` for each lost word; this keeps exactly that and escapes every other
 * angle bracket, so a line that did not come from garbleLine can only ever show as text.
 * @param {*} html
 * @returns {string|null} null stays null ("can't hear this side")
 */
export function safeHeardHtml(html) {
  if (html === null || html === undefined) return null;
  const keep = [];
  const marked = String(html).slice(0, 4000).replace(GARBLE_SPAN, (m, g) => { keep.push(g); return `\u0000${keep.length - 1}\u0000`; });
  return marked
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/\u0000(\d+)\u0000/g, (m, i) => `<span class="ncm-r4-gl">${keep[Number(i)]}</span>`);
}
