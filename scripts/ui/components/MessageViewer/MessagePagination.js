/**
 * Message Pagination Component
 * File: scripts/ui/components/MessageViewer/MessagePagination.js
 * Module: cyberpunkred-messenger
 * Description: Handles pagination controls
 */

export class MessagePagination {
  constructor(parent) {
    this.parent = parent;
    this.stateManager = parent.stateManager;
  }
  
  /**
   * Go to specific page
   * @param {number} page - Page number
   */
  goToPage(page) {
    const totalPages = this.stateManager.get('pagination.totalPages');
    
    // Validate page number
    if (page < 1 || page > totalPages) {
      console.warn(`Invalid page number: ${page}`);
      return;
    }
    
    this.stateManager.set('pagination.currentPage', page);
    this.parent.render(false);
    
    // Scroll to top of message list
    const $element = this.parent._element;
    if ($element) {
      $element.find('.ncm-viewer__message-list').scrollTop(0);
    }
  }
  
  /**
   * Go to next page
   */
  nextPage() {
    const currentPage = this.stateManager.get('pagination.currentPage');
    const totalPages = this.stateManager.get('pagination.totalPages');
    
    if (currentPage < totalPages) {
      this.goToPage(currentPage + 1);
    }
  }
  
  /**
   * Go to previous page
   */
  previousPage() {
    const currentPage = this.stateManager.get('pagination.currentPage');
    
    if (currentPage > 1) {
      this.goToPage(currentPage - 1);
    }
  }
  
  /**
   * Go to first page
   */
  firstPage() {
    this.goToPage(1);
  }
  
  /**
   * Go to last page
   */
  lastPage() {
    const totalPages = this.stateManager.get('pagination.totalPages');
    this.goToPage(totalPages);
  }
  
  /**
   * Activate event listeners
   * @param {jQuery} html - The application HTML
   */
  activateListeners(html) {
    // Previous page
    html.find('.ncm-pagination__prev').on('click', () => {
      this.previousPage();
      this.parent.playSound('click');
    });
    
    // Next page
    html.find('.ncm-pagination__next').on('click', () => {
      this.nextPage();
      this.parent.playSound('click');
    });
    
    // First page
    html.find('.ncm-pagination__first').on('click', () => {
      this.firstPage();
      this.parent.playSound('click');
    });
    
    // Last page
    html.find('.ncm-pagination__last').on('click', () => {
      this.lastPage();
      this.parent.playSound('click');
    });
    
    // Page number input
    html.find('.ncm-pagination__input').on('change', (event) => {
      const page = parseInt($(event.currentTarget).val());
      if (!isNaN(page)) {
        this.goToPage(page);
      }
    });
  }
  
  /**
   * Cleanup
   */
  destroy() {
    // Cleanup if needed
  }
}