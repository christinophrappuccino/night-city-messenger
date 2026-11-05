/**
 * Foundry version differences — the ONE place NCM reaches for a Foundry class or function that moved (stage 2,
 * step 10a: Foundry v13 readiness).
 * @file scripts/utils/compat.js
 * @module night-city-messenger
 *
 * Foundry v13 moves many global classes and functions into namespaces (`foundry.applications.handlebars`,
 * `foundry.applications.apps`, …). The old global names still work in v13 but print a deprecation warning, and a
 * later version removes them. NCM declares v12, where the namespaces mostly don't exist yet. So every lookup here
 * tries the NEW place first and falls back to the v12 global.
 *
 * Two rules:
 *   - Resolve at CALL time (functions, not constants): a module can be imported before Foundry has built everything.
 *   - A v12 fallback is a BARE identifier behind `typeof`, never `globalThis.X`. In v12 these are top-level `class`
 *     declarations in Foundry's classic scripts — lexical globals, which are NOT properties of the global object
 *     (the ImagePopout lesson). `typeof` also keeps an absent name from throwing a ReferenceError.
 *
 * `dev/tools/check-deprecations.mjs` (run by CI) fails when code outside this file uses one of these names directly.
 * When Foundry moves something else NCM uses: add it here, list it in that tool, migrate the callers.
 */

/** Pure: read a dotted path off an object (`'applications.apps.FilePicker'`). */
const at = (root, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root);
const ns = (dotted) => at(globalThis.foundry, dotted);

/** Foundry's major version (12, 13, …), or 0 when it can't be read. */
export function foundryGeneration() {
  return Number(globalThis.game?.release?.generation ?? String(globalThis.game?.version || '').split('.')[0]) || 0;
}

// ─── Handlebars templates ───────────────────────────────────────────────────
/** `renderTemplate(path, data)` — v13 `foundry.applications.handlebars.renderTemplate`, v12 global. */
export function renderTemplate(path, data) {
  const fn = ns('applications.handlebars.renderTemplate') || (typeof globalThis.renderTemplate === 'function' ? globalThis.renderTemplate : null);
  if (!fn) throw new Error('NCM | renderTemplate is not available');
  return fn(path, data);
}
/** `loadTemplates(paths)` — v13 namespaced, v12 global. */
export function loadTemplates(paths) {
  const fn = ns('applications.handlebars.loadTemplates') || (typeof globalThis.loadTemplates === 'function' ? globalThis.loadTemplates : null);
  if (!fn) throw new Error('NCM | loadTemplates is not available');
  return fn(paths);
}
/** `getTemplate(path)` — v13 namespaced, v12 global. */
export function getTemplate(path) {
  const fn = ns('applications.handlebars.getTemplate') || (typeof globalThis.getTemplate === 'function' ? globalThis.getTemplate : null);
  if (!fn) throw new Error('NCM | getTemplate is not available');
  return fn(path);
}

// ─── Classes ────────────────────────────────────────────────────────────────
/** The file picker class (v13: the configured implementation of `foundry.applications.apps.FilePicker`). */
export function FilePickerClass() {
  return ns('applications.apps.FilePicker.implementation') || ns('applications.apps.FilePicker')
    || (typeof FilePicker !== 'undefined' ? FilePicker : null);   // eslint-disable-line no-undef
}
/** `new FilePicker(options)` through the right class. Returns the picker (call `.render(true)` or `.browse()`). */
export function newFilePicker(options) {
  const FP = FilePickerClass();
  if (!FP) throw new Error('NCM | the file picker is not available');
  return new FP(options);
}
/** `FilePicker.browse(source, target, options)` through the right class. */
export function browseFiles(source, target, options) {
  const FP = FilePickerClass();
  if (!FP?.browse) throw new Error('NCM | the file picker is not available');
  return FP.browse(source, target, options);
}
/** The image popout class (v13 `foundry.applications.apps.ImagePopout`). */
export function ImagePopoutClass() {
  return ns('applications.apps.ImagePopout') || (typeof ImagePopout !== 'undefined' ? ImagePopout : null);   // eslint-disable-line no-undef
}
/** The document permissions window class. */
export function DocumentOwnershipConfigClass() {
  return ns('applications.apps.DocumentOwnershipConfig') || (typeof DocumentOwnershipConfig !== 'undefined' ? DocumentOwnershipConfig : null);   // eslint-disable-line no-undef
}
/** The Configure Settings window class (its static `reloadConfirm` asks everyone to reload). */
export function SettingsConfigClass() {
  return ns('applications.settings.SettingsConfig') || (typeof SettingsConfig !== 'undefined' ? SettingsConfig : null);   // eslint-disable-line no-undef
}
/** The canvas interaction layer base class (NCM's own scene-controls layer extends it). */
export function InteractionLayerClass() {
  return ns('canvas.layers.InteractionLayer') || (typeof InteractionLayer !== 'undefined' ? InteractionLayer : null);   // eslint-disable-line no-undef
}

// ─── Hook arguments ─────────────────────────────────────────────────────────
/**
 * The HTML element a hook or dialog callback was given. v12 hands jQuery to v1 apps and dialogs; v13 hands elements.
 * Use `htmlOf(html).querySelector(…)` instead of `html.find(…)` and the code works on both.
 * @param {HTMLElement|object} html  an element, or a jQuery object
 * @returns {HTMLElement|null}
 */
export function htmlOf(html) {
  if (!html) return null;
  if (typeof html.querySelector === 'function') return html;   // already an element
  if (html.jquery || typeof html.get === 'function') return html[0] ?? html.get?.(0) ?? null;
  return html[0] ?? null;
}
