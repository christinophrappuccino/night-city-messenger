/**
 * Rich-text hygiene for everything a person can PASTE into (2026-10-23).
 *
 * Pure — no Foundry globals, no DOM — so `tools/sims/test-rich-paste.mjs`
 * drives the real functions. Three jobs:
 *
 *   cleanHtml(html, {mode, colors})   whitelist-clean a fragment. A browser's
 *       default paste carries the SOURCE's computed styles as inline `style`
 *       attributes (a Foundry journal is near-black text on parchment, so every
 *       span arrives with `color: rgb(25,24,19)` and a white background), and a
 *       container's `color … !important` can never beat a child's own inline
 *       declaration. This is the tester's "black text on a dark shard / white
 *       blocks" report. The cleaner keeps structure + inline formatting and
 *       drops every literal colour, background, font and size.
 *   htmlToBlocks(html)                 split a pasted/imported HTML document
 *       into the Document type's block model (heading → section, lists, figures,
 *       quotes). Consecutive paragraphs stay in ONE text block — a block is a
 *       section, not a sentence (the GM can split it afterwards).
 *   reflowText(text) / textToBlocks()  the PDF case: a PDF viewer puts only
 *       plain text on the clipboard, hard-wrapped at every visual line, with
 *       hyphenation and ligature glyphs. Reflow joins lines back into
 *       paragraphs without touching deliberately short lines (addresses, verse).
 *
 * Colour policy (the one subtle rule): a colour is kept ONLY when it comes from
 * the module — a `var(--ncm-*)` token, or a hex in RICH_TEXT_PALETTE (the
 * editors' own colour tool). At PASTE time even palette colours are dropped
 * (`colors:'none'`): nothing pasted was coloured for this screen.
 */

/** The text-colour tool's swatches (shard composer RTE). Palette colours survive save/render. */
export const RICH_TEXT_PALETTE = ['#F65261', '#f7c948', '#00ff41', '#19f3f7', '#a855f7', '#ff6ac1', '#5b9bff', '#ededf2', '#7a7a92'];

const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'col', 'wbr', 'area', 'base', 'embed', 'source', 'track', 'param']);
/** Tags whose CONTENT is dropped too. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'head', 'title', 'meta', 'link', 'template', 'textarea', 'select', 'button', 'input', 'canvas', 'video', 'audio', 'form']);
const INLINE = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'a', 'code', 'sub', 'sup', 'mark', 'span', 'font', 'br'];
const BLOCKISH = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'ul', 'ol', 'li', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'address', 'center', 'details', 'summary', 'body', 'html']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const TABLE_PARTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);

/**
 * Modes:
 *  inline — a one-line value (a list item, a caption): inline tags only, blocks → a space.
 *  block  — a Document text block: inline + p/br + lists; div→p, headings→bold line,
 *           blockquote/pre→p, hr/img/tables dropped (those are their own block kinds).
 *  rich   — a message body (shard/terminal `message` entries, the Agent mail body):
 *           inline + p/div/br/headings/lists/blockquote/pre/hr/img/tables.
 *  mail   — alias of rich (kept separate so a future mail-only allowance has a home).
 */
const MODES = {
  inline: { allow: new Set(INLINE.filter(t => t !== 'br')), map: {} },
  block:  { allow: new Set([...INLINE, 'p', 'ul', 'ol', 'li']), map: { div: 'p', blockquote: 'p', pre: 'p', section: 'p', article: 'p', header: 'p', footer: 'p', main: 'p', aside: 'p', center: 'p', dd: 'p', dt: 'p', address: 'p', summary: 'p', details: 'p', figcaption: 'p', nav: 'p', figure: 'p', dl: 'p' } },
  rich:   { allow: new Set([...INLINE, 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr', 'img', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']), map: { section: 'div', article: 'div', header: 'div', footer: 'div', main: 'div', aside: 'div', center: 'div', figure: 'div', figcaption: 'div', dl: 'div', dd: 'div', dt: 'div', address: 'div', details: 'div', summary: 'div', nav: 'div' } },
};
MODES.mail = MODES.rich;

/** Inline-style properties kept regardless of value (they carry no colour or font identity). */
const KEEP_PROPS = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right']);

// ─────────────────────────────────────────────────────────────
//  Tokenizer + tolerant tree
// ─────────────────────────────────────────────────────────────

const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** @returns {Array<{type:'text',text:string}|{type:'open',name:string,attrs:Array<[string,string]>,self:boolean}|{type:'close',name:string}>} */
export function tokenizeHtml(html) {
  const out = [];
  const s = String(html ?? '');
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(s)) !== null) {
    const tok = m[0];
    if (!tok) { TOKEN_RE.lastIndex++; continue; }
    if (tok.startsWith('<!')) continue; // comments / doctype / cdata
    if (m[1]) { out.push({ type: 'close', name: m[1].toLowerCase() }); continue; }
    if (m[2]) {
      const attrs = [];
      const raw = m[3] || '';
      let a;
      ATTR_RE.lastIndex = 0;
      while ((a = ATTR_RE.exec(raw)) !== null) {
        if (!a[1]) continue;
        attrs.push([a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? '']);
      }
      const name = m[2].toLowerCase();
      out.push({ type: 'open', name, attrs, self: !!m[4] || VOID.has(name) });
      continue;
    }
    // Text (a lone '<' that opened no tag is text too — escape it so it can't start one later).
    out.push({ type: 'text', text: tok === '<' ? '&lt;' : tok.replace(/<(?![a-zA-Z/!])/g, '&lt;') });
  }
  return out;
}

/**
 * Build a tolerant node tree. Nodes: {tag, attrs, children} | {text}.
 * Implicit closes: a block opening inside <p> closes the <p>; <li> closes a
 * sibling <li>; <td>/<th>/<tr> likewise. A close with no open is ignored.
 */
export function parseHtml(html) {
  const root = { tag: '#root', attrs: [], children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const closeTo = (name) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === name) { stack.length = i; return true; }
    }
    return false;
  };
  for (const t of tokenizeHtml(html)) {
    if (t.type === 'text') { top().children.push({ text: t.text }); continue; }
    if (t.type === 'close') { closeTo(t.name); continue; }
    const name = t.name;
    if (BLOCKISH.has(name) && top().tag === 'p') stack.pop();
    if (name === 'li' && top().tag === 'li') stack.pop();
    if ((name === 'td' || name === 'th') && (top().tag === 'td' || top().tag === 'th')) stack.pop();
    if (name === 'tr' && top().tag === 'tr') stack.pop();
    if ((name === 'dt' || name === 'dd') && (top().tag === 'dt' || top().tag === 'dd')) stack.pop();
    const node = { tag: name, attrs: t.attrs, children: [] };
    top().children.push(node);
    if (!t.self) stack.push(node);
  }
  return root;
}

// ─────────────────────────────────────────────────────────────
//  Attribute / style policy
// ─────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/&(?!#?\w+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decodeBasic = (s) => String(s ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

function safeUrl(v) {
  const u = decodeBasic(v).trim().replace(/[\u0000-\u001f\s]+/g, '');
  if (!u) return '';
  if (/^(javascript|data|vbscript|file):/i.test(u)) return '';
  return String(v).trim();
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function normHex(h) {
  const m = HEX_RE.exec(String(h || '').trim());
  if (!m) return '';
  const x = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return `#${x.toLowerCase()}`;
}
const PALETTE_SET = new Set(RICH_TEXT_PALETTE.map(normHex));
export const isPaletteColor = (v) => PALETTE_SET.has(normHex(v));

/**
 * Filter an inline style. Keeps: anything token-based (`var(--ncm-…)`), the
 * identity-free props in KEEP_PROPS, a palette `color` (unless colors:'none'),
 * and a relative font-size (em/% ≤ 2em).
 */
export function cleanStyle(style, { colors = 'palette' } = {}) {
  const kept = [];
  for (const decl of String(style || '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim().replace(/\s*!important\s*$/i, '');
    if (!prop || !val) continue;
    if (/url\(|expression\(|javascript:/i.test(val)) continue;
    if (/var\(\s*--ncm-/.test(val)) { kept.push(`${prop}:${val}`); continue; }
    if (KEEP_PROPS.has(prop)) { kept.push(`${prop}:${val}`); continue; }
    if (prop === 'color' && colors === 'palette' && isPaletteColor(val)) { kept.push(`${prop}:${normHex(val)}`); continue; }
    if (prop === 'font-size') {
      const m = /^(\d*\.?\d+)(em|%)$/.exec(val);
      if (m && ((m[2] === 'em' && +m[1] <= 2) || (m[2] === '%' && +m[1] <= 200))) kept.push(`${prop}:${val}`);
    }
  }
  return kept.join(';');
}

function cleanAttrs(tag, attrs, opts) {
  const out = [];
  for (const [k, vRaw] of attrs) {
    const v = vRaw ?? '';
    if (k.startsWith('on')) continue;
    if (k === 'style') { const s = cleanStyle(v, opts); if (s) out.push(['style', s]); continue; }
    if (k === 'class') {
      const cls = v.split(/\s+/).filter(c => /^ncm-/.test(c));
      if (cls.length) out.push(['class', cls.join(' ')]);
      continue;
    }
    if (k === 'href' && tag === 'a') { const u = safeUrl(v); if (u) out.push(['href', u]); continue; }
    if (k === 'src' && tag === 'img') { const u = safeUrl(v); if (u) out.push(['src', u]); continue; }
    if ((k === 'alt' || k === 'title') && (tag === 'img' || tag === 'a')) { out.push([k, v]); continue; }
    if ((k === 'colspan' || k === 'rowspan') && (tag === 'td' || tag === 'th')) { if (/^\d+$/.test(v)) out.push([k, v]); continue; }
    if (k === 'data-label') { out.push([k, v]); continue; } // the Agent composer's ICE-encrypted block
    if (k === 'color' && tag === 'font') {
      if (opts.colors === 'palette' && isPaletteColor(v)) out.push(['color', normHex(v)]);
      continue;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
//  Cleaner
// ─────────────────────────────────────────────────────────────

const looksLikeHtml = (s) => /<[a-zA-Z/!]/.test(String(s ?? ''));
const hasBlockChildren = (n) => (n.children || []).some(c => c.tag && BLOCKISH.has(c.tag));

/** Escape plain text into HTML, keeping paragraph/line breaks (the "body with no tags" case). */
export function textToHtml(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!t) return '';
  return t.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/**
 * Whitelist-clean an HTML fragment.
 * @param {string} html
 * @param {{mode?: 'inline'|'block'|'rich'|'mail', colors?: 'palette'|'none', enrichers?: boolean}} o
 *   enrichers:true also flattens Foundry `@UUID[…]{Label}` / `[[roll]]{Label}` enrichers to their label
 *   (journal page CONTENT carries them raw; a clipboard copy of the rendered page does not).
 */
export function cleanHtml(html, { mode = 'rich', colors = 'palette', enrichers = false } = {}) {
  let src = String(html ?? '');
  if (enrichers) src = stripEnrichers(src);
  if (!src.trim()) return '';
  if (!looksLikeHtml(src)) {
    // A plain-text body: escape it, keep its line structure. A Document block that is
    // ONE paragraph stays bare inline text (no stray <p> wrapper to nest later).
    if (mode === 'inline') return esc(src.replace(/\s+/g, ' ').trim());
    if (mode === 'block' && !/\n[ \t]*\n/.test(src.trim())) return esc(src.trim()).replace(/\n/g, '<br>');
    return textToHtml(src);
  }
  const M = MODES[mode] || MODES.rich;
  const opts = { colors };
  const root = parseHtml(src);
  const parts = [];
  let preDepth = 0;

  const emitText = (text) => {
    const t = preDepth ? text : text.replace(/\s+/g, ' ');
    if (t) parts.push(t);
  };
  const walk = (node) => {
    for (const ch of node.children) {
      if (ch.text !== undefined) { emitText(ch.text); continue; }
      let tag = ch.tag;
      if (DROP_WITH_CONTENT.has(tag)) continue;
      // Google Docs wraps the whole paste in <b style="font-weight:normal"> — a bold tag that isn't bold.
      if ((tag === 'b' || tag === 'strong') && ch.attrs.some(([k, v]) => k === 'style' && /font-weight\s*:\s*(normal|400)/i.test(v))) { walk(ch); continue; }
      // Mode-specific remaps (a heading inside a Document block becomes a bold line, etc.).
      let wrapBold = false;
      if (!M.allow.has(tag)) {
        if (mode === 'block' && HEADINGS.has(tag)) { tag = 'p'; wrapBold = true; }
        else if (M.map[tag]) tag = M.map[tag];
        else if (mode === 'inline' && (BLOCKISH.has(tag) || tag === 'br')) { parts.push(' '); walk(ch); parts.push(' '); continue; }
        else if (mode === 'block' && TABLE_PARTS.has(tag)) { walk(ch); parts.push(' '); continue; }
        else if (mode === 'block' && (tag === 'hr' || tag === 'img')) continue; // nothing to keep in a text block
        else { walk(ch); continue; } // unknown → unwrap, keep content
      }
      // A paragraph (or anything remapped to one) holding block children would nest
      // <p> inside <p> — unwrap it and let the children stand on their own.
      if (tag === 'p' && hasBlockChildren(ch)) { walk(ch); continue; }
      const attrs = cleanAttrs(tag, ch.attrs, opts);
      // A span/font left with no attributes is a formatting corpse — unwrap it.
      if ((tag === 'span' || tag === 'font') && !attrs.length) { walk(ch); continue; }
      if (tag === 'a' && !attrs.some(([k]) => k === 'href')) { walk(ch); continue; } // a link with no safe target is just text
      if (tag === 'img' && !attrs.some(([k]) => k === 'src')) continue;
      const attrStr = attrs.map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
      if (VOID.has(tag)) { parts.push(`<${tag}${attrStr}>`); continue; }
      parts.push(`<${tag}${attrStr}>`);
      if (wrapBold) parts.push('<b>');
      if (tag === 'pre') preDepth++;
      walk(ch);
      if (tag === 'pre') preDepth--;
      if (wrapBold) parts.push('</b>');
      parts.push(`</${tag}>`);
    }
  };
  walk(root);
  let out = parts.join('');
  // Tidy: drop empty wrappers, collapse runaway breaks, trim whitespace between blocks.
  for (let i = 0; i < 3; i++) {
    out = out
      .replace(/<(p|div|li|h[1-6]|blockquote|b|strong|i|em|u|s|strike|del|code|sub|sup|mark|span|font)(\s[^>]*)?>\s*(<br>\s*)*<\/\1>/g, '')
      .replace(/<(ul|ol)(\s[^>]*)?>\s*<\/\1>/g, '');
  }
  out = out.replace(/(?:\s*<br>\s*){3,}/g, '<br><br>');
  if (!/<pre[\s>]/.test(out)) out = out.replace(/>\s+</g, '><');
  out = out.trim();
  if (mode === 'inline') out = out.replace(/\s+/g, ' ').trim();
  // Block mode contract: a ONE-paragraph block is bare inline HTML, a multi-paragraph
  // block is a <p>…</p> sequence. Unwrap a lone <p> so the two shapes never mix.
  if (mode === 'block' && /^<p>[\s\S]*<\/p>$/.test(out) && (out.match(/<p[\s>]/g) || []).length === 1 && !/<(ul|ol)[\s>]/.test(out)) {
    out = out.slice(3, -4).trim();
  }
  return out;
}

/** `@UUID[Actor.abc]{Rogue}` → `Rogue`; `[[/r 1d10]]{Roll}` → `Roll`; labelless → the bracket's inner text. */
export function stripEnrichers(text) {
  return String(text ?? '')
    .replace(/@[A-Za-z]+\[([^\]]*)\](?:\{([^}]*)\})?/g, (m, inner, label) => label ?? (inner.split('.').pop() || ''))
    .replace(/\[\[([^\]]*)\]\](?:\{([^}]*)\})?/g, (m, inner, label) => label ?? inner);
}

// ─────────────────────────────────────────────────────────────
//  HTML → Document blocks
// ─────────────────────────────────────────────────────────────

const serialize = (n) => {
  if (n.text !== undefined) return n.text;
  if (n.tag === '#root') return n.children.map(serialize).join('');
  const attrs = n.attrs.map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  if (VOID.has(n.tag)) return `<${n.tag}${attrs}>`;
  return `<${n.tag}${attrs}>${n.children.map(serialize).join('')}</${n.tag}>`;
};
const innerHtml = (n) => n.children.map(serialize).join('');
const plain = (s) => decodeBasic(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const findFirst = (n, tag) => {
  for (const c of n.children || []) {
    if (c.tag === tag) return c;
    const d = c.children ? findFirst(c, tag) : null;
    if (d) return d;
  }
  return null;
};
const attrOf = (n, k) => n.attrs.find(([key]) => key === k)?.[1] || '';

/**
 * Split an HTML fragment into Document blocks:
 *   { heading?, text, quote? } | { kind:'list', ordered, items, heading? } | { kind:'figure', image, caption, heading? }
 * Headings start a new block and become its heading; consecutive paragraphs
 * merge into one text block (a block is a section). Lists, figures and quotes
 * are their own blocks. Inline-only input → one text block.
 */
export function htmlToBlocks(html, { colors = 'none', enrichers = false } = {}) {
  let src = String(html ?? '');
  if (enrichers) src = stripEnrichers(src);
  if (!src.trim()) return [];
  if (!looksLikeHtml(src)) return textToBlocks(src);
  const root = parseHtml(src);
  const blocks = [];
  let pending = null;   // heading waiting for a body
  let text = [];        // paragraph HTML strings accumulating into one text block
  let run = [];         // inline nodes sitting directly at block level (glue into one paragraph)
  const cleanOpts = { mode: 'block', colors };

  const flushRun = () => { if (run.length) { const h = run.join('').trim(); if (h) text.push(`<p>${h}</p>`); run = []; } };
  const flushText = () => {
    flushRun();
    const body = text.map(p => p.trim()).filter(Boolean);
    text = [];
    if (!body.length) return; // a pending heading waits for whatever block comes next (a list, a figure…)
    const joined = body.length > 1 ? body.join('') : (body[0] || '').replace(/^<p>([\s\S]*)<\/p>$/, '$1');
    const t = cleanHtml(joined, cleanOpts);
    if (!t) return;
    blocks.push({ ...(pending ? { heading: pending } : {}), text: t });
    pending = null;
  };
  const push = (b) => { flushText(); blocks.push({ ...(pending ? { heading: pending } : {}), ...b }); pending = null; };
  const isBlockNode = (n) => n.tag && BLOCKISH.has(n.tag);
  const hasBlockChild = (n) => (n.children || []).some(isBlockNode);

  const visit = (n) => {
    for (const ch of n.children) {
      if (ch.text !== undefined) { if (ch.text.trim()) run.push(ch.text); continue; }
      const tag = ch.tag;
      if (DROP_WITH_CONTENT.has(tag)) continue;
      if (HEADINGS.has(tag)) {
        flushText();
        if (pending) blocks.push({ heading: pending, text: '' }); // two headings in a row: the first is an empty section
        pending = plain(innerHtml(ch));
        continue;
      }
      if (tag === 'ul' || tag === 'ol') {
        const items = ch.children.filter(c => c.tag === 'li').map(li => cleanHtml(innerHtml(li), { mode: 'inline', colors })).filter(Boolean);
        if (items.length) push({ kind: 'list', ordered: tag === 'ol', items });
        continue;
      }
      if (tag === 'img') {
        const src2 = safeUrl(attrOf(ch, 'src'));
        if (src2) push({ kind: 'figure', image: src2, caption: plain(attrOf(ch, 'alt')) });
        continue;
      }
      if (tag === 'figure') {
        const img = findFirst(ch, 'img');
        const cap = findFirst(ch, 'figcaption');
        const src2 = img ? safeUrl(attrOf(img, 'src')) : '';
        if (src2) push({ kind: 'figure', image: src2, caption: cap ? plain(innerHtml(cap)) : plain(attrOf(img, 'alt')) });
        else visit(ch);
        continue;
      }
      if (tag === 'blockquote') {
        const q = cleanHtml(innerHtml(ch), cleanOpts);
        if (q) push({ text: q, quote: true });
        continue;
      }
      if (tag === 'hr') { flushText(); continue; }
      if (tag === 'table') { // a table has no block kind — its rows become lines of one paragraph
        const rows = [];
        const walkRows = (m) => { for (const c of m.children || []) { if (c.tag === 'tr') rows.push(c.children.filter(x => x.tag === 'td' || x.tag === 'th').map(x => plain(innerHtml(x))).filter(Boolean).join(' · ')); else if (c.children) walkRows(c); } };
        walkRows(ch);
        const r = rows.filter(Boolean);
        flushRun();
        if (r.length) text.push(`<p>${r.map(esc).join('<br>')}</p>`);
        continue;
      }
      if (tag === 'br') { flushRun(); continue; } // a bare line break at block level ends the inline run
      if (isBlockNode(ch)) {
        flushRun();
        if (hasBlockChild(ch)) visit(ch);
        else { const h = innerHtml(ch); if (h.trim()) text.push(`<p>${h}</p>`); }
        continue;
      }
      // Inline at this level (a span/b/… sitting directly in the fragment) — accumulate as a paragraph run.
      run.push(serialize(ch));
    }
  };
  visit(root);
  flushText();
  if (pending) blocks.push({ heading: pending, text: '' });
  return blocks.filter(b => b.kind || b.heading || (b.text && b.text.trim()));
}

// ─────────────────────────────────────────────────────────────
//  Plain text (PDF) reflow
// ─────────────────────────────────────────────────────────────

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
const BULLET_RE = /^\s*(?:[•·▪◦●■▶►\-–—*]|\d{1,3}[.)]|[a-zA-Z][.)])\s+(.*)$/;
const PAGE_NO_RE = /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
const ENDS_SENTENCE = /[.!?:;…"”’)\]]$/;

/** Normalise clipboard text: CRLF, NBSP, soft hyphens, ligature glyphs, trailing spaces. */
export function normalizeText(text) {
  let t = String(text ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/­/g, '');
  t = t.replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] || c);
  return t.split('\n').map(l => l.replace(/[ \t]+$/g, '')).join('\n');
}

function joinLines(a, b) {
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

/**
 * Reflow hard-wrapped text into paragraphs.
 * @returns {Array<{lines: string[], bullet?: boolean}>}  each paragraph's lines (several when the
 *   breaks look deliberate — short lines, verse, an address); `bullet` marks a list item.
 * Rules (per blank-line-separated paragraph, maxLen = its longest line):
 *   · "word-" + lowercase next → rejoin without the hyphen
 *   · a line not ending a sentence, that is ≥55% of maxLen or whose successor starts lowercase → join
 *   · a line ending a sentence but ≥80% of maxLen, successor uppercase → join (full line, mid-paragraph)
 *   · otherwise the break stays. Paragraphs whose longest line is <40 chars keep every break.
 *   · a bullet line never joins the line above it; a run of bullets stays line-per-item.
 *   · a bare page number (`12`, `Page 3 of 9`) is dropped when the paste has ≥3 paragraphs.
 */
export function reflowText(text, { dropPageNumbers = true } = {}) {
  const norm = normalizeText(text).trim();
  if (!norm) return [];
  const rawParas = norm.split(/\n[ \t]*\n+/);
  const paras = [];
  for (const raw of rawParas) {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    // Bullet runs: each bullet is its own item; a continuation line (not a bullet) joins the previous item.
    if (BULLET_RE.test(lines[0]) && lines.filter(l => BULLET_RE.test(l)).length >= Math.max(1, Math.ceil(lines.length / 2))) {
      const items = [];
      for (const l of lines) {
        const m = BULLET_RE.exec(l);
        if (m) items.push(m[1].trim());
        else if (items.length) items[items.length - 1] = joinLines(items[items.length - 1], l);
        else items.push(l);
      }
      for (const it of items) paras.push({ lines: [it], bullet: true });
      continue;
    }
    if (lines.length === 1) { paras.push({ lines }); continue; }
    const maxLen = Math.max(...lines.map(l => l.length));
    if (maxLen < 40) { paras.push({ lines }); continue; }
    const out = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      const prev = out[out.length - 1];
      const next = lines[i];
      if (BULLET_RE.test(next)) { out.push(next); continue; }
      const nextLower = /^[a-z]/.test(next);
      const nextUpper = /^[A-Z0-9"“(]/.test(next);
      const prevLen = lines[i - 1].length;
      let join = false;
      if (/[A-Za-z]-$/.test(prev) && nextLower) { out[out.length - 1] = prev.slice(0, -1) + next; continue; }
      if (!ENDS_SENTENCE.test(prev) && (prevLen >= 0.55 * maxLen || nextLower)) join = true;
      else if (ENDS_SENTENCE.test(prev) && prevLen >= 0.8 * maxLen && nextUpper) join = true;
      if (join) out[out.length - 1] = joinLines(prev, next);
      else out.push(next);
    }
    paras.push({ lines: out });
  }
  if (dropPageNumbers && paras.length >= 3) {
    return paras.filter(p => !(p.lines.length === 1 && PAGE_NO_RE.test(p.lines[0])));
  }
  return paras;
}

/** Reflowed paragraphs → HTML (`<p>` per paragraph, `<br>` for kept breaks, bullet runs → `<ul>`). */
export function reflowedToHtml(paras) {
  const out = [];
  let list = [];
  const flushList = () => { if (list.length) { out.push(`<ul>${list.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`); list = []; } };
  for (const p of paras) {
    if (p.bullet) { list.push(p.lines.join(' ')); continue; }
    flushList();
    out.push(`<p>${p.lines.map(esc).join('<br>')}</p>`);
  }
  flushList();
  return out.join('');
}

/** Plain text → HTML, reflowed (the PDF path for a message body). */
export function textToReflowedHtml(text) {
  return reflowedToHtml(reflowText(text));
}

/**
 * Plain text → Document blocks: ONE text block holding the reflowed paragraphs
 * (a section), with bullet runs split out as list blocks in sequence.
 */
export function textToBlocks(text) {
  const paras = reflowText(text);
  const blocks = [];
  let ps = [];
  let items = [];
  const flushP = () => { if (ps.length) { blocks.push({ text: ps.length === 1 ? ps[0].replace(/^<p>|<\/p>$/g, '') : ps.join('') }); ps = []; } };
  const flushL = () => { if (items.length) { blocks.push({ kind: 'list', ordered: false, items: items.slice() }); items = []; } };
  for (const p of paras) {
    if (p.bullet) { flushP(); items.push(esc(p.lines.join(' '))); continue; }
    flushL();
    ps.push(`<p>${p.lines.map(esc).join('<br>')}</p>`);
  }
  flushP(); flushL();
  return blocks;
}

// ─────────────────────────────────────────────────────────────
//  Paste entry points (what an editor's paste handler calls)
// ─────────────────────────────────────────────────────────────

/**
 * What to insert into a message-body editor for a paste. HTML wins when the
 * clipboard carries it (cleaned, colours dropped); plain text is reflowed.
 * @returns {string} HTML
 */
export function pasteToHtml({ html = '', text = '' } = {}, { mode = 'rich' } = {}) {
  if (html && looksLikeHtml(html)) {
    const out = cleanHtml(html, { mode, colors: 'none' });
    if (out) return out;
  }
  return textToReflowedHtml(text);
}

/**
 * What a Document text block does with a paste: blocks to insert.
 * @returns {Array} blocks (see htmlToBlocks)
 */
export function pasteToBlocks({ html = '', text = '' } = {}) {
  if (html && looksLikeHtml(html)) {
    const b = htmlToBlocks(html, { colors: 'none' });
    if (b.length) return b;
  }
  return textToBlocks(text);
}

/** A single plain text block (no heading/quote/kind) can go in at the caret; anything else restructures. */
export function isSimplePaste(blocks) {
  return blocks.length === 1 && !blocks[0].kind && !blocks[0].heading && !blocks[0].quote;
}

/** How many `<p>` paragraphs a block's text holds (1 for bare inline text). */
export function paragraphCount(text) {
  const n = (String(text || '').match(/<p[\s>]/g) || []).length;
  return Math.max(1, n);
}

/** Explode a multi-paragraph text block into one block per paragraph (the first keeps the heading). */
export function splitBlockParagraphs(block) {
  const text = String(block?.text || '');
  const root = parseHtml(text);
  const ps = root.children.filter(c => c.tag === 'p');
  if (ps.length < 2) return [block];
  return ps.map((p, i) => {
    const t = innerHtml(p).trim();
    const b = { text: t };
    if (i === 0 && block.heading) b.heading = block.heading;
    if (block.quote) b.quote = true;
    if (block.redacted) b.redacted = true;
    return b;
  }).filter(b => b.text || b.heading);
}
