/**
 * HackFX — tiny cosmetic "code is being generated" streamer for loading beats.
 * @file scripts/ui/content/HackFX.js
 * @module cyberpunkred-messenger
 * @description Appends faux compile/forge log lines + hex dumps to a feed element,
 *   auto-scrolling, for a set duration — the "the deck is forging the payload"
 *   flourish. Pure flavor: Math.random (for hex/line variety) and Date.now (for
 *   the real-time cadence) are both legitimate here (cosmetic animation, not game
 *   state — the same allowance as SoundService.playClick's random pitch).
 *   Reduced-motion renders a couple static lines and resolves instantly.
 *   Reusable — any loading moment (upload compile, a boot beat, …) can drop it in.
 */

const HEX = '0123456789ABCDEF';
const rhex = (n) => { let s = ''; for (let i = 0; i < n; i++) s += HEX[(Math.random() * 16) | 0]; return s; };
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Generic build/obfuscation chatter — used by every family.
const SHARED = [
  'linking payload.o', 'resolving symbols', 'patching checksum 0x@', 'obfuscating strings',
  'signing manifest', 'zeroing slack space', 'spoofing timestamps', 'stripping debug syms',
  'packing .text 0x@', 'seeding entropy pool', 'aligning segments 0x@', 'scrubbing metadata',
  'faking cert chain', 'relocating 0x@ → 0x@', 'deflating resources', 'remapping imports',
  'encrypting body // rc4', 'rewriting entrypoint 0x@',
];
// Family-flavored lines — a PLANT forges believable content; an EXECUTE arms code.
const FAM_STEPS = {
  plant: [
    'forging document header', 'aging timestamps → §', 'synthesizing sender headers',
    'matching writing cadence', 'planting EXIF trail 0x@', 'backdating record §',
    'compositing image layers', 'weaving conversation graph', 'laundering provenance',
    'minting message-id 0x@', 'stitching reply chain', 'normalizing font metrics',
  ],
  execute: [
    'assembling shellcode', 'building ROP chain 0x@', 'patching syscall table', 'injecting §',
    'hooking IAT 0x@', 'escalating privileges', 'disabling watchdog', 'opening reverse shell',
    'mapping RWX page 0x@', 'planting persistence key', 'unhooking EDR', 'staging dropper §',
  ],
};
// Rare amber warnings — the "this is dodgy" texture.
const WARN = [
  '⚠ heuristic flag suppressed', '⚠ signature mismatch — patching', '⚠ ICE probe detected — cloaking',
  '⚠ checksum drift 0x@', '⚠ AV hook bypassed', '⚠ trace ping — scrubbing route',
];
const OK_LINE = {
  plant: '✓ forgery sealed — uploading…',
  execute: '✓ binary armed — uploading…',
  default: '✓ payload compiled — forging…',
};

/**
 * Stream generated code into `el` for ~durationMs, then call onDone.
 * @param {HTMLElement} el   the feed container (styled by .ncm-hackfx)
 * @param {object} opts
 * @param {number}  [opts.durationMs=1150]
 * @param {string}  [opts.subject='payload']  woven into the log lines
 * @param {string}  [opts.family]  'plant' | 'execute' — picks the flavored pool
 * @param {boolean} [opts.reduced=false]
 * @param {Function}[opts.onDone]
 * @returns {() => void} cancel fn
 */
export function streamHackCode(el, { durationMs = 1150, subject = 'payload', family = '', reduced = false, onDone } = {}) {
  if (!el) { onDone?.(); return () => {}; }
  const subj = String(subject || 'payload');
  const fam = FAM_STEPS[family] ? family : '';
  const okLine = OK_LINE[fam] || OK_LINE.default;

  const fill = (s) => { while (s.includes('0x@')) s = s.replace('0x@', '0x' + rhex(8)); return s.replace('§', subj); };
  const hexRow = () => `${rhex(4)}:  ${rhex(2)} ${rhex(2)} ${rhex(2)} ${rhex(2)}  ${rhex(2)} ${rhex(2)} ${rhex(2)} ${rhex(2)}`;

  const addLine = (txt, cls = '') => {
    const d = document.createElement('div');
    d.className = 'ncm-hackfx__ln' + (cls ? ' ' + cls : '');
    d.textContent = txt;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
    while (el.childElementCount > 60) el.firstElementChild.remove(); // cap DOM growth
  };

  const genLine = () => {
    const r = Math.random();
    if (r < 0.08) return { txt: fill(pick(WARN)), cls: 'is-warn' };            // rare warning
    if (r < 0.34) return { txt: hexRow(), cls: 'is-hex' };                     // hex dump
    // Prefer the family pool a bit more than shared, so the run reads on-theme.
    const famPool = FAM_STEPS[fam];
    const pool = (famPool && Math.random() < 0.6) ? famPool : SHARED;
    return { txt: '→ ' + fill(pick(pool)), cls: 'is-step' };
  };

  if (reduced) {
    addLine('→ ' + fill(fam === 'plant' ? 'forging §' : fam === 'execute' ? 'arming §' : 'compiling §'), 'is-step');
    addLine('→ signing manifest', 'is-step');
    addLine(okLine, 'is-ok');
    onDone?.();
    return () => {};
  }

  const start = Date.now();
  let done = false;
  const iv = setInterval(() => {
    if (done) return;
    const { txt, cls } = genLine();
    addLine(txt, cls);
    if (Date.now() - start >= durationMs) {
      done = true;
      clearInterval(iv);
      addLine(okLine, 'is-ok');
      onDone?.();
    }
  }, 55);

  return () => { done = true; clearInterval(iv); };
}
