// Click the Countermeasure visibility checkboxes with REAL mouse events (CDP, headless Chrome) over
// dev/mockups/cmv-click-harness.html and report what moved (tester 2026-11-10: "the window narrows to Countermeasure
// visibility and the box doesn't save"). Two passes: OLD re-creates the unpositioned labels (the label jumps ~500px,
// the second box can't be clicked); CURRENT is the shipped CSS (nothing moves, both boxes tick). Not part of
// run-checks (needs Chrome + a local Foundry install). Usage: node dev/tools/sims/cdp-cmv-click.mjs
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HARNESS = new URL('../../mockups/cmv-click-harness.html', import.meta.url).href;
const PORT = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--no-first-run', '--allow-file-access-from-files',
  '--user-data-dir=' + process.env.TEMP + '/cmv-click-profile', '--window-size=1000,800', HARNESS], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
try {
  let t = null;
  for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === 'page'); } catch {} }
  ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Runtime.enable'); await sleep(900);
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result.value;
  for (const old of [true, false]) {
    await ev(`document.getElementById('old').textContent = ${old} ? '.ncm-app label.ncm-cmv-check, .ncm-app label.ncm-cmv-dvtoggle { position: static !important; } .ncm-app .ncm-cmv-check input, .ncm-app .ncm-cmv-dvtoggle input { top: auto !important; left: auto !important; }' : ''; document.getElementById('inp').checked=false; document.getElementById('inp2').checked=false; document.activeElement?.blur(); ['app','wc','sc'].forEach(i=>document.getElementById(i).scrollTop=0); document.getElementById('sc').scrollTop = 760; true`);
    await sleep(200);
    for (const which of ['lbl', 'lbl2']) {
      const state = () => ev(`JSON.stringify({ wc: document.getElementById('wc').scrollTop, app: document.getElementById('app').scrollTop, sc: document.getElementById('sc').scrollTop, html: document.scrollingElement.scrollTop, lblTop: Math.round(document.getElementById('${which}').getBoundingClientRect().top), inp: (() => { const r = document.getElementById('${which === 'lbl' ? 'inp' : 'inp2'}').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })(), checked: document.getElementById('${which === 'lbl' ? 'inp' : 'inp2'}').checked })`);
      const before = await state();
      const r = await ev(`(() => { const r = document.getElementById('${which}').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 8 }; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await sleep(250);
      console.log(`${old ? 'OLD    ' : 'CURRENT'} ${which}: before ${before}\n        after  ${await state()}`);
    }
  }
} catch (e) { console.error(e); } finally { chrome.kill(); process.exit(0); }
