/**
 * Journal Manager
 * File: scripts/data/JournalManager.js
 * Module: cyberpunkred-messenger
 * Description: Manages journal entries and folders for message storage
 */

import { MODULE_ID } from '../utils/constants.js';

export class JournalManager {
  constructor() {
    this.folderCache = new Map();
    this.journalCache = new Map();
  }
  
  /**
   * Get or create the Player Messages folder
   * @returns {Promise<Folder>}
   */
  async getMessageFolder() {
    // Check cache
    if (this.folderCache.has('messages')) {
      return this.folderCache.get('messages');
    }
    
    // Find existing folder
    let folder = game.folders.find(f => 
      f.name === "Player Messages" && 
      f.type === "JournalEntry"
    );
    
    // Create if doesn't exist (GM only)
    if (!folder && game.user.isGM) {
      folder = await Folder.create({
        name: "Player Messages",
        type: "JournalEntry",
        parent: null,
        color: "#F65261",
        flags: {
          [MODULE_ID]: {
            isMessageFolder: true
          }
        },
        // Hide from players by default
        permission: {
          default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
        }
      });
      
      console.log(`${MODULE_ID} | Created Player Messages folder`);
    }
    
    // Cache
    if (folder) {
      this.folderCache.set('messages', folder);
    }
    
    return folder;
  }
  
  /**
   * Get or create the Deleted Messages folder
   * @returns {Promise<Folder>}
   */
  async getDeletedMessagesFolder() {
    // Check cache
    if (this.folderCache.has('deleted')) {
      return this.folderCache.get('deleted');
    }
    
    // Find existing folder
    let folder = game.folders.find(f => 
      f.name === "Deleted Messages" && 
      f.type === "JournalEntry"
    );
    
    // Create if doesn't exist (GM only)
    if (!folder && game.user.isGM) {
      folder = await Folder.create({
        name: "Deleted Messages",
        type: "JournalEntry",
        parent: null,
        color: "#ff0000",
        flags: {
          [MODULE_ID]: {
            isDeletedMessagesFolder: true
          }
        }
      });
      
      console.log(`${MODULE_ID} | Created Deleted Messages folder`);
    }
    
    // Cache
    if (folder) {
      this.folderCache.set('deleted', folder);
    }
    
    return folder;
  }
  
  /**
   * Get user's inbox journal
   * @param {string} userId - User ID (defaults to current user)
   * @returns {Promise<JournalEntry|null>}
   */
  async getUserInbox(userId = null) {
    userId = userId || game.user.id;
    
    // Check cache
    const cacheKey = `inbox-${userId}`;
    if (this.journalCache.has(cacheKey)) {
      return this.journalCache.get(cacheKey);
    }
    
    // Get character name
    const user = game.users.get(userId);
    if (!user) {
      console.error(`${MODULE_ID} | User not found: ${userId}`);
      return null;
    }
    
    const characterName = user.character?.name || user.name;
    const journalName = `${characterName} Messages`;
    
    // Find existing journal
    let journal = game.journal.find(j => 
      j.name === journalName &&
      j.getFlag(MODULE_ID, 'isInbox')
    );
    
    // Cache and return
    if (journal) {
      this.journalCache.set(cacheKey, journal);
      return journal;
    }
    
    return null;
  }
  
  /**
   * Create inbox journal for user
   * @param {string} userId - User ID
   * @returns {Promise<JournalEntry>}
   */
  async createUserInbox(userId) {
    const user = game.users.get(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    
    const characterName = user.character?.name || user.name;
    const journalName = `${characterName} Messages`;
    
    // Get message folder
    const folder = await this.getMessageFolder();
    
    // Create journal
    const journal = await JournalEntry.create({
      name: journalName,
      folder: folder?.id || null,
      flags: {
        [MODULE_ID]: {
          isInbox: true,
          userId: userId,
          characterName: characterName
        }
      },
      // Set ownership: user has owner, others have observer
      ownership: {
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
        [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
      }
    });
    
    console.log(`${MODULE_ID} | Created inbox for ${characterName}`);
    
    // Cache
    const cacheKey = `inbox-${userId}`;
    this.journalCache.set(cacheKey, journal);
    
    return journal;
  }
  
  /**
   * Ensure user has an inbox (get or create)
   * @param {string} userId - User ID
   * @returns {Promise<JournalEntry>}
   */
  async ensureUserInbox(userId = null) {
    userId = userId || game.user.id;
    
    let journal = await this.getUserInbox(userId);
    
    if (!journal) {
      // Only GM can create journals
      if (game.user.isGM) {
        journal = await this.createUserInbox(userId);
      } else {
        throw new Error('Cannot create inbox: requires GM permissions');
      }
    }
    
    return journal;
  }
  
  /**
   * Get deleted messages journal for user
   * @param {string} userId - User ID
   * @returns {Promise<JournalEntry|null>}
   */
  async getUserDeletedJournal(userId = null) {
    userId = userId || game.user.id;
    
    const user = game.users.get(userId);
    if (!user) {
      console.error(`${MODULE_ID} | User not found: ${userId}`);
      return null;
    }
    
    const characterName = user.character?.name || user.name;
    const journalName = `${characterName} Deleted Messages`;
    
    // Find existing journal
    let journal = game.journal.find(j => 
      j.name === journalName &&
      j.getFlag(MODULE_ID, 'isDeletedMessagesJournal')
    );
    
    return journal;
  }
  
  /**
   * Create deleted messages journal for user
   * @param {string} userId - User ID
   * @returns {Promise<JournalEntry>}
   */
  async createUserDeletedJournal(userId) {
    const user = game.users.get(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    
    const characterName = user.character?.name || user.name;
    const journalName = `${characterName} Deleted Messages`;
    
    // Get deleted folder
    const folder = await this.getDeletedMessagesFolder();
    
    // Create journal
    const journal = await JournalEntry.create({
      name: journalName,
      folder: folder?.id || null,
      flags: {
        [MODULE_ID]: {
          isDeletedMessagesJournal: true,
          userId: userId,
          characterName: characterName
        }
      },
      ownership: {
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
        [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
      }
    });
    
    console.log(`${MODULE_ID} | Created deleted messages journal for ${characterName}`);
    
    return journal;
  }
  
  /**
   * Get all inbox journals
   * @returns {Array<JournalEntry>}
   */
  getAllInboxes() {
    return game.journal.filter(j => j.getFlag(MODULE_ID, 'isInbox'));
  }
  
  /**
   * Get inbox for actor
   * @param {string} actorId - Actor ID
   * @returns {Promise<JournalEntry|null>}
   */
  async getActorInbox(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return null;
    
    // Find by actor name
    const journalName = `${actor.name} Messages`;
    return game.journal.find(j => j.name === journalName);
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    this.folderCache.clear();
    this.journalCache.clear();
  }
  
  /**
   * Refresh cache for specific journal
   * @param {string} journalId - Journal ID
   */
  refreshJournal(journalId) {
    // Remove from cache if present
    for (const [key, journal] of this.journalCache.entries()) {
      if (journal.id === journalId) {
        this.journalCache.delete(key);
      }
    }
  }
}