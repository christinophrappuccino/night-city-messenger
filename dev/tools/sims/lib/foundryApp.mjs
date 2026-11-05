// Where the sims find Foundry's own libraries (Handlebars 4.7.8 in both v12 and v13) and core templates.
//
// Order: NCM_FOUNDRY_APP first — a folder with a package.json and node_modules/handlebars, e.g. Foundry's
// `resources/app`, or the `npm install handlebars@4.7.8` that CI makes — then the local installs of the version this
// run models (NCM_FOUNDRY_VERSION; the profiles in ./foundryVersion.mjs list them: v12 the Windows install, v13 the
// Node build in dev/). NCM_NO_LOCAL_FOUNDRY=1 drops the local installs, to check on this machine that a sim passes the
// way CI runs it.
import { foundryProfile } from './foundryVersion.mjs';

const env = process.env.NCM_FOUNDRY_APP ? [process.env.NCM_FOUNDRY_APP.replace(/\\/g, '/').replace(/\/(package\.json)?$/, '')] : [];
const LOCAL = foundryProfile().appDirs;

/** Folders holding Foundry's app code (each has package.json + node_modules). */
export const FOUNDRY_APP_DIRS = [...env, ...(process.env.NCM_NO_LOCAL_FOUNDRY ? [] : LOCAL)];
/** The same folders' package.json paths — what `createRequire(p)('handlebars')` wants. */
export const FOUNDRY_APP_PKGS = FOUNDRY_APP_DIRS.map((d) => `${d}/package.json`);
