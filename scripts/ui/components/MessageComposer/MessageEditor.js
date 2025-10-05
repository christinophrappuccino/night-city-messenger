/**
 * Message Editor Component
 * File: scripts/ui/components/MessageComposer/MessageEditor.js
 * Module: cyberpunkred-messenger
 * Description: Rich text editor for message content
 */

import { MODULE_ID } from '../../../utils/constants.js';

export class MessageEditor {
  constructor(parent) {
    this.parent = parent;
    this.editor = null;
    this.characterCount = 0;
    this.maxCharacters = 10000;
  }
  
  /**
   * Initialize editor
   * @param {jQuery} html - Parent HTML
   */
  initialize(html) {
    const $textarea = html.find('[name="content"]');
    
    if ($textarea.length === 0) return;
    
    this.editor = $textarea[0];
    
    // Update character count
    this.updateCharacterCount();
  }
  
  /**
   * Get editor content
   * @returns {string}
   */
  getContent() {
    if (!this.editor) return '';
    return this.editor.value;
  }
  
  /**
   * Set editor content
   * @param {string} content - Content to set
   */
  setContent(content) {
    if (!this.editor) return;
    this.editor.value = content;
    this.updateCharacterCount();
  }
  
  /**
   * Clear editor
   */
  clear() {
    this.setContent('');
  }
  
  /**
   * Insert text at cursor
   * @param {string} text - Text to insert
   */
  insertText(text) {
    if (!this.editor) return;
    
    const start = this.editor.selectionStart;
    const end = this.editor.selectionEnd;
    const currentValue = this.editor.value;
    
    const newValue = currentValue.substring(0, start) + text + currentValue.substring(end);
    
    this.editor.value = newValue;
    this.editor.selectionStart = this.editor.selectionEnd = start + text.length;
    
    this.updateCharacterCount();
  }
  
  /**
   * Format text (bold, italic, etc.)
   * @param {string} format - Format type
   */
  formatText(format) {
    if (!this.editor) return;
    
    const start = this.editor.selectionStart;
    const end = this.editor.selectionEnd;
    const selectedText = this.editor.value.substring(start, end);
    
    if (!selectedText) return;
    
    let formatted = selectedText;
    
    switch (format) {
      case 'bold':
        formatted = `<strong>${selectedText}</strong>`;
        break;
      case 'italic':
        formatted = `<em>${selectedText}</em>`;
        break;
      case 'underline':
        formatted = `<u>${selectedText}</u>`;
        break;
      case 'code':
        formatted = `<code>${selectedText}</code>`;
        break;
    }
    
    this.insertText(formatted);
  }
  
  /**
   * Update character count display
   */
  updateCharacterCount() {
    const content = this.getContent();
    this.characterCount = content.length;
    
    const $counter = $('.ncm-editor-character-count');
    if ($counter.length > 0) {
      $counter.text(`${this.characterCount} / ${this.maxCharacters}`);
      
      // Warn if approaching limit
      if (this.characterCount > this.maxCharacters * 0.9) {
        $counter.addClass('warning');
      } else {
        $counter.removeClass('warning');
      }
    }
  }
  
  /**
   * Activate event listeners
   */
  activateListeners(html) {
    // Initialize editor
    this.initialize(html);
    
    const $textarea = html.find('[name="content"]');
    
    // Update character count on input
    $textarea.on('input', () => {
      this.updateCharacterCount();
    });
    
    // Formatting buttons
    html.find('.ncm-editor-format-btn').on('click', (event) => {
      const format = $(event.currentTarget).data('format');
      this.formatText(format);
      this.parent.playSound('click');
    });
    
    // Insert template
    html.find('.ncm-editor-template-btn').on('click', () => {
      this.showTemplateSelector();
      this.parent.playSound('click');
    });
    
    // Tab key handling (insert spaces instead of tab)
    $textarea.on('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        this.insertText('    '); // 4 spaces
      }
    });
  }
  
  /**
   * Show template selector
   */
  showTemplateSelector() {
    const templates = [
      {
        name: 'Professional',
        content: 'Greetings,\n\n[Your message here]\n\nBest regards,\n[Your name]'
      },
      {
        name: 'Casual',
        content: 'Hey,\n\n[Your message here]\n\nCatch you later,\n[Your name]'
      },
      {
        name: 'Urgent',
        content: '⚠️ URGENT ⚠️\n\n[Your message here]\n\nImmediate response required.'
      }
    ];
    
    const content = `
      <div class="ncm-template-selector">
        ${templates.map((t, i) => `
          <div class="ncm-template-item" data-index="${i}">
            <strong>${t.name}</strong>
            <pre>${t.content}</pre>
          </div>
        `).join('')}
      </div>
    `;
    
    new Dialog({
      title: 'Select Template',
      content,
      buttons: {
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel'
        }
      },
      render: (html) => {
        html.find('.ncm-template-item').on('click', (event) => {
          const index = $(event.currentTarget).data('index');
          const template = templates[index];
          
          this.setContent(template.content);
          
          // Close dialog
          html.closest('.dialog').find('.dialog-button.cancel').click();
        });
      }
    }, {
      classes: ['dialog', 'ncm-dialog'],
      width: 500
    }).render(true);
  }
  
  /**
   * Cleanup
   */
  destroy() {
    this.editor = null;
  }
}