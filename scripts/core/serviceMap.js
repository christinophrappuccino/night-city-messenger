/**
 * Which NCM service relies on which, and what each one does at the table (stage 2, batch 8).
 * @file scripts/core/serviceMap.js
 * @module night-city-messenger
 *
 * Services find each other at run time through `game.nightcity.<name>`, so the import graph shows none of these
 * links. When a startup step fails, its service is missing and everything that relies on it quietly does less (most
 * lookups are `?.`). This table lets the startup report say WHAT stopped working, not only which step failed.
 *
 * `uses` must match the code: `dev/tools/sims/test-service-map.mjs` re-derives every service's `game.nightcity.*`
 * lookups from its source and fails when this table and the code disagree. Add a lookup → add it here.
 * `does` is for the GM: plain words, what they would notice.
 */

/**
 * `feature` (optional): built only when that feature is on (utils/features.js), so its absence is not a failure.
 * @type {Record<string, { uses: string[], does: string, feature?: string }>}
 */
export const SERVICE_MAP = Object.freeze({
  timeService:           { uses: [], does: 'the game clock' },
  soundService:          { uses: [], does: 'sounds' },
  themeService:          { uses: [], does: 'player themes' },
  skillService:          { uses: ['networkService', 'soundService'], does: 'skill rolls' },
  networkService:        { uses: ['accessLogService', 'messageRepository', 'messageService', 'soundService', 'timeService'], does: 'networks, signal and dead zones' },
  securityService:       { uses: ['notificationService', 'soundService', 'timeService'], does: 'lockouts' },
  iceService:            { uses: ['networkService', 'soundService'], does: 'Black ICE' },
  traceService:          { uses: ['notificationService', 'soundService', 'terminalService', 'timeService'], does: 'traces and heat' },
  traceCountdownHud:     { uses: ['timeService'], does: 'trace countdowns on screen' },
  messageRepository:     { uses: ['masterContactService', 'timeService'], does: 'stored mail' },
  contactRepository:     { uses: ['emailService', 'masterContactService'], does: "players' contact lists" },
  messageService:        { uses: ['contactGroupService', 'contactRepository', 'iceService', 'masterContactService', 'messageRepository', 'networkService', 'notificationService', 'skillService', 'soundService', 'spamService', 'terminalService', 'timeService', 'traceService'], does: 'sending and delivering mail' },
  notificationService:   { uses: ['conversationService', 'masterContactService', 'messageRepository', 'messageService', 'networkService', 'soundService', 'terminalService'], does: 'toasts' },
  spamService:           { uses: ['messageRepository', 'messageService', 'networkService', 'timeService'], does: 'spam' },
  messageTemplateService:{ uses: [], does: 'message templates' },
  dataShardService:      { uses: ['iceService', 'messageRepository', 'networkService', 'securityService', 'skillService', 'soundService', 'timeService', 'traceService'], does: 'data shards' },
  terminalService:       { uses: ['dataShardService', 'iceService', 'masterContactService', 'messageRepository', 'networkService', 'securityService', 'skillService', 'soundService', 'timeService', 'traceService'], does: 'terminals' },
  terminalScenePins:     { uses: ['dataShardService', 'networkService', 'payphoneService', 'soundService', 'terminalService'], does: 'map pins' },
  schedulingService:     { uses: ['contactGroupService', 'messageService', 'terminalService', 'timeService'], does: 'scheduled mail' },
  masterContactService:  { uses: ['callService', 'contactRepository', 'emailService'], does: 'the contact directory' },
  contactGroupService:   { uses: ['contactRepository', 'masterContactService'], does: 'contact groups' },
  portraitService:       { uses: ['contactRepository', 'masterContactService'], does: 'portraits' },
  contactBreachService:  { uses: ['contactRepository', 'notificationService', 'skillService', 'soundService', 'timeService', 'traceService'], does: 'encrypted contacts' },
  contactShareService:   { uses: ['callService', 'contactRepository', 'networkService', 'notificationService', 'portraitService'], does: 'Data Drop contact sharing' },
  messageAccessService:  { uses: ['messageRepository', 'networkService', 'securityService', 'skillService', 'soundService', 'timeService', 'traceService'], does: 'locked and network-gated mail' },
  emailService:          { uses: ['masterContactService'], does: 'email addresses and setup' },
  accessLogService:      { uses: ['networkService'], does: 'the network activity log' },
  conversationService:   { uses: ['masterContactService', 'messageRepository', 'networkService', 'notificationService', 'soundService', 'timeService'], does: 'conversations' },
  callService:           { uses: ['accessLogService', 'contactRepository', 'emergencyHud', 'emergencyService', 'masterContactService', 'messageRepository', 'networkService', 'payphoneService', 'skillService', 'soundService', 'terminalService', 'timeService', 'traceService'], does: 'calls and voicemail' },
  callHud:               { uses: ['masterContactService', 'soundService', 'themeService'], does: 'the call screen', feature: 'calls' },
  emergencyService:      { uses: ['emergencyHud', 'notificationService', 'skillService', 'soundService', 'timeService'], does: 'emergency calls' },
  emergencyHud:          { uses: ['soundService', 'themeService'], does: 'the emergency call screen', feature: 'emergency' },
  overheardService:      { uses: ['masterContactService', 'messageRepository', 'networkService', 'overheardHud', 'terminalService', 'timeService', 'traceService'], does: 'overheard calls' },
  overheardHud:          { uses: ['skillService'], does: 'the overheard-call strip', feature: 'overheard' },
  payphoneService:       { uses: ['callService', 'payphoneBooth', 'soundService', 'terminalScenePins'], does: 'payphones' },
  payphoneBooth:         { uses: ['emergencyService', 'soundService', 'themeService'], does: 'the payphone booth', feature: 'payphones' },
  watchService:          { uses: [], does: 'watching another player' },
});

/**
 * Pure: the services that use one of `missing` directly, so do less without it.
 * Direct users only, on purpose: the services depend on each other in loops, so following the chain outward would
 * list nearly everything for any missing service (no sound is not "mail is broken").
 * @param {string[]} missing  service names
 * @param {Record<string, { uses: string[] }>} [map]
 * @returns {string[]}  the affected services, NOT including the missing ones themselves, in table order
 */
export function affectedBy(missing, map = SERVICE_MAP) {
  return Object.keys(map).filter((n) => !missing.includes(n) && map[n].uses.some((u) => missing.includes(u)));
}

/**
 * Pure: the sentence the GM reads for a broken startup.
 * @param {{ failed: string[], missing: string[], map?: object }} o  failed = startup step names; missing = service names
 * @returns {string}  '' when nothing is wrong
 */
export function startupImpact({ failed = [], missing = [], map = SERVICE_MAP }) {
  if (!failed.length && !missing.length) return '';
  const words = (names) => [...new Set(names.map((n) => map[n]?.does || n))];
  const list = (a, max = 6) => (a.length > max ? `${a.slice(0, max).join(', ')}, and ${a.length - max} more` : a.join(', '));
  const parts = [];
  if (failed.length) parts.push(`${failed.length} startup step${failed.length === 1 ? '' : 's'} failed: ${list(failed, 4)}.`);
  if (missing.length) {
    parts.push(`Not running: ${list(words(missing))}.`);
    const also = words(affectedBy(missing, map));
    if (also.length) parts.push(`Working only partly because they rely on it: ${list(also)}.`);
  }
  return parts.join(' ');
}
