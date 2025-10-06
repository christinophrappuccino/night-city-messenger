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
    const validCategories = ['all', 'inbox', 'unread', 'read', 'saved', 'spam', 'sent'];
    
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
    
    // Trigger parent re-render
    this.parent.render(false);
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
      // Update state
      this.stateManager.update({
        searchTerm: term,
        'pagination.currentPage': 1 // Reset to first page
      });
      
      // Emit event
      this.eventBus.emit(EVENTS.STATE_SEARCH_CHANGED, { term });
      
      // Trigger parent re-render
      this.parent.render(false);
    }, 300);
  }
  
  /**
   * Toggle advanced filters panel
   */
  toggleAdvancedFilters() {
    this.advancedFiltersOpen = !this.advancedFiltersOpen;
    
    // Update state
    this.stateManager.update({
      showFilters: this.advancedFiltersOpen
    });
    
    // Trigger parent re-render
    this.parent.render(false);
  }
  
  /**
   * Apply advanced filters
   * @param {Object} filters - Filter criteria
   */
  applyAdvancedFilters(filters) {
    // Store filters in state
    this.stateManager.update({
      advancedFilters: filters,
      'pagination.currentPage': 1
    });
    
    // Emit event
    this.eventBus.emit(EVENTS.STATE_FILTER_CHANGED, { filters });
    
    // Trigger parent re-render
    this.parent.render(false);
  }
  
  /**
   * Clear all filters
   */
  clearFilters() {
    // Reset to defaults
    this.stateManager.update({
      currentFilter: 'all',
      searchTerm: '',
      advancedFilters: null,
      'pagination.currentPage': 1
    });
    
    // Emit event
    this.eventBus.emit(EVENTS.STATE_FILTER_CLEARED);
    
    // Trigger parent re-render
    this.parent.render(false);
  }
  
  /**
   * Set sort order
   * @param {string} sortBy - Sort field and direction
   */
  setSortOrder(sortBy) {
    const validSorts = ['date-desc', 'date-asc', 'sender-az', 'sender-za', 'subject-az', 'subject-za'];
    
    if (!validSorts.includes(sortBy)) {
      console.warn(`${MODULE_ID} | Invalid sort order: ${sortBy}`);
      return;
    }
    
    // Update state
    this.stateManager.update({
      sortOrder: sortBy
    });
    
    // Emit event
    this.eventBus.emit(EVENTS.STATE_SORT_CHANGED, { sortBy });
    
    // Trigger parent re-render
    this.parent.render(false);
  }
  
  /**
   * Get current filter state
   * @returns {Object} Current filter state
   */
  getFilterState() {
    return {
      category: this.stateManager.get('currentFilter') || 'all',
      searchTerm: this.stateManager.get('searchTerm') || '',
      sortOrder: this.stateManager.get('sortOrder') || 'date-desc',
      advancedFilters: this.stateManager.get('advancedFilters'),
      showFilters: this.stateManager.get('showFilters') || false
    };
  }
  
  /**
   * Activate listeners
   * @param {jQuery} html - The rendered HTML
   */
  activateListeners(html) {
    // Search input
    html.find('[data-action="search"]').on('input', (event) => {
      this.setSearchTerm(event.target.value);
    });
    
    // Category filter select
    html.find('[data-filter="status"]').on('change', (event) => {
      this.setCategory(event.target.value);
    });
    
    // Sort order select
    html.find('[data-filter="sort"]').on('change', (event) => {
      this.setSortOrder(event.target.value);
    });
    
    // Toggle filters button
    html.find('[data-action="toggle-filters"]').on('click', () => {
      this.toggleAdvancedFilters();
    });
    
    // Clear filters button
    html.find('[data-action="clear-filters"]').on('click', () => {
      this.clearFilters();
    });
    
    // Refresh button
    html.find('[data-action="refresh"]').on('click', () => {
      this.parent.render(false);
    });
  }
  
  /**
   * Destroy/cleanup
   */
  destroy() {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
  }
}