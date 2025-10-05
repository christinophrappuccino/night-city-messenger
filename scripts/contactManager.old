/**
 * Contact management for Night City Messenger
 */
import { MODULE_ID } from './constants.js';
import { extractEmailAddress, isValidEmail } from './utils.js';

/**
 * Manages contacts for the messenger system
 */
export class ContactManager {
  constructor() {
    this.contacts = [];
    this.loaded = false;
  }
  
  /**
   * Load contacts from user data and message journals
   * @returns {Promise<Array>} List of contacts
   */
  async load() {
    if (this.loaded) return this.contacts;
    
    try {
      // Load from user flags
      this.contacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
      
      // Scan journals for contacts if character is assigned
      if (game.user.character) {
        await this._scanJournalsForContacts();
      }
      
      // Remove duplicates
      this._removeDuplicates();
      
      this.loaded = true;
      return this.contacts;
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading contacts:`, error);
      return [];
    }
  }
  
  /**
   * Add a new contact
   * @param {string} name - Contact name
   * @param {string} email - Email address
   * @param {string|null} img - Optional image path
   * @returns {Promise<Object>} The added contact
   */
  async add(name, email, img = null) {
    if (!name || !email) {
      throw new Error("Contact name and email are required");
    }
    
    if (!isValidEmail(email)) {
      throw new Error("Invalid email format");
    }
    
    // Make sure contacts are loaded
    if (!this.loaded) {
      await this.load();
    }
    
    // Check if contact already exists
    const existingIndex = this.contacts.findIndex(c => c.email === email);
    
    if (existingIndex >= 0) {
      // Update existing contact
      this.contacts[existingIndex] = {
        ...this.contacts[existingIndex],
        name,
        img
      };
    } else {
      // Add new contact
      this.contacts.push({
        name,
        email,
        img,
        createdAt: new Date().toISOString()
      });
    }
    
    // Save to user flags
    await game.user.setFlag(MODULE_ID, "contacts", this.contacts);
    
    // Return the contact
    return existingIndex >= 0 ? this.contacts[existingIndex] : this.contacts[this.contacts.length - 1];
  }
  
  /**
   * Remove a contact
   * @param {string} email - Email address
   * @returns {Promise<boolean>} True if removed
   */
  async remove(email) {
    if (!this.loaded) {
      await this.load();
    }
    
    const initialLength = this.contacts.length;
    this.contacts = this.contacts.filter(c => c.email !== email);
    
    // Only update if something changed
    if (initialLength !== this.contacts.length) {
      await game.user.setFlag(MODULE_ID, "contacts", this.contacts);
      return true;
    }
    
    return false;
  }
  
  /**
   * Find a contact by email
   * @param {string} email - Email address
   * @returns {Object|null} Contact or null if not found
   */
  async find(email) {
    if (!this.loaded) {
      await this.load();
    }
    
    return this.contacts.find(c => c.email === email) || null;
  }
  
  /**
   * Find contacts by name (partial match)
   * @param {string} name - Name to search for
   * @returns {Array} Matching contacts
   */
  async search(query) {
    if (!this.loaded) {
      await this.load();
    }
    
    if (!query) return this.contacts;
    
    const lowercaseQuery = query.toLowerCase();
    
    return this.contacts.filter(contact => 
      contact.name.toLowerCase().includes(lowercaseQuery) || 
      contact.email.toLowerCase().includes(lowercaseQuery)
    );
  }
  
  /**
   * Get all contacts
   * @returns {Array} All contacts
   */
  async getAll() {
    if (!this.loaded) {
      await this.load();
    }
    
    return this.contacts;
  }
  
  /**
   * Scan message journals for contacts
   * @private
   */
  async _scanJournalsForContacts() {
    const characterName = game.user.character.name;
    const journalName = `${characterName}'s Messages`;
    const journal = game.journal.getName(journalName);
    
    if (!journal || !journal.pages) return;
    
    // Extract contacts from messages
    const pages = journal.pages.contents || [];
    
    for (const page of pages) {
      if (!page?.text?.content) continue;
      
      const content = page.text.content;
      const fromMatch = content.match(/\[From\](.+?)\[End\]/);
      
      if (fromMatch) {
        const rawFrom = fromMatch[1].trim();
        // Extract name (before parentheses) and email (inside parentheses)
        const nameMatch = rawFrom.split('(')[0].trim();
        const email = extractEmailAddress(rawFrom);
        
        if (nameMatch && email && !email.includes('spam') && !rawFrom.toLowerCase().includes('spam')) {
          // Add to contacts if not already present
          const existingContact = this.contacts.find(c => c.email === email);
          
          if (!existingContact) {
            this.contacts.push({
              name: nameMatch,
              email: email,
              img: null,
              createdAt: new Date().toISOString(),
              source: 'journal'
            });
          }
        }
      }
    }
  }
  
  /**
   * Remove duplicate contacts (by email)
   * @private
   */
  _removeDuplicates() {
    // Create a map of contacts by email
    const contactMap = new Map();
    
    // Preserve the newest duplicate
    for (const contact of this.contacts) {
      const existing = contactMap.get(contact.email);
      
      if (!existing || (contact.createdAt && existing.createdAt && contact.createdAt > existing.createdAt)) {
        contactMap.set(contact.email, contact);
      }
    }
    
    // Convert back to array
    this.contacts = Array.from(contactMap.values());
  }
}