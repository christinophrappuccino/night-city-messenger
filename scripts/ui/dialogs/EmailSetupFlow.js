/**
 * EmailSetupFlow — Multi-Step Email Registration Dialog
 * @file scripts/ui/dialogs/EmailSetupFlow.js
 * @module cyberpunkred-messenger
 * @description ApplicationV2 dialog for the email identity registration flow.
 *              Single window with internal step transitions.
 *              Steps: Boot → Handle → Domain → Confirm → Register animation.
 *              Animations are JS-driven to avoid Foundry !important conflicts.
 */

import { MODULE_ID, TEMPLATES } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    window: {
      title: 'NET Identity Registration',
      icon: 'fas fa-satellite-dish',
      resizable: false,
    },
    position: { width: 480, height: 'auto' },
    actions: {
      nextStep: EmailSetupFlow._onNextStep,
      prevStep: EmailSetupFlow._onPrevStep,
      selectSuggestion: EmailSetupFlow._onSelectSuggestion,
      selectDomain: EmailSetupFlow._onSelectDomain,
      registerIdentity: EmailSetupFlow._onRegisterIdentity,
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
    const selDomain = domains.find(d => d.networkId === this._domainNetworkId);

    return {
      actorName: this.actor?.name ?? 'Unknown',
      step: this._step,
      handle: this._handle,
      domain: this._domain,
      fullEmail: this._handle && this._domain ? `${this._handle}@${this._domain}` : '',
      suggestions,
      domains: domains.map(d => ({ ...d, selected: d.domain === this._domain })),
      allowCustomDomains: allowCustom,
      domainNetworkName: selDomain?.networkName ?? '',
      domainNetworkIcon: selDomain?.icon ?? 'fa-wifi',
      domainNetworkColor: selDomain?.color ?? '#00D4E6',
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const handleInput = this.element?.querySelector('[data-handle-input]');
    if (handleInput) handleInput.addEventListener('input', () => this._onHandleInput(handleInput));

    const domainInput = this.element?.querySelector('[data-custom-domain]');
    if (domainInput) domainInput.addEventListener('input', () => this._onCustomDomainInput(domainInput));

    this._showStep(1);
    if (!this._bootPlayed) { this._bootPlayed = true; this._runBootSequence(); }
  }

  // ═══════════════════════════════════════════
  //  STEP MANAGEMENT
  // ═══════════════════════════════════════════

  _showStep(n) {
    this._step = n;

    this.element?.querySelectorAll('.ncm-email-step').forEach(el => {
      el.classList.toggle('ncm-email-step--active', parseInt(el.dataset.step) === n);
    });

    // Step dots (steps 2-4 → dots 0-2)
    const dots = this.element?.querySelectorAll('.ncm-email-step-dot');
    const lines = this.element?.querySelectorAll('.ncm-email-step-line');
    dots?.forEach((dot, i) => {
      const dotStep = i + 2;
      dot.classList.remove('ncm-email-step-dot--active', 'ncm-email-step-dot--done');
      if (dotStep < n) { dot.classList.add('ncm-email-step-dot--done'); dot.innerHTML = '<i class="fas fa-check" style="font-size:8px;"></i>'; }
      else if (dotStep === n) { dot.classList.add('ncm-email-step-dot--active'); dot.textContent = String(i + 1); }
      else { dot.textContent = String(i + 1); }
    });
    lines?.forEach((line, i) => { line.classList.toggle('ncm-email-step-line--done', (i + 3) <= n); });

    // Indicator visibility
    const indicator = this.element?.querySelector('[data-step-indicator]');
    if (indicator) indicator.style.display = (n >= 2 && n <= 4) ? '' : 'none';

    // Footer buttons
    const prevBtn = this.element?.querySelector('[data-action="prevStep"]');
    const nextBtn = this.element?.querySelector('[data-action="nextStep"]');
    const regBtn = this.element?.querySelector('[data-action="registerIdentity"]');
    if (prevBtn) prevBtn.style.display = (n >= 2 && n <= 4) ? '' : 'none';
    if (nextBtn) nextBtn.style.display = (n >= 1 && n <= 3) ? '' : 'none';
    if (regBtn) regBtn.style.display = (n === 4) ? '' : 'none';

    // Update previews
    const email = this._handle && this._domain ? `${this._handle}@${this._domain}` : '';
    this.element?.querySelectorAll('[data-email-preview]').forEach(el => { el.textContent = email; });

    if (n === 4) {
      const h = this.element?.querySelector('[data-confirm-handle]'); if (h) h.textContent = this._handle;
      const d = this.element?.querySelector('[data-confirm-domain]'); if (d) d.textContent = this._domain;
    }

    // Hide footer on step 5
    const footer = this.element?.querySelector('.ncm-email-setup__footer');
    if (footer) footer.style.display = (n === 5) ? 'none' : '';
  }

  // ═══════════════════════════════════════════
  //  BOOT SEQUENCE — JS-driven line reveal
  // ═══════════════════════════════════════════

  _runBootSequence() {
    const lines = this.element?.querySelectorAll('.ncm-email-boot__line');
    if (!lines?.length) return;

    // Start hidden
    lines.forEach(l => { l.style.opacity = '0'; l.style.transform = 'translateY(4px)'; });

    // Stagger reveal via JS timers
    const delays = [300, 600, 1000, 1400, 1900, 2500, 3000];
    lines.forEach((line, i) => {
      setTimeout(() => {
        if (!this.element) return;
        line.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        line.style.opacity = '1';
        line.style.transform = 'translateY(0)';
      }, delays[i] ?? (3000 + (i - 6) * 400));
    });

    // Progress bar — JS driven
    const fill = this.element?.querySelector('.ncm-email-boot__progress-fill');
    if (fill) {
      fill.style.transition = 'none';
      fill.style.width = '0%';
      requestAnimationFrame(() => {
        fill.style.transition = 'width 3.5s ease-out';
        fill.style.width = '100%';
      });
    }
  }

  // ═══════════════════════════════════════════
  //  REGISTRATION ANIMATION — phased
  // ═══════════════════════════════════════════

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
    if (progressEl) { progressEl.style.transition = 'none'; progressEl.style.width = '0%'; }

    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    await wait(50);
    if (progressEl) progressEl.style.transition = 'width 0.6s ease';

    const phases = [
      { status: 'Registering handle...', sub: 'Connecting to NET registry', progress: '15%' },
      { status: 'Allocating mailbox...', sub: 'Provisioning storage node', progress: '40%' },
      { status: 'Verifying identity...', sub: 'Cross-referencing NET records', progress: '65%' },
      { status: 'Writing to directory...', sub: 'Syncing master contact list', progress: '85%' },
      { status: 'Finalizing...', sub: 'Confirming identity registration', progress: '95%' },
    ];

    for (const phase of phases) {
      if (!this.element) return;
      statusEl.textContent = phase.status;
      if (subEl) subEl.textContent = phase.sub;
      if (progressEl) progressEl.style.width = phase.progress;
      await wait(700);
    }

    try {
      if (!this.element) return;
      const email = await this.emailService.registerEmail(this.actor, this._handle, this._domain);
      if (progressEl) progressEl.style.width = '100%';
      await wait(400);
      spinnerEl.style.display = 'none';
      if (emailEl) emailEl.textContent = email;
      successEl.classList.add('ncm-email-reg__success--show');
      await wait(2500);
      if (this._resolvePromise) { this._resolvePromise(email); this._resolvePromise = null; }
      this.close();
    } catch (err) {
      log.error('Email registration failed:', err);
      ui.notifications.error(`Registration failed: ${err.message}`);
      this._showStep(2);
    }
  }

  // ═══════════════════════════════════════════
  //  INPUT HANDLERS
  // ═══════════════════════════════════════════

  _onHandleInput(input) {
    this._handle = this.emailService?.sanitizeHandle(input.value) ?? input.value;

    this._updatePreviews();

    const result = this.emailService?.validateHandle(this._handle) ?? { valid: false, error: 'Unknown' };
    const valEl = this.element?.querySelector('[data-handle-validation]');
    if (valEl) {
      valEl.className = `ncm-email-validation ${result.valid ? 'ncm-email-validation--ok' : 'ncm-email-validation--err'}`;
      valEl.innerHTML = result.valid
        ? '<i class="fas fa-check-circle"></i> Handle available'
        : `<i class="fas fa-times-circle"></i> ${result.error}`;
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

  // ═══════════════════════════════════════════
  //  ACTIONS
  // ═══════════════════════════════════════════

  static _onNextStep() { if (this._step === 1) { this._showStep(2); } else if (this._step === 2) { const r = this.emailService?.validateHandle(this._handle); if (!r?.valid) { this.element?.querySelector('[data-handle-input]')?.focus(); return; } this._showStep(3); } else if (this._step === 3) { const r = this.emailService?.validateDomain(this._domain); if (!r?.valid) return; this._showStep(4); } }

  static _onPrevStep() { if (this._step > 1 && this._step < 5) this._showStep(this._step - 1); }

  static _onSelectSuggestion(event, target) {
    const handle = target.dataset.handle; if (!handle) return;
    this._handle = handle;
    const input = this.element?.querySelector('[data-handle-input]'); if (input) input.value = handle;
    this.element?.querySelectorAll('.ncm-email-suggest').forEach(s => { s.classList.toggle('ncm-email-suggest--active', s.dataset.handle === handle); });
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

  static _onRegisterIdentity() { this._showStep(5); this._runRegistration(); }
}
