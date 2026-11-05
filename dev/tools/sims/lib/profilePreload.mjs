// Loaded by run-checks with `node --import` before every sim (stage 2 step 10, part 4). Most sims build their own
// `globalThis.game = { … }` with no release, which compat.js reads as "version unknown" and so v12 — that would make a
// v13 run test nothing new. This makes `globalThis.game` an accessor that stamps the run's profile (NCM_FOUNDRY_VERSION)
// onto whatever object a sim assigns, unless the sim set its own release (then the sim's wins). Nothing else changes:
// reading, replacing and deleting `game` behave as before.
import { applyFoundryProfile } from './foundryVersion.mjs';

let current = globalThis.game;
Object.defineProperty(globalThis, 'game', {
  configurable: true,
  enumerable: true,
  get() { return current; },
  set(v) { current = applyFoundryProfile(v); },
});
if (current) applyFoundryProfile(current);
