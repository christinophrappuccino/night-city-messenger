/**
 * The sound catalogue (2026-10-29, dev: "a spot to change the sounds… what sounds and where it's used").
 * @file scripts/utils/soundCatalog.js
 * @module night-city-messenger
 *
 * Pure (no Foundry globals): what every SOUND_PATHS id is for, the groups the Sound board shows, and the rules for
 * the GM's replacements — world setting `soundOverrides` = { [id]: { src, volume, off } } (only the sounds the GM
 * changed). `soundSource(id, overrides)` is the ONE answer to "what file plays, how loud, or nothing".
 */

import { SOUND_PATHS } from './constants.js';

export const SOUND_GROUPS = Object.freeze([
  ['ui', 'Windows & buttons', 'fa-window-maximize'],
  ['mail', 'Messages', 'fa-envelope'],
  ['net', 'Networks', 'fa-wifi'],
  ['sec', 'Logins & hacking', 'fa-user-secret'],
  ['shard', 'Data shards & terminals', 'fa-microchip'],
  ['calls', 'Calls', 'fa-phone'],
  ['other', 'Not used yet', 'fa-ellipsis'],
]);

/** id → { label, group, where } — `where` is plain words for the GM. */
export const SOUND_INFO = Object.freeze({
  'open': { label: 'Window opens', group: 'ui', where: 'Any messenger window opening (inbox, composer, contacts, shard, terminal, admin panel).' },
  'close': { label: 'Window closes', group: 'ui', where: 'Any messenger window closing.' },
  'click': { label: 'Button click', group: 'ui', where: 'Every button in a messenger window. Played quietly and slightly varied each press.' },
  'error': { label: 'Error', group: 'ui', where: 'Something refused or failed: a bad file, a refused share, a breach that will not start.' },
  'receive': { label: 'New message', group: 'mail', where: 'A message arrives for your character; also the end of a terminal download.' },
  'receive-urgent': { label: 'Urgent message', group: 'mail', where: 'A message marked urgent or critical arrives; a planted program firing.' },
  'send': { label: 'Message sent', group: 'mail', where: 'Sending from the composer; the start of a terminal download; a network broadcast.' },
  'destruct': { label: 'Self-destruct', group: 'mail', where: 'A self-destructing message erasing itself.' },
  'connect': { label: 'Connect', group: 'net', where: 'Joining a network; a network node switched back on.' },
  'disconnect': { label: 'Disconnect', group: 'net', where: 'Leaving a network; a node switched off; jacking out of a node.' },
  'switch': { label: 'Switch network', group: 'net', where: 'Changing which network you are on.' },
  'dead-zone': { label: 'Dead zone', group: 'net', where: 'Losing all signal (a dead-zone scene, or every node down).' },
  'hack-start': { label: 'Hack starts', group: 'sec', where: 'The start of a breach: shard hack, siphon, jacking into a node.' },
  'hack-progress': { label: 'Hack in progress', group: 'sec', where: 'The dice spinning in a skill check; the middle of a breach, an upload or a sweep.' },
  'hack-success': { label: 'Hack succeeds', group: 'sec', where: 'A skill check or breach that succeeds (shards, messages, contacts, nodes).' },
  'hack-fail': { label: 'Hack fails', group: 'sec', where: 'A skill check or breach that fails.' },
  'black-ice': { label: 'Black ICE', group: 'sec', where: 'Black ICE hitting a character.' },
  'lockout': { label: 'Locked out', group: 'sec', where: 'Too many failed tries: a network, account, shard or node locks someone out.' },
  'login-success': { label: 'Login accepted', group: 'sec', where: 'A network or terminal login that works; picking an operator.' },
  'login-fail': { label: 'Login refused', group: 'sec', where: 'A wrong password or a failed login.' },
  'key-accepted': { label: 'Key item accepted', group: 'sec', where: 'A key item (keycard, chip) opens a lock.' },
  'key-rejected': { label: 'Key item rejected', group: 'sec', where: 'The wrong key item is presented.' },
  'trace-fire': { label: 'Trace', group: 'sec', where: 'A failed action that leaves a trace; a trace countdown running out.' },
  'shard-insert': { label: 'Shard inserted', group: 'shard', where: 'A shard is converted or written to; a program installs.' },
  'shard-decrypt': { label: 'Shard unlocked', group: 'shard', where: 'A shard, message or file opening after a breach; an anonymous sender traced.' },
  'shard-relock': { label: 'Shard relocked', group: 'shard', where: 'The GM relocks a shard or resets a terminal.' },
  'shard-boot': { label: 'Startup', group: 'shard', where: 'A shard or terminal running its startup screen.' },
  'shard-compile': { label: 'Compiling', group: 'shard', where: 'Writing a shard in the Encoder; an upload compiling; burning a file to a shard.' },
  'shard-brick': { label: 'Shard bricked', group: 'shard', where: 'A shard destroyed (integrity at zero, or a botched encode).' },
  'shard-expire': { label: 'Shard expires', group: 'shard', where: 'A shard that self-destructs on a timer.' },
  'eddies-claim': { label: 'Eddies claimed', group: 'shard', where: 'Claiming eddies from a message, shard or terminal file.' },
  'call-ring': { label: 'Ringing', group: 'calls', where: 'A call coming in — plays once per ring. Silent mode mutes it.' },
  'call-ringback': { label: 'Ringing out', group: 'calls', where: 'What the caller hears while the other phone rings.' },
  'call-connect': { label: 'Call connects', group: 'calls', where: 'A call is answered.' },
  'call-end': { label: 'Call ends', group: 'calls', where: 'Someone hangs up, or a call ends for any normal reason.' },
  'call-drop': { label: 'Call dropped', group: 'calls', where: 'A call cut off: no signal, a node going down, the GM dropping the line.' },
  'call-waiting': { label: 'Call waiting', group: 'calls', where: 'A second call coming in while you are already on one.' },
  'voicemail-beep': { label: 'Voicemail tone', group: 'calls', where: 'The tone after a voicemail greeting.' },
  'keystroke': { label: 'Keystroke', group: 'other', where: 'Not played anywhere yet.' },
  'queue-flush': { label: 'Queued mail sent', group: 'other', where: 'Not played anywhere yet.' },
  'terminal-hum': { label: 'Terminal hum', group: 'other', where: 'Not played anywhere yet.' },
});

/** The module's own file for a sound (relative to the module root). */
export const defaultSoundPath = (id, moduleId) => (SOUND_PATHS[id] ? `modules/${moduleId}/assets/sounds/${SOUND_PATHS[id]}` : '');

const AUDIO = /\.(ogg|oga|mp3|wav|webm|m4a|aac|flac|opus)(\?.*)?$/i;

/** Clean the stored overrides: known ids only, a path or http(s) url to an audio file, volume 0.1–2, off flag. */
export function sanitizeSoundOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!SOUND_PATHS[id] || !v || typeof v !== 'object') continue;
    const src = typeof v.src === 'string' ? v.src.trim() : '';
    const okSrc = src && !/^(javascript|data):/i.test(src) && !/["'<>]/.test(src) && AUDIO.test(src) ? src : '';
    const vol = Number(v.volume);
    const rec = {};
    if (okSrc) rec.src = okSrc;
    if (Number.isFinite(vol) && vol !== 1) rec.volume = Math.max(0.1, Math.min(2, Math.round(vol * 100) / 100));
    if (v.off === true) rec.off = true;
    if (Object.keys(rec).length) out[id] = rec;
  }
  return out;
}

/**
 * What actually plays for a sound: { src, volume, off, custom }. `off` = play nothing. `custom` = the GM's file.
 * @param {string} id @param {object} overrides — the (sanitized) setting @param {string} moduleId
 */
export function soundSource(id, overrides = {}, moduleId = 'night-city-messenger') {
  const o = overrides?.[id] || {};
  return { src: o.src || defaultSoundPath(id, moduleId), volume: o.volume ?? 1, off: !!o.off, custom: !!o.src };
}

/** The Sound board's rows, grouped. */
export function soundBoard(overrides = {}, moduleId = 'night-city-messenger') {
  return SOUND_GROUPS.map(([key, label, icon]) => ({
    key, label, icon,
    rows: Object.entries(SOUND_INFO).filter(([, i]) => i.group === key).map(([id, i]) => {
      const s = soundSource(id, overrides, moduleId);
      return { id, label: i.label, where: i.where, src: s.src, file: s.custom ? s.src.split('/').pop() : '', custom: s.custom, off: s.off,
        volume: Math.round(s.volume * 100), changed: !!overrides?.[id], unused: key === 'other' };
    }),
  })).filter((g) => g.rows.length);
}

/** Every SOUND_PATHS id has a catalogue row (the sim checks it). */
export const catalogueGaps = () => Object.keys(SOUND_PATHS).filter((id) => !SOUND_INFO[id]);
