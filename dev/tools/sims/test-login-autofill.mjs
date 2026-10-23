// Sim: no NCM login screen can trigger the browser's password manager (tester,
// 2026-10-20: "browsers auto-fill Username from the Forge login when decrypting
// shards"). Static guards over every template and JS-built input: a secret field
// carries autocomplete="new-password" + the extension opt-outs, and no input is
// NAMED like a login field. Plus: the readers still find the renamed fields.
import { fileURLToPath } from 'url';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const rel = (f) => f.replace(ROOT + '/', '');
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) { const p = join(dir, n); const st = statSync(p); if (st.isDirectory()) walk(p, out); else if (/\.(js|hbs)$/.test(n)) out.push(p); }
  return out;
}
const files = [...walk(`${ROOT}/scripts`), ...walk(`${ROOT}/templates`)];

// every <input type="password" …> tag, wherever it is built
const badSecret = [];
const badName = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/<input\b[^>]*>/gs)) {
    const tag = m[0];
    const isSecret = /type=["']?password/.test(tag);
    if (isSecret && !(/autocomplete=["']new-password["']/.test(tag) && /data-lpignore/.test(tag) && /data-1p-ignore/.test(tag))) badSecret.push(`${rel(f)}: ${tag.slice(0, 70)}`);
    // The NAME heuristic matters where a player types a secret: the login screens
    // and every secret field. GM config sheets (where the GM sets the password a
    // shard will demand, in the clear) are text fields on an admin window.
    const playerLogin = /security-overlay-login|terminal-login|terminal-manual-login|terminal-viewer|network-auth-dialog|ItemInboxApp|TerminalViewerApp|NetworkAuthDialog/.test(f);
    const name = tag.match(/\bname=["']([^"']+)["']/)?.[1] || '';
    if ((isSecret || playerLogin) && /username|password|^login|login-|passwd|handle|account|^user$/i.test(name)) badName.push(`${rel(f)}: name="${name}"`);
  }
}
ok(badSecret.length === 0, `every secret field opts out of autofill (${badSecret.join(' | ') || 'none missing'})`);
ok(badName.length === 0, `no input is named like a login field (${badName.join(' | ') || 'none'})`);

// the readers follow the renamed fields
const pairs = [
  ['scripts/ui/ItemInbox/ItemInboxApp.js', ['ncm-shard-op', 'ncm-shard-key']],
  ['scripts/ui/Terminal/TerminalViewerApp.js', ['ncm-term-op', 'ncm-term-key', 'ncm-term-netkey']],
  ['scripts/ui/NetworkManagement/NetworkAuthDialog.js', ['ncm-net-key']],
];
for (const [f, names] of pairs) {
  const src = readFileSync(`${ROOT}/${f}`, 'utf8');
  for (const n of names) ok(src.includes(`name="${n}"`), `${f} reads ${n}`);
  ok(!/manualPassword|manualUsername|netAuthPassword|login-username|login-password/.test(src), `${f} has no stale field name`);
}
for (const [f, names] of [
  ['templates/item-inbox/security-overlay-login.hbs', ['ncm-shard-op', 'ncm-shard-key']],
  ['templates/terminal/terminal-manual-login.hbs', ['ncm-term-op', 'ncm-term-key']],
  ['templates/terminal/terminal-login.hbs', ['ncm-term-key']],
  ['templates/terminal/terminal-viewer.hbs', ['ncm-term-netkey']],
  ['templates/dialogs/network-auth-dialog.hbs', ['ncm-net-key']],
]) {
  const src = readFileSync(`${ROOT}/${f}`, 'utf8');
  for (const n of names) ok(src.includes(`name="${n}"`), `${f} renders ${n}`);
}

// ── layers 2 + 3, through the real helpers: readonly-until-touched, and the SHADOW
//    (a plain text input that shows bullets while script holds the real text) ──
{
  // a real-enough HTMLInputElement: the prototype owns `value`, like the DOM's
  class HTMLInputElement {
    constructor() { this._v = ''; this.type = 'text'; this.dataset = {}; this.attrs = {}; this.readOnly = false; this.listeners = {};
      this.classList = { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }, toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); } }; }
    get value() { return this._v; } set value(v) { this._v = v; }
    setAttribute(k, v) { this.attrs[k] = v; } setSelectionRange() {}
    addEventListener(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
    fire(ev, init = {}) { for (const fn of [...(this.listeners[ev] || [])]) fn({ preventDefault() {}, ...init }); }
    shown() { return HTMLInputElement.prototype.__lookupGetter__('value').call(this); }   // what the DOM (and a manager) sees
  }
  globalThis.HTMLInputElement = HTMLInputElement;
  const { guardSecretInputs, shadowSecretInput } = await import(`file:///${ROOT}/scripts/utils/helpers.js`);
  // a secret field, with the document plumbing the editable needs
  const mkCe = () => { const l = {}; return { style: {}, attrs: {}, textContent: '', className: '', setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, fn) { (l[e] ??= []).push(fn); }, fire(e, init = {}) { for (const fn of l[e] || []) fn({ preventDefault() { init.prevented = true; }, ...init }); return init; }, focus() { this.focused = true; } }; };
  const ce = mkCe();
  const dispatched = [];
  const pw = new HTMLInputElement(); pw.type = 'password'; pw.className = 'ncm-sec-login-input'; pw.tabIndex = 0;
  pw.ownerDocument = { createElement: () => ce }; pw.insertAdjacentElement = () => {}; pw.getAttribute = () => '••••••••'; pw.dispatchEvent = (ev) => dispatched.push(ev);
  globalThis.KeyboardEvent = class { constructor(type, init) { this.type = type; this.key = init.key; } };
  const handle = new HTMLInputElement();
  const root = { querySelectorAll: (sel) => (sel.includes('password') ? [pw, handle] : []) };
  ok(guardSecretInputs(root) === 2, 'both fields are guarded');
  ok(guardSecretInputs(root) === 0, 'guarding is idempotent per element');
  ok(pw.type === 'hidden' && ce.attrs.contenteditable === 'true' && ce.className.includes('ncm-secret-ce') && ce.className.includes('ncm-sec-login-input'), 'the secret field is HIDDEN with an editable element in front — no <input> a manager can attach to');
  ce.fire('beforeinput', { inputType: 'insertText', data: 'a' });
  ce.fire('beforeinput', { inputType: 'insertText', data: 'b' });
  ce.fire('beforeinput', { inputType: 'insertFromPaste', dataTransfer: { getData: () => 'cd' } });
  ok(pw.value === 'abcd' && ce.textContent === '••••' && pw.shown() === 'abcd', 'typing + paste land in the real value; the editable shows bullets; the hidden input carries the real text for the readers');
  ce.fire('beforeinput', { inputType: 'deleteContentBackward' });
  ok(pw.value === 'abc' && ce.textContent === '•••', 'backspace removes one character');
  pw.value = 'keypad-1234';
  ok(pw.value === 'keypad-1234' && ce.textContent === '•'.repeat(11), 'a programmatic write (the terminal keypad) is served back as the real value, shown as bullets');
  pw.ncmSetMasked(false);
  ok(ce.textContent === 'keypad-1234', 'the eye reveals the real text');
  pw.ncmSetMasked(true);
  ok(ce.textContent === '•'.repeat(11), '…and masks it again');
  const r = ce.fire('keydown', { key: 'Enter' });
  ok(r.prevented && dispatched.length === 1 && dispatched[0].key === 'Enter', 'Enter never inserts a newline; it is forwarded to the hidden input so the login listeners fire');
  shadowSecretInput(pw);
  ok(pw.value === 'keypad-1234', 'shadowing twice is a no-op');
  const plain = { dataset: {}, type: 'password' };
  shadowSecretInput(plain);
  ok(plain.type === 'password', 'a non-element (no DOM prototype) is left alone');
  for (const f of ['scripts/ui/ItemInbox/ItemInboxApp.js', 'scripts/ui/Terminal/TerminalViewerApp.js', 'scripts/ui/NetworkManagement/NetworkAuthDialog.js']) {
    ok(/guardSecretInputs\(this\.element\)/.test(readFileSync(`${ROOT}/${f}`, 'utf8')), `${f} guards its secret fields on render`);
  }
  ok(/input\.ncm-autofill-guard\[readonly\]/.test(readFileSync(`${ROOT}/styles/base/interactions.css`, 'utf8')), 'a guarded field is styled like a live one');
  // the two things that summon a manager must never come back
  const allCss = walk(`${ROOT}/styles`).filter((p) => p.endsWith('.css')).map((p) => readFileSync(p, 'utf8')).join('\n');
  ok(!/-webkit-text-security/.test(allCss), 'no stylesheet uses -webkit-text-security (Chromium reads it as a password field)');
  ok(/ncmSetMasked/.test(readFileSync(`${ROOT}/scripts/ui/NetworkManagement/NetworkAuthDialog.js`, 'utf8')), 'the auth dialog eye reveals through the shadow');
  // the page must NEVER contain a password field on a player login screen — a
  // browser classifies a field the moment it is inserted, so a type="password"
  // that script flips to text afterwards has already summoned the manager.
  for (const p of ['item-inbox/security-overlay-login', 'terminal/terminal-login', 'terminal/terminal-manual-login', 'terminal/terminal-viewer', 'dialogs/network-auth-dialog']) {
    const src = readFileSync(`${ROOT}/templates/${p}.hbs`, 'utf8');
    ok(!/type="password"/.test(src) && /data-ncm-secret="1"/.test(src), `${p}.hbs emits its secret field as text + data-ncm-secret, never type=password`);
  }
  // the NAME field: no <input> at all — an editable element mirrors into a hidden one
  {
    const { shadowLoginInput } = await import(`file:///${ROOT}/scripts/utils/helpers.js`);
    let focused = null;
    const secret = { ncmFocus() { focused = 'secret'; } };
    const ce = mkCe();
    const login = new HTMLInputElement(); login.type = 'text'; login.dataset.ncmLogin = '1'; login.value = 'rogue'; login.className = 'ncm-sec-login-input'; login.autofocus = false;
    login.getAttribute = (k) => (k === 'placeholder' ? 'operator' : null);
    login.ownerDocument = { createElement: () => ce, execCommand: () => false, querySelector: (sel) => (sel.includes('data-ncm-secret') ? secret : null) };
    login.closest = () => null;
    let inserted = null; login.insertAdjacentElement = (where, node) => { inserted = [where, node]; };
    guardSecretInputs({ querySelectorAll: () => [login] });
    ok(inserted?.[0] === 'beforebegin' && inserted[1] === ce && login.type === 'hidden' && !login.readOnly, 'the name field becomes a hidden input with an editable element in front of it (no readonly dance needed)');
    ok(ce.attrs.contenteditable === 'true' && ce.attrs.role === 'textbox' && ce.attrs['data-placeholder'] === 'operator' && ce.className.includes('ncm-sec-login-input') && ce.className.includes('ncm-login-ce') && ce.textContent === 'rogue', 'the editable wears the input\'s class, placeholder and prefilled value');
    ce.textContent = ' V\n'; ce.fire('input');
    ok(login.value === 'V', 'typing mirrors into the hidden input (trimmed, no line breaks) — readers by name still work');
    const r = ce.fire('keydown', { key: 'Enter' });
    ok(r.prevented && focused === 'secret', 'Enter never inserts a newline; it moves focus to the passcode');
    ok(shadowLoginInput(login) === null, 'shadowing the name field twice is a no-op');
  }
  const pre = new HTMLInputElement(); pre.type = 'text'; pre.dataset.ncmSecret = '1'; pre.ownerDocument = { createElement: () => mkCe() }; pre.insertAdjacentElement = () => {}; pre.getAttribute = () => '';
  guardSecretInputs({ querySelectorAll: () => [pre] });
  ok(pre.dataset.ncmShadow === '1' && pre.type === 'hidden', 'a data-ncm-secret text field is shadowed by the guard');
  const login = readFileSync(`${ROOT}/templates/item-inbox/security-overlay-login.hbs`, 'utf8');
  ok(!/>\s*(Username|Password|Account|Login|User)\s*</i.test(login) && !/placeholder="admin"/.test(login), 'the shard login labels no longer say Username / Password (a manager heuristic, and the tester\'s confusion)');
}

console.log(`\ntest-login-autofill: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
