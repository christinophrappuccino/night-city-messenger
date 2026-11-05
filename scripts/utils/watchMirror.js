/**
 * Watching over someone's shoulder: copy what a window shows, and show the copy somewhere else.
 * @file scripts/utils/watchMirror.js
 * @module night-city-messenger
 *
 * Why a copy of the window and not the same window opened on another client: a watcher often cannot load what the
 * operator is using (a shard on another player's sheet, an actor they have no rights on), and a second live window
 * would judge every gate by the WATCHER's rights. A copy shows exactly what the operator sees, no more and no less,
 * consoles and roll reveals included, because those mount inside the window.
 *
 * Nothing typed into a password box travels: the module's secret fields hold only bullets on screen, and every input
 * value is left out unless it is plain visible text.
 */

const SECRET_TYPES = new Set(['password', 'hidden', 'file']);
/** Zooming in makes the layout narrower, but not narrower than this: past it, it scrolls sideways. */
const MIN_LAYOUT_W = 480;

/** Carry what cloneNode does not: scroll positions, what is typed, what is picked. */
function carryState(from, to) {
  if (from.scrollTop) to.setAttribute('data-watch-top', String(Math.round(from.scrollTop)));
  if (from.scrollLeft) to.setAttribute('data-watch-left', String(Math.round(from.scrollLeft)));
  const tag = from.tagName;
  if (tag === 'INPUT') {
    const type = String(from.getAttribute('type') || 'text').toLowerCase();
    if (SECRET_TYPES.has(type) || from.matches?.('[data-ncm-secret], .ncm-autofill-guard') || from.ncmSetMasked) {
      to.removeAttribute('value');
    } else if (type === 'checkbox' || type === 'radio') {
      if (from.checked) to.setAttribute('checked', ''); else to.removeAttribute('checked');
    } else {
      to.setAttribute('value', from.value ?? '');
    }
  } else if (tag === 'TEXTAREA') {
    to.textContent = from.value ?? '';
  } else if (tag === 'SELECT') {
    const opts = to.querySelectorAll('option');
    opts.forEach((o, i) => { if (i === from.selectedIndex) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
  }
}

// ─── What a copy may hold (audit SEC-09 / SEC-20) ───
// The copy arrives over the socket from another client, so the WATCHER cleans it too and trusts nothing in it.
// Elements are an allowlist: what NCM windows are built from. An element not on it is unwrapped (its text stays);
// the ones that could load or run something are removed outright.

const MIRROR_HTML = 'a abbr article aside b bdi bdo blockquote br button caption code col colgroup dd del details dfn div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i img input ins kbd label legend li main mark meter nav ol optgroup option output p pre progress q s samp section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul var wbr canvas datalist';
const MIRROR_SVG = 'svg g path rect circle ellipse line polyline polygon text tspan textpath defs use lineargradient radialgradient stop clippath mask pattern filter symbol marker title desc image animatetransform animate fegaussianblur feturbulence fedisplacementmap feoffset feblend fecolormatrix fecomposite feflood femerge femergenode femorphology fedropshadow fecomponenttransfer fefunca fefuncr fefuncg fefuncb feimage fetile';
const MIRROR_TAGS = new Set(`${MIRROR_HTML} ${MIRROR_SVG}`.split(/\s+/));
/** Removed with their contents: they could run, load, restyle the whole page, or navigate. */
const MIRROR_DROP = new Set(['script', 'style', 'link', 'meta', 'base', 'template', 'noscript', 'set', 'animatemotion', 'mpath', 'foreignobject', 'frame', 'frameset', 'applet', 'portal', 'slot', 'dialog']);
/** A panel stands in for these: a live player would restart on every picture, and a frame could be anything. */
const MIRROR_MEDIA = new Set(['iframe', 'video', 'audio', 'object', 'embed']);
/** Attributes that hold a URL. Anything else that could load something (srcset, ping…) is dropped. */
const MIRROR_URL_ATTRS = new Set(['href', 'xlink:href', 'src', 'poster', 'action', 'formaction', 'cite']);
const MIRROR_DROP_ATTRS = new Set(['srcset', 'ping', 'background', 'lowsrc', 'dynsrc', 'codebase', 'data', 'manifest', 'formtarget', 'target', 'http-equiv', 'srcdoc', 'is']);

/**
 * May a copy keep this URL? A relative path, http(s), blob, mailto/tel, or a data:image URI. The value is what the
 * DOM holds (entities already decoded); control characters and whitespace are taken out before the scheme test,
 * because the browser ignores them (`java\tscript:`).
 * @param {*} value
 * @returns {boolean}
 */
export function mirrorUrlOk(value) {
  const probe = String(value ?? '').replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, '');
  if (!probe) return true;
  const head = probe.split(/[/?#]/)[0];
  if (!head.includes(':')) return true;
  const scheme = head.slice(0, head.indexOf(':')).toLowerCase();
  if (['http', 'https', 'blob', 'mailto', 'tel'].includes(scheme)) return true;
  return scheme === 'data' && /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(probe);
}

/** An inline style with nothing that could load an unsafe URL or run (the old IE `expression`). */
export function mirrorStyle(style) {
  const out = [];
  for (const decl of String(style ?? '').split(';')) {
    if (!decl.trim()) continue;
    if (/expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i.test(decl)) continue;
    const urls = [...decl.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)];
    if (urls.some((m) => !mirrorUrlOk(m[2]))) continue;
    out.push(decl.trim());
  }
  return out.join(';');
}

/** "--a:b;--c:d" with only custom-property pairs whose value is safe. Anything else is dropped. */
export function mirrorVars(str) {
  const out = [];
  for (const decl of String(str ?? '').split(';')) {
    const m = /^\s*(--[\w-]+)\s*:([\s\S]*)$/.exec(decl);
    if (!m) continue;
    const val = m[2].trim();
    if (/[{}<>]|expression\s*\(|javascript:|@import/i.test(val)) continue;
    if ([...val.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].some((u) => !mirrorUrlOk(u[2]))) continue;
    out.push(`${m[1]}:${val}`);
  }
  return out.join(';');
}

/** Class tokens made only of word characters and dashes. */
export function mirrorClasses(str) {
  return String(str ?? '').split(/\s+/).filter((c) => /^[\w-]+$/.test(c)).join(' ');
}

/** Only `data-*` attributes, by name. A copy once carried `onanimationstart` here (SEC-09). */
export function mirrorData(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
    if (/^data-[\w-]+$/i.test(k)) out[k.toLowerCase()] = String(v ?? '');
  }
  return out;
}

/** Strip what must not run, load or take focus in a copy. Run on the way out AND on the way in. */
export function cleanMirror(root) {
  root.querySelectorAll('[data-ncm-no-watch]').forEach((n) => n.remove());
  // Deepest first, so an unwrapped element's children have already been judged.
  for (const n of [...root.querySelectorAll('*')].reverse()) {
    const tag = String(n.localName || n.tagName || '').toLowerCase();
    if (MIRROR_DROP.has(tag)) { n.remove(); continue; }
    if (MIRROR_MEDIA.has(tag)) {
      const box = n.ownerDocument.createElement('div');
      box.className = 'ncm-watch__media';
      box.innerHTML = '<i class="fas fa-photo-film"></i> Playing on their screen';
      n.replaceWith(box);
      continue;
    }
    if (!MIRROR_TAGS.has(tag)) { n.replaceWith(...n.childNodes); continue; }
    // An SVG animation may not change a link or a handler.
    if ((tag === 'animate' || tag === 'animatetransform') && /href|^on|^style$/i.test(n.getAttribute('attributeName') || '')) { n.remove(); continue; }
    n.removeAttribute('id');
    n.removeAttribute('autofocus');
    n.removeAttribute('contenteditable');
    n.setAttribute('tabindex', '-1');
    for (const a of [...n.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on') || MIRROR_DROP_ATTRS.has(name)) n.removeAttribute(a.name);
      else if (MIRROR_URL_ATTRS.has(name)) {
        // <use> may only point inside the copy.
        if (!mirrorUrlOk(a.value) || (tag === 'use' && !/^\s*#/.test(a.value))) n.removeAttribute(a.name);
      } else if (name === 'style') {
        const s = mirrorStyle(a.value);
        if (s) n.setAttribute('style', s); else n.removeAttribute('style');
      }
    }
  }
  return root;
}

/** The custom properties set inline on an element, as "--a:b;--c:d". */
function customProps(el) {
  const out = [];
  const st = el?.style;
  if (!st) return '';
  for (let i = 0; i < st.length; i += 1) {
    const k = st[i];
    if (k.startsWith('--')) out.push(`${k}:${st.getPropertyValue(k)}`);
  }
  return out.join(';');
}

/**
 * One picture of a window.
 * @param {HTMLElement} appEl the application element (frame + content)
 * @returns {{html:string, cls:string, vars:string, rootVars:string, data:Object, w:number, h:number}|null}
 */
export function snapshotWindow(appEl) {
  const wc = appEl?.querySelector(':scope > .window-content');
  if (!wc) return null;
  const clone = wc.cloneNode(true);
  const a = wc.querySelectorAll('*');
  const b = clone.querySelectorAll('*');
  for (let i = 0; i < a.length; i += 1) carryState(a[i], b[i]);
  cleanMirror(clone);
  // An effect mounted on the window itself, so that a re-render or a scrolled pane cannot disturb it.
  const overlays = document.createElement('div');
  appEl.querySelectorAll(':scope > [data-watch-overlay]').forEach((n) => overlays.appendChild(n.cloneNode(true)));
  cleanMirror(overlays);
  const data = {};
  for (const at of appEl.attributes) if (at.name.startsWith('data-')) data[at.name] = at.value;
  const rect = wc.getBoundingClientRect();
  return {
    html: clone.innerHTML,
    overlay: overlays.innerHTML,
    wcVars: customProps(wc),
    wcClass: wc.className,
    wcTop: Math.round(wc.scrollTop) || 0,
    cls: [...appEl.classList].filter((c) => c !== 'minimized').join(' '),
    vars: customProps(appEl),
    rootVars: customProps(document.documentElement),
    data,
    w: Math.round(rect.width) || 800,
    h: Math.round(rect.height) || 500,
  };
}

/**
 * The smallest single edit that turns one string into another: [where, how many to drop, what to put there].
 * A window's HTML barely changes between pictures, so this is usually a few bytes, and never more than the whole.
 */
export function diffText(a, b) {
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start += 1;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) { endA -= 1; endB -= 1; }
  return [start, endA - start, b.slice(start, endB)];
}

export function applyText(a, [at, drop, ins]) {
  return a.slice(0, at) + ins + a.slice(at + drop);
}

/**
 * The fit. The copy only shrinks to fit the WIDTH: a tall window scrolls instead, because shrinking for height is what
 * made a narrow, tall node console small and hard to read. The layout then fills whatever is left (it is real HTML, so
 * it can reflow, and there is never a gap down one side). The watcher can pick their own size with `zoom`; the layout
 * then gets narrower, down to a floor, and past that it scrolls sideways.
 * @param {number} w @param {number} h the operator's window
 * @param {number} availW @param {number} availH the watcher's window
 * @param {number|null} [zoom] the watcher's choice; none = fit the width
 * @returns {{scale:number, width:number, height:number}} the scale, and the size to lay the copy out at
 */
export function fitLayout(w, h, availW, availH, zoom = null) {
  if (!(w > 0 && h > 0 && availW > 0 && availH > 0)) return { scale: zoom || 1, width: w || 0, height: h || 0 };
  const scale = zoom || Math.min(1, Math.floor((availW / w) * 100) / 100);
  return {
    scale,
    width: Math.max(Math.ceil(availW / scale), Math.min(w, MIN_LAYOUT_W)),
    height: Math.max(Math.ceil(availH / scale), h),
  };
}

/** Make `live` match `next` without touching what already matches. */
function morphAttrs(live, next) {
  for (const at of [...live.attributes]) {
    if (next.hasAttribute(at.name)) continue;
    live.removeAttribute(at.name);
    if (at.name === 'data-watch-top' || at.name === 'data-watch-left') {
      gliding.delete(live);
      if (at.name === 'data-watch-top') live.scrollTop = 0; else live.scrollLeft = 0;
    }
  }
  for (const at of next.attributes) {
    if (live.getAttribute(at.name) !== at.value) live.setAttribute(at.name, at.value);
  }
  // The attribute only sets the starting value of a form control.
  if (live.tagName === 'INPUT') {
    if (live.value !== next.value) live.value = next.value;
    if (live.checked !== next.hasAttribute('checked')) live.checked = next.hasAttribute('checked');
  } else if (live.tagName === 'OPTION') {
    if (live.selected !== next.hasAttribute('selected')) live.selected = next.hasAttribute('selected');
  } else if (live.tagName === 'TEXTAREA' && live.value !== next.textContent) {
    live.value = next.textContent;
  }
}

/**
 * Children are matched by position. Nodes that survive keep their running animations, loaded images and scroll
 * positions, which is what makes the copy move instead of flicker.
 */
function morphChildren(live, next) {
  const incoming = [...next.childNodes];
  incoming.forEach((n, i) => {
    const cur = live.childNodes[i];
    if (!cur) { live.appendChild(n); return; }
    if (cur.nodeType !== n.nodeType || cur.nodeName !== n.nodeName) { live.replaceChild(n, cur); return; }
    if (n.nodeType === 1) { morphAttrs(cur, n); morphChildren(cur, n); }
    else if (cur.nodeValue !== n.nodeValue) cur.nodeValue = n.nodeValue;
  });
  while (live.childNodes.length > incoming.length) live.lastChild.remove();
}

/** A scroller eases to where the operator has it. Pictures arrive a few times a second, and jumps would show that. */
const gliding = new Map();
let glideFrame = null;
function glideStep() {
  glideFrame = null;
  for (const [el, to] of gliding) {
    if (!el.isConnected) { gliding.delete(el); continue; }
    const dy = to.top - el.scrollTop, dx = to.left - el.scrollLeft;
    // Near the end it just lands: scroll positions can round to whole pixels, so a smaller step would never arrive.
    if (Math.abs(dy) < 3 && Math.abs(dx) < 3) { el.scrollTop = to.top; el.scrollLeft = to.left; gliding.delete(el); continue; }
    el.scrollTop += dy * 0.35;
    el.scrollLeft += dx * 0.35;
    // The operator scrolled further than this box can (it may be taller here): stop at the end instead of chasing it.
    if (el.scrollTop === to.lastTop && el.scrollLeft === to.lastLeft) { gliding.delete(el); continue; }
    to.lastTop = el.scrollTop; to.lastLeft = el.scrollLeft;
  }
  if (gliding.size) glideFrame = requestAnimationFrame(glideStep);
}

function scrollTo(el, top, left) {
  const known = el.__ncmWatchScroll;
  el.__ncmWatchScroll = true;
  const still = !known || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (still) { gliding.delete(el); el.scrollTop = top; el.scrollLeft = left; return; }
  if (el.scrollTop === top && el.scrollLeft === left) { gliding.delete(el); return; }
  gliding.set(el, { top, left });
  glideFrame ??= requestAnimationFrame(glideStep);
}

/**
 * Show a picture.
 * @param {HTMLElement} fit the watcher's window area
 * @param {object} snap from snapshotWindow
 */
export function mountMirror(fit, snap) {
  let stage = fit.querySelector(':scope > .ncm-watch__mirror');
  if (!stage) {
    fit.replaceChildren();
    stage = document.createElement('div');
    stage.className = 'ncm-watch__mirror';
    fit.appendChild(stage);
  }
  const look = JSON.stringify([snap.cls, snap.data, snap.rootVars, snap.vars]);
  if (stage.__ncmWatchLook !== look) {
    stage.__ncmWatchLook = look;
    // The picture came from another client: only data-* keys, plain class names and custom properties are applied.
    stage.className = `${mirrorClasses(snap.cls)} ncm-watch__mirror`;
    for (const at of [...stage.attributes]) if (at.name.startsWith('data-')) stage.removeAttribute(at.name);
    for (const [k, v] of Object.entries(mirrorData(snap.data))) stage.setAttribute(k, v);
    stage.setAttribute('style', `${mirrorVars(snap.rootVars)};${mirrorVars(snap.vars)}`);
  }
  let wc = stage.firstElementChild;
  if (!wc) { wc = document.createElement('div'); stage.appendChild(wc); }
  const wcClass = mirrorClasses(snap.wcClass) || 'window-content';
  if (wc.className !== wcClass) wc.className = wcClass;
  const wcVars = mirrorVars(snap.wcVars);
  if ((wc.getAttribute('style') || '') !== wcVars) wc.setAttribute('style', wcVars);
  refit(fit, snap);
  const html = String(snap.html ?? '');
  if (stage.__ncmWatchHtml !== html) {
    stage.__ncmWatchHtml = html;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    cleanMirror(tpl.content);
    morphChildren(wc, tpl.content);
  }
  const overlay = String(snap.overlay ?? '');
  if ((stage.__ncmWatchOverlay ?? '') !== overlay) {
    stage.__ncmWatchOverlay = overlay;
    let layer = stage.querySelector(':scope > .ncm-watch__overlay');
    if (!layer) { layer = document.createElement('div'); layer.className = 'ncm-watch__overlay'; stage.appendChild(layer); }
    const tpl = document.createElement('template');
    tpl.innerHTML = overlay;
    cleanMirror(tpl.content);
    morphChildren(layer, tpl.content);
  }
  scrollTo(wc, snap.wcTop || 0, 0);
  wc.querySelectorAll('[data-watch-top], [data-watch-left]').forEach((n) => {
    scrollTo(n, Number(n.getAttribute('data-watch-top')) || 0, Number(n.getAttribute('data-watch-left')) || 0);
  });
}

/** Re-apply the fit (a new picture, or the watcher resized the window). */
export function refit(fit, snap) {
  const stage = fit?.querySelector(':scope > .ncm-watch__mirror');
  if (!stage || !snap) return;
  const zoom = Number(fit.dataset.watchZoom) || null;
  // Decided from the window's full size, because a scrollbar takes width: measuring what is left after one would shrink
  // the copy, remove the need for the scrollbar, grow the copy again, and flicker between the two.
  const fullW = fit.offsetWidth, fullH = fit.offsetHeight;
  if (fit.__ncmWatchBar === undefined) {
    fit.style.overflowY = 'scroll';
    fit.__ncmWatchBar = fit.offsetWidth - fit.clientWidth;
  }
  const open = fitLayout(snap.w, snap.h, fullW, fullH, zoom);
  const tall = open.height * open.scale > fullH + 1;
  const { scale, width, height } = tall ? fitLayout(snap.w, snap.h, fullW - fit.__ncmWatchBar, fullH, zoom) : open;
  fit.style.overflowY = tall ? 'scroll' : 'hidden';
  fit.style.overflowX = width * scale > fullW - (tall ? fit.__ncmWatchBar : 0) + 1 ? 'auto' : 'hidden';
  stage.style.setProperty('width', `${width}px`, 'important');
  stage.style.setProperty('height', `${height}px`, 'important');
  // zoom, not transform: a transform scales a finished picture of the text, zoom lays the text out again at the new size.
  stage.style.setProperty('zoom', String(scale), 'important');
  fit.dataset.watchScale = String(scale);
}
