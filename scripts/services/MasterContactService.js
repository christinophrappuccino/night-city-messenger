/**
 * ENHANCED Master Contact List Service
 * File: scripts/services/MasterContactService.js
 * Module: cyberpunkred-messenger
 * Description: GM's private directory with FULL editing, sorting, tags, and organization
 * 
 * ENHANCEMENTS:
 * - Multi-field sorting (name, email, organization, type, date)
 * - Tag/label system for categorization
 * - Edit actor emails (with sync back to actors)
 * - CSV import/export
 * - Better search and filtering
 * - Quick "Send As" integration
 */

import { MODULE_ID } from '../utils/constants.js';
import { debugLog } from '../utils/debug.js';
import { isValidEmail } from '../utils/validators.js';

export class MasterContactService {
  constructor() {
    this.contacts = [];
  }
  
  /**
   * Initialize the master contact list
   */
  async initialize() {
    if (game.user.isGM) {
      await this.loadContacts();
      debugLog('GM Master Contact Service initialized (ENHANCED)');
    }
  }
  
  /**
   * Load master contacts from world settings
   * Automatically includes all actors with email addresses
   */
  async loadContacts() {
    if (!game.user.isGM) {
      this.contacts = [];
      return;
    }
    
    try {
      // Load custom contacts from settings
      const customContacts = game.settings.get(MODULE_ID, 'gmMasterContacts') || [];
      
      // Load all actors with email addresses
      const actorContacts = game.actors.contents
        .filter(a => {
          const emailAddress = a.getFlag(MODULE_ID, 'emailAddress');
          return emailAddress && emailAddress.trim() !== '';
        })
        .map(a => ({
          id: `actor_${a.id}`,
          name: a.name,
          email: a.getFlag(MODULE_ID, 'emailAddress'),
          type: 'actor',
          organization: a.getFlag(MODULE_ID, 'organization') || '',
          role: a.getFlag(MODULE_ID, 'role') || a.type || 'character',
          img: a.img,
          tags: a.getFlag(MODULE_ID, 'contactTags') || [],
          notes: '',
          isActor: true,
          actorId: a.id,
          createdAt: a.getFlag(MODULE_ID, 'emailCreatedAt') || new Date().toISOString()
        }));
      
      // Merge custom and actor contacts
      this.contacts = [...customContacts, ...actorContacts];
      
      // Default sort by name
      this.contacts.sort((a, b) => a.name.localeCompare(b.name));
      
      debugLog(`GM Master List loaded: ${customContacts.length} custom + ${actorContacts.length} actors = ${this.contacts.length} total`);
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading GM master contacts:`, error);
      this.contacts = [];
    }
  }
  
  /**
   * Save custom contacts to settings (GM only)
   * Does NOT save actor-linked contacts (those are dynamic)
   */
  async saveContacts() {
    if (!game.user.isGM) {
      return false;
    }
    
    try {
      // Only save custom contacts, not actor-linked ones
      const customContacts = this.contacts.filter(c => !c.isActor);
      
      await game.settings.set(MODULE_ID, 'gmMasterContacts', customContacts);
      debugLog(`GM Master List saved: ${customContacts.length} custom contacts`);
      return true;
      
    } catch (error) {
      console.error(`${MODULE_ID} | Error saving GM master contacts:`, error);
      ui.notifications.error('Failed to save master contact list');
      return false;
    }
  }
  
  /**
   * Get all master contacts with optional sorting (GM only)
   * @param {Object} options - Query options
   * @param {string} options.sortBy - Field to sort by (name, email, organization, type, createdAt)
   * @param {string} options.sortOrder - 'asc' or 'desc'
   * @returns {Array} Array of contact objects
   */
  getAllContacts(options = {}) {
    if (!game.user.isGM) {
      return [];
    }
    
    let contacts = [...this.contacts];
    
    // Apply sorting if requested
    if (options.sortBy) {
      contacts = this._sortContacts(contacts, options.sortBy, options.sortOrder || 'asc');
    }
    
    return contacts;
  }
  
  /**
   * Sort contacts by field
   * @private
   */
  _sortContacts(contacts, sortBy, sortOrder) {
    const multiplier = sortOrder === 'desc' ? -1 : 1;
    
    return contacts.sort((a, b) => {
      let aVal, bVal;
      
      switch (sortBy) {
        case 'name':
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
          break;
        case 'email':
          aVal = (a.email || '').toLowerCase();
          bVal = (b.email || '').toLowerCase();
          break;
        case 'organization':
          aVal = (a.organization || '').toLowerCase();
          bVal = (b.organization || '').toLowerCase();
          break;
        case 'type':
          aVal = a.isActor ? 'actor' : 'custom';
          bVal = b.isActor ? 'actor' : 'custom';
          break;
        case 'createdAt':
          aVal = a.createdAt || '';
          bVal = b.createdAt || '';
          break;
        case 'role':
          aVal = (a.role || '').toLowerCase();
          bVal = (b.role || '').toLowerCase();
          break;
        default:
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
      }
      
      if (aVal < bVal) return -1 * multiplier;
      if (aVal > bVal) return 1 * multiplier;
      return 0;
    });
  }
  
  /**
   * Search master contacts by query (GM only)
   * @param {string} query - Search term
   * @returns {Array} Filtered contacts
   */
  searchContacts(query) {
    if (!game.user.isGM) {
      return [];
    }
    
    if (!query || query.trim() === '') {
      return this.getAllContacts();
    }
    
    const term = query.toLowerCase();
    return this.contacts.filter(c => 
      (c.name && c.name.toLowerCase().includes(term)) ||
      (c.email && c.email.toLowerCase().includes(term)) ||
      (c.organization && c.organization.toLowerCase().includes(term)) ||
      (c.role && c.role.toLowerCase().includes(term)) ||
      (c.tags && c.tags.some(tag => tag.toLowerCase().includes(term))) ||
      (c.notes && c.notes.toLowerCase().includes(term))
    );
  }
  
  /**
   * Filter contacts by tags
   * @param {Array} tags - Array of tag names
   * @returns {Array} Filtered contacts
   */
  getByTags(tags) {
    if (!game.user.isGM || !tags || tags.length === 0) {
      return this.getAllContacts();
    }
    
    return this.contacts.filter(c => 
      c.tags && c.tags.some(tag => tags.includes(tag))
    );
  }
  
  /**
   * Get all unique tags from all contacts
   * @returns {Array} Array of unique tag names
   */
  getAllTags() {
    if (!game.user.isGM) {
      return [];
    }
    
    const tagSet = new Set();
    this.contacts.forEach(c => {
      if (c.tags && Array.isArray(c.tags)) {
        c.tags.forEach(tag => tagSet.add(tag));
      }
    });
    
    return Array.from(tagSet).sort();
  }
  
  /**
   * Get contact by email (GM only)
   * @param {string} email - Email address
   * @returns {Object|null} Contact or null
   */
  getByEmail(email) {
    if (!game.user.isGM || !email) {
      return null;
    }
    return this.contacts.find(c => c.email === email) || null;
  }
  
  /**
   * Add new custom contact to master list (GM only)
   * @param {Object} contactData - Contact data
   * @returns {boolean} Success
   */
  async addContact(contactData) {
    if (!game.user.isGM) {
      return false;
    }
    
    // Validate
    if (!contactData.name || !contactData.email) {
      ui.notifications.error('Name and email are required');
      return false;
    }
    
    if (!isValidEmail(contactData.email)) {
      ui.notifications.error('Invalid email address');
      return false;
    }
    
    // Check for duplicate email
    if (this.getByEmail(contactData.email)) {
      ui.notifications.error('Email address already exists in master list');
      return false;
    }
    
    // Create new contact
    const newContact = {
      id: foundry.utils.randomID(),
      name: contactData.name,
      email: contactData.email,
      type: contactData.type || 'custom',
      organization: contactData.organization || '',
      role: contactData.role || '',
      img: contactData.img || 'icons/svg/mystery-man.svg',
      tags: contactData.tags || [],
      notes: contactData.notes || '',
      isActor: false,
      createdAt: new Date().toISOString()
    };
    
    this.contacts.push(newContact);
    await this.saveContacts();
    
    ui.notifications.info(`Added "${newContact.name}" to master contact list`);
    return true;
  }
  
  /**
   * Update existing contact (GM only)
   * ⚡ NEW: Can now update actor-linked contacts (syncs to actor)
   * @param {string} contactId - Contact ID
   * @param {Object} updates - Fields to update
   * @returns {boolean} Success
   */
  async updateContact(contactId, updates) {
    if (!game.user.isGM) {
      return false;
    }
    
    const contact = this.contacts.find(c => c.id === contactId);
    
    if (!contact) {
      ui.notifications.error('Contact not found');
      return false;
    }
    
    // Validate email if being updated
    if (updates.email && updates.email !== contact.email) {
      if (!isValidEmail(updates.email)) {
        ui.notifications.error('Invalid email address');
        return false;
      }
      
      // Check for duplicate (excluding current contact)
      const existing = this.getByEmail(updates.email);
      if (existing && existing.id !== contactId) {
        ui.notifications.error('Email address already exists');
        return false;
      }
    }
    
    // ⚡ ENHANCED: Allow editing actor-linked contacts
    if (contact.isActor) {
      // Sync changes back to the actor
      const actor = game.actors.get(contact.actorId);
      
      if (!actor) {
        ui.notifications.error('Linked actor not found');
        return false;
      }
      
      try {
        // Update actor flags
        if (updates.email) {
          await actor.setFlag(MODULE_ID, 'emailAddress', updates.email);
        }
        if (updates.organization !== undefined) {
          await actor.setFlag(MODULE_ID, 'organization', updates.organization);
        }
        if (updates.role !== undefined) {
          await actor.setFlag(MODULE_ID, 'role', updates.role);
        }
        if (updates.tags !== undefined) {
          await actor.setFlag(MODULE_ID, 'contactTags', updates.tags);
        }
        
        // Reload contacts to reflect actor changes
        await this.loadContacts();
        
        ui.notifications.info(`Updated actor-linked contact "${contact.name}" (changes synced to actor)`);
        return true;
        
      } catch (error) {
        console.error(`${MODULE_ID} | Error updating actor contact:`, error);
        ui.notifications.error('Failed to update actor contact');
        return false;
      }
    }
    
    // Update custom contact
    Object.assign(contact, updates);
    await this.saveContacts();
    
    ui.notifications.info(`Updated "${contact.name}"`);
    return true;
  }
  
  /**
   * Delete custom contact from master list (GM only)
   * Cannot delete actor-linked contacts
   * @param {string} contactId - Contact ID
   * @returns {boolean} Success
   */
  async deleteContact(contactId) {
    if (!game.user.isGM) {
      return false;
    }
    
    const contact = this.contacts.find(c => c.id === contactId);
    
    if (!contact) {
      ui.notifications.error('Contact not found');
      return false;
    }
    
    if (contact.isActor) {
      ui.notifications.error('Cannot delete actor-linked contacts. They are automatically synced from actors.');
      return false;
    }
    
    this.contacts = this.contacts.filter(c => c.id !== contactId);
    await this.saveContacts();
    
    ui.notifications.info(`Deleted "${contact.name}" from master list`);
    return true;
  }
  
  /**
   * ⚡ NEW: Import contacts from CSV
   * @param {Array} csvData - Array of contact objects from CSV
   * @param {boolean} merge - Merge or replace duplicates
   * @returns {Object} Import statistics
   */
  async importFromCSV(csvData, merge = true) {
    if (!game.user.isGM) {
      return { added: 0, updated: 0, skipped: 0, errors: [] };
    }
    
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];
    
    for (const row of csvData) {
      try {
        // Validate required fields
        if (!row.name || !row.email) {
          errors.push(`Row missing name or email: ${JSON.stringify(row)}`);
          skipped++;
          continue;
        }
        
        if (!isValidEmail(row.email)) {
          errors.push(`Invalid email: ${row.email}`);
          skipped++;
          continue;
        }
        
        // Check if exists
        const existing = this.getByEmail(row.email);
        
        if (existing) {
          if (merge) {
            // Update existing
            await this.updateContact(existing.id, {
              name: row.name || existing.name,
              organization: row.organization || existing.organization,
              role: row.role || existing.role,
              tags: row.tags ? row.tags.split(';').map(t => t.trim()) : existing.tags,
              notes: row.notes || existing.notes
            });
            updated++;
          } else {
            skipped++;
          }
        } else {
          // Add new
          await this.addContact({
            name: row.name,
            email: row.email,
            organization: row.organization || '',
            role: row.role || '',
            tags: row.tags ? row.tags.split(';').map(t => t.trim()) : [],
            notes: row.notes || ''
          });
          added++;
        }
      } catch (error) {
        errors.push(`Error processing row: ${error.message}`);
        skipped++;
      }
    }
    
    return { added, updated, skipped, errors };
  }
  
  /**
   * ⚡ NEW: Export contacts to CSV format
   * @returns {Array} Array of contact objects ready for CSV
   */
  exportToCSV() {
    if (!game.user.isGM) {
      return [];
    }
    
    return this.contacts.map(c => ({
      name: c.name,
      email: c.email,
      organization: c.organization || '',
      role: c.role || '',
      type: c.isActor ? 'actor' : 'custom',
      tags: c.tags ? c.tags.join(';') : '',
      notes: c.notes || '',
      createdAt: c.createdAt || ''
    }));
  }
  
  /**
   * Refresh actor-linked contacts
   */
  async refreshActorContacts() {
    if (!game.user.isGM) {
      return;
    }
    
    await this.loadContacts();
    debugLog('GM Master List refreshed');
  }
}