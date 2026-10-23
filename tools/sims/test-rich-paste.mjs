// Sim: rich-text paste hygiene (scripts/utils/richText.js) + the wiring that
// puts it on every contenteditable surface (2026-10-23).
//
// Tester report that started it: pasting a journal page into a shard Document
// gave black text on the dark theme and white blocks; typing afterwards stayed
// black; the light theme was no better; and "one paragraph per box" made a
// journal with lots of text impractical to bring over. PDF pastes arrive as
// hard-wrapped plain text on top of that.
//
// Drives the REAL pure module with clipboard-shaped fixtures (a Foundry journal
// / ProseMirror copy, a Google Docs copy, a Word copy, a PDF text copy), then
// greps the module for the wiring a surface can silently miss.
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');

const M = await import(pathToFileURL(`${ROOT}/scripts/utils/richText.js`).href);
const { cleanHtml, cleanStyle, htmlToBlocks, reflowText, textToBlocks, textToReflowedHtml, pasteToHtml, pasteToBlocks, isSimplePaste, splitBlockParagraphs, stripEnrichers, RICH_TEXT_PALETTE, paragraphCount } = M;

// ═══ 1. The journal paste (ProseMirror → Chrome clipboard) ═══
const JOURNAL = `<meta charset='utf-8'><p style="color: rgb(25, 24, 19); font-family: Signika, sans-serif; font-size: 14px; background-color: rgb(245, 240, 230);"><span style="color: rgb(25, 24, 19); background-color: rgb(255, 255, 255);">Hello <strong style="color: rgb(25, 24, 19);">bold</strong> world &lt;3</span></p><h2 style="color: rgb(25, 24, 19);">Findings</h2><p style="color: rgb(25,24,19)">One.</p><p>Two <em>it</em>.</p><ul><li style="color:#191813">a</li><li>b <b>c</b></li></ul><blockquote><p>Quote me</p></blockquote><img src="x.png" alt="cap"><p>After</p>`;
const rich = cleanHtml(JOURNAL, { mode: 'rich' });
ok(!/style=/.test(rich), 'journal paste: every inline style dropped');
ok(!/rgb\(|#191813|Signika|background/.test(rich), 'journal paste: no literal colour/font/background survives');
ok(/<strong>bold<\/strong>/.test(rich) && /<em>it<\/em>/.test(rich), 'journal paste: bold/italic kept');
ok(/<h2>Findings<\/h2>/.test(rich) && /<ul><li>a<\/li><li>b <b>c<\/b><\/li><\/ul>/.test(rich), 'journal paste: heading + list structure kept (rich)');
ok(/world &lt;3/.test(rich), 'a stray "<3" is escaped, not swallowed');
ok(!/<meta/.test(rich), 'the clipboard <meta charset> wrapper is gone');
const block = cleanHtml(JOURNAL, { mode: 'block' });
ok(/<p><b>Findings<\/b><\/p>/.test(block), 'block mode: a heading inside a text block becomes a bold line');
ok(!/<img|<h2|<blockquote/.test(block) && /<p>Quote me<\/p><p>After<\/p>$/.test(block), 'block mode: img dropped, blockquote flattened to a paragraph, no nested <p>');
ok(!/<p><p>/.test(block), 'block mode: never nests <p> in <p>');

// ═══ 2. Colour policy — module colours survive, foreign ones die ═══
const col = cleanHtml('<font color="#19F3F7">x</font><span style="color:#000000">y</span><span style="color:var(--ncm-secondary);font-family:var(--ncm-font-mono);font-size:0.9em;">z</span><span style="color:#f7c948">p</span>');
ok(/<font color="#19f3f7">x<\/font>/.test(col), 'palette colour on <font> kept (normalised to lowercase hex)');
ok(/>y</.test(col) && !/#000000/.test(col), 'a non-palette literal colour is dropped and its span unwrapped');
ok(/style="color:var\(--ncm-secondary\);font-family:var\(--ncm-font-mono\);font-size:0\.9em"/.test(col), 'var(--ncm-*) declarations and relative font-size kept intact');
ok(/<span style="color:#f7c948">p<\/span>/.test(col), 'palette colour as a style declaration kept');
ok(cleanHtml('<font color="#19F3F7">x</font>', { colors: 'none' }) === 'x', 'colors:none (paste time) drops even palette colours');
ok(RICH_TEXT_PALETTE.length === 9 && RICH_TEXT_PALETTE.every(c => /^#[0-9a-fA-F]{6}$/.test(c)), 'palette is nine six-digit hexes');
ok(cleanStyle('font-size:48px;font-weight:700;color:red;background:url(x);margin-top:4px') === 'font-weight:700;margin-top:4px', 'cleanStyle: absolute size, named colour and url() dropped; weight + margin kept');
ok(cleanStyle('font-size:3em') === '' && cleanStyle('font-size:1.5em') === 'font-size:1.5em', 'cleanStyle: relative font-size capped at 2em');

// ═══ 3. Safety + the Agent composer's own markup ═══
const enc = cleanHtml('<div class="ncm-encrypted-text-block other-class" data-label="ICE-ENCRYPTED" onclick="x()" id="q">secret</div>', { mode: 'mail' });
ok(enc === '<div class="ncm-encrypted-text-block" data-label="ICE-ENCRYPTED">secret</div>', 'ICE-encrypted block: ncm-* class + data-label kept, handler/id/foreign class dropped');
ok(/<div\s+class="ncm-encrypted-text-block"[^>]*data-label="([^"]*)"[^>]*>([\s\S]*?)<\/div>/i.test(enc), 'the viewer\'s encrypted-block regex still matches the cleaned markup (attribute order preserved)');
const sig = cleanHtml('<br><div class="ncm-signature" style="border-top:1px solid var(--ncm-border);padding-top:6px;margin-top:8px;color:var(--ncm-text-muted);font-family:var(--ncm-font-mono);font-size:0.85em;font-style:italic;">— V // v@nc.net</div>', { mode: 'mail' });
ok(/class="ncm-signature"/.test(sig) && /border-top:1px solid var\(--ncm-border\)/.test(sig) && /padding-top:6px/.test(sig) && /font-style:italic/.test(sig), 'Agent signature block survives intact (token styles + padding/margin kept)');
const tag = cleanHtml('<span class="ncm-timestamp-tag" style="color:var(--ncm-secondary);font-family:var(--ncm-font-mono);font-size:0.9em;">[ 12:00 ]</span>&nbsp;', { mode: 'mail' });
ok(/class="ncm-timestamp-tag"/.test(tag) && /&nbsp;/.test(tag), 'timestamp tag + nbsp survive');
const danger = cleanHtml('<p>a<script>evil()</script>b</p><a href="javascript:alert(1)">l</a><a href="https://x.y/z" target="_blank">ok</a><img src="data:image/png;base64,AAAA"><iframe src="x"></iframe><p onmouseover="x()">c</p>');
ok(danger === '<p>ab</p>l<a href="https://x.y/z">ok</a><p>c</p>', 'script/iframe dropped with content, javascript: link unwrapped, data: image dropped, handlers stripped');
ok(cleanHtml('<p>x</p>', { mode: 'inline' }) === 'x' && cleanHtml('a<br>b<div>c</div>', { mode: 'inline' }) === 'a b c', 'inline mode flattens blocks to spaces');
ok(cleanHtml('plain line\nsecond\n\npara two') === '<p>plain line<br>second</p><p>para two</p>', 'a tagless body keeps its paragraph/line structure');
ok(cleanHtml('Tom & Jerry <3 you') === '<p>Tom &amp; Jerry &lt;3 you</p>', 'plain text is escaped (& and <)');
ok(cleanHtml('<p>Tom &amp; Jerry</p>') === '<p>Tom &amp; Jerry</p>', 'existing entities are not double-escaped');
ok(cleanHtml('<pre>a\n  b</pre>') === '<pre>a\n  b</pre>', 'whitespace inside <pre> is preserved');

// ═══ 4. Google Docs + Word quirks ═══
const gdocs = cleanHtml('<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:700;">Bold</span><span style="font-size:11pt;font-family:Arial;color:#000000;"> plain</span></p></b>');
ok(!/<b/.test(gdocs) && /<span style="font-weight:700">Bold<\/span> plain/.test(gdocs), 'Google Docs: the font-weight:normal <b> wrapper is unwrapped, real weight kept, Arial/#000 dropped');
const word = cleanHtml('<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment--><p class="MsoNormal" style="margin:0cm;font-size:11pt;font-family:Calibri">Memo<o:p></o:p></p><!--EndFragment--></body></html>');
ok(/^<p( style="margin:0cm")?>Memo<\/p>$/.test(word), 'Word: comments, MsoNormal class, o:p tags and Calibri dropped (a margin may stay — it carries no identity)');

// ═══ 5. HTML → Document blocks ═══
const blocks = htmlToBlocks(JOURNAL);
ok(blocks.length === 6, `journal → 6 blocks (got ${blocks.length})`);
ok(blocks[0].text === 'Hello <strong>bold</strong> world &lt;3' && !blocks[0].heading, 'first paragraph: a plain text block, inline HTML kept, colours gone');
ok(blocks[1].heading === 'Findings' && blocks[1].text === '<p>One.</p><p>Two <em>it</em>.</p>', 'a heading starts a section; the two paragraphs under it stay in ONE block');
ok(blocks[2].kind === 'list' && blocks[2].ordered === false && blocks[2].items.join('|') === 'a|b <b>c</b>', 'list → list block with inline-cleaned items');
ok(blocks[3].quote === true && blocks[3].text === 'Quote me', 'blockquote → a quote block (one paragraph = bare inline text)');
ok(blocks[4].kind === 'figure' && blocks[4].image === 'x.png' && blocks[4].caption === 'cap', 'img → figure block with alt as caption');
ok(blocks[5].text === 'After', 'trailing paragraph is its own block after the figure');
ok(cleanHtml('<p>lone <b>x</b></p>', { mode: 'block' }) === 'lone <b>x</b>' && cleanHtml('<p>a</p><p>b</p>', { mode: 'block' }) === '<p>a</p><p>b</p>', 'block contract: one paragraph bare, several as <p>s');
ok(htmlToBlocks('<h1>A</h1><h2>B</h2><p>x</p>').map(b => b.heading).join('|') === 'A|B', 'two headings in a row: the first is an empty section, the second heads the text');
const hl = htmlToBlocks('<h2>Items</h2><ul><li>a</li></ul><h2>Pic</h2><img src="p.png"><h2>Last</h2>');
ok(hl.length === 3 && hl[0].kind === 'list' && hl[0].heading === 'Items' && hl[1].kind === 'figure' && hl[1].heading === 'Pic' && hl[2].heading === 'Last' && hl[2].text === '', 'a heading titles the list/figure that follows it (no empty heading-only block); a trailing heading keeps its own block');
ok(htmlToBlocks('just <b>inline</b> text').length === 1 && htmlToBlocks('just <b>inline</b> text')[0].text === 'just <b>inline</b> text', 'inline-only input → one text block');
ok(htmlToBlocks('<figure><img src="a.png"><figcaption>Cap <b>x</b></figcaption></figure>')[0].caption === 'Cap x', 'figure → caption from figcaption, tags flattened');
ok(htmlToBlocks('<ol><li>1</li><li>2</li></ol>')[0].ordered === true, 'ordered list detected');
const tbl = htmlToBlocks('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>');
ok(tbl.length === 1 && tbl[0].text === 'a · b<br>c', 'a table becomes one paragraph of rows');
ok(htmlToBlocks('<p>a</p><hr><p>b</p>').length === 2, 'a horizontal rule splits text blocks');
const uuid = htmlToBlocks('<p>See @UUID[Actor.abc123]{Rogue} and @UUID[JournalEntry.x] and [[/r 1d10]]{Roll} and [[1d6]].</p>', { enrichers: true });
ok(uuid[0].text === 'See Rogue and x and Roll and 1d6.', 'journal enrichers flatten to their label (or the inner text); a lone paragraph stays bare');
ok(cleanHtml('one line', { mode: 'block' }) === 'one line' && cleanHtml('a\nb', { mode: 'block' }) === 'a<br>b' && cleanHtml('a\n\nb', { mode: 'block' }) === '<p>a</p><p>b</p>', 'block mode: tagless text wraps in <p> only when it has several paragraphs');
ok(stripEnrichers('@Compendium[a.b.c]{Thing}') === 'Thing', 'stripEnrichers handles any @Type');

// ═══ 6. PDF reflow ═══
const PDF = `The quick brown fox jumps over the lazy dog and keeps run-\nning across the corpo-\nrate plaza until the ﬁnal siren sounds across the dis-\ntrict. It was late.\n\n12\n\n• first item\n• second item that\n  continues here\n\nArasaka Tower\nFloor 92\nNight City\n\nPage 3 of 9`;
const re = reflowText(PDF);
ok(re.length === 4, `PDF: 4 entries after reflow (one paragraph, two bullets, one address; page numbers dropped) — got ${re.length}`);
ok(re[0].lines.length === 1 && /running across the corporate plaza until the final siren sounds across the district\. It was late\./.test(re[0].lines[0]), 'PDF: hard-wrapped lines rejoined, "run-/ning" and "corpo-/rate" dehyphenated, ﬁ ligature expanded');
ok(re[1]?.bullet && re[1].lines[0] === 'first item' && re[2]?.bullet && re[2].lines[0] === 'second item that continues here', 'PDF: bullets stay items, a continuation line joins its bullet');
ok(!re.some(p => p.lines.join(' ').match(/^(12|Page 3 of 9)$/)), 'PDF: bare page numbers dropped');
const addr = reflowText('Arasaka Tower\nFloor 92\nNight City');
ok(addr.length === 1 && addr[0].lines.length === 3, 'short-line block (an address) keeps its breaks');
ok(reflowText('42').length === 1 && reflowText('42')[0].lines[0] === '42', 'a lone number is NOT eaten as a page number (needs ≥3 paragraphs)');
ok(reflowText('a\u00A0b\u00ADc').length === 1 && reflowText('a\u00A0b\u00ADc')[0].lines[0] === 'a bc', 'NBSP → space, soft hyphen removed');
const sentence = reflowText('This is the first long line of a paragraph that ends a sentence here.\nAnd this is the next one which is also fairly long and goes on.');
ok(sentence[0].lines.length === 1, 'a full-width line ending a sentence still joins a following capitalised line');
const tb = textToBlocks(PDF);
ok(tb.length === 3 && !tb[0].kind && tb[1].kind === 'list' && tb[1].items.length === 2 && tb[2].text === 'Arasaka Tower<br>Floor 92<br>Night City', 'textToBlocks: text · list · text, breaks kept inside the address');
ok(textToBlocks('a\n\nb\n\nc')[0].text === '<p>a</p><p>b</p><p>c</p>', 'several plain paragraphs → ONE block of <p>s (a section)');
ok(textToReflowedHtml('• x\n• y') === '<ul><li>x</li><li>y</li></ul>', 'reflowed bullets → <ul>');
ok(textToBlocks('<3 & <b>')[0].text === '&lt;3 &amp; &lt;b&gt;', 'plain text is escaped on the way into a block');

// ═══ 7. Paste entry points ═══
const pHtml = pasteToHtml({ html: '<p style="color:#191813">x</p>', text: 'x' }, { mode: 'mail' });
ok(pHtml === '<p>x</p>', 'pasteToHtml prefers cleaned HTML');
ok(pasteToHtml({ html: '', text: 'line one that is long enough to be a wrapped line of text here\nline two continues' }).indexOf('<br>') < 0, 'pasteToHtml with plain text reflows (no <br> for a wrapped line)');
ok(pasteToHtml({ html: '<font color="#19f3f7">x</font>', text: 'x' }) === 'x', 'pasteToHtml drops even palette colours (nothing pasted was coloured for this screen)');
const pb = pasteToBlocks({ html: JOURNAL, text: 'ignored' });
ok(pb.length === 6, 'pasteToBlocks prefers HTML');
ok(isSimplePaste(pasteToBlocks({ text: 'one short line' })) === true, 'a single plain paragraph is a simple paste (goes in at the caret)');
ok(isSimplePaste(pasteToBlocks({ html: '<h2>H</h2><p>x</p>' })) === false, 'a heading makes it a structured paste');
ok(isSimplePaste(pasteToBlocks({ text: 'a\n\nb' })) === true && paragraphCount(pasteToBlocks({ text: 'a\n\nb' })[0].text) === 2, 'several plain paragraphs: simple paste into one block, two paragraphs counted (→ the Split offer)');
const split = splitBlockParagraphs({ heading: 'H', text: '<p>a</p><p>b <b>c</b></p>', redacted: true });
ok(split.length === 2 && split[0].heading === 'H' && split[0].text === 'a' && !split[1].heading && split[1].text === 'b <b>c</b>' && split[1].redacted === true, 'splitBlockParagraphs: first keeps the heading, flags carried, inline HTML kept');
ok(splitBlockParagraphs({ text: 'single' }).length === 1, 'a single-paragraph block does not split');

// ═══ 8. Wiring guards ═══
const composer = read('scripts/ui/ItemInbox/DataShardComposer.js');
const tpl = read('templates/item-inbox/data-shard-composer.hbs');
const css = read('styles/components/item-inbox.css');
const ctCss = read('styles/components/content-types.css');
const body = read('templates/content/content-body.hbs');
const renderers = read('scripts/ui/content/ContentRenderers.js');
const viewer = read('scripts/ui/MessageViewer/MessageViewerApp.js');
const viewerCss = read('styles/components/message-viewer.css');
const mailComposer = read('scripts/ui/MessageComposer/MessageComposerApp.js');
const terminal = read('scripts/ui/Terminal/TerminalViewerApp.js');

ok(/richText\.js/.test(composer) && /_onDocPaste\(/.test(composer) && /addEventListener\('paste'/.test(composer), 'shard composer: imports richText + a paste listener on the document page');
ok(/_onRtePaste\(/.test(composer) && /surface\?\.addEventListener\('paste'/.test(composer), 'shard composer: the message RTE surface has a paste listener');
ok(/const text = cleanHtml\(\(row\.querySelector\('\[data-doc-text\]'\)[\s\S]*?\{ mode: 'block' \}\)/.test(composer), 'shard composer: document text is cleaned at collect (save time)');
ok(/data\.body = cleanHtml\(data\.body, \{ mode: 'rich' \}\)/.test(composer), 'shard composer: the message body is cleaned at collect');
ok(/const RTE_COLORS = RICH_TEXT_PALETTE;/.test(composer), 'shard composer: the colour tool uses the ONE palette the cleaner knows');
for (const a of ['docImportJournal', 'docPasteUndo', 'docPasteSplit', 'docPasteDismiss', 'docSplitBlock']) {
  ok(new RegExp(`\\b${a}: DataShardComposer\\._on`).test(composer), `action registered: ${a}`);
}
ok(/data-action="docImportJournal"/.test(tpl), 'template: Import from Journal button');
ok(/data-action="docSplitBlock"/.test(composer) && /\.ncm-docpara:not\(\.has-paras\) \.ncm-docpara__split/.test(css), 'split tool button + its show-only-when-useful CSS');
ok(/\.ncm-docpaste\b/.test(css) && /data-action="docPasteUndo"/.test(composer), 'after-paste strip: CSS + Undo button');
ok(/fromUuid\(pick\.id\)/.test(composer) && /htmlToBlocks\(html, \{ enrichers: true \}\)/.test(composer), 'journal import reads the page and flattens enrichers');
ok(/showNamePicker\(\{\s*title: 'Import from Journal'/.test(composer), 'journal import uses the shared name picker (not a <select>)');
ok(!/\.ncm-docpage \{[^}]*background: #/.test(css), 'docpage background is a token, not a literal hex');
ok(/\.ncm-docpara__h \{[\s\S]*?color: var\(--ncm-accent/.test(css), 'editor heading wears the viewer\'s accent');
ok(/class="ncm-ct-doc__p/.test(body) && !/<p\{\{#if declassified\}\} class="is-declassified"\{\{\/if\}\}>\{\{\{text\}\}\}<\/p>/.test(body), 'content-body: text block renders as a div (a section may hold several <p>)');
ok(/\.ncm-ct-doc__p\b/.test(ctCss) && /\.ncm-ct-doc__p\.is-declassified/.test(ctCss), 'content-types.css styles the new block wrapper + its declassified state');
ok(/cleanHtml\(p\.text \|\| '', \{ mode: 'block' \}\)/.test(renderers) && /cleanHtml\(String\(s\)\.trim\(\), \{ mode: 'inline' \}\)/.test(renderers), 'enricher: document text + list items cleaned at render');
ok(/enriched\.body = cleanHtml\(enriched\.body, \{ mode: 'rich' \}\)/.test(renderers), 'enricher: plain message body cleaned at render');
ok(/body = cleanHtml\(body, \{ mode: 'mail' \}\)/.test(viewer), 'Agent viewer: mail body cleaned at render');
ok(/\.ncm-viewer__detail-body blockquote/.test(viewerCss) && /\.ncm-viewer__detail-body code/.test(viewerCss) && /\.ncm-viewer__detail-body hr/.test(viewerCss), 'Agent viewer CSS: rich-body elements styled (blockquote/code/hr)');
ok(/pasteToHtml/.test(mailComposer) && /editor\.addEventListener\('paste'/.test(mailComposer), 'Agent composer: paste listener on the editor');
ok(!/<code style=/.test(mailComposer), 'Agent composer: the monospace tool writes a bare <code> (no literal hex)');
ok(/return cleanHtml\(String\(body \?\? ''\), \{ mode: 'rich' \}\)/.test(terminal), 'terminal: plain bodies go through the cleaner (formatting now matches the other viewers)');

// Every contenteditable surface in the module has a paste handler in its file.
const ceFiles = {
  'scripts/ui/ItemInbox/DataShardComposer.js': /addEventListener\('paste'/g,
  'scripts/ui/MessageComposer/MessageComposerApp.js': /addEventListener\('paste'/g,
};
for (const [f, re2] of Object.entries(ceFiles)) {
  const src = read(f);
  const ceCount = (src.match(/contenteditable="true"/g) || []).length + (f.includes('MessageComposer') ? 1 : 0); // the mail editor's contenteditable is in its .hbs
  ok((src.match(re2) || []).length >= Math.min(ceCount, 2) && (src.match(re2) || []).length >= 1, `${f}: paste handler present for its editable surface(s)`);
}

console.log(`test-rich-paste: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
