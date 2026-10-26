/**
 * BootVideo — a video as the boot screen of a terminal or a data shard
 * (2026-10-25, dev: "a video as a boot screen, use its audio, and however long
 * the video is it'll transition into the content").
 * @file scripts/ui/content/BootVideo.js
 * @module night-city-messenger
 *
 * Framework-free: `playBootVideo(host, opts)` mounts a <video> into `host`,
 * plays it with the module's sound volume, and calls `onDone` ONCE when the
 * video ends — or when the player clicks to skip, or when the wall clock says
 * the file never delivered. Rules it owns, so both viewers behave the same:
 *   · The video stands alone: no choreography, no boot sound (its own audio is
 *     the boot sound; a muted module = a muted video).
 *   · `ended` is the normal exit. A wall-clock CAP (duration + grace once the
 *     metadata is known, else MAX_MS) is the safety net — the inbox splash
 *     taught us a stalled loop with nothing behind it is worse than no splash.
 *   · `error` / an unplayable file → onDone right away (the machine still opens).
 *   · Click anywhere on the boot = skip (after a short grace so a double-click
 *     that opened the terminal does not skip it by accident).
 *   · Reduced / off motion → the caller never calls this; it skips the boot.
 * Returns { skip(), destroy() } so the viewer can tear it down on close.
 */

const MAX_MS = 180000;     // never hold the table hostage past three minutes
const GRACE_MS = 2500;     // past the declared duration before we give up on `ended`
const SKIP_GUARD_MS = 400; // clicks earlier than this are the double-click that opened the window

/** The module's effective sound volume (0 when sound is off). */
export function bootVideoVolume() {
  try {
    const prefs = game.nightcity?.settingsManager?.getTheme?.() || {};
    if (prefs.soundEnabled === false) return 0;
    const v = Number(prefs.soundVolume);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
  } catch { return 0.5; }
}

/**
 * @param {HTMLElement} host - the boot element the video fills
 * @param {object} o
 * @param {string}   o.url
 * @param {Function} o.onDone      - called exactly once
 * @param {number}   [o.volume]    - 0..1 (default: the module's sound volume)
 * @param {boolean}  [o.allowSkip] - click-to-skip (default true)
 * @param {string}   [o.skipHint]  - the corner hint text
 * @returns {{ skip: Function, destroy: Function, el: HTMLVideoElement }}
 */
export function playBootVideo(host, { url, onDone, volume, allowSkip = true, skipHint = 'click to skip' } = {}) {
  let done = false;
  const timers = [];
  const t = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const finish = (why) => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    try { video.pause(); } catch { /* already gone */ }
    host.removeEventListener('click', onClick, true);
    try { onDone?.(why); } catch (err) { console.warn('NCM | boot video onDone threw', err); }
  };

  const wrap = document.createElement('div');
  wrap.className = 'ncm-boot-video';
  const video = document.createElement('video');
  video.className = 'ncm-boot-video__el';
  video.src = url;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.disablePictureInPicture = true;
  video.setAttribute('disableremoteplayback', '');
  video.volume = volume ?? bootVideoVolume();
  video.muted = video.volume === 0;
  wrap.appendChild(video);
  if (allowSkip) {
    const hint = document.createElement('div');
    hint.className = 'ncm-boot-video__skip';
    hint.textContent = skipHint;
    wrap.appendChild(hint);
  }
  host.prepend(wrap);

  const mounted = Date.now();
  const onClick = (e) => {
    if (!allowSkip || Date.now() - mounted < SKIP_GUARD_MS) return;
    e.preventDefault(); e.stopPropagation();
    finish('skipped');
  };
  if (allowSkip) host.addEventListener('click', onClick, true);

  video.addEventListener('ended', () => finish('ended'));
  video.addEventListener('error', () => finish('error'));
  video.addEventListener('loadedmetadata', () => {
    const d = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
    if (d > 0) t(() => finish('capped'), Math.min(MAX_MS, d + GRACE_MS));
  });
  // Absolute cap in case metadata never arrives (bad path, blocked origin).
  t(() => finish('capped'), MAX_MS);
  // Autoplay with sound can be refused if the window opened without a gesture;
  // retry muted so the picture still plays rather than hanging.
  const p = video.play?.();
  if (p?.catch) p.catch(() => { video.muted = true; video.play?.().catch(() => finish('error')); });

  return {
    el: video,
    skip: () => finish('skipped'),
    destroy: () => { finish('destroyed'); wrap.remove(); },
  };
}
