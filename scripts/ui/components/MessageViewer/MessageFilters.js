/**
 * Message Filters Component
 * File: scripts/ui/components/MessageViewer/MessageFilters.js
 * Module: cyberpunkred-messenger
 * Description: Handles filtering, search, and category switching
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { EVENTS } from '../../../core/EventBus.js';

export class MessageFilters {
  constructor(parent) {
    this.parent = parent;
    this.eventBus = parent.eventBus;
    this.stateManager = parent.stateManager;
    
    this.searchDebounceTimer = null;
    this.advancedFiltersOpen = false;
  }
  
  /**
   * Set current category filter
   * @param {string} category - Category name (inbox, saved, spam, sent)
   */
  setCategory(category) {
    const validCategories = ['inbox', 'saved', 'spam', 'sent'];
    
    if (!validCategories.includes(category)) {
      console.warn(`${MODULE_ID} | Invalid category: ${category}`);
      return;
    }
    
    // Update state
    this.stateManager.update({
      currentFilter: category,
      'pagination.currentPage': 1 // Reset to first page
    });
    
    // Emit event
    this.eventBus.emit(EVENTS.STATE_FILTER_CHANGED, { category });
    
    // Update UI
    this._updateCategoryUI(category);
  }
  
  /**
   * Set search term
   * @param {string} term - Search term
   */
  setSearchTerm(term) {
    // Clear existing debounce timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    
    // Debounce search to avoid excessive re-renders
    this.searchDebounceTimer = setTimeout(() => {
      this.stateManager.update({
        searchTerm: term,
        'pagination.currentPage': 1 // Reset to first page
      });
      
      this.eventBus.emit(EVENTS.STATE_SEARCH_CHANGED, { term });
      
      this.parent.render(false);
    }, 300);
  }
  
  /**
   * Clear search
   */
  clearSearch() {
    this.stateManager.set('searchTerm', '');
    this.parent.render(false);
    
    // Clear input
    const $element = this.parent._element;
    if ($element) {
      $element.find('.ncm-filters__search-input').val('');
    }
  }
  
  /**
   * Toggle advanced filters panel
   */
  toggleAdvancedFilters() {
    this.advancedFiltersOpen = !this.advancedFiltersOpen;
    
    const $element = this.parent._element;
    if (!$element) return;
    
    const $panel = $element.find('.ncm-filters__advanced-panel');
    
    if (this.advancedFiltersOpen) {
      $panel.slideDown(200);
    } else {
      $panel.slideUp(200);
    }
  }
  
  /**
   * Apply advanced filters
   * @param {Object} filters - Filter object
   */
  applyAdvancedFilters(filters) {
    this.stateManager.update({
      advancedFilters: filters,
      'pagination.currentPage': 1
    });
    
    this.parent.render(false);
    
    ui.notifications.info('Filters applied');
  }
  
  /**
   * Clear advanced filters
   */
  clearAdvancedFilters() {
    this.stateManager.set('advancedFilters', null);
    this.parent.render(false);
    
    // Clear form
    const $element = this.parent._element;
    if ($element) {
      $element.find('.ncm-filters__advanced-panel form')[0]?.reset();
    }
    
    ui.notifications.info('Filters cleared');
  }
  
  /**
   * Update category button UI
   * @private
   */
  _updateCategoryUI(activeCategory) {
    const $element = this.parent._element;
    if (!$element) return;
    
    $element.find('.ncm-filters__category-btn').removeClass('ncm-filters__category-btn--active');
    $element.find(`[data-category="${activeCategory}"]`).addClass('ncm-filters__category-btn--active');
  }
  
  /**
   * Activate event listeners
   * @param {jQuery} html - The application HTML
   */
  activateListeners(html) {
    // Category buttons
    html.find('.ncm-filters__category-btn').on('click', (event) => {
      const category = $(event.currentTarget).data('category');
      this.setCategory(category);
      this.parent.playSound('click');
    });
    
    // Search input
    html.find('.ncm-filters__search-input').on('input', (event) => {
      const term = $(event.currentTarget).val();
      this.setSearchTerm(term);
    });
    
    // Clear search button
    html.find('.ncm-filters__clear-search').on('click', () => {
      this.clearSearch();
      this.parent.playSound('click');
    });
    
    // Advanced filters toggle
    html.find('.ncm-filters__advanced-toggle').on('click', () => {
      this.toggleAdvancedFilters();
      this.parent.playSound('click');
    });
    
    // Apply advanced filters
    html.find('.ncm-filters__apply-advanced').on('click', (event) => {
      event.preventDefaul