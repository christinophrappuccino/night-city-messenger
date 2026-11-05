/**
 * Module Settings, in sections (stage 2, step 18).
 * @file scripts/ui/settingsLayout.js
 * @module night-city-messenger
 *
 * Foundry lists a module's settings in the order they were registered, as one long list. This table says which
 * section each visible NCM setting belongs to; when the settings window renders, `layOutSettings` moves NCM's rows
 * under a heading per section, in this order. Nothing about the settings themselves changes (keys, values, scope),
 * and only NCM's own rows move. A visible setting missing from the table lands in a final "Other" section, so it can
 * never disappear; `dev/tools/sims/test-settings-layout.mjs` fails until it is placed.
 *
 * Works on v12 (`.form-group[data-setting-id]`) and v13 (`formGroup` rows): a row is found through its input's
 * `name`, which is `night-city-messenger.<key>` on both.
 */

import { MODULE_ID } from '../utils/constants.js';
import { htmlOf } from '../utils/compat.js';
import { log } from '../utils/helpers.js';

/** Section → the setting keys it holds, in display order. */
export const SETTINGS_LAYOUT = Object.freeze([
  { title: 'Systems', hint: 'Switch whole parts of NCM on or off. Most of these reload the world; nothing is deleted.',
    keys: ['networkSimulationEnabled', 'callsEnabled', 'payphonesEnabled', 'emergencyEnabled', 'overheardEnabled', 'conversationsEnabled', 'traceConsequencesEnabled'] },
  { title: 'Mail', hint: 'How mail is grouped, who players may write to, and where stolen files go.',
    keys: ['subjectThreading', 'requireContactVerification', 'autoRegisterNpcSenders', 'exfilFolderName'] },
  { title: 'Email addresses', hint: 'The address each character picks the first time they open their inbox.',
    keys: ['emailSetupRequired', 'emailDefaultDomain', 'emailAllowCustomDomains', 'emailAllowPlayerBurn'] },
  { title: 'Anonymous send', hint: 'Your composer can hide who sent a message; players can try to trace it.',
    keys: ['anonSendEnabled', 'anonDefaultStyle', 'anonAllowRepliesDefault', 'anonTraceEnabled', 'anonTraceDV', 'anonTraceSkill'] },
  { title: 'Spam filter', hint: 'Mail from senders a player has not added can land in their Spam folder.',
    keys: ['spamUnknownSenderEnabled', 'spamUnknownSenderChance', 'spamUnknownSenderScope', 'spamUnknownSenderExcludePlayers'] },
  { title: 'GM alerts', hint: 'What pings you while you run the game.',
    keys: ['notifyGmNpcMail', 'notifyGmConversations', 'notifyGmEmergency', 'emergencyChatCard'] },
  { title: 'Shards, terminals & hacking', hint: 'Names for shards, map pins, planted programs and how rolls work.',
    keys: ['shardTerm', 'shardTermCustom', 'shardNamePrefix', 'terminalPinsAutoShow', 'residentFireMode', 'roleAbilityRoll', 'askBeforeRoll'] },
  { title: 'Date & time', hint: 'Which clock NCM follows and how dates are written.',
    keys: ['timeProvider', 'dateFormat', 'dateMonthStyle', 'timeFormat'] },
  { title: 'Advanced', hint: 'Watching other players, and the console explanations for troubleshooting.',
    keys: ['watchMode', 'debugMode'] },
]);

const HEAD_CLASS = 'ncm-settings-head';

/**
 * Re-order NCM's rows in a rendered settings window into the sections above. Idempotent: safe on every render.
 * @param {HTMLElement|jQuery} html the window's element (either version's hook argument)
 */
export function layOutSettings(html) {
  const root = htmlOf(html);
  if (!root?.querySelectorAll) return;
  const rowOf = (key) => root.querySelector(`[name="${MODULE_ID}.${key}"]`)?.closest('.form-group') || null;
  // every NCM row on screen (the GM sees world + client, a player only client ones)
  const all = [...root.querySelectorAll(`[name^="${MODULE_ID}."]`)].map((el) => el.closest('.form-group')).filter(Boolean);
  if (!all.length) return;
  const host = all[0].parentElement;
  if (!host || all.some((r) => r.parentElement !== host)) return;   // an unexpected layout: leave it as Foundry drew it
  host.querySelectorAll(`.${HEAD_CLASS}`).forEach((h) => h.remove());

  const placed = new Set();
  const frag = document.createDocumentFragment();
  const section = (title, hint, rows) => {
    if (!rows.length) return;
    const h = document.createElement('h3');
    h.className = HEAD_CLASS;
    h.textContent = title;
    if (hint) { const s = document.createElement('small'); s.textContent = hint; h.appendChild(s); }
    frag.appendChild(h);
    for (const r of rows) { frag.appendChild(r); placed.add(r); }
  };
  const anchor = all[0].previousSibling;   // where NCM's block starts (menus, if any, stay above it)
  for (const s of SETTINGS_LAYOUT) section(s.title, s.hint, s.keys.map(rowOf).filter((r) => r && !placed.has(r)));
  section('Other', '', all.filter((r) => !placed.has(r)));
  host.insertBefore(frag, anchor ? anchor.nextSibling : host.firstChild);
}

/** Install the hook (init). */
export function registerSettingsLayout() {
  Hooks.on('renderSettingsConfig', (app, html) => {
    try { layOutSettings(html); } catch (err) { log.warn(`Settings layout failed: ${err.message}`); }
  });
}
