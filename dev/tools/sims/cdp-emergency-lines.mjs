// Drives the REAL Backup and Trauma Team editor in headless Chrome, with real writes on the probe's in-memory world.
// Needs the preview server: node dev/tools/serve-mockups.cjs. Then: node dev/tools/sims/cdp-emergency-lines.mjs
import { spawn } from 'child_process';
import fs from 'fs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = (process.env.TEMP || process.env.TMPDIR || '.').replace(/\\/g, '/') + '/ncm-cdp-em-';
const PORT = 9341, BASE = 'http://127.0.0.1:8123/dev/mockups/admin-phone-numbers-probe.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--force-device-scale-factor=1', '--window-size=1000,1300', '--no-first-run', '--user-data-dir=' + OUT + 'chrome-cdp', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const nav = async (q) => { await send('Page.navigate', { url: BASE + q }); for (let i = 0; i < 60; i++) { await sleep(150); try { if (await ev(`return document.title`) === 'ready') return; } catch {} } throw new Error('never ready'); };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + name + '.png', Buffer.from(r.data, 'base64')); };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const contrast = `
  const cv = document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  const rgb = (c)=>{cv.clearRect(0,0,1,1);cv.fillStyle=c;cv.fillRect(0,0,1,1);const d=cv.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]/255];};
  const lum=(c)=>{const f=c.slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4});return .2126*f[0]+.7152*f[1]+.0722*f[2]};
  const bgOf=(el)=>{const st=[];for(let e=el;e;e=e.parentElement){const b=rgb(getComputedStyle(e).backgroundColor);if(b[3]>0){st.push(b);if(b[3]>=1)break;}}let o=[0,0,0];for(const b of st.reverse())o=[0,1,2].map(i=>o[i]*(1-b[3])+b[i]*b[3]);return o;};
  const bad=[];const w=document.createTreeWalker(document.querySelector('.ncm-pn'),NodeFilter.SHOW_TEXT);
  while(w.nextNode()){const t=w.currentNode;if(!t.textContent.trim())continue;const el=t.parentElement;if(!el.closest('.ncm-emv'))continue;const s=getComputedStyle(el);if(s.visibility==='hidden'||s.display==='none')continue;const fg=rgb(s.color),bg=bgOf(el);const a=lum(fg),b=lum(bg);const r=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);if(r<4.5)bad.push(t.textContent.trim().slice(0,30)+' '+r.toFixed(2));}
  return bad;`;

async function main() {
  let list; for (let i = 0; i < 40; i++) { await sleep(150); try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (list?.length) break; } catch {} }
  ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } };
  await send('Page.enable'); await send('Runtime.enable');

  await nav('?f=backup&pop=0&h=1250');
  const click = (sel) => `const el=${sel}; if(!el) throw new Error('no element: ${sel.replace(/'/g, '')}'); el.click(); await new Promise(r=>setTimeout(r,120));`;
  const errs = async () => (await ev(`return window.__errs||[]`));
  const cfg = () => ev(`return JSON.parse(JSON.stringify(__settings.phoneEmergency))`);
  const btnByText = (t) => `[...document.querySelectorAll('.ncm-pn button')].find(b=>b.textContent.trim()==='${t}')`;

  // opening a Lawman
  await ev(click(btnByText('Customize')));
  ok(await ev(`return !!document.querySelector('.ncm-em2.is-wide .ncm-emv')`), 'Customize opens the editor, full width');
  ok(await ev(`return document.querySelectorAll('.ncm-emv textarea[data-in="emLine"]').length === 11`), 'all 11 slots show');
  ok(await ev(`const r=document.querySelector('.ncm-r3-scrollbox.is-editing'); return getComputedStyle(r).maxHeight==='none'`), 'the list does not trap the editor in a small scroller');
  const typing = (k, v) => `const b=document.querySelector('textarea[data-in="emLine"][data-k="${k}"]'); b.focus(); b.value=${JSON.stringify(v)}; b.dispatchEvent(new Event('input',{bubbles:true}));`;
  await ev(typing('ask', 'Reyes here. Shots fired, {place}.\nSend everyone to {place}.')); await ev(typing('channel', 'UNIT-7'));
  await sleep(800);
  let c = await cfg();
  ok(c.backup.people.ra?.voice?.ask?.length === 2 && c.backup.people.ra.voice.channel[0] === 'UNIT-7', 'typing in two boxes quickly saves both');
  await ev(`__draw(); await new Promise(r=>setTimeout(r,50))`);
  ok(await ev(`return document.querySelector('textarea[data-k="ask"]').closest('.ncm-emv__slot').classList.contains('is-own') && document.querySelector('.ncm-emv__change')?.textContent.includes('2 changes')`), 'the row and box say what changed');

  // a fill-in chip keeps the focus
  await ev(`const b=document.querySelector('textarea[data-k="busy"]'); b.focus(); const t=[...document.querySelectorAll('.ncm-emv__tok')].find(x=>x.dataset.t==='{org}'); t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); t.click(); await new Promise(r=>setTimeout(r,80));`);
  ok(await ev(`return document.querySelector('textarea[data-k="busy"]').value==='{org}'`), 'a fill-in goes into the box being typed in');
  await ev(typing('busy', 'Hold, {plce}.')); await sleep(700); await ev(`__draw()`);
  ok(await ev(`return !!document.querySelector('.ncm-emv__bad')?.textContent.includes('{plce}')`), 'a mistyped fill-in is flagged');
  await ev(typing('busy', '')); await sleep(700); await ev(`__draw()`);
  c = await cfg(); ok(!c.backup.people.ra.voice.busy, 'emptying a box goes back to inheriting');
  await shot('real-words');
  const badW = await ev(contrast); ok(!badW.length, 'words contrast: ' + badW.join(' | '));

  // Play reads what was just typed, with no wait
  await ev(typing('answer', 'TYPED JUST NOW'));
  await ev(click(btnByText('Play')));
  await sleep(500);
  c = await cfg(); ok(c.backup.people.ra.voice.answer?.[0] === 'TYPED JUST NOW', 'Play saves what is still waiting first');
  ok(await ev(`return !!document.querySelector('.ncm-r5-layer .ncm-em-scene')`), 'Play opens the real call');
  ok(await ev(`return document.querySelector('.ncm-em-sting')?.textContent.includes('UNIT-7')`), 'with their callsign');
  await ev(`game.nightcity.emergencyHud._stop()`);

  // their people
  await ev(click(btnByText('Their people')));
  await ev(`document.getElementById('emg-an').value='Det. Okafor'`);
  await ev(click(btnByText('Add')));
  c = await cfg(); ok(c.backup.people.ra.groups?.[0]?.name === 'Det. Okafor' && c.backup.people.ra.groups[0].r1 === 3, 'a group can be added');
  ok(await ev(`return game.nightcity.emergencyService.optionsFor(game.actors.get('ra')).some(r=>r.name==='Det. Okafor')`), 'and the player can pick it');
  await shot('real-people');
  const badP = await ev(contrast); ok(!badP.length, 'people contrast: ' + badP.join(' | '));

  // the look
  await ev(click(btnByText('How it looks')));
  await ev(click(btnByText('On')));
  c = await cfg(); ok(c.backup.people.ra.look.lights === true, 'lights can be switched');
  await ev(`const s=document.getElementById('emv-arriveSound'); s.value='em-dispatch'; s.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,120));`);
  await ev(`const s=document.getElementById('emv-color'); s.value='#ff00aa'; s.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,120));`);
  c = await cfg(); ok(c.backup.people.ra.look.arriveSound === 'em-dispatch' && c.backup.people.ra.look.color === '#ff00aa', 'sound and colour save');
  ok(await ev(`const i=game.nightcity.emergencyService.backupInfo(game.actors.get('ra')); return i.color==='#ff00aa' && i.lights===true && i.arriveSound==='em-dispatch'`), 'and reach the call');
  await shot('real-look');
  const badL = await ev(contrast); ok(!badL.length, 'look contrast: ' + badL.join(' | '));
  await ev(click(btnByText('Arrival')));
  await sleep(300);
  ok(await ev(`const a=document.querySelector('.ncm-r5-arrive'); return !!a && a.getAttribute('style')?.includes('#ff00aa') && a.textContent.includes('ON SCENE')`), 'the arrival preview wears their colour');
  await ev(`document.querySelectorAll('.ncm-r5-landing').forEach(x=>x.remove())`);

  // an organization
  await ev(click(btnByText('Close')));
  ok(await ev(`return !document.querySelector('.ncm-em2.is-wide')`), 'closing puts the two columns back');
  await ev(`const q=[...document.querySelectorAll('.ncm-pn-qh')].find(x=>x.textContent.includes('What do their calls say')); q.click(); await new Promise(r=>setTimeout(r,120));`);
  await shot('real-org');
  const badO = await ev(contrast); ok(!badO.length, 'org contrast: ' + badO.join(' | '));
  await ev(`const b=document.querySelector('textarea[data-in="emLine"][data-k="speaker"]'); b.value='Org Dispatch'; b.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(700);
  c = await cfg(); ok(Object.values(c.backup.orgs).some((o) => o.voice?.speaker?.[0] === 'Org Dispatch'), 'an organization keeps its own words');

  // Trauma Team
  await nav('?f=trauma&h=1250');
  await ev(`const q=[...document.querySelectorAll('.ncm-pn-qh')].find(x=>x.textContent.includes('What does dispatch say')); q.click(); await new Promise(r=>setTimeout(r,120));`);
  ok(await ev(`return document.querySelectorAll('textarea[data-in="emLine"]').length === 8`), 'Trauma Team shows its 8 slots');
  await ev(`const b=document.querySelector('textarea[data-in="emLine"][data-k="speaker"]'); b.value='Nurse Ito'; b.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(700);
  c = await cfg(); ok(c.trauma.voice?.speaker?.[0] === 'Nurse Ito', 'Trauma Team keeps its words');
  ok(await ev(`const i=game.nightcity.emergencyService.traumaInfo(game.actors.get('ra')); return i.voice.speaker==='Nurse Ito'`), 'and the call reads them');
  await shot('real-trauma');
  const badT = await ev(contrast); ok(!badT.length, 'trauma contrast: ' + badT.join(' | '));

  // the other presets
  for (const t of ['clean-light', 'high-contrast']) {
    await nav(`?f=backup&h=1250&t=${t}`);
    await ev(click(btnByText('Customize')));
    const b = await ev(contrast); ok(!b.length, `${t} contrast: ` + b.join(' | '));
    if (t === 'clean-light') await shot('real-light');
  }
  const e = await errs(); ok(!e.length, 'no page errors: ' + e.join(' | '));
  console.log(`drive-em: ${pass} passed, ${fail} failed`);
}
main().catch((e) => { console.log('ERROR ' + e.message); fail++; }).finally(() => { try { ws?.close(); } catch {} chrome.kill(); process.exit(fail ? 1 : 0); });
