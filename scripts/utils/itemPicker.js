/**
 * Item Picker Utility
 * @file scripts/utils/itemPicker.js
 * @module cyberpunkred-messenger
 * @description Shared dialog for selecting items from inventory, world items,
 *   and compendiums. Features search, type filtering, and source tabs.
 */

/**
 * Show an item picker for a player's actor inventory.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {string} [options.title='Select Item']
 * @param {string} [options.hint]
 * @returns {Promise<Item|null>}
 */
export async function showItemPicker(actor, options = {}) {
  if (!actor) {
    ui.notifications.warn('NCM | No character assigned.');
    return null;
  }

  const items = (actor.items?.contents ?? [])
    .filter(i => i.type !== 'skill' && i.type !== 'role')
    .sort((a, b) => a.name.localeCompare(b.name));

  return _showPicker(items, {
    title: options.title || 'Select Item',
    hint: options.hint || null,
    emptyMessage: 'No items in inventory.',
    showSource: false,
  });
}

/**
 * Show an item picker for world items + compendiums (GM mode).
 * @param {object} [options]
 * @param {string} [options.title='Select Key Item']
 * @returns {Promise<Item|null>}
 */
export async function showWorldItemPicker(options = {}) {
  // Gather world items
  const worldItems = (game.items?.contents ?? [])
    .filter(i => i.type !== 'skill' && i.type !== 'role')
    .map(i => ({ id: i.id, name: i.name, img: i.img, type: i.type, source: 'World', item: i }));

  // Gather compendium items
  const compendiumItems = [];
  for (const pack of game.packs) {
    if (pack.documentName !== 'Item') continue;
    try {
      const index = await pack.getIndex({ fields: ['img', 'type', 'name'] });
      for (const entry of index) {
        if (entry.type === 'skill' || entry.type === 'role') continue;
        compendiumItems.push({
          id: entry._id,
          name: entry.name,
          img: entry.img || 'icons/svg/item-bag.svg',
          type: entry.type || 'unknown',
          source: pack.metadata.label || pack.metadata.id,
          packId: pack.metadata.id,
          uuid: `Compendium.${pack.metadata.id}.Item.${entry._id}`,
        });
      }
    } catch { /* skip inaccessible packs */ }
  }

  const allItems = [...worldItems, ...compendiumItems]
    .sort((a, b) => a.name.localeCompare(b.name));

  return _showPicker(allItems, {
    title: options.title || 'Select Key Item',
    hint: null,
    emptyMessage: 'No items found.',
    showSource: true,
    resolveFromPack: true,
  });
}

/**
 * Internal: render the picker dialog.
 * @param {Array} items - Array of { id, name, img, type, source?, item?, uuid? }
 * @param {object} config
 * @returns {Promise<Item|null>}
 */
function _showPicker(items, config) {
  if (items.length === 0) {
    ui.notifications.warn(`NCM | ${config.emptyMessage}`);
    return Promise.resolve(null);
  }

  // Collect unique types for filter
  const types = [...new Set(items.map(i => i.type))].sort();

  return new Promise((resolve) => {
    let resolved = false;
    let searchTerm = '';
    let filterType = '';

    const buildRows = () => {
      let filtered = items;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        filtered = filtered.filter(i => i.name.toLowerCase().includes(q));
      }
      if (filterType) {
        filtered = filtered.filter(i => i.type === filterType);
      }
      if (filtered.length === 0) {
        return '<div class="ncm-itempick__empty">No matching items</div>';
      }
      return filtered.map(i =>
        `<div class="ncm-itempick__row" data-item-id="${i.id}" ${i.uuid ? `data-uuid="${i.uuid}"` : ''} ${i.item ? 'data-local="true"' : ''}>
          <img class="ncm-itempick__img" src="${i.img || 'icons/svg/item-bag.svg'}" alt="" />
          <div class="ncm-itempick__info">
            <span class="ncm-itempick__name">${i.name}</span>
            ${config.showSource ? `<span class="ncm-itempick__source">${i.source || ''}</span>` : ''}
          </div>
          <span class="ncm-itempick__type">${i.type}</span>
        </div>`
      ).join('');
    };

    const typeOptions = types.map(t =>
      `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
    ).join('');

    const content = `
      <style>
        .ncm-itempick__controls { display:flex; gap:6px; margin-bottom:8px; }
        .ncm-itempick__search {
          all: unset !important; flex:1 !important; font-family:monospace !important; font-size:11px !important;
          padding:4px 8px !important; background:rgba(0,0,0,0.3) !important; border:1px solid #2a2a45 !important;
          border-radius:2px !important; color:#e0e0e8 !important; caret-color:#19f3f7 !important;
          -webkit-text-fill-color:#e0e0e8 !important; box-sizing:border-box !important; cursor:text !important;
        }
        .ncm-itempick__search::placeholder { color:#555570 !important; -webkit-text-fill-color:#555570 !important; opacity:1 !important; }
        .ncm-itempick__search:focus { border-color:#19f3f7 !important; }
        .ncm-itempick__filter {
          all: unset !important; font-family:monospace !important; font-size:10px !important;
          padding:4px 6px !important; background:rgba(0,0,0,0.3) !important; border:1px solid #2a2a45 !important;
          border-radius:2px !important; color:#8888a0 !important; cursor:pointer !important;
          -webkit-text-fill-color:#8888a0 !important;
        }
        .ncm-itempick__list { max-height:350px; overflow-y:auto; display:flex; flex-direction:column; gap:2px; }
        .ncm-itempick__row {
          display:flex; align-items:center; gap:8px; padding:6px 10px; cursor:pointer;
          border:1px solid transparent; border-radius:3px; transition:all 0.12s;
        }
        .ncm-itempick__row:hover { border-color:rgba(25,243,247,0.35); background:rgba(25,243,247,0.05); }
        .ncm-itempick__img { width:28px; height:28px; border:1px solid #2a2a45; border-radius:3px; flex-shrink:0; object-fit:cover; }
        .ncm-itempick__info { flex:1; display:flex; flex-direction:column; gap:1px; min-width:0; overflow:hidden; }
        .ncm-itempick__name { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .ncm-itempick__source { font-size:8px; color:#555570; text-transform:uppercase; letter-spacing:0.03em; }
        .ncm-itempick__type { font-size:9px; color:#888; text-transform:uppercase; flex-shrink:0; padding:1px 6px; background:rgba(255,255,255,0.04); border-radius:2px; }
        .ncm-itempick__empty { text-align:center; padding:20px; color:#555570; font-size:11px; font-style:italic; }
        .ncm-itempick__count { font-size:9px; color:#555570; text-align:right; margin-top:4px; }
      </style>
      ${config.hint ? `<div style="font-size:10px;color:#888;margin-bottom:6px;font-style:italic;">${config.hint}</div>` : ''}
      <div class="ncm-itempick__controls">
        <input class="ncm-itempick__search" type="text" placeholder="Search items..." />
        <select class="ncm-itempick__filter">
          <option value="">All Types</option>
          ${typeOptions}
        </select>
      </div>
      <div class="ncm-itempick__list">${buildRows()}</div>
      <div class="ncm-itempick__count">${items.length} items</div>
    `;

    const dialog = new Dialog({
      title: config.title,
      content,
      buttons: {
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel',
          callback: () => { if (!resolved) { resolved = true; resolve(null); } },
        },
      },
      default: 'cancel',
      render: (html) => {
        const el = html instanceof jQuery ? html[0] : html;

        const bindRowClicks = () => {
          el.querySelectorAll('.ncm-itempick__row')?.forEach(row => {
            row.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (resolved) return;

              let item = null;
              if (row.dataset.local === 'true') {
                const match = items.find(i => i.id === row.dataset.itemId && i.item);
                item = match?.item;
              } else if (row.dataset.uuid) {
                try { item = await fromUuid(row.dataset.uuid); } catch { /* */ }
              }

              // Fallback: search by ID in the items array
              if (!item) {
                const match = items.find(i => i.id === row.dataset.itemId);
                item = match?.item || null;
                // For compendium items without resolved item, create a fake item-like object
                if (!item && match) {
                  item = { name: match.name, img: match.img, type: match.type, id: match.id, system: {} };
                }
              }

              if (item) {
                resolved = true;
                resolve(item);
                dialog.close();
              }
            });
          });
        };

        // Bind initial rows
        bindRowClicks();

        // Search input
        const searchInput = el.querySelector('.ncm-itempick__search');
        searchInput?.addEventListener('input', (e) => {
          searchTerm = e.target.value;
          const list = el.querySelector('.ncm-itempick__list');
          if (list) { list.innerHTML = buildRows(); bindRowClicks(); }
        });

        // Type filter
        const filterSelect = el.querySelector('.ncm-itempick__filter');
        filterSelect?.addEventListener('change', (e) => {
          filterType = e.target.value;
          const list = el.querySelector('.ncm-itempick__list');
          if (list) { list.innerHTML = buildRows(); bindRowClicks(); }
        });

        // Auto-focus search
        requestAnimationFrame(() => searchInput?.focus());
      },
      close: () => { if (!resolved) { resolved = true; resolve(null); } },
    }, { width: 380, height: 500, classes: ['ncm-app'] });

    dialog.render(true);
  });
}
