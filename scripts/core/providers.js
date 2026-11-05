/**
 * Providers — what a service needs from the UI layer, handed to it instead of imported (R9b, after stage 2).
 * @file scripts/core/providers.js
 * @module night-city-messenger
 *
 * A few services need a piece that lives in `ui/`: the roll panel and the roll animation, the Data Drop overlay, the
 * resident's console, the content-saving relay. Importing them made a service depend on presentation (a sim had to
 * stub the DOM to load it) and broke the layering rule (`dev/tools/sims/test-layering.mjs`). Now the UI side
 * PROVIDES each one by name at init (`init/registerUIComponents.js`, "UI providers"), and a service asks for it
 * with `need(name)` when it runs. The UI file still loads only when first used.
 *
 * A new one: add its name to PROVIDERS, provide it in the init step, and `need()` it in the service.
 * `test-layering` fails on a `need()` / `provided()` of a name that is not in PROVIDERS or not provided at init.
 */

/** name → what it is (the contract; the init step provides each) */
export const PROVIDERS = Object.freeze({
  askRoll: 'the roll panel before a skill check — (o) → Promise<{ cancelled, luck, mod, … }> (ui/content/RollPanel.js)',
  rollReveal: 'the shared roll climax animation — (o) → Promise (ui/content/RollReveal.js)',
  dataDropOverlay: 'the Data Drop animation for a shared contact — (o) → Promise (ui/DataDropOverlay/DataDropOverlay.js)',
  residentConsole: "a resident program's console prompt — (o) → Promise<choice> (ui/content/ResidentConsole.js)",
  canPersistContent: 'can this client get a content change saved (a GM online)? — (o) → boolean (ui/content/SiphonFlow.js)',
  persistContentData: "save a shard / terminal entry's contentData (GM direct, player via relay) — (…) → Promise (ui/content/SiphonFlow.js)",
  migrateRecycleBin: 'move the old recycle-bin setting into its journal (migration v6) — () → Promise<number> (ui/content/SiphonFlow.js)',
});

const table = new Map();

/** Register a provider (the init step). */
export function provide(name, fn) {
  if (!(name in PROVIDERS)) throw new Error(`NCM providers: "${name}" is not a known provider (add it to PROVIDERS)`);
  if (typeof fn !== 'function') throw new Error(`NCM providers: "${name}" must be a function`);
  table.set(name, fn);
}

/** The provider, or null when nothing registered it (a caller that can do without it). */
export function provided(name) { return table.get(name) || null; }

/** The provider; throws a clear error when it is missing (the UI step did not run). */
export function need(name) {
  const fn = table.get(name);
  if (!fn) throw new Error(`NCM: "${name}" is not available — the "UI providers" startup step did not register it`);
  return fn;
}

/** For sims: register several at once, or clear. */
export function _provideAll(map = {}) { for (const [k, v] of Object.entries(map)) provide(k, v); }
export function _clearProviders() { table.clear(); }
