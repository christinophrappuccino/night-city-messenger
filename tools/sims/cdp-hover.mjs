// Drive REAL mouse events over the flicker harness via CDP (headless Chrome).
// Node 22 has global WebSocket. Usage: node cdp-hover.mjs
import { spawn } from 'child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger/docs/mockups/refine-bar-flicker-harness.html';
const PORT = 9333;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--user-data-dir=' + process.env.TEMP + '/cdp-hover-profile',
  URL,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let ws, msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  // Wait for the debugger endpoint
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find(t => t.type === 'page' && t.url.startsWith('file'));
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('No debuggable page');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };

  await send('Runtime.enable');
  await sleep(600); // let CSS settle

  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
  const rect = async (id) => evalJs(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, b: r.bottom }; })()`);
  const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const counts = () => evalJs('JSON.stringify(counts)');

  const out = [];

  // 1) Park the cursor at the sort button's BOTTOM edge and jiggle 0.2px for 1.5s
  //    (simulates a hand at rest at the worst spot). A flicker loop = enter/leave storms.
  const s = await rect('sort');
  await move(s.x + s.w / 2, s.b - 0.5);
  for (let i = 0; i < 30; i++) { await move(s.x + s.w / 2 + (i % 2 ? 0.2 : -0.2), s.b - 0.5); await sleep(50); }
  out.push('sort bottom-edge jiggle: ' + await counts());

  // 2) Same on the filters button.
  const f = await rect('filters');
  await move(f.x + f.w / 2, f.b - 0.5);
  for (let i = 0; i < 30; i++) { await move(f.x + f.w / 2 + (i % 2 ? 0.2 : -0.2), f.b - 0.5); await sleep(50); }
  out.push('filters bottom-edge jiggle: ' + await counts());

  // 3) Row left edge.
  const r1 = await rect('row1');
  await move(r1.x + 1, r1.y + r1.h / 2);
  for (let i = 0; i < 30; i++) { await move(r1.x + 1 + (i % 2 ? 0.2 : -0.2), r1.y + r1.h / 2); await sleep(50); }
  out.push('row left-edge jiggle: ' + await counts());

  // 4) Click the sort button, then travel INTO the dropdown across the 4px gap.
  await click(s.x + s.w / 2, s.y + s.h / 2);
  await sleep(150);
  const open1 = await evalJs(`!document.getElementById('sortDrop').classList.contains('ncm-hidden')`);
  for (let y = s.y + s.h / 2; y < s.b + 24; y += 1) { await move(s.x + s.w / 2, y); await sleep(15); }
  const open2 = await evalJs(`!document.getElementById('sortDrop').classList.contains('ncm-hidden')`);
  out.push(`sort dropdown: open-after-click=${open1} open-after-travel=${open2} counts=` + await counts());

  console.log(out.join('\n'));
  chrome.kill();
  process.exit(0);
}

main().catch(e => { console.error('ERR', e.message); chrome.kill(); process.exit(1); });
