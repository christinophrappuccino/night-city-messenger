// Foundry version profiles for the sims (stage 2 step 10, part 4) — the ONE place the v12 / v13 differences the sims
// care about are written down. A sim run picks one with NCM_FOUNDRY_VERSION=12|13 (default 12, what the dev plays on);
// `node dev/tools/run-checks.mjs --foundry 13` sets it, and CI runs the whole suite once per version.
//
//   - createMockWorld (lib/world.mjs) stamps game.release from the profile;
//   - lib/profilePreload.mjs (run-checks loads it with --import) stamps it onto any `globalThis.game` a sim builds by
//     hand without one, so compat.js takes that version's branch in every sim, not only the world.mjs ones;
//   - lib/foundryApp.mjs looks for that version's Foundry install (Handlebars, core templates) first.
// A sim that tests BOTH versions on purpose (test-compat, test-directory-menu) sets game.release itself; that wins.
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url))).replace(/\\/g, '/');

export const FOUNDRY_PROFILES = Object.freeze({
  12: Object.freeze({
    generation: 12, version: '12.343', handlebars: '4.7.8',
    chatHook: 'renderChatMessage',                          // jQuery html
    directoryMenuHook: (doc) => `get${doc}DirectoryEntryContext`,
    sceneControls: 'array',
    tokenHud: 'templates/hud/token-hud.html',
    appDirs: ['C:/Program Files/Foundry Virtual Tabletop/resources/app', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app'],
  }),
  13: Object.freeze({
    generation: 13, version: '13.351', handlebars: '4.7.8',
    chatHook: 'renderChatMessageHTML',                      // an element
    directoryMenuHook: (doc) => `get${doc}ContextOptions`,  // collected once, at the directory's first render
    sceneControls: 'record',
    tokenHud: 'templates/hud/token-hud.hbs',
    appDirs: [`${ROOT}/dev/FoundryVTT-Node-13.351`],         // the gitignored Node build (memory: v13-test-install)
  }),
});

/** The version this sim run models (NCM_FOUNDRY_VERSION, default 12). An unknown value is an error, not a silent 12. */
export const SIM_FOUNDRY_VERSION = (() => {
  const v = Number(process.env.NCM_FOUNDRY_VERSION || 12);
  if (!FOUNDRY_PROFILES[v]) throw new Error(`NCM_FOUNDRY_VERSION=${process.env.NCM_FOUNDRY_VERSION}: no such profile (have ${Object.keys(FOUNDRY_PROFILES).join(', ')})`);
  return v;
})();

/** The profile for a version (this run's by default). */
export function foundryProfile(v = SIM_FOUNDRY_VERSION) {
  const p = FOUNDRY_PROFILES[v];
  if (!p) throw new Error(`no Foundry profile ${v}`);
  return p;
}

/** Stamp a mocked `game` with the profile's release (Foundry's shape), unless it already has one. Returns the game. */
export function applyFoundryProfile(game, v = SIM_FOUNDRY_VERSION) {
  if (!game || typeof game !== 'object' || game.release) return game;
  const p = foundryProfile(v);
  game.release = { generation: p.generation, build: Number(p.version.split('.')[1]), version: p.version };
  if (game.version === undefined) game.version = p.version;
  return game;
}
