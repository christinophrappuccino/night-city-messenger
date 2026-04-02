/**
 * EmailSetupFlow — Multi-Step Email Registration Dialog
 * @file scripts/ui/dialogs/EmailSetupFlow.js
 * @module cyberpunkred-messenger
 * @description ApplicationV2 dialog for email identity registration.
 *              Typewriter boot sequence, scramble-decode transitions,
 *              single adaptive footer button, close→inbox on success.
 */

import { MODULE_ID } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ═══════════════════════════════════════
//  TEXT ENGINES
// ═══════════════════════════════════════

const GLYPHS = '!@#$%^&*_+-=[]{}|;:<>?/~░▒▓█▀▄■□▪●○◆◇◊'.split('');

/** Scramble-decode: random glyphs resolve left-to-right into final text. */
function scrambleDecode(el, text, duration = 350) {
  if (!el) return Promise.resolve();
  const len = text.length;
  const steps = 8;
  const interval = duration / steps;
  let step = 0;
  return new Promise(resolve => {
    const timer = setInterval(() => {
      step++;
      const progress = step / steps;
      let out = '';
      for (let i = 0; i < len; i++) {
        out += (i / len < progress) ? text[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      el.textContent = out;
      if (step >= steps) { clearInterval(timer); el.textContent = text; resolve(); }
    }, interval);
  });
}

/** Typewriter: types chars one-by-one with a blinking cursor. Returns a Promise. */
function typewriteLine(container, text, cls = '', speed = 18) {
  return new Promise(resolve => {
    const line = document.createElement('div');
    line.className = 'ncm-email-boot__line ' + cls;
    container.appendChild(line);

    const cursor = document.createElement('span');
    cursor.className = 'ncm-email-boot__cursor';
    line.appendChild(cursor);

    let i = 0;
    function tick() {
      if (i >= text.length) { cursor.remove(); resolve(); return; }
      cursor.remove();
      line.insertAdjacentText('beforeend', text[i]);
      line.appendChild(cursor);
      i++;
      setTimeout(tick, speed + Math.random() * 12);
    }
    tick();
  });
}

/** Type multiple lines sequentially with delays between. */
async function typewriteSequence(container, lines) {
  container.innerHTML = '';
  for (const { text, cls, speed, delay } of lines) {
    if (delay) await new Promise(r => setTimeout(r, delay));
    await typewriteLine(container, text, cls, speed);
  }
}

// ═══════════════════════════════════════
//  APPLICATION
// ═══════════════════════════════════════

export class EmailSetupFlow extends HandlebarsApplicationMixin(ApplicationV2) {

  actor = null;
  emailService = null;
  _step = 1;
  _handle = '';
  _domain = '';
  _domainNetworkId = null;
  _resolvePromise = null;
  _bootPlayed = false;

  static DEFAULT_OPTIONS = {
    id: 'ncm-email-setup',
    classes: ['ncm-app', 'ncm-email-setup'],
    window: { title: 'NET Identity Registration', icon: 'fas fa-satellite-dish', resizable: false },
    position: { width: 480, height: 'auto' },
    actions: {
      nextStep: EmailSetupFlow._onNextStep,
      prevStep: EmailSetupFlow._onPrevStep,
      selectSuggestion: EmailSetupFlow._onSelectSuggestion,
      selectDomain: EmailSetupFlow._onSelectDomain,
      openInbox: EmailSetupFlow._onOpenInbox,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/dialogs/email-setup.hbs` },
  };

  static run(actor, emailService) {
    return new Promise(resolve => {
      const flow = new EmailSetupFlow();
      flow.actor = actor;
      flow.emailService = emailService;
      flow._resolvePromise = resolve;
      flow._handle = emailService.generateHandleSuggestions(actor)[0] || '';
      const domains = emailService.getAvailableDomains();
      flow._domain = domains[0]?.domain || 'nightcity.net';
      flow._domainNetworkId = domains[0]?.networkId || '';
      flow.render(true);
    });
  }

  async close(options = {}) {
    if (this._resolvePromise) { this._resolvePromise(null); this._resolvePromise = null; }
    return super.close(options);
  }

  async _prepareContext() {
    const suggestions = this.emailService?.generateHandleSuggestions(this.actor) ?? [];
    const domains = this.emailService?.getAvailableDomains() ?? [];
    const allowCustom = this.emailService?.allowCustomDomains() ?? true;
    const sel = domains.find(d => d.networkId === this._domainNetworkId);
    return {
      actorName: this.actor?.name ?? 'Unknown',
      handle: this._handle, domain: this._domain,
      fullEmail: this._handle && this._domain ? `${this._handle}@${this._domain}` : '',
      suggestions,
      domains: domains.map(d => ({ ...d, selected: d.domain === this._domain })),
      allowCustomDomains: allowCustom,
      domainNetworkName: sel?.networkName ?? '',
      domainNetworkIcon: sel?.icon ?? 'fa-wifi',
      domainNetworkColor: sel?.color ?? '#00D4E6',
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const hi = this.element?.querySelector('[data-handle-input]');
    if (hi) hi.addEventListener('input', () => this._onHandleInput(hi));
    const di = this.element?.querySelector('[data-custom-domain]');
    if (di) di.addEventListener('input', () => this._onCustomDomainInput(di));
    this._showStep(1);
    if (!this._bootPlayed) { this._bootPlayed = true; this._runBootSequence(); }
  }

  // ─── STEP MANAGEMENT ───

  _showStep(n) {
    this._step = n;
    this.element?.querySelectorAll('.ncm-email-step').forEach(el => {
      el.classList.toggle('ncm-email-step--active', parseInt(el.dataset.step) === n);
    });

    // Dots
    const dots = this.element?.querySelectorAll('.ncm-email-step-dot');
    const lines = this.element?.querySelectorAll('.ncm-email-step-line');
    dots?.forEach((dot, i) => {
      const ds = i + 2;
      dot.classList.remove('ncm-email-step-dot--active', 'ncm-email-step-dot--done');
      if (ds < n) { dot.classList.add('ncm-email-step-dot--done'); dot.innerHTML = '<i class="fas fa-check" style="font-size:8px;"></i>'; }
      else if (ds === n) { dot.classList.add('ncm-email-step-dot--active'); dot.textContent = String(i + 1); }
      else { dot.textContent = String(i + 1); }
    });
    lines?.forEach((l, i) => l.classList.toggle('ncm-email-step-line--done', (i + 3) <= n));

    // Indicator visibility
    const ind = this.element?.querySelector('[data-step-indicator]');
    if (ind) ind.classList.toggle('ncm-email-step-indicator--show', n >= 2 && n <= 4);

    // Footer
    const footer = this.element?.querySelector('.ncm-email-setup__footer');
    const backBtn = this.element?.querySelector('[data-action="prevStep"]');
    const nextBtn = this.element?.querySelector('[data-action="nextStep"]');
    if (footer) footer.classList.toggle('ncm-email-footer--hidden', n === 5);
    if (backBtn) backBtn.style.display = (n >= 2 && n <= 4) ? '' : 'none';
    if (nextBtn) {
      nextBtn.style.display = (n >= 1 && n <= 4) ? '' : 'none';
      const label = nextBtn.querySelector('[data-next-label]');
      const icon = nextBtn.querySelector('i');
      if (n === 4) {
        nextBtn.className = 'ncm-email-btn ncm-email-btn--green';
        if (label) label.textContent = 'Register Identity';
        if (icon) icon.className = 'fas fa-check';
      } else {
        nextBtn.className = 'ncm-email-btn ncm-email-btn--cyan';
        if (label) label.textContent = n === 1 ? 'Continue' : 'Next';
        if (icon) icon.className = 'fas fa-arrow-right';
      }
    }

    // Update previews
    const email = this._handle && this._domain ? `${this._handle}@${this._domain}` : '';
    this.element?.querySelectorAll('[data-email-preview]').forEach(el => { el.textContent = email; });
    if (n === 4) {
      const h = this.element?.querySelector('[data-confirm-handle]'); if (h) h.textContent = this._handle;
      const d = this.element?.querySelector('[data-confirm-domain]'); if (d) d.textContent = this._domain;
    }

    // Scramble-decode headings on steps 2-4
    if (n >= 2 && n <= 4) {
      const stepEl = this.element?.querySelector(`.ncm-email-step[data-step="${n}"]`);
      stepEl?.querySelectorAll('[data-decode]').forEach(el => {
        const orig = el.dataset.original || el.textContent;
        el.dataset.original = orig;
        scrambleDecode(el, orig, 350);
      });
    }
  }

  // ─── BOOT SEQUENCE ───

  async _runBootSequence() {
    const terminal = this.element?.querySelector('[data-boot-terminal]');
    const fill = this.element?.querySelector('[data-boot-fill]');
    if (!terminal) return;

    if (fill) {
      fill.style.transition = 'none'; fill.style.width = '0%';
      requestAnimationFrame(() => { fill.style.transition = 'width 4s ease-out'; fill.style.width = '100%'; });
    }

    await typewriteSequence(terminal, [
      { text: 'NCM AGENT RUNTIME v4.1.0', cls: 'ncm-email-boot__line--dim', speed: 12, delay: 200 },
      { text: 'SCANNING NET INTERFACE...', cls: 'ncm-email-boot__line--dim', speed: 15, delay: 300 },
      { text: '▓ NET INTERFACE DETECTED', cls: '', speed: 12, delay: 400 },
      { text: 'CHECKING IDENTITY REGISTRY...', cls: 'ncm-email-boot__line--dim', speed: 15, delay: 300 },
      { text: '⚠ NO REGISTERED IDENTITY FOUND', cls: 'ncm-email-boot__line--warn', speed: 10, delay: 500 },
      { text: 'AGENT REGISTRATION REQUIRED', cls: 'ncm-email-boot__line--heading', speed: 20, delay: 400 },
      { text: 'Register a NET identity to send and receive messages.', cls: 'ncm-email-boot__line--dim', speed: 8, delay: 200 },
    ]);
  }

  // ─── REGISTRATION ───

  async _runRegistration() {
    const statusEl = this.element?.querySelector('[data-reg-status]');
    const subEl = this.element?.querySelector('[data-reg-sub]');
    const progressEl = this.element?.querySelector('[data-reg-progress]');
    const spinnerEl = this.element?.querySelector('[data-reg-spinner]');
    const successEl = this.element?.querySelector('[data-reg-success]');
    const emailEl = this.element?.querySelector('[data-reg-email]');
    if (!statusEl || !spinnerEl || !successEl) return;

    spinnerEl.style.display = '';
    successEl.classList.remove('ncm-email-reg__success--show');
    if (statusEl) statusEl.textContent = '';
    if (subEl) subEl.textContent = '';
    if (progressEl) { progressEl.style.transition = 'none'; progressEl.style.width = '0%'; }

    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(50);
    if (progressEl) progressEl.style.transition = 'width 0.6s ease';

    const phases = [
      { s: 'REGISTERING HANDLE...', sub: 'Connecting to NET registry', p: '15%' },
      { s: 'ALLOCATING MAILBOX...', sub: 'Provisioning storage node', p: '40%' },
      { s: 'VERIFYING IDENTITY...', sub: 'Cross-referencing NET records', p: '65%' },
      { s: 'WRITING TO DIRECTORY...', sub: 'Syncing master contact list', p: '85%' },
      { s: 'FINALIZING...', sub: 'Confirming registration', p: '95%' },
    ];

    for (const phase of phases) {
      if (!this.element) return;
      scrambleDecode(statusEl, phase.s, 250);
      if (subEl) subEl.textContent = phase.sub;
      if (progressEl) progressEl.style.width = phase.p;
      await wait(800);
    }

    try {
      if (!this.element) return;
      const email = await this.emailService.registerEmail(this.actor, this._handle, this._domain);
      if (progressEl) progressEl.style.width = '100%';
      await wait(400);
      spinnerEl.style.display = 'none';
      if (emailEl) emailEl.textContent = email;
      successEl.classList.add('ncm-email-reg__success--show');

      // Store email for close handler
      this._registeredEmail = email;
    } catch (err) {
      log.error('Email registration failed:', err);
      ui.notifications.error(`Registration failed: ${err.message}`);
      this._showStep(2);
    }
  }

  // ─── INPUT HANDLERS ───

  _onHandleInput(input) {
    this._handle = this.emailService?.sanitizeHandle(input.value) ?? input.value;
    this._updatePreviews();
    const result = this.emailService?.validateHandle(this._handle) ?? { valid: false, error: 'Unknown' };
    const valEl = this.element?.querySelector('[data-handle-validation]');
    if (valEl) {
      valEl.className = `ncm-email-validation ${result.valid ? 'ncm-email-validation--ok' : 'ncm-email-validation--err'}`;
      valEl.innerHTML = result.valid ? '<i class="fas fa-check-circle"></i> Handle available' : `<i class="fas fa-times-circle"></i> ${result.error}`;
    }
  }

  _onCustomDomainInput(input) {
    this._domain = input.value.toLowerCase().replace(/[^a-z0-9.-]/g, '');
    this._domainNetworkId = '';
    this.element?.querySelectorAll('.ncm-email-domain-card').forEach(c => c.classList.remove('ncm-email-domain-card--active'));
    this._updatePreviews();
  }

  _updatePreviews() {
    this.element?.querySelectorAll('[data-handle-preview]').forEach(el => {
      el.innerHTML = this._handle
        ? `${this._handle}<span class="ncm-email-dim">@${this._domain || '___'}</span>`
        : '<span class="ncm-email-dim">___@___</span>';
    });
    const atEl = this.element?.querySelector('.ncm-email-handle-at');
    if (atEl) atEl.textContent = `@${this._domain || '___'}`;
  }

  // ─── ACTIONS ───

  static _onNextStep() {
    if (this._step === 1) { this._showStep(2); }
    else if (this._step === 2) {
      if (!this.emailService?.validateHandle(this._handle)?.valid) { this.element?.querySelector('[data-handle-input]')?.focus(); return; }
      this._showStep(3);
    } else if (this._step === 3) {
      if (!this.emailService?.validateDomain(this._domain)?.valid) return;
      this._showStep(4);
    } else if (this._step === 4) {
      this._showStep(5);
      this._runRegistration();
    }
  }

  static _onPrevStep() { if (this._step > 1 && this._step < 5) this._showStep(this._step - 1); }

  static _onSelectSuggestion(event, target) {
    const handle = target.dataset.handle; if (!handle) return;
    this._handle = handle;
    const input = this.element?.querySelector('[data-handle-input]'); if (input) input.value = handle;
    this.element?.querySelectorAll('.ncm-email-suggest').forEach(s => s.classList.toggle('ncm-email-suggest--active', s.dataset.handle === handle));
    this._onHandleInput(input || { value: handle });
  }

  static _onSelectDomain(event, target) {
    const card = target.closest('.ncm-email-domain-card'); if (!card) return;
    this._domain = card.dataset.domain || ''; this._domainNetworkId = card.dataset.networkId || '';
    this.element?.querySelectorAll('.ncm-email-domain-card').forEach(c => c.classList.remove('ncm-email-domain-card--active'));
    card.classList.add('ncm-email-domain-card--active');
    const ci = this.element?.querySelector('[data-custom-domain]'); if (ci) ci.value = '';
    this._updatePreviews();
  }

  static _onOpenInbox() {
    const email = this._registeredEmail;
    if (this._resolvePromise) { this._resolvePromise(email); this._resolvePromise = null; }
    this.close();
    // Open inbox after a brief delay to let close complete
    setTimeout(() => { game.nightcity?.openInbox?.(); }, 150);
  }
}
