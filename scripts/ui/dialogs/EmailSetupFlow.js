/**
 * EmailSetupFlow — Multi-Step Email Registration Dialog
 * @file scripts/ui/dialogs/EmailSetupFlow.js
 * @module cyberpunkred-messenger
 * @description ApplicationV2 dialog for the email identity registration flow.
 *              Single window with internal step transitions (no re-render between steps).
 *              Steps: Boot → Handle → Domain → Confirm → Register animation.
 */

import { MODULE_ID, TEMPLATES } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EmailSetupFlow extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @type {Actor} */
  actor = null;

  /** @type {import('../../services/EmailService.js').EmailService} */
  emailService = null;

  /** @type {number} Current step (1-5) */
  _step = 1;

  /** @type {string} Selected handle */
  _handle = '';

  /** @type {string} Selected domain */
  _domain = '';

  /** @type {string|null} Selected network ID for domain */
  _domainNetworkId = null;

  /** @type {Function|null} Resolve callback for the Promise returned by .run() */
  _resolvePromise = null;

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

  /**
   * Open the setup flow for an actor and return a Promise that resolves
   * with the registered email (or null if cancelled).
   * @param {Actor} actor
   * @param {EmailService} emailService
   * @returns {Promise<string|null>}
   */
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

  /** @override */
  async close(options = {}) {
    if (this._resolvePromise) {
      this._resolvePromise(null);
      this._resolvePromise = null;
    }
    return super.close(options);
  }

  /** @override */
  async _prepareContext() {
    const suggestions = this.emailService?.generateHandleSuggestions(this.actor) ?? [];
    const domains = this.emailService?.getAvailableDomains() ?? [];
    const allowCustom = this.emailService?.allowCustomDomains() ?? true;

    return {
      actorName: this.actor?.name ?? 'Unknown',
      step: this._step,
      handle: this._handle,
      domain: this._domain,
      fullEmail: this._handle && this._domain ? `${this._handle}@${this._domain}` : '',
      suggestions,
      domains: domains.map(d => ({
        ...d,
        selected: d.domain === this._domain,
      })),
      allowCustomDomains: allowCustom,
      domainNetworkName: domains.find(d => d.networkId === this._domainNetworkId)?.networkName ?? '',
      domainNetworkIcon: domains.find(d => d.networkId === this._domainNetworkId)?.icon ?? 'fa-wifi',
      domainNetworkColor: domains.find(d => d.networkId === this._domainNetworkId)?.color ?? '#00D4E6',
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Wire handle input live validation
    const handleInput = this.element?.querySelector('[data-handle-input]');
    if (handleInput) {
      handleInput.addEventListener('input', () => this._onHandleInput(handleInput));
    }

    // Wire custom domain input
    const domainInput = this.element?.querySelector('[data-custom-domain]');
    if (domainInput) {
      domainInput.addEventListener('input', () => this._onCustomDomainInput(domainInput));
    }

    // Boot animation auto-advance
    if (this._step === 1) {
      this._runBootSequence();
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  STEP TRANSITIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * Transition to a new step with animation.
   * @param {number} newStep
   */
  _goToStep(newStep) {
    if (newStep < 1 || newStep > 5) return;
    if (newStep === this._step) return;

    const body = this.element?.querySelector('.ncm-email-setup__body');
    if (!body) return;

    const oldPanel = body.querySelector(`.ncm-email-step[data-step="${this._step}"]`);
    const newPanel = body.querySelector(`.ncm-email-step[data-step="${newStep}"]`);
    if (!oldPanel || !newPanel) return;

    const direction = newStep > this._step ? 1 : -1;

    // Animate out
    oldPanel.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    oldPanel.style.opacity = '0';
    oldPanel.style.transform = `translateX(${direction * -16}px)`;

    setTimeout(() => {
      oldPanel.classList.remove('ncm-email-step--active');
      oldPanel.style.cssText = '';

      // Set up new panel
      newPanel.style.opacity = '0';
      newPanel.style.transform = `translateX(${direction * 16}px)`;
      newPanel.classList.add('ncm-email-step--active');

      // Update step indicators
      this._step = newStep;
      this._updateStepIndicators();

      // Animate in
      requestAnimationFrame(() => {
        newPanel.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        newPanel.style.opacity = '1';
        newPanel.style.transform = 'translateX(0)';
      });

      // Boot sequence for step 1
      if (newStep === 1) this._runBootSequence();
      // Registration animation for step 5
      if (newStep === 5) this._runRegistration();
    }, 200);
  }

  /**
   * Update step indicator dots based on current step.
   */
  _updateStepIndicators() {
    const dots = this.element?.querySelectorAll('.ncm-email-step-dot');
    const lines = this.element?.querySelectorAll('.ncm-email-step-line');
    if (!dots?.length) return;

    dots.forEach((dot, i) => {
      const stepNum = i + 1; // Steps 2, 3, 4 map to dots 0, 1, 2
      const actualStep = i + 2; // Dot indices are for steps 2-4
      dot.classList.remove('ncm-email-step-dot--active', 'ncm-email-step-dot--done');
      if (actualStep < this._step) dot.classList.add('ncm-email-step-dot--done');
      else if (actualStep === this._step) dot.classList.add('ncm-email-step-dot--active');
    });

    lines?.forEach((line, i) => {
      const nextStep = i + 3;
      line.classList.toggle('ncm-email-step-line--done', nextStep <= this._step);
    });

    // Update preview email in all visible places
    const previews = this.element?.querySelectorAll('[data-email-preview]');
    const email = this._handle && this._domain ? `${this._handle}@${this._domain}` : '';
    previews?.forEach(el => { el.textContent = email; });

    // Update footer buttons
    const prevBtn = this.element?.querySelector('[data-action="prevStep"]');
    const nextBtn = this.element?.querySelector('[data-action="nextStep"]');
    const regBtn = this.element?.querySelector('[data-action="registerIdentity"]');

    if (prevBtn) prevBtn.style.display = this._step <= 1 ? 'none' : '';
    if (nextBtn) nextBtn.style.display = (this._step >= 4 || this._step === 1) ? 'none' : '';
    if (regBtn) regBtn.style.display = this._step === 4 ? '' : 'none';

    // Step 1 shows "Continue" as next
    const contBtn = this.element?.querySelector('[data-boot-continue]');
    if (contBtn) contBtn.style.display = this._step === 1 ? '' : 'none';
  }

  // ═══════════════════════════════════════════════════════════
  //  BOOT SEQUENCE (Step 1)
  // ═══════════════════════════════════════════════════════════

  _runBootSequence() {
    const terminal = this.element?.querySelector('.ncm-email-boot__terminal');
    if (!terminal) return;

    // Reset all boot lines
    const lines = terminal.querySelectorAll('.ncm-email-boot__line');
    lines.forEach(l => { l.style.opacity = '0'; l.style.animation = 'none'; });

    // Stagger reveal
    requestAnimationFrame(() => {
      lines.forEach(l => { l.style.animation = ''; });
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  REGISTRATION ANIMATION (Step 5)
  // ═══════════════════════════════════════════════════════════

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
    if (progressEl) progressEl.style.width = '0%';

    const phases = [
      { status: 'Registering handle...', sub: 'Connecting to NET registry', progress: '20%', delay: 0 },
      { status: 'Allocating mailbox...', sub: 'Provisioning storage node', progress: '50%', delay: 800 },
      { status: 'Verifying identity...', sub: 'Cross-referencing NET records', progress: '75%', delay: 1600 },
      { status: 'Finalizing...', sub: 'Writing identity confirmation', progress: '95%', delay: 2400 },
    ];

    for (const phase of phases) {
      await new Promise(r => setTimeout(r, phase.delay ? phase.delay - (phases.indexOf(phase) > 0 ? phases[phases.indexOf(phase) - 1].delay : 0) : 0));
      if (!this.element) return; // Dialog was closed
      statusEl.textContent = phase.status;
      if (subEl) subEl.textContent = phase.sub;
      if (progressEl) progressEl.style.width = phase.progress;
    }

    // Actually register
    try {
      await new Promise(r => setTimeout(r, 800));
      if (!this.element) return;

      const email = await this.emailService.registerEmail(this.actor, this._handle, this._domain);

      spinnerEl.style.display = 'none';
      if (emailEl) emailEl.textContent = email;
      successEl.classList.add('ncm-email-reg__success--show');

      // Auto-close after 2.5s
      setTimeout(() => {
        if (this._resolvePromise) {
          this._resolvePromise(email);
          this._resolvePromise = null;
        }
        this.close();
      }, 2500);

    } catch (err) {
      log.error('Email registration failed:', err);
      ui.notifications.error(`Registration failed: ${err.message}`);
      this._goToStep(2);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  INPUT HANDLERS
  // ═══════════════════════════════════════════════════════════

  _onHandleInput(input) {
    const raw = input.value;
    this._handle = this.emailService?.sanitizeHandle(raw) ?? raw;

    // Update preview
    const preview = this.element?.querySelector('[data-handle-preview]');
    if (preview) {
      preview.innerHTML = this._handle
        ? `${this._handle}<span class="ncm-email-dim">@${this._domain || '___'}</span>`
        : '<span class="ncm-email-dim">___@___</span>';
    }

    // Validate
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

    // Deselect domain cards
    this.element?.querySelectorAll('.ncm-email-domain-card').forEach(c => c.classList.remove('ncm-email-domain-card--active'));

    // Update preview
    this._updateEmailPreview();
  }

  _updateEmailPreview() {
    const previews = this.element?.querySelectorAll('[data-handle-preview]');
    previews?.forEach(el => {
      el.innerHTML = this._handle
        ? `${this._handle}<span class="ncm-email-dim">@${this._domain || '___'}</span>`
        : '<span class="ncm-email-dim">___@___</span>';
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  ACTIONS
  // ═══════════════════════════════════════════════════════════

  static _onNextStep(event, target) {
    if (this._step === 1) {
      this._goToStep(2);
    } else if (this._step === 2) {
      // Validate handle before advancing
      const result = this.emailService?.validateHandle(this._handle);
      if (!result?.valid) {
        const input = this.element?.querySelector('[data-handle-input]');
        input?.focus();
        return;
      }
      this._goToStep(3);
    } else if (this._step === 3) {
      const result = this.emailService?.validateDomain(this._domain);
      if (!result?.valid) return;
      this._goToStep(4);
    }
  }

  static _onPrevStep(event, target) {
    if (this._step > 1 && this._step < 5) {
      this._goToStep(this._step - 1);
    }
  }

  static _onSelectSuggestion(event, target) {
    const handle = target.dataset.handle;
    if (!handle) return;

    this._handle = handle;

    // Update input
    const input = this.element?.querySelector('[data-handle-input]');
    if (input) input.value = handle;

    // Update suggestion pills
    this.element?.querySelectorAll('.ncm-email-suggest').forEach(s => {
      s.classList.toggle('ncm-email-suggest--active', s.dataset.handle === handle);
    });

    // Update preview + validation
    this._onHandleInput(input || { value: handle });
  }

  static _onSelectDomain(event, target) {
    const card = target.closest('.ncm-email-domain-card');
    if (!card) return;

    const domain = card.dataset.domain;
    const netId = card.dataset.networkId || '';
    if (!domain) return;

    this._domain = domain;
    this._domainNetworkId = netId;

    // Update active state
    this.element?.querySelectorAll('.ncm-email-domain-card').forEach(c => c.classList.remove('ncm-email-domain-card--active'));
    card.classList.add('ncm-email-domain-card--active');

    // Clear custom input
    const customInput = this.element?.querySelector('[data-custom-domain]');
    if (customInput) customInput.value = '';

    this._updateEmailPreview();
  }

  static _onRegisterIdentity(event, target) {
    this._goToStep(5);
  }
}
