/**
 * UploadConsole — the "pick a program to push onto this box" FUI picker.
 * @file scripts/ui/content/UploadConsole.js
 * @module cyberpunkred-messenger
 * @description A framework-free promise modal (the OperatorSelect / SecurityConsole
 *   pattern — NOT an Application): a themed `.ncm-upcon` panel appended into
 *   `opts.host` (the viewer element, so it inherits that viewer's --ncm-* preset;
 *   falls back to document.body = brand defaults). Accented purple via
 *   data-ct-color, matching the upload SecurityConsole.
 *
 *   It only GATHERS the choice — { program, accountId } — then resolves; the FORGE
 *   ROLL itself runs afterward in UploadFlow.runUpload via the SecurityConsole.
 *   Diegetically: you pick a carried program, aim it at a mailbox, and the deck
 *   COMPILES the payload before the forge attempt. Reduced-motion collapses the
 *   flourishes to an instant resolve.
 */

import { log } from '../../utils/helpers.js';
import { streamHackCode } from './HackFX.js';

/** Minimal HTML escaper. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FAM = {
  plant:   { cls: 'plant', icon: 'fa-syringe',   label: 'PLANT',   dv: 'FORGE DV' },
  execute: { cls: 'exe',   icon: 'fa-biohazard', label: 'EXECUTE', dv: 'RUN DV' },
};
const famOf = (p) => FAM[p.family] || (p.effectType === 'plant' ? FAM.plant : FAM.execute);

/**
 * Open the upload picker. Resolves with { program, accountId } or null on cancel.
 * @param {object} opts
 * @param {object[]} opts.programs  carried uploadable programs (each: { name, effectType, family?, disabled?, description?, sourceLabel?, uploadDV?, ...runUpload fields })
 * @param {object[]} opts.accounts  target mailboxes ({ id, label })
 * @param {string}  [opts.terminalName]
 * @param {HTMLElement} [opts.host] viewer element (theme source)
 * @returns {Promise<{program:object, accountId:string|null}|null>}
 */
export function runUploadConsole({ programs = [], accounts = [], terminalName = 'the terminal', host = null } = {}) {
  return new Promise((resolve) => {
    if (!programs.length) {
      try { ui.notifications?.info?.('NCM | You are not carrying anything uploadable.'); } catch { /* no ui */ }
      resolve(null); return;
    }

    let reduced = false;
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* no */ }

    const mount = host || document.body;
    const wrap = document.createElement('div');
    wrap.className = 'ncm-upcon-backdrop';

    const rows = programs.map((p, i) => {
      const fam = famOf(p);
      const soon = !!p.disabled;
      const dvLabel = `${fam.dv} ${Number(p.uploadDV) || 15}`;
      return `
        <button type="button" class="ncm-upcon__item${soon ? ' is-soon' : ''}" data-up-idx="${i}" style="--i:${i}"${soon ? ' disabled' : ''}>
          <span class="ncm-upcon__ico ncm-upcon__ico--${fam.cls}"><i class="fas ${fam.icon}"></i></span>
          <span class="ncm-upcon__nm">
            <span class="ncm-upcon__t">${esc(p.name || 'program')}
              <span class="ncm-upcon__fam ncm-upcon__fam--${fam.cls}">${fam.label}</span>
              ${soon ? '<span class="ncm-upcon__soon">SOON</span>' : ''}</span>
            <span class="ncm-upcon__d">${esc(p.description || '')}</span>
            <span class="ncm-upcon__src"><i class="fas fa-sd-card"></i> ${esc(p.sourceLabel || 'carried')}</span>
          </span>
          <span class="ncm-upcon__dv">${esc(dvLabel)}</span>
        </button>`;
    }).join('');

    const acctOpts = accounts.map(a =>
      `<option value="${esc(a.id)}">${esc(a.label || a.email || a.id)}</option>`).join('')
      + '<option value="">— any login —</option>';
    const acctById = (id) => accounts.find(a => a.id === id) || null;

    wrap.innerHTML = `
      <div class="ncm-upcon" role="dialog" aria-modal="true" data-ct-color="purple">
        <div class="ncm-upcon__bar"></div>
        <span class="ncm-upcon__ck ncm-upcon__ck--tl"></span><span class="ncm-upcon__ck ncm-upcon__ck--tr"></span>
        <span class="ncm-upcon__ck ncm-upcon__ck--bl"></span><span class="ncm-upcon__ck ncm-upcon__ck--br"></span>
        <div class="ncm-upcon__hd">
          <span class="ncm-upcon__tag"><i class="fas fa-upload"></i> UPLOAD</span>
          <span class="ncm-upcon__sub">push a carried program onto ${esc(terminalName)}</span>
        </div>
        <div class="ncm-upcon__list">${rows}</div>
        <div class="ncm-upcon__deliver">
          <div class="ncm-upcon__dhd"><i class="fas fa-crosshairs"></i> DELIVERY<span class="ncm-upcon__dhint">where it lands · when it fires</span></div>
          <div class="ncm-upcon__drow">
            <span class="ncm-upcon__dlbl">TARGET</span>
            <select class="ncm-upcon__acct">${acctOpts}</select>
          </div>
          <div class="ncm-upcon__outcome" data-empty="1">
            <span class="ncm-upcon__oline"><i class="fas fa-inbox"></i> <span class="ncm-upcon__owhat">Pick a program above to preview delivery.</span></span>
            <span class="ncm-upcon__oline ncm-upcon__oline--when"><i class="fas fa-clock"></i> <span class="ncm-upcon__owhen"></span></span>
          </div>
        </div>
        <div class="ncm-upcon__compile">
          <div class="ncm-upcon__crow">
            <span class="ncm-upcon__cline"></span>
            <span class="ncm-upcon__ctx">COMPILING PAYLOAD…</span>
          </div>
          <div class="ncm-hackfx"></div>
        </div>
        <div class="ncm-upcon__ft">
          <button type="button" class="ncm-upcon__cancel">CANCEL</button>
          <button type="button" class="ncm-upcon__go" disabled><i class="fas fa-fingerprint"></i> FORGE &amp; UPLOAD</button>
        </div>
      </div>`;

    const panel = () => wrap.querySelector('.ncm-upcon');
    let selectedIdx = -1;

    // Live delivery preview — reads the picked program + target account into a
    // plain-language "what lands + when it fires" sentence, so the outcome is
    // never a mystery. (PLANT-focused copy; EXECUTE arrives in thread #6.)
    const syncOutcome = () => {
      const out = panel().querySelector('.ncm-upcon__outcome');
      const whatEl = panel().querySelector('.ncm-upcon__owhat');
      const whenEl = panel().querySelector('.ncm-upcon__owhen');
      if (!out) return;
      if (selectedIdx < 0) {
        out.dataset.empty = '1';
        if (whatEl) whatEl.textContent = 'Pick a program above to preview delivery.';
        if (whenEl) whenEl.textContent = '';
        return;
      }
      out.dataset.empty = '0';
      const prog = programs[selectedIdx];
      const acct = acctById(panel().querySelector('.ncm-upcon__acct')?.value || '');
      const who = acct ? esc(acct.label || acct.email || 'that account') : 'anyone';
      const isExec = famOf(prog).cls === 'exe';
      if (whatEl) whatEl.innerHTML = isExec
        ? `<b>${esc(prog.name || 'the program')}</b> — ${esc(prog.description || 'installs a program')}`
        : `<b>${esc(prog.name || 'the file')}</b> lands in <b>${who}</b>'s mailbox`;
      if (whenEl) whenEl.innerHTML = acct
        ? `${isExec ? 'fires' : 'activates'} the next time <b>${who}</b> logs in`
        : `${isExec ? 'fires' : 'activates'} on the next login by <b>anyone</b>`;
    };

    const cleanup = (val) => {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cleanup(null); } };

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('.ncm-upcon__cancel')) { cleanup(null); return; }

      const item = e.target.closest('.ncm-upcon__item');
      if (item && !item.disabled) {
        selectedIdx = Number(item.dataset.upIdx);
        panel().querySelectorAll('.ncm-upcon__item').forEach(el => el.classList.toggle('is-sel', el === item));
        const go = panel().querySelector('.ncm-upcon__go');
        if (go) go.disabled = false;
        syncOutcome();
        try { game.nightcity?.soundService?.play('click'); } catch { /* no sound */ }
        return;
      }

      if (e.target.closest('.ncm-upcon__go')) {
        if (selectedIdx < 0) return;
        const accountId = panel().querySelector('.ncm-upcon__acct')?.value || null;
        const program = programs[selectedIdx];
        // COMPILING beat — stream generated forge-code, then hand off to the
        // FORGE roll (runUpload). Cosmetic; reduced-motion resolves at once.
        panel().classList.add('is-compiling');
        try { game.nightcity?.soundService?.play('shard-compile'); } catch { /* no sound */ }
        if (reduced) { cleanup({ program, accountId }); return; }
        streamHackCode(panel().querySelector('.ncm-hackfx'), {
          subject: program.name || 'payload',
          family: famOf(program).cls === 'exe' ? 'execute' : 'plant',
          durationMs: 1150, reduced,
          onDone: () => setTimeout(() => cleanup({ program, accountId }), 240),
        });
      }
    });

    // Re-preview delivery when the target account changes (a <select> fires on
    // change, not the delegated click).
    wrap.addEventListener('change', (e) => { if (e.target.closest('.ncm-upcon__acct')) syncOutcome(); });

    document.addEventListener('keydown', onKey, true);
    mount.appendChild(wrap);
    syncOutcome();
    try { game.nightcity?.soundService?.play('click'); } catch { /* no sound */ }
    log.debug(`UploadConsole: ${programs.length} program(s) carried.`);
  });
}
