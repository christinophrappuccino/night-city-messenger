/**
 * Custom Role Manager Dialog
 * @file scripts/ui/RoleManagerDialog.js
 * @module cyberpunkred-messenger
 * @description GM dialog for creating, editing, and deleting custom roles.
 *   Shows built-in roles (read-only) and custom roles (editable) in a list,
 *   with a create/edit form featuring a curated icon picker, native color
 *   picker, and live chip preview.
 *
 *   Uses Foundry Dialog with programmatic render callback (no HBS template).
 *   Service layer: MasterContactService.getCustomRoles / addCustomRole /
 *   updateCustomRole / deleteCustomRole.
 *
 *   Visual reference: ncm-gm-editor-mockup-v3.html — State 4
 */

import { MODULE_ID } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

// ═══════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════

const BUILT_IN_ROLES = [
  { id: 'fixer',      label: 'Fixer',      icon: 'crosshairs',       color: '#d4a017' },
  { id: 'solo',       label: 'Solo',       icon: 'crosshairs',       color: '#e04848' },
  { id: 'netrunner',  label: 'Netrunner',  icon: 'terminal',         color: '#00e5ff' },
  { id: 'tech',       label: 'Tech',       icon: 'gear',             color: '#2ecc71' },
  { id: 'medtech',    label: 'Medtech',    icon: 'staff-snake',      color: '#1abc9c' },
  { id: 'ripperdoc',  label: 'Ripperdoc',  icon: 'syringe',          color: '#e06888' },
  { id: 'media',      label: 'Media',      icon: 'podcast',          color: '#b87aff' },
  { id: 'exec',       label: 'Exec',       icon: 'building-columns', color: '#6ec1e4' },
  { id: 'corp',       label: 'Corp',       icon: 'briefcase',        color: '#4a8ab5' },
  { id: 'lawman',     label: 'Lawman',     icon: 'shield-halved',    color: '#6b8fa3' },
  { id: 'nomad',      label: 'Nomad',      icon: 'truck-monster',    color: '#d4844a' },
  { id: 'rockerboy',  label: 'Rockerboy',  icon: 'guitar',           color: '#e05cb5' },
];

/** Curated cyberpunk-relevant icon grid (~32 icons) */
const ICON_OPTIONS = [
  'crosshairs', 'terminal', 'gear', 'briefcase', 'shield-halved',
  'guitar', 'syringe', 'podcast', 'truck-monster', 'building-columns',
  'staff-snake', 'users-line', 'user', 'landmark', 'microchip',
  'jet-fighter', 'box-open', 'satellite-dish', 'ghost', 'skull',
  'binoculars', 'bolt-lightning', 'car', 'hand-fist', 'mask',
  'money-bill-wave', 'bomb', 'robot', 'wand-magic-sparkles', 'flask',
  'warehouse', 'helicopter',
];

/** Build inline chip style from hex color */
function _chipStyle(color) {
  if (!color) return '';
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `color:${color};border-color:rgba(${r},${g},${b},0.35);background:rgba(${r},${g},${b},0.10);`;
}

// ═══════════════════════════════════════════
//  Dialog Class
// ═══════════════════════════════════════════

export class RoleManagerDialog {

  /** @type {MasterContactService} */
  _svc = null;

  /** @type {Dialog|null} */
  _dialog = null;

  /** @type {string|null} Role being edited (null = create mode) */
  _editingRoleId = null;

  /** Form state */
  _formName = '';
  _formColor = '#888888';
  _formIcon = 'tag';

  constructor(masterContactService) {
    this._svc = masterContactService;
  }

  /**
   * Open the Role Manager dialog.
   */
  async open() {
    this._editingRoleId = null;
    this._formName = '';
    this._formColor = '#888888';
    this._formIcon = 'tag';
    this._render();
  }

  /**
   * Build and render the dialog.
   */
  _render() {
    const customRoles = this._svc?.getCustomRoles?.() || [];
    const content = this._buildContent(customRoles);

    if (this._dialog) {
      // Re-render existing dialog by updating content
      try { this._dialog.close(); } catch { /* ok */ }
    }

    const mgr = this;
    this._dialog = new Dialog({
      title: 'Role Manager',
      content,
      buttons: {
        close: { icon: '<i class="fas fa-times"></i>', label: 'Close' },
      },
      default: 'close',
      render: (html) => mgr._onDialogRender(html),
    }, {
      classes: ['ncm-app', 'ncm-role-manager-dialog'],
      width: 480,
      height: 'auto',
      resizable: false,
    });

    this._dialog.render(true);
  }

  /**
   * Build the full HTML content for the dialog.
   */
  _buildContent(customRoles) {
    // Built-in roles list
    const builtInHtml = BUILT_IN_ROLES.map(r => `
      <div class="ncm-role-list-item ncm-role-list-item--builtin">
        <div class="ncm-role-list-item__swatch" style="background:${r.color};"></div>
        <i class="ncm-role-list-item__icon fas fa-${r.icon}" style="color:${r.color};"></i>
        <span class="ncm-role-list-item__name">${r.label}</span>
        <span class="ncm-role-list-item__tag">BUILT-IN</span>
      </div>
    `).join('');

    // Custom roles list
    const customHtml = customRoles.length ? customRoles.map(r => `
      <div class="ncm-role-list-item" data-role-id="${r.id}">
        <div class="ncm-role-list-item__swatch" style="background:${r.color};"></div>
        <i class="ncm-role-list-item__icon fas fa-${r.icon}" style="color:${r.color};"></i>
        <span class="ncm-role-list-item__name">${r.label}</span>
        <span class="ncm-role-list-item__tag">CUSTOM</span>
        <div class="ncm-role-list-item__actions">
          <button class="ncm-role-list-item__action ncm-rm-edit-btn" data-role-id="${r.id}" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="ncm-role-list-item__action ncm-role-list-item__action--delete ncm-rm-delete-btn" data-role-id="${r.id}" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `).join('') : '<div style="font-size:10px;color:#555570;padding:6px 0;">No custom roles yet. Create one below.</div>';

    // Icon grid
    const selectedIcon = this._formIcon;
    const iconGridHtml = ICON_OPTIONS.map(icon => {
      const sel = icon === selectedIcon ? 'ncm-role-form__icon-option--selected' : '';
      return `<button class="ncm-role-form__icon-option ${sel}" data-icon="${icon}"><i class="fas fa-${icon}"></i></button>`;
    }).join('');

    // Live preview
    const previewLabel = (this._formName || 'ROLE').toUpperCase();
    const previewStyle = _chipStyle(this._formColor);

    // Form title
    const formTitle = this._editingRoleId
      ? `<i class="fas fa-pen"></i> Edit Role — ${this._formName}`
      : '<i class="fas fa-plus"></i> Create New Role';

    const saveLabel = this._editingRoleId ? 'Update Role' : 'Save Role';

    return `
      <div class="ncm-role-manager__body">

        <div class="ncm-rm-header-bar">
          <span class="ncm-rm-header-bar__title"><i class="fas fa-palette"></i> Role Manager</span>
          <button class="ncm-btn ncm-btn--accent ncm-btn--sm ncm-rm-new-btn"><i class="fas fa-plus"></i> New Role</button>
        </div>

        <div class="ncm-rm-section"><i class="fas fa-lock"></i> Built-in Roles <span class="ncm-rm-section__hint">(read-only)</span></div>
        <div class="ncm-role-list ncm-rm-builtin-list">${builtInHtml}</div>

        <div class="ncm-rm-section"><i class="fas fa-wand-magic-sparkles"></i> Custom Roles</div>
        <div class="ncm-role-list ncm-rm-custom-list">${customHtml}</div>

        <div class="ncm-role-form ncm-rm-form">
          <div class="ncm-role-form__title">${formTitle}</div>
          <div class="ncm-role-form__row">
            <div class="ncm-form-group" style="flex:1;">
              <label class="ncm-form-label">Role Name</label>
              <input type="text" class="ncm-form-input ncm-rm-name-input" placeholder="e.g. Smuggler" value="${this._formName}" maxlength="30" />
            </div>
            <div class="ncm-form-group">
              <label class="ncm-form-label">Color</label>
              <input type="color" class="ncm-role-form__color-picker ncm-rm-color-input" value="${this._formColor}" />
            </div>
          </div>
          <div class="ncm-form-group">
            <label class="ncm-form-label">Icon <span class="ncm-form-hint">(click to select)</span></label>
            <div class="ncm-role-form__icon-grid">${iconGridHtml}</div>
          </div>
          <div class="ncm-role-form__preview">
            <span class="ncm-role-form__preview-label">Preview:</span>
            <span class="ncm-chip ncm-rm-preview-chip" style="${previewStyle}">
              <i class="fas fa-${this._formIcon}"></i> ${previewLabel}
            </span>
            <span class="ncm-gm-list-item__role ncm-rm-preview-pill" style="${previewStyle}">${previewLabel}</span>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:8px;">
            <button class="ncm-btn ncm-btn--ghost ncm-btn--sm ncm-rm-cancel-btn"><i class="fas fa-times"></i> Cancel</button>
            <button class="ncm-btn ncm-btn--accent ncm-btn--sm ncm-rm-save-btn"><i class="fas fa-save"></i> ${saveLabel}</button>
          </div>
        </div>

      </div>
    `;
  }

  /**
   * Wire up all event listeners after dialog renders.
   */
  _onDialogRender(html) {
    const el = html[0] || html;

    // New Role button
    el.querySelector('.ncm-rm-new-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._editingRoleId = null;
      this._formName = '';
      this._formColor = '#888888';
      this._formIcon = 'tag';
      this._render();
    });

    // Edit buttons
    el.querySelectorAll('.ncm-rm-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const roleId = btn.dataset.roleId;
        const roles = this._svc?.getCustomRoles?.() || [];
        const role = roles.find(r => r.id === roleId);
        if (!role) return;

        this._editingRoleId = roleId;
        this._formName = role.label;
        this._formColor = role.color;
        this._formIcon = role.icon;
        this._render();
      });
    });

    // Delete buttons
    el.querySelectorAll('.ncm-rm-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const roleId = btn.dataset.roleId;
        await this._deleteRole(roleId);
      });
    });

    // Icon grid clicks
    el.querySelectorAll('.ncm-role-form__icon-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.preventDefault();
        const icon = opt.dataset.icon;
        if (!icon) return;

        this._formIcon = icon;

        // Update selected state
        el.querySelectorAll('.ncm-role-form__icon-option').forEach(o =>
          o.classList.toggle('ncm-role-form__icon-option--selected', o.dataset.icon === icon)
        );

        // Update preview
        this._updatePreview(el);
      });
    });

    // Name input — live preview
    const nameInput = el.querySelector('.ncm-rm-name-input');
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        this._formName = nameInput.value;
        this._updatePreview(el);
      });
      // Auto-focus
      setTimeout(() => nameInput.focus(), 50);
    }

    // Color picker — live preview
    const colorInput = el.querySelector('.ncm-rm-color-input');
    if (colorInput) {
      colorInput.addEventListener('input', () => {
        this._formColor = colorInput.value;
        this._updatePreview(el);
      });
    }

    // Save button
    el.querySelector('.ncm-rm-save-btn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await this._saveRole();
    });

    // Cancel button
    el.querySelector('.ncm-rm-cancel-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._editingRoleId = null;
      this._formName = '';
      this._formColor = '#888888';
      this._formIcon = 'tag';
      this._render();
    });
  }

  /**
   * Update live preview chip and pill.
   */
  _updatePreview(el) {
    const label = (this._formName || 'ROLE').toUpperCase();
    const style = _chipStyle(this._formColor);

    const chip = el.querySelector('.ncm-rm-preview-chip');
    if (chip) {
      chip.setAttribute('style', style);
      chip.innerHTML = `<i class="fas fa-${this._formIcon}"></i> ${label}`;
    }

    const pill = el.querySelector('.ncm-rm-preview-pill');
    if (pill) {
      pill.setAttribute('style', style);
      pill.textContent = label;
    }
  }

  /**
   * Save a new or edited role.
   */
  async _saveRole() {
    const name = this._formName.trim();
    if (!name) {
      ui.notifications.warn('Role name is required.');
      return;
    }

    try {
      if (this._editingRoleId) {
        const result = await this._svc.updateCustomRole(this._editingRoleId, {
          label: name,
          icon: this._formIcon,
          color: this._formColor,
        });
        if (result.success) {
          ui.notifications.info(`Role "${name}" updated.`);
        } else {
          ui.notifications.error(result.error || 'Failed to update role.');
          return;
        }
      } else {
        const result = await this._svc.addCustomRole({
          label: name,
          icon: this._formIcon,
          color: this._formColor,
        });
        if (result.success) {
          ui.notifications.info(`Role "${name}" created.`);
        } else {
          ui.notifications.error(result.error || 'Failed to create role.');
          return;
        }
      }

      // Reset form and re-render
      this._editingRoleId = null;
      this._formName = '';
      this._formColor = '#888888';
      this._formIcon = 'tag';
      this._render();
    } catch (err) {
      console.error(`${MODULE_ID} | RoleManagerDialog save failed:`, err);
      ui.notifications.error('Failed to save role.');
    }
  }

  /**
   * Delete a custom role with confirmation.
   */
  async _deleteRole(roleId) {
    const roles = this._svc?.getCustomRoles?.() || [];
    const role = roles.find(r => r.id === roleId);
    if (!role) return;

    // Count affected contacts
    const contacts = this._svc.getAll?.() || [];
    const affected = contacts.filter(c => c.role === roleId).length;

    const warningText = affected > 0
      ? `<p style="color:var(--ncm-text-muted,#555570);font-size:11px;margin-top:4px;">${affected} contact${affected > 1 ? 's' : ''} use this role — their role will be cleared.</p>`
      : '';

    const confirmed = await Dialog.confirm({
      title: 'Delete Custom Role',
      content: `
        <div style="text-align:center; padding:8px 0;">
          <p style="color:var(--ncm-text-primary,#e0e0e8);">
            Delete the <strong style="color:${role.color};">${role.label}</strong> role?
          </p>
          ${warningText}
        </div>`,
    });

    if (!confirmed) return;

    const result = await this._svc.deleteCustomRole(roleId);
    if (result.success) {
      ui.notifications.info(`Role "${role.label}" deleted.${result.affectedContacts ? ` ${result.affectedContacts} contacts cleared.` : ''}`);
      this._render();
    } else {
      ui.notifications.error(result.error || 'Failed to delete role.');
    }
  }
}
