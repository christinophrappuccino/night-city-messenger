/**
 * What every button in a themed GM window looks like WHILE HOVERED.
 * @file tools/sims/cdp-button-hover.mjs
 * @description Foundry core ships `button:hover { background: var(--button-hover-background-color);
 *   color: var(--button-hover-text-color) }`. Any NCM button whose own rule does not
 *   re-assert both on `:hover` inherits core's — which on a pale admin preset is
 *   near-white text on a near-white fill. Reasoning about @layer ordering is how you
 *   get this wrong; this forces the real pseudo-state through CDP and MEASURES it.
 *
 *   Usage (the mockup server must be running — node tools/serve-mockups.cjs):
 *     node tools/sims/cdp-button-hover.mjs "<url>"
 *
 *   Reports every button whose hovered text/background contrast falls under 3:1.
 */

import { spawn } from 'node:child_process';

const PORT = 9223;
const URL_ = process.argv[2]
  || 'http://127.0.0.1:8123/docs/mockups/encoder-config-probe.html?tab=who&gated=1&t=clean-light';
/** Which buttons to measure (default: every one on the page). */
const SEL = process.argv[3] || 'button';
/** Match the debuggable page by the probe file name in the URL. */
const PAGE = (URL_.split('/').pop() || '').split('?')[0];
const CHROME = process.env.CHROME
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-btn-profile',
  URL_,
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

async function main() {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.url.includes(PAGE));
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('No debuggable page — is the mockup server running?');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };

  await send('Runtime.enable');
  await send('DOM.enable');
  await send('CSS.enable');
  await sleep(900);

  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;

  const { root } = await send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: SEL });

  console.log(`\n${URL_}\n${nodeIds.length} buttons\n`);

  const lum = (c) => {
    const m = String(c).match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    const [r, g, b] = m.map(Number).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); if (x === null || y === null) return null; const [hi, lo] = x > y ? [x, y] : [y, x]; return (hi + 0.05) / (lo + 0.05); };

  let bad = 0;
  for (const nodeId of nodeIds) {
    // Tag the node so we can read it back by selector, then force :hover on it.
    await evalJs('void 0');
    await send('DOM.setAttributeValue', { nodeId, name: 'data-probe-btn', value: 'x' });
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    // Composite the real stack: a button's own fill is usually a TRANSLUCENT tint,
    // and comparing text against that raw value reports nonsense (a 10%-alpha tint
    // over white scored 1.29:1 while the button was perfectly legible). Collect
    // every background from the element up to the first opaque one, then paint them
    // back-to-front on a 1×1 canvas and read the pixel — the browser does the
    // compositing and the colour-space conversion, so oklab()/color(srgb) just work.
    const info = await evalJs(`(() => {
      const el = document.querySelector('[data-probe-btn]');
      const cs = getComputedStyle(el);
      const stack = [];
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const bg = getComputedStyle(e).backgroundColor;
        if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
        stack.unshift(bg);
        if (!/\\/\\s*0?\\.\\d|,\\s*0?\\.\\d+\\s*\\)/.test(bg)) break;   // opaque — stop
      }
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1, 1);            // the page under it all
      for (const bg of stack) { ctx.fillStyle = bg; ctx.fillRect(0, 0, 1, 1); }
      const px = ctx.getImageData(0, 0, 1, 1).data;
      const flat = 'rgb(' + px[0] + ', ' + px[1] + ', ' + px[2] + ')';
      // The text colour may itself be translucent; composite it over that ground.
      ctx.fillStyle = cs.color; ctx.fillRect(0, 0, 1, 1);
      const tp = ctx.getImageData(0, 0, 1, 1).data;
      return JSON.stringify({
        cls: el.className || el.tagName, txt: (el.textContent||'').trim().slice(0,22),
        color: 'rgb(' + tp[0] + ', ' + tp[1] + ', ' + tp[2] + ')', bg: flat,
        raw: cs.backgroundColor, img: cs.backgroundImage,
      });
    })()`);
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    await send('DOM.removeAttribute', { nodeId, name: 'data-probe-btn' });

    const d = JSON.parse(info);
    const r = ratio(d.color, d.bg);
    const flag = r !== null && r < 3 ? '  ✗ UNREADABLE' : '';
    if (flag) bad++;
    console.log(`  ${flag ? '✗' : '·'} ${String(d.txt || d.cls).padEnd(24)} ${String(d.color).padEnd(22)} on ${String(d.bg).padEnd(22)} ${r ? r.toFixed(2) + ':1' : '?'}${d.img !== 'none' ? '  +bg-image' : ''}`);
  }

  console.log(`\n${bad ? '✗' : '✓'} ${bad} button(s) unreadable while hovered\n`);
  chrome.kill();
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e.message); chrome.kill(); process.exit(2); });
