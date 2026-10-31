/**
 * Voicemail — the rules (phase 3a: greetings, typed / read-out messages). Pure: no Foundry globals.
 * @file scripts/utils/voicemail.js
 * @module night-city-messenger
 * @description Design dev/design/CALLS.md §7. Every NUMBER has its own line settings (a main line and each burner can
 *   sound different), kept in the number directory (`phoneLines[number].settings`): the greeting (default / typed /
 *   read out by the browser's voice) and the voicemail switches (take messages, do not disturb). A message is
 *   `{ vmId, callId, from, to, text, kind: 'typed'|'tts', voice, at, gameTime, heard }`, kept as a page in the
 *   recipient's inbox (no messageId — no mail reader shows it). Recorded audio is phase 3b.
 */

export const GREETING_KINDS = Object.freeze(['default', 'typed', 'tts', 'recorded']);
export const GREETING_LABELS = Object.freeze({ default: 'Default', typed: 'Typed', tts: 'Read out', recorded: 'Recorded' });
/** A recorded greeting is short; a message is up to the GM's limit. A stored audio reference (a path, or a data URL
 *  when the world cannot take files) is capped so a page flag never balloons. */
export const GREETING_RECORD_MS = 20000;
export const AUDIO_REF_MAX = 900000;
const cleanAudio = (v) => {
  if (typeof v !== 'string' || !v || v.length > AUDIO_REF_MAX || /["'<>\s]/.test(v)) return '';
  if (/^data:/i.test(v)) return /^data:audio\/[\w.+-]+(;[\w=.+-]+)*;base64,[A-Za-z0-9+/=]+$/i.test(v) ? v : '';
  if (/^[a-z][\w+.-]*:/i.test(v)) return /^https?:\/\//i.test(v) ? v : '';   // a scheme: only http(s)
  return v;                                                                  // a plain path (the world's ncm-voicemail folder)
};
export const DEFAULT_GREETING = 'The person you are calling is not available.';
export const TONE_LINE = 'Leave a message after the tone.';
export const GREETING_MAX = 300;
export const VOICEMAIL_MAX = 1000;
export const VOICE_NAME_MAX = 120;

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A number's line settings made safe. A new number: the default greeting, takes messages, not on do not disturb. */
export function sanitizeLineSettings(v = {}) {
  const g = v?.greeting || {};
  const vm = v?.voicemail || {};
  const kind = GREETING_KINDS.includes(g.kind) ? g.kind : 'default';
  const text = clean(g.text, GREETING_MAX);
  const audio = cleanAudio(g.audio);
  // a typed / read-out greeting needs words; a recorded one needs its recording (the words are optional subtitles)
  const usable = kind === 'default' || (kind === 'recorded' ? !!audio : !!text);
  return {
    greeting: { kind: usable ? kind : 'default', text, voice: clean(g.voice, VOICE_NAME_MAX), rate: clampNum(g.rate, 0.6, 1.6, 1), pitch: clampNum(g.pitch, 0, 2, 1),
      audio: kind === 'recorded' ? audio : '', duration: clampNum(g.duration, 0, 60, 0) },
    voicemail: { on: vm.on !== false, dnd: !!vm.dnd },
  };
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/** What a caller hears: the greeting words + whether it is read out, and with which voice. */
export function greetingFor(settings) {
  const s = sanitizeLineSettings(settings);
  const g = s.greeting;
  return { kind: g.kind, text: g.kind === 'default' ? DEFAULT_GREETING : g.text, readOut: g.kind === 'tts', voice: g.voice, rate: g.rate, pitch: g.pitch,
    audio: g.kind === 'recorded' ? g.audio : '', duration: g.duration };
}

/**
 * Does an unanswered call go to voicemail? Only a real line (a player's or an NPC's) that takes messages; never a
 * number nobody owns, never a call that never got through (no signal, not in service).
 * @param {{toKind: string, settings?: object, why: string}} o — why: missed | declined | busy | dnd | offline
 */
export function goesToVoicemail({ toKind, settings, why } = {}) {
  if (!['player', 'npc'].includes(toKind)) return false;
  if (!['missed', 'declined', 'busy', 'dnd', 'offline'].includes(why)) return false;
  return sanitizeLineSettings(settings).voicemail.on;
}

/** How long a greeting is on screen before the tone: it types out (or plays), then a beat. */
export function greetMs(text, { perChar = 38, min = 1800, max = 6500, duration = 0 } = {}) {
  if (duration > 0) return Math.min(GREETING_RECORD_MS + 1500, Math.round(duration * 1000) + 700);
  return Math.min(max, Math.max(min, String(text ?? '').length * perChar + 900));
}

/** A message as left: text cleaned and capped, the kind checked. Null when there is nothing to leave. */
export function makeVoicemail({ vmId, callId, from, to, text, kind = 'typed', voice = '', at = Date.now(), gameTime = '', audio = '', duration = 0 } = {}) {
  const t = clean(text, VOICEMAIL_MAX);
  const a = kind === 'audio' ? cleanAudio(audio) : '';
  if (kind === 'audio' ? !a : !t) return null;
  const pick = (p) => ({ actorId: p?.actorId || null, contactId: p?.contactId || null, number: p?.number || '', name: p?.name || '' });
  return { vmId: vmId || `vm-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`, callId: callId || '',
    from: pick(from), to: pick(to), text: t, kind: ['tts', 'audio'].includes(kind) ? kind : 'typed', voice: clean(voice, VOICE_NAME_MAX), at, gameTime, heard: false,
    audio: a, duration: clampNum(duration, 0, 600, 0) };
}

/** Recordings older than `days` (0 = keep forever) — the ones a purge clears. */
export function recordingsToPurge(vms, days, now = Date.now()) {
  if (!(days > 0)) return [];
  const cut = now - days * 86400000;
  return (vms || []).filter((v) => v.kind === 'audio' && v.audio && (v.at || 0) < cut);
}

/** The inbox a message lands in: the character a line belongs to, else the directory identity. */
export function voicemailOwner(to = {}) {
  return to.actorId || to.contactId || null;
}
