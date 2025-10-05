/**
 * Contact Repository
 * File: scripts/data/ContactRepository.js
 * Module: cyberpunkred-messenger
 * Description: Handles contact data operations
 */

import { MODULE_ID } from '../utils/constants.js';
import { DataValidator } from './DataValidator.js';
import { SettingsManager } from '../core/SettingsManager.js';

export class ContactRepository {
  constructor() {
    this.settingsManager = SettingsManager.getInstance();
  }
  
  /**
   * Get all contacts for current user
   * @returns {Array<Object>}
   */
  getAll() {
    const contacts = this.settingsManager.get('contacts') || {};
    const userId = game.user.id;
    
    return contacts[userId] || [];
  }
  
  /**
   * Find contact by email
   * @param {string} email - Email address
   * @returns {Object|null}
   */
  findByEmail(email) {
    const contacts = this.getAll();
    return contacts.find(c => c.email === email) || null;
  }
  
  /**
   * Find contact by ID
   * @param {string} id - Contact ID
   * @returns {Object|null}
   */
  findById(id) {
    const contacts = this.getAll();
    return contacts.find(c => c.id === id) || null;
  }
  
  /**
   * Create a new contact
   * @param {Object} contactData - Contact data
   * @returns {Promise<Object>} Created contact
   */
  async create(contactData) {
    // Validate
    const validation = DataValidator.validateContact(contactData);
    if (!validation.valid) {
      throw new Error(`Invalid contact data: ${validation.errors.join(', ')}`);
    }
    
    const data = validation.sanitized;
    
    // Check if already exists
    if (this.findByEmail(data.email)) {
      throw new Error(`Contact already exists: ${data.email}`);
    }
    
    // Generate ID
    const contact = {
      id: foundry.utils.randomID(),
      ...data,
      createdAt: new Date().toISOString()
    };
    
    // Save
    const contacts = this.getAll();
    contacts.push(contact);
    await this._saveContacts(contacts);
    
    console.log(`${MODULE_ID} | Created contact: ${contact.name}`);
    
    return contact;
  }
  
  /**
   * Update a contact
   * @param {string} id - Contact ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated contact
   */
  async update(id, updates) {
    const contacts = this.getAll();
    const index = contacts.findIndex(c => c.id === id);
    
    if (index === -1) {
      throw new Error(`Contact not found: ${id}`);
    }
    
    // Validate updates
    const merged = { ...contacts[index], ...updates };
    const validation = DataValidator.validateContact(merged);
    if (!validation.valid) {
      throw new Error(`Invalid contact data: ${validation.errors.join(', ')}`);
    }
    
    // Update
    contacts[index] = {
      ...contacts[index],
      ...validation.sanitized,
      updatedAt: new Date().toISOString()
    };
    
    await this._saveContacts(contacts);
    
    console.log(`${MODULE_ID} | Updated contact: ${id}`);
    
    return contacts[index];
  }
  
  /**
   * Delete a contact
   * @param {string} id - Contact ID
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    const contacts = this.getAll();
    const filtered = contacts.filter(c => c.id !== id);
    
    if (filtered.length === contacts.length) {
      return false; // Not found
    }
    
    await this._saveContacts(filtered);
    
    console.log(`${MODULE_ID} | Deleted contact: ${id}`);
    
    return true;
  }
  
  /**
   * Search contacts
   * @param {string} query - Search query
   * @returns {Array<Object>}
   */
  search(query) {
    if (!query || query.trim().length === 0) {
      return this.getAll();
    }
    
    const queryLower = query.toLowerCase();
    const contacts = this.getAll();
    
    return contacts.filter(c => 
      c.name.toLowerCase().includes(queryLower) ||
      c.email.toLowerCase().includes(queryLower) ||
      c.notes?.toLowerCase().includes(queryLower)
    );
  }
  
  /**
   * Get contacts by category
   * @param {string} category - Category name
   * @returns {Array<Object>}
   */
  getByCategory(category) {
    const contacts = this.getAll();
    return contacts.filter(c => c.category === category);
  }
  
  /**
   * Get all categories
   * @returns {Array<string>}
   */
  getCategories() {
    const contacts = this.getAll();
    const categories = new Set(contacts.map(c => c.category).filter(Boolean));
    return Array.from(categories).sort();
  }
  
  /**
   * Import contacts from actors
   * @returns {Promise<number>} Number of imported contacts
   */
  async importFromActors() {
    const actors = game.actors.filter(a => a.type === 'character');
    let imported = 0;
    
    for (const actor of actors) {
      const email = `${actor.name.toLowerCase().replace(/\s+/g, '')}@nightcity.net`;
      
      // Skip if already exists
      if (this.findByEmail(email)) continue;
      
      try {
        await this.create({
          name: actor.name,
          email: email,
          actorId: actor.id,
          category: 'characters'
        });
        imported++;
      } catch (error) {
        console.warn(`${MODULE_ID} | Failed to import actor ${actor.name}:`, error);
      }
    }
    
    console.log(`${MODULE_ID} | Imported ${imported} contacts from actors`);
    
    return imported;
  }
  
  /**
   * Save contacts to settings
   * @private
   */
  async _saveContacts(contacts) {
    const allContacts = this.settingsManager.get('contacts') || {};
    const userId = game.user.id;
    
    allContacts[userId] = contacts;
    
    await this.settingsManager.set('contacts', allContacts);
  }
}