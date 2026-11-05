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

// ─── Hooks whose shape changed ──────────────────────────────────────────────
/**
 * Listen to a chat message being drawn, with an HTML ELEMENT on both versions. v13 deprecates `renderChatMessage`
 * (jQuery; removed in v15) for `renderChatMessageHTML` (element). Registers exactly one of the two.
 * @param {(message: ChatMessage, el: HTMLElement, data: object) => void} fn
 * @returns {number} the hook id
 */
export function onRenderChatMessage(fn) {
  if (foundryGeneration() >= 13) return Hooks.on('renderChatMessageHTML', (message, el, data) => fn(message, htmlOf(el), data));
  return Hooks.on('renderChatMessage', (message, html, data) => fn(message, htmlOf(html), data));
}

/**
 * Add one group of buttons to the scene controls (call it from a `getSceneControlButtons` hook).
 * Written in the v12 shape: `{ name, title, icon, layer, tools: [{ name, title, icon, button: true, onClick }] }`.
 *   v12 hands the hook an ARRAY of groups; the group is pushed as it is.
 *   v13 hands it a RECORD keyed by name (Foundry's SceneControls#prepareControls), each tool a record entry with an
 *   `order` and `onChange(event, active)`; `onClick` is deprecated there (removed in v15). A group is joined to a
 *   canvas layer by its own `onChange`, not a `layer` field. Selecting a group fires its `activeTool`'s onChange, so
 *   a BUTTON only acts when the click landed on that button — otherwise opening the group would open the inbox.
 * @param {object[]|Record<string, object>} controls  what the hook received
 * @param {{name:string, title:string, icon:string, layer?:string, tools:object[]}} group
 */
export function addSceneControlGroup(controls, { name, title, icon, layer, tools = [] }) {
  if (Array.isArray(controls)) { controls.push({ name, title, icon, layer, tools }); return; }   // v12
  if (!controls || typeof controls !== 'object' || !tools.length) return;
  const record = {};
  tools.forEach((t, i) => {
    record[t.name] = {
      name: t.name, title: t.title, icon: t.icon, order: i, button: !!t.button, visible: t.visible !== false,
      onChange: (event, active) => {
        if (!t.button) { t.onClick?.(active); return; }
        if (!active) return;
        const clicked = event?.target?.closest?.('[data-tool]')?.dataset?.tool;
        if (clicked === t.name) t.onClick?.();
      },
    };
  });
  controls[name] = {
    name, title, icon, order: Object.keys(controls).length, visible: true, tools: record, activeTool: tools[0].name,
    onChange: (event, active) => { if (active && layer) globalThis.canvas?.[layer]?.activate?.(); },
  };
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
