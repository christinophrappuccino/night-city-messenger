/**
 * Contact Repository
 * File: scripts/data/ContactRepository.js
 * Module: cyberpunkred-messenger
 * Description: Manage contact data storage and retrieval
 */

import { MODULE_ID } from '../utils/constants.js';

export class ContactRepository {
  constructor() {
    this.contacts = [];
    this._loaded = false;
  }
  
  /**
   * Load contacts from storage
   * @private
   */
  async _loadContacts() {
    if (this._loaded) return;
    
    try {
      // Load from user flags (client-side storage)
      const stored = await game.user.getFlag(MODULE_ID, 'contacts');
      this.contacts = stored || [];
      this._loaded = true;
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading contacts:`, error);
      this.contacts = [];
    }
  }
  
  /**
   * Save contacts to storage
   * @private
   */
  async _saveContacts() {
    try {
      await game.user.setFlag(MODULE_ID, 'contacts', this.contacts);
    } catch (error) {
      console.error(`${MODULE_ID} | Error saving contacts:`, error);
      throw error;
    }
  }
  
  /**
   * Get all contacts
   * @returns {Promise<Array>}
   */
  async getAll() {
    await this._loadContacts();
    return [...this.contacts];
  }
  
  /**
   * Get contact by ID
   * @param {string} id - Contact ID
   * @returns {Promise<Object|null>}
   */
  async getById(id) {
    await this._loadContacts();
    return this.contacts.find(c => c.id === id) || null;
  }
  
  /**
   * Search contacts by name or email
   * @param {string} query - Search query
   * @returns {Promise<Array>}
   */
  async search(query) {
    await this._loadContacts();
    
    if (!query || query.trim() === '') {
      return this.getAll();
    }
    
    const searchLower = query.toLowerCase();
    
    return this.contacts.filter(contact => 
      contact.name.toLowerCase().includes(searchLower) ||
      contact.email.toLowerCase().includes(searchLower) ||
      (contact.notes && contact.notes.toLowerCase().includes(searchLower))
    );
  }
  
  /**
   * Get contacts by category
   * @param {string} category - Category name
   * @returns {Promise<Array>}
   */
  async getByCategory(category) {
    await this._loadContacts();
    
    if (!category || category === 'all') {
      return this.getAll();
    }
    
    return this.contacts.filter(c => 
      c.category && c.category.toLowerCase() === category.toLowerCase()
    );
  }
  
  /**
   * Get all unique categories
   * @returns {Promise<Array>}
   */
  async getCategories() {
    await this._loadContacts();
    
    const categories = new Set();
    this.contacts.forEach(contact => {
      if (contact.category) {
        categories.add(contact.category);
      }
    });
    
    return Array.from(categories).sort();
  }
  
  /**
   * Add new contact
   * @param {Object} contactData - Contact data
   * @returns {Promise<Object>} Created contact
   */
  async add(contactData) {
    await this._loadContacts();
    
    // Validate required fields
    if (!contactData.name || !contactData.email) {
      throw new Error('Contact must have name and email');
    }
    
    // Check for duplicate email
    const existing = this.contacts.find(c => 
      c.email.toLowerCase() === contactData.email.toLowerCase()
    );
    
    if (existing) {
      throw new Error('Contact with this email already exists');
    }
    
    // Create contact
    const contact = {
      id: foundry.utils.randomID(),
      name: contactData.name.trim(),
      email: contactData.email.trim().toLowerCase(),
      type: contactData.type || 'npc',
      category: contactData.category || 'General',
      notes: contactData.notes || '',
      img: contactData.img || null,
      createdAt: new Date().toISOString(),
      lastContacted: null
    };
    
    this.contacts.push(contact);
    await this._saveContacts();
    
    return contact;
  }
  
  /**
   * Update contact
   * @param {string} id - Contact ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated contact
   */
  async update(id, updates) {
    await this._loadContacts();
    
    const index = this.contacts.findIndex(c => c.id === id);
    
    if (index === -1) {
      throw new Error('Contact not found');
    }
    
    // Check for email conflicts
    if (updates.email) {
      const conflict = this.contacts.find(c => 
        c.id !== id && 
        c.email.toLowerCase() === updates.email.toLowerCase()
      );
      
      if (conflict) {
        throw new Error('Another contact already has this email');
      }
    }
    
    // Update contact
    this.contacts[index] = {
      ...this.contacts[index],
      ...updates,
      id: this.contacts[index].id, // Ensure ID doesn't change
      createdAt: this.contacts[index].createdAt // Preserve creation date
    };
    
    await this._saveContacts();
    
    return this.contacts[index];
  }
  
  /**
   * Delete contact
   * @param {string} id - Contact ID
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    await this._loadContacts();
    
    const index = this.contacts.findIndex(c => c.id === id);
    
    if (index === -1) {
      return false;
    }
    
    this.contacts.splice(index, 1);
    await this._saveContacts();
    
    return true;
  }
  
  /**
   * Update last contacted timestamp
   * @param {string} id - Contact ID
   * @returns {Promise<void>}
   */
  async touchContact(id) {
    await this.update(id, {
      lastContacted: new Date().toISOString()
    });
  }
  
  /**
   * Import contacts from array
   * @param {Array} contacts - Contacts to import
   * @param {boolean} merge - Merge with existing or replace
   * @returns {Promise<Object>} Import result
   */
  async importContacts(contacts, merge = true) {
    await this._loadContacts();
    
    let added = 0;
    let updated = 0;
    let skipped = 0;
    
    for (const contactData of contacts) {
      try {
        const existing = this.contacts.find(c => 
          c.email.toLowerCase() === contactData.email.toLowerCase()
        );
        
        if (existing) {
          if (merge) {
            await this.update(existing.id, contactData);
            updated++;
          } else {
            skipped++;
          }
        } else {
          await this.add(contactData);
          added++;
        }
      } catch (error) {
        console.warn(`${MODULE_ID} | Error importing contact:`, error);
        skipped++;
      }
    }
    
    return { added, updated, skipped };
  }
  
  /**
   * Export all contacts
   * @returns {Promise<Array>}
   */
  async exportContacts() {
    return this.getAll();
  }
  
  /**
   * Clear all contacts
   * @returns {Promise<void>}
   */
  async clear() {
    this.contacts = [];
    await this._saveContacts();
  }
  
  /**
   * Get contacts grouped by category
   * @returns {Promise<Array>}
   */
  async getGroupedByCategory() {
    await this._loadContacts();
    
    const grouped = {};
    
    this.contacts.forEach(contact => {
      const category = contact.category || 'General';
      
      if (!grouped[category]) {
        grouped[category] = [];
      }
      
      grouped[category].push(contact);
    });
    
    // Convert to array format
    return Object.entries(grouped).map(([category, contacts]) => ({
      category,
      contacts: contacts.sort((a, b) => a.name.localeCompare(b.name))
    })).sort((a, b) => a.category.localeCompare(b.category));
  }
}