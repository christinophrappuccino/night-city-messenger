/**
 * Master Contact List Service
 * File: scripts/services/MasterContactService.js
 * Module: cyberpunkred-messenger
 * Description: GM's private directory of all email identities in the world
 * 
 * PURPOSE:
 * - GM-only access (players never see this)
 * - Contains ALL email identities that exist in the world:
 *   * Actor-linked contacts (real characters with email addresses)
 *   * Custom NPC contacts (email identities without actors)
 *   * Corporate/organization contacts
 *   * Any other email the GM wants to send/receive as
 * 
 * USE CASE:
 * - GM can send messages AS any identity in this list
 * - GM can receive messages TO any identity in this list
 * - Players discover these emails in messages and can add to their personal lists
 * - GM effectively impersonates NPCs via email
 */

import { MODULE_ID } from '../utils/constants.js';
import { debugLog } from '../utils/debug.js';
import { isValidEmail } from '../utils/validators.js';

/**
 * Service for managing GM's master contact directory
 */
export class MasterContactService {
  constructor() {
    this.contacts = [];
  }
  
  /**
   * Initialize the master contact list
   * Only loads if user is GM
   */
  async initialize() {
    if (game.user.isGM) {
      await this.loadContacts();
      debugLog('GM Master Contact Service initialized');
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
          notes: '',
          isActor: true,
          actorId: a.id
        }));
      
      // Merge custom and actor contacts
      this.contacts = [...customContacts, ...actorContacts];
      
      // Sort alphabetically
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
   * Get all master contacts (GM only)
   * @returns {Array} Array of contact objects
   */
  getAllContacts() {
    if (!game.user.isGM) {
      return [];
    }
    return [...this.contacts];
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
      (c.role && c.role.toLowerCase().includes(term))
    );
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
   * @param {string} contactData.name - Display name
   * @param {string} contactData.email - Email address (required, must be unique)
   * @param {string} [contactData.organization] - Organization/corp
   * @param {string} [contactData.role] - Role/title
   * @param {string} [contactData.img] - Avatar image
   * @param {string} [contactData.notes] - GM notes about this contact
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
   * Update existing custom contact (GM only)
   * Cannot update actor-linked contacts
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
    
    if (contact.isActor) {
      ui.notifications.error('Cannot edit actor-linked contacts from master list. Edit the actor directly.');
      return false;
    }
    
    // Validate email if being updated
    if (updates.email && updates.email !== contact.email) {
      if (!isValidEmail(updates.email)) {
        ui.notifications.error('Invalid email address');
        return false;
      }
      
      if (this.getByEmail(updates.email)) {
        ui.notifications.error('Email address already exists');
        return false;
      }
    }
    
    // Update contact
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
   * Refresh actor-linked contacts
   * Called when actors are updated/added/removed
   */
  async refreshActorContacts() {
    if (!game.user.isGM) {
      return;
    }
    
    await this.loadContacts();
    debugLog('GM Master List refreshed');
  }
}