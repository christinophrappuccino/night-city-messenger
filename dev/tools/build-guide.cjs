#!/usr/bin/env node
/**
 * build-guide.cjs — the two guides, markdown → dev/guide-export/<name>.html → the shipped PDF:
 *   docs/GETTING-STARTED.md → NCM-Getting-Started (the GM guide)
 *   docs/PLAYER-GUIDE.md    → NCM-Player-Guide (spoiler-free, opened from the player's inbox)
 *
 * Each markdown is the ONE source for its guide (it is what GitHub shows). This turns it into the styled print version
 * (the guide's fonts, cover, callouts and figures; styles in dev/guide-export/src/guide.css) and prints it with headless
 * Chrome to docs/<name>.pdf (the copy that ships in the zip) and dev/guide-export/<name>.pdf.
 *
 * Figures: an HTML comment in the markdown, invisible on GitHub —
 *     <!-- fig: overview.png | the caption | 92 -->      (file in dev/guide-export/img/, optional width in %)
 * A paragraph that starts with "Tip:" becomes a tip box. "Three rules to remember" becomes rule cards.
 * Pages flow (no fixed-height boxes that clip); every Part starts on a new page.
 *
 *   node dev/tools/build-guide.cjs            build HTML + PDF
 *   node dev/tools/build-guide.cjs --html     HTML only
 *   NCM_CHROME=<path to chrome>               if Chrome is not in the usual place
 *
 * A dev authoring tool, never run by Foundry (like gen-macros.cjs).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'dev', 'guide-export');
const CSS = fs.readFileSync(path.join(OUT_DIR, 'src', 'guide.css'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'module.json'), 'utf8')).version;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Inline markdown: `code`, **bold**, *italic*, [text](link) (an in-page #link keeps only its text). */
function inline(s) {
  const codes = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) => (href.startsWith('#') ? txt : `<a href="${href}">${txt}</a>`));
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

function buildGuide({ source, name, htmlTitle, coverSub, tocWho, partBreaks }) {
const MD = path.join(ROOT, 'docs', source);
const HTML = path.join(OUT_DIR, `${name}.html`);
const PDF_SHIP = path.join(ROOT, 'docs', `${name}.pdf`);
const PDF_DEV = path.join(OUT_DIR, `${name}.pdf`);
const src = fs.readFileSync(MD, 'utf8').replace(/\r\n/g, '\n');
const lines = src.split('\n');

// ── parse into blocks ──
const blocks = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!l.trim() || /^---+$/.test(l.trim())) continue;
  let m;
  if ((m = l.match(/^<!--\s*fig:\s*([^|]+?)\s*\|\s*(.+?)\s*(?:\|\s*(\d+)\s*)?-->$/))) { blocks.push({ t: 'fig', file: m[1], cap: m[2], w: m[3] ? +m[3] : 100 }); continue; }
  if (l.startsWith('<!--')) continue;
  if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { blocks.push({ t: 'h' + m[1].length, text: m[2] }); continue; }
  if (l.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
    i--;
    const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    blocks.push({ t: 'table', head: cells(rows[0]), rows: rows.slice(2).map(cells) });
    continue;
  }
  if (/^(\s*)([-*]|\d+\.)\s+/.test(l)) {
    const ordered = /^\s*\d+\./.test(l);
    const items = [];
    while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
      let item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i + 1])) { i++; item += ' ' + lines[i].trim(); }
      items.push(item); i++;
    }
    i--;
    blocks.push({ t: ordered ? 'ol' : 'ul', items });
    continue;
  }
  let para = l;
  while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\||<!--|---|\s*([-*]|\d+\.)\s)/.test(lines[i + 1])) { i++; para += ' ' + lines[i].trim(); }
  blocks.push({ t: 'p', text: para });
}

// ── render ──
const title = blocks.find((b) => b.t === 'h1')?.text || 'Getting Started';
const h2s = blocks.filter((b) => b.t === 'h2' && b.text !== 'Contents').map((b) => b.text);
const partNo = (t) => (t.match(/^Part (\d+)/) || [])[1];
const partLabel = (t) => t.replace(/^Part \d+\s+—\s+/, '');
const who = (t) => (/Players: your Agent/.test(t) ? 'Players' : /Three rules|What is this|first sessions|video/.test(t) ? 'Everyone' : 'GM');

let body = '';
let section = '';
let first = true;
let inRules = false;
const figs = [];
for (const b of blocks) {
  if (b.t === 'h1') continue;
  if (b.t === 'h2') {
    inRules = b.text === 'Three rules to remember';
    if (b.text === 'Contents') {
      section = 'toc';
      body += `<h3>Contents</h3><div class="toc">${h2s.filter((h) => h !== 'What is this module?').map((h, i) => `<div class="toc-item"><span class="no">${String(i + 1).padStart(2, '0')}</span><span class="lbl">${esc(partLabel(h))}</span>${tocWho ? `<span class="who">${who(h)}</span>` : ''}</div>`).join('')}</div>`;
      continue;
    }
    section = '';
    const n = partNo(b.text);
    const kicker = n ? `// PART ${n.padStart(2, '0')}` : b.text === 'What is this module?' ? '// START HERE' : '// REFERENCE';
    body += `<h2 class="${first || !partBreaks ? '' : 'brk'}"><span class="num">${kicker}</span>${esc(n ? partLabel(b.text) : b.text)}</h2><div class="h2rule"></div>`;
    first = false;
    continue;
  }
  if (section === 'toc') continue;   // the markdown's own contents list
  if (b.t === 'h3') { body += `<h3>${inline(b.text)}</h3>`; continue; }
  if (b.t === 'fig') {
    if (!fs.existsSync(path.join(OUT_DIR, 'img', b.file))) throw new Error(`figure missing: dev/guide-export/img/${b.file}`);
    figs.push(b.file);
    body += `<figure style="width:${b.w}%;margin-left:auto;margin-right:auto"><div class="shot"><img src="img/${b.file}" alt=""></div><figcaption>${inline(b.cap)}</figcaption></figure>`;
    continue;
  }
  if (b.t === 'table') {
    body += `<table><thead><tr>${b.head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    continue;
  }
  if (b.t === 'ol' && inRules) {
    body += b.items.map((it, i) => {
      const m = it.match(/^\*\*(.+?)\*\*\s*(.*)$/);
      return `<div class="rule-card"><span class="n">${i + 1}</span><h4>${inline(m ? m[1] : it)}</h4><p>${inline(m ? m[2] : '')}</p></div>`;
    }).join('');
    continue;
  }
  if (b.t === 'ul' || b.t === 'ol') { body += `<${b.t}>${b.items.map((x) => `<li>${inline(x)}</li>`).join('')}</${b.t}>`; continue; }
  if (b.t === 'p') {
    const tip = b.text.match(/^(?:\*\*)?Tip:(?:\*\*)?\s*(.*)$/);
    if (tip) { body += `<div class="tip"><span class="k">Tip</span>${inline(tip[1])}</div>`; continue; }
    body += `<p>${inline(b.text)}</p>`;
  }
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Night City Messenger — ${esc(htmlTitle)}</title>
<!-- GENERATED by dev/tools/build-guide.cjs from docs/${source} — edit the markdown, not this file. -->
<style>
${CSS}
  /* ── flowing pages (build-guide.cjs): the cover is a page of its own, everything else flows ── */
  @page { size: A4; margin: 15mm 16mm 16mm; }
  @page cover { margin: 0; }
  .cover { page: cover; width: 210mm; height: 297mm; page-break-after: always; }
  main { font-size: 12pt; }
  h2.brk { break-before: page; }
  main h2:not(.brk) { margin-top: 10mm; }
  @media screen { main { max-width: 178mm; margin: 0 auto; padding: 12mm 0; } }
  h2, h3 { break-after: avoid; }
  figure, .tip, .warn, .rule-card, tr, li { break-inside: avoid; }
  table { break-inside: auto; }
  thead { display: table-header-group; }
  a { color: var(--cyan); text-decoration: none; }
  figcaption { font-size: 8.5pt; }
</style>
</head>
<body>
<section class="page cover">
  <div class="cover-kicker">// A module for Foundry VTT + Cyberpunk RED</div>
  <h1>NIGHT CITY<br><span class="accent">MESSENGER</span></h1>
  <div class="cover-sub">${esc(coverSub)}</div>
  <div class="cover-shot"><img src="img/access-granted.png" alt=""></div>
  <div class="cover-foot">
    <div>v${esc(version)}</div>
    <div class="r">github.com/christinophrappuccino/night-city-messenger</div>
  </div>
</section>
<main>
${body}
</main>
</body>
</html>
`;
fs.writeFileSync(HTML, html);
console.log(`HTML: ${path.relative(ROOT, HTML)} — ${h2s.length} sections, ${figs.length} figures`);

if (process.argv.includes('--html')) return;
const chrome = process.env.NCM_CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
if (!chrome) { console.error('Chrome not found — set NCM_CHROME, or open the HTML and print it to PDF.'); process.exit(1); }
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-pdf-header-footer',
  '--virtual-time-budget=10000', `--print-to-pdf=${PDF_SHIP}`, 'file:///' + HTML.replace(/\\/g, '/')], { stdio: 'ignore' });
fs.copyFileSync(PDF_SHIP, PDF_DEV);
console.log(`PDF:  ${path.relative(ROOT, PDF_SHIP)} (${Math.round(fs.statSync(PDF_SHIP).size / 1024)} KB) + dev copy`);
}

buildGuide({ source: 'GETTING-STARTED.md', name: 'NCM-Getting-Started', htmlTitle: 'Getting Started', coverSub: 'Getting Started Guide — for GMs', tocWho: true, partBreaks: true });
buildGuide({ source: 'PLAYER-GUIDE.md', name: 'NCM-Player-Guide', htmlTitle: 'Player Guide', coverSub: 'Player Guide', tocWho: false, partBreaks: false });
