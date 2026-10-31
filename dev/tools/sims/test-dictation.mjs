// Sim: calls phase 5 — Dictate. The REAL dictation module driven by a fake SpeechRecognition (results, the browser
// closing a session after a silence, errors), the browser checks, the line shape, and the HUD / service wiring.
//   node dev/tools/sims/test-dictation.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

const D = await imp('scripts/ui/Calls/dictation.js');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const EDGE = CHROME + ' Edg/130.0';
const SAFARI = 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0';
const ELECTRON = CHROME + ' FoundryVirtualTabletop/12.331 Electron/30.0';

// ═══ 1. Who does the listening, and where it works ═══
{
  ok(D.speechVendor(CHROME) === 'Google' && D.speechVendor(EDGE) === 'Microsoft' && D.speechVendor(SAFARI) === 'Apple', 'the notice names the company that hears the speech');
  const Fake = function () {};
  ok(D.dictateStatus({ navigator: { userAgent: CHROME }, webkitSpeechRecognition: Fake, isSecureContext: true }).ok, 'Chrome on https: it works');
  ok(/Firefox/.test(D.dictateStatus({ navigator: { userAgent: FIREFOX } }).reason), 'Firefox: says why, by name');
  ok(/Foundry app/.test(D.dictateStatus({ navigator: { userAgent: ELECTRON }, webkitSpeechRecognition: Fake }).reason), 'the Foundry desktop app: says why');
  ok(/HTTPS/.test(D.dictateStatus({ navigator: { userAgent: CHROME }, webkitSpeechRecognition: Fake, isSecureContext: false }).reason), 'an http page: the GM fix');
  ok(D.dictateError('no-speech') === null && D.dictateError('aborted') === null, 'silence is not an error worth telling');
  ok(/not allowed/.test(D.dictateError('not-allowed')) && /reached/.test(D.dictateError('network')), 'refused / offline: in words');
  ok(D.spokenLines('  meet me   at the pier ').join('|') === 'Meet me at the pier', 'a phrase: folded and capitalised');
  const long = D.spokenLines(('word ').repeat(260), 500);
  ok(long.length === 3 && long.every((l) => l.length <= 500) && !long.some((l) => l.endsWith(' ')), 'a long phrase splits at word breaks under the line cap');
  ok(D.spokenLines('   ').length === 0, 'nothing said, nothing sent');
  ok(D.dictateLang({ game: { i18n: { lang: 'en' } }, navigator: { language: 'en-GB' } }) === 'en-GB', 'the browser’s English when Foundry is English');
  ok(D.dictateLang({ game: { i18n: { lang: 'de' } }, navigator: { language: 'en-US' } }) === 'de-DE', 'Foundry’s language otherwise');
}

// ═══ 2. The mic: results, restarts, errors ═══
{
  const made = [];
  class FakeRec { constructor() { made.push(this); this.started = 0; } start() { this.started++; this.onstart?.(); } stop() { this.stopped = true; this.onend?.(); } }
  const g = { navigator: { userAgent: CHROME }, webkitSpeechRecognition: FakeRec, isSecureContext: true };
  const finals = [], interims = [], states = [];
  const d = new D.Dictation({ g, onFinal: (t) => finals.push(t), onInterim: (t) => interims.push(t), onState: (s, r) => states.push([s, r]) });
  ok(d.start() && d.listening && made.length === 1 && made[0].continuous && made[0].interimResults, 'start opens one continuous session with live words');
  const res = (items, index = 0) => ({ resultIndex: index, results: items.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) });
  made[0].onresult(res([['meet me at', false]]));
  ok(interims.at(-1) === 'meet me at' && !finals.length, 'words in progress show, nothing is sent yet');
  made[0].onresult(res([['meet me at the pier', true]]));
  ok(finals.join() === 'Meet me at the pier' && interims.at(-1) === '', 'a finished phrase is sent as a line, the in-progress text clears');
  made[0].onend();   // the browser closed the session after a silence
  ok(made.length === 2 && made[1].started === 1 && d.listening, 'a silence: it listens again on its own');
  made[1].onerror({ error: 'no-speech' });
  ok(d.listening, 'no speech is not a stop');
  made[1].onerror({ error: 'not-allowed' });
  ok(!d.listening && /not allowed/.test(states.at(-1)[1] || ''), 'refused mic: stops, with the reason');
  made[1].onend();
  ok(made.length === 2, 'a refused mic is not reopened');
  // a session that keeps dying stops after a few tries
  const d2 = new D.Dictation({ g, onState: (s, r) => states.push([s, r]) });
  d2.start();
  const n0 = made.length;
  for (let i = 0; i < 8; i++) made.at(-1).onend();   // never reaches onstart
  ok(!d2.listening && made.length - n0 <= 6 && /kept stopping/.test(states.at(-1)[1] || ''), 'a session that keeps closing gives up and says so');
  // stopping
  const d3 = new D.Dictation({ g });
  d3.start(); const rec = made.at(-1);
  d3.stop();
  ok(!d3.listening && rec.stopped, 'mute closes the mic');
  rec.onend?.();
  ok(made.at(-1) === rec, 'a muted mic is not reopened');
  // a browser that can't
  const st = [];
  const d4 = new D.Dictation({ g: { navigator: { userAgent: FIREFOX } }, onState: (s, r) => st.push(r) });
  ok(!d4.start() && /Firefox/.test(st[0]), 'no API: start refuses with the reason');
}

// ═══ 3. Lines and modes ═══
{
  const M = await imp('scripts/utils/callModel.js');
  ok(M.BUILT_MODES.includes('dictate'), 'Dictate is built');
  ok(M.makeLine({ side: 'caller', text: 'hi', via: 'dictate' }).via === 'dictate' && !('via' in M.makeLine({ side: 'caller', text: 'hi' })), 'a dictated line is marked; a typed one is not');
  ok(M.allowedModes(['loud', 'type', 'dictate'], { dictate: true }).join() === 'loud,type,dictate', 'where it works, all three');
  const P = await imp('scripts/ui/AdminPanel/tabs/phoneModel.js');
  const live = P.liveBoard([{ id: 'a', state: 'live', from: {}, to: {}, lines: [{ side: 'caller', text: 'x', via: 'dictate' }] }]);
  ok(live.modes.dictate === 1, 'the switchboard counts dictated calls');
  ok(P.settingsView({ callModes: ['loud', 'type', 'dictate'] }, { modesAvailable: ['loud', 'type', 'dictate'] }).modes.length === 3, 'the GM can switch Dictate on and off');
}

// ═══ 4. Wiring ═══
{
  const svc = read('scripts/services/CallService.js');
  ok(/get offeredModes\(\)/.test(svc) && /get dictateBlock\(\)/.test(svc) && /dictateConsent/.test(svc), 'the service: offered modes, the reason, the notice');
  ok(/sendLine\(callId, text, \{ via \} = \{\}\)/.test(svc) && /how: how === 'talk'/.test(svc), 'lines carry via; the typing indicator knows talking from typing');
  ok(read('scripts/core/SettingsManager.js').includes("'callDictateConsent'"), 'the notice answer is a client setting');
  ok(read('scripts/ui/AdminPanel/tabs/PhoneTab.js').includes("modesAvailable: ['loud', 'type', 'dictate']"), 'Admin → Phone → Settings offers Dictate');
  const hud = read('scripts/ui/Calls/CallHud.js');
  ok(/_pickMode\(/.test(hud) && /themedConfirm\(/.test(hud) && /dictateConsent/.test(hud), 'picking Dictate shows the notice once');
  ok(/is-off/.test(hud) && /dictateBlock/.test(hud), 'a chip this browser cannot use is greyed with the reason');
  ok(/_dictBar\(/.test(hud) && /_stopDict\(\)/.test(hud) && /via: 'dictate'/.test(hud), 'the bar opens the mic, sends dictated lines, closes the mic');
  ok(/if \(this\._dict && \(!talkingMe \|\| this\._dict\.callId !== call\?\.id\)\) this\._stopDict\(\)/.test(hud), 'the mic closes when the call or the mode moves on');
  ok(/is talking…/.test(hud), 'the other side sees “is talking…”');
  const css = read('styles/components/call-hud.css');
  ok(/\.ncm-ch-mode\.is-off/.test(css) && /button\.ncm-ch-mic/.test(css) && /prefers-reduced-motion[^}]*ncm-ch-mic/.test(css), 'styles: greyed chip, mic button, no pulse for reduced motion');
}

console.log(`test-dictation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
