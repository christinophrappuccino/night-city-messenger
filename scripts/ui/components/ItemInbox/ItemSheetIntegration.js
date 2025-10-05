/**
 * Item Sheet Integration
 * File: scripts/integrations/ItemSheetIntegration.js
 * Module: cyberpunkred-messenger
 * Description: Add "View Messages" button to item sheets
 */

import { MODULE_ID } from '../utils/constants.js';

/**
 * Register item sheet hooks
 */
export function registerItemSheetHooks() {
  // Add button to item sheets
  Hooks.on('renderItemSheet', (app, html, data) => {
    const item = app.object;
    
    // Check if item is a data shard
    const isDataShard = item.getFlag(MODULE_ID, 'isDataShard');
    
    if (!isDataShard) return;
    
    // Add "View Messages" button to header
    const $header = html.find('.window-header .window-title');
    
    if ($header.length > 0) {
      const $button = $(`
        <a class="ncm-item-sheet-btn" title="View Data Shard Messages">
          <i class="fas fa-envelope"></i> View Messages
        </a>
      `);
      
      $button.on('click', async (event) => {
        event.preventDefault();
        
        // Open item inbox
        const { ItemInboxApp } = await import('../ui/components/ItemInbox/ItemInboxApp.js');
        new ItemInboxApp(item).render(true);
      });
      
      $header.after($button);
    }
    
    // Add styling
    if (!document.getElementById('ncm-item-sheet-styles')) {
      const style = document.createElement('style');
      style.id = 'ncm-item-sheet-styles';
      style.textContent = `
        .ncm-item-sheet-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 8px;
          margin-left: 10px;
          background: #1a1a1a;
          border: 1px solid #F65261;
          color: #F65261;
          border-radius: 3px;
          cursor: pointer;
          font-size: 0.9em;
          transition: all 0.2s;
        }
        
        .ncm-item-sheet-btn:hover {
          background: #F65261;
          color: #1a1a1a;
        }
      `;
      document.head.appendChild(style);
    }
  });
  
  console.log(`${MODULE_ID} | Item sheet integration registered`);
}