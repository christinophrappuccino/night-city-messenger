/**
 * Recipient Selector Component
 * File: scripts/ui/components/MessageComposer/RecipientSelector.js
 * Module: cyberpunkred-messenger
 * Description: Handles recipient selection with autocomplete
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class RecipientSelector {
  constructor(parent) {
    this.parent = parent;
    this.contactRepository = parent.contactRepository;
    
    this.suggestionsVisible = false;
    this.selectedIndex = -1;
    this.suggestions = [];
  }
  
  /**
   * Get recipient suggestions
   * @param {string} query - Search query
   * @returns {Array}
   */
  getSuggestions(query) {
    if (!query || query.length < 2) {
      return [];
    }
    
    const queryLower = query.toLowerCase();
    const suggestions = [];
    
    // Get contacts
    const contacts = this.contactRepository.getAll();
    contacts.forEach(contact => {
      if (contact.name.toLowerCase().includes(queryLower) ||
          contact.email.toLowerCase().includes(queryLower)) {
        suggestions.push({
          type: 'contact',
          name: contact.name,
          email: contact.email,
          img: null
        });
      }
    });
    
    // Get actors
    game.actors.forEach(actor => {
      if (actor.type === 'character' && 
          actor.name.toLowerCase().includes(queryLower)) {
        const email = `${actor.name.toLowerCase().replace(/\s+/g, '')}@nightcity.net`;
        suggestions.push({
          type: 'actor',
          name: actor.name,
          email: email,
          img: actor.img
        });
      }
    });
    
    // Get users
    game.users.forEach(user => {
      if (user.name.toLowerCase().includes(queryLower)) {
        const name = user.character?.name || user.name;
        const email = `${name.toLowerCase().replace(/\s+/g, '')}@nightcity.net`;
        suggestions.push({
          type: 'user',
          name: name,
          email: email,
          img: user.character?.img || user.avatar
        });
      }
    });
    
    // Remove duplicates by email
    const unique = [];
    const seen = new Set();
    
    suggestions.forEach(s => {
      if (!seen.has(s.email)) {
        seen.add(s.email);
        unique.push(s);
      }
    });
    
    return unique.slice(0, 10); // Limit to 10 suggestions
  }
  
  /**
   * Show suggestions
   * @param {jQuery} $input - Input element
   * @param {Array} suggestions - Suggestions to show
   */
  showSuggestions($input, suggestions) {
    this.suggestions = suggestions;
    this.selectedIndex = -1;
    
    const $container = $input.closest('.ncm-recipient-selector');
    let $dropdown = $container.find('.ncm-recipient-dropdown');
    
    // Create dropdown if doesn't exist
    if ($dropdown.length === 0) {
      $dropdown = $('<div class="ncm-recipient-dropdown"></div>');
      $container.append($dropdown);
    }
    
    // Clear and populate
    $dropdown.empty();
    
    if (suggestions.length === 0) {
      $dropdown.hide();
      this.suggestionsVisible = false;
      return;
    }
    
    suggestions.forEach((suggestion, index) => {
      const $item = $(`
        <div class="ncm-recipient-item" data-index="${index}">
          ${suggestion.img ? `<img src="${suggestion.img}" alt="${suggestion.name}" />` : '<i class="fas fa-user"></i>'}
          <div class="ncm-recipient-info">
            <div class="ncm-recipient-name">${suggestion.name}</div>
            <div class="ncm-recipient-email">${suggestion.email}</div>
          </div>
        </div>
      `);
      
      $item.on('click', () => {
        this.selectSuggestion(index, $input);
      });
      
      $dropdown.append($item);
    });
    
    $dropdown.show();
    this.suggestionsVisible = true;
  }
  
  /**
   * Hide suggestions
   */
  hideSuggestions() {
    const $dropdown = $('.ncm-recipient-dropdown');
    $dropdown.hide();
    this.suggestionsVisible = false;
    this.selectedIndex = -1;
  }
  
  /**
   * Select suggestion
   * @param {number} index - Suggestion index
   * @param {jQuery} $input - Input element
   */
  selectSuggestion(index, $input) {
    if (index < 0 || index >= this.suggestions.length) return;
    
    const suggestion = this.suggestions[index];
    $input.val(suggestion.email);
    
    this.hideSuggestions();
  }
  
  /**
   * Navigate suggestions with keyboard
   * @param {string} direction - 'up' or 'down'
   */
  navigateSuggestions(direction) {
    if (!this.suggestionsVisible || this.suggestions.length === 0) return;
    
    if (direction === 'down') {
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1);
    } else if (direction === 'up') {
      this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
    }
    
    // Update UI
    const $items = $('.ncm-recipient-item');
    $items.removeClass('selected');
    
    if (this.selectedIndex >= 0) {
      $items.eq(this.selectedIndex).addClass('selected');
    }
  }
  
  /**
   * Activate event listeners
   */
  activateListeners(html) {
    const $input = html.find('[name="to"]');
    
    // Input event - show suggestions
    $input.on('input', () => {
      const query = $input.val();
      const suggestions = this.getSuggestions(query);
      this.showSuggestions($input, suggestions);
    });
    
    // Focus event - show suggestions if has value
    $input.on('focus', () => {
      const query = $input.val();
      if (query.length >= 2) {
        const suggestions = this.getSuggestions(query);
        this.showSuggestions($input, suggestions);
      }
    });
    
    // Blur event - hide suggestions (with delay for click)
    $input.on('blur', () => {
      setTimeout(() => {
        this.hideSuggestions();
      }, 200);
    });
    
    // Keyboard navigation
    $input.on('keydown', (event) => {
      if (!this.suggestionsVisible) return;
      
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          this.navigateSuggestions('down');
          break;
        case 'ArrowUp':
          event.preventDefault();
          this.navigateSuggestions('up');
          break;
        case 'Enter':
          if (this.selectedIndex >= 0) {
            event.preventDefault();
            this.selectSuggestion(this.selectedIndex, $input);
          }
          break;
        case 'Escape':
          event.preventDefault();
          this.hideSuggestions();
          break;
      }
    });
    
    // Contact picker button
    html.find('.ncm-recipient-picker-btn').on('click', () => {
      this.openContactPicker($input);
    });
  }
  
  /**
   * Open contact picker dialog
   * @param {jQuery} $input - Input element to populate
   */
  openContactPicker($input) {
    const contacts = this.contactRepository.getAll();
    
    const content = `
      <div class="ncm-contact-picker">
        <input type="text" class="ncm-contact-search" placeholder="Search contacts..." />
        <div class="ncm-contact-list">
          ${contacts.map(c => `
            <div class="ncm-contact-item" data-email="${c.email}">
              <i class="fas fa-user"></i>
              <div>
                <div class="ncm-contact-name">${c.name}</div>
                <div class="ncm-contact-email">${c.email}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    
    new Dialog({
      title: 'Select Contact',
      content,
      buttons: {
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      },
      render: (html) => {
        // Search functionality
        html.find('.ncm-contact-search').on('input', (event) => {
          const query = $(event.currentTarget).val().toLowerCase();
          
          html.find('.ncm-contact-item').each((i, el) => {
            const $item = $(el);
            const text = $item.text().toLowerCase();
            
            if (text.includes(query)) {
              $item.show();
            } else {
              $item.hide();
            }
          });
        });
        
        // Click to select
        html.find('.ncm-contact-item').on('click', function() {
          const email = $(this).data('email');
          $input.val(email);
          
          // Close dialog
          html.closest('.dialog').find('.dialog-button.cancel').click();
        });
      }
    }, {
      classes: ['dialog', 'ncm-dialog'],
      width: 400,
      height: 500
    }).render(true);
  }
  
  /**
   * Cleanup
   */
  destroy() {
    this.hideSuggestions();
  }
}