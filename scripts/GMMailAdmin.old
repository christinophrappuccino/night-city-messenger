/**
 * GM Mail Administration Panel
 * A comprehensive tool for GMs to manage the Night City Messenger system
 */
import { MODULE_ID, AUDIO } from './constants.js';
import { getCurrentDateTime, extractEmailAddress, isValidEmail } from './utils.js';
import { getSetting } from './settings.js';

export class GMMailAdmin extends Application {
  constructor() {
    super();
    this.characters = game.actors.filter(a => a.type === "character") || [];
    this.contacts = [];
    this.selectedTab = "inboxes";
    this.selectedJournal = null;
    this.selectedCharacter = null;
    this.emailStats = {
      totalMessages: 0,
      unreadMessages: 0,
      spamMessages: 0
    };
    this.messageJournals = [];
  }

  /**
   * Application configuration
   */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: `modules/${MODULE_ID}/templates/gm-admin.html`,
      title: "Night City Mail Admin",
      id: "cyberpunk-mail-admin",
      width: 800,
      height: 650,
      resizable: true,
      minimizable: true,
      classes: ["cyberpunk-app", "admin-panel"]
    });
  }

  /**
   * Get data for the template
   */
  async getData() {
    await this._loadContacts();
    await this._loadMessageJournals();
    
    // Calculate stats
    await this._calculateEmailStats();
    
    return {
      characters: this.characters,
      contacts: this.contacts,
      selectedTab: this.selectedTab,
      selectedJournal: this.selectedJournal,
      selectedCharacter: this.selectedCharacter,
      messageJournals: this.messageJournals,
      stats: this.emailStats,
      // Settings data
      settings: {
        enableSpam: getSetting('enableSpamGeneration'),
        spamFrequency: getSetting('spamFrequency'),
        defaultDomain: getSetting('defaultDomain')
      }
    };
  }
  
  /**
   * Load contacts from all sources
   * @private
   */
  async _loadContacts() {
    try {
      // Get all character emails (these are visible to everyone)
      const characterEmails = this.characters.map(actor => {
        if (!actor || !actor.id) return null;
        
        const email = actor.getFlag(MODULE_ID, "emailAddress");
        return email ? {
          name: actor.name,
          email: email,
          img: actor.img,
          type: "character",
          id: actor.id
        } : null;
      }).filter(e => e !== null);
      
      // Get only the current GM's contacts (not all users)
      const gmContacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
      const userContacts = gmContacts.map(contact => ({
        ...contact,
        type: "contact",
        owner: game.user.name
      }));
      
      // Combine character emails and GM's contacts
      const allContacts = [...characterEmails, ...userContacts];
      const uniqueEmails = new Set();
      
      this.contacts = allContacts.filter(contact => {
        if (uniqueEmails.has(contact.email)) {
          return false;
        }
        uniqueEmails.add(contact.email);
        return true;
      });
      
      // Sort by name
      this.contacts.sort((a, b) => a.name.localeCompare(b.name));
      
      return this.contacts;
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading contacts:`, error);
      this.contacts = [];
      return [];
    }
  }
  
  /**
   * Load all message journals
   * @private
   */
  async _loadMessageJournals() {
    // Find all journals in the "Player Messages" folder or with names ending in "'s Messages"
    const messageJournals = game.journal.contents.filter(journal => {
      const isInMessageFolder = journal.folder?.name === "Player Messages";
      const isMessageJournal = journal.name.endsWith("'s Messages");
      return isInMessageFolder || isMessageJournal;
    });
    
    this.messageJournals = messageJournals;
    
    // Find first journal if we don't have one selected
    if (!this.selectedJournal && this.messageJournals.length > 0) {
      this.selectedJournal = this.messageJournals[0];
      
      // Find the associated character
      const characterName = this.selectedJournal.name.replace("'s Messages", "");
      this.selectedCharacter = game.actors.find(a => a.name === characterName);
    }
    
    return this.messageJournals;
  }
  
  /**
   * Calculate email statistics
   * @private
   */
  async _calculateEmailStats() {
    let totalMessages = 0;
    let unreadMessages = 0;
    let spamMessages = 0;
    
    for (const journal of this.messageJournals) {
      const pages = journal.pages?.contents || [];
      totalMessages += pages.length;
      
      // Count unread messages
      const journalUnread = await journal.getFlag(MODULE_ID, "unreadMessages") || [];
      unreadMessages += journalUnread.length;
      
      // Count spam messages
      for (const page of pages) {
        if (!page || !page.text?.content) continue;
        
        const status = page.getFlag(MODULE_ID, "status") || {};
        if (status.spam || page.text.content.includes("[SPAM]")) {
          spamMessages++;
        }
      }
    }
    
    this.emailStats = {
      totalMessages,
      unreadMessages,
      spamMessages,
      journals: this.messageJournals.length
    };
  }
  
  /**
   * Activate application listeners
   * @param {jQuery} html - The app HTML
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Tab navigation
    html.find('.admin-tab-button').click(ev => this._onTabChange(ev));
    
    // Character inbox selection
    html.find('.character-inbox-item').click(ev => this._onInboxSelect(ev));
    
    // Open inbox button
    html.find('.open-inbox-btn').click(ev => this._onOpenInbox(ev));
    
    // Generate spam button
    html.find('.generate-spam-btn').click(ev => this._onGenerateSpam(ev));
    
    // Generate email button (for a character)
    html.find('.generate-email-btn').click(ev => this._onGenerateEmail(ev));
    
    // Compose message button
    html.find('.compose-message-btn').click(ev => this._onComposeMessage(ev));
    
    // Schedule message button
    html.find('.schedule-message-btn').click(ev => this._onScheduleMessage(ev));
    
    // Mark all read button
    html.find('.mark-all-read-btn').click(ev => this._onMarkAllRead(ev));
    
    // Save settings button
    html.find('.save-settings-btn').click(ev => this._onSaveSettings(ev));
    
    // View scheduled messages button
    html.find('.view-scheduled-btn').click(ev => this._onViewScheduled(ev));
    
    // Add contact button
    html.find('.add-contact-btn').click(ev => this._onAddContact(ev));

    // Add View as button
    html.find('.view-as-btn').click(ev => {
      const actorId = ev.currentTarget.dataset.actorId;
      if (actorId) {
        this._viewAsCharacter(actorId);
      }
    });
    
    // Edit contact buttons
    html.find('.edit-contact-btn').click(ev => this._onEditContact(ev));
    
    // Delete contact buttons
    html.find('.delete-contact-btn').click(ev => this._onDeleteContact(ev));
    
    // Mass message button
    html.find('.mass-message-btn').click(ev => this._onMassMessage(ev));
  }
  
  /**
   * Handle tab change
   * @param {Event} event - Click event
   * @private
   */
  _onTabChange(event) {
    const tab = event.currentTarget.dataset.tab;
    this.selectedTab = tab;
    this.render(true);
  }
  
  /**
   * Handle inbox selection
   * @param {Event} event - Click event
   * @private
   */
  _onInboxSelect(event) {
    const journalId = event.currentTarget.dataset.journalId;
    this.selectedJournal = this.messageJournals.find(j => j.id === journalId);
    
    // Find the associated character
    if (this.selectedJournal) {
      const characterName = this.selectedJournal.name.replace("'s Messages", "");
      this.selectedCharacter = game.actors.find(a => a.name === characterName);
    }
    
    this.render(true);
  }
  
  /**
   * Handle open inbox button
   * @param {Event} event - Click event
   * @private
   */
  _onOpenInbox(event) {
    if (!this.selectedJournal) return;
    
    // Open the message viewer with this journal
    if (game.nightcity?.messenger?.openViewer) {
      game.nightcity.messenger.openViewer(this.selectedJournal.id);
    }
  }
  
  /**
   * Handle generate spam button
   * @param {Event} event - Click event
   * @private
   */
  _onGenerateSpam(event) {
    // Show a dialog to select the character to spam
    const characterOptions = this.characters.map(c => 
      `<option value="${c.id}">${c.name}</option>`
    ).join('');
    
    new Dialog({
      title: "Generate Spam Message",
      content: `
        <div class="form-group">
          <label>Target Character:</label>
          <select name="character-select">
            ${characterOptions}
          </select>
        </div>
      `,
      buttons: {
        generate: {
          icon: '<i class="fas fa-virus"></i>',
          label: "Generate Spam",
          callback: async (html) => {
            const characterId = html.find('[name="character-select"]').val();
            const character = game.actors.get(characterId);
            
            if (character) {
              if (game.nightcity?.messenger?.generateSpam) {
                await game.nightcity.messenger.generateSpam(character);
                ui.notifications.info(`Spam message generated for ${character.name}`);
              }
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "generate"
    }).render(true);
  }
  
  /**
   * Handle generate email button
   * @param {Event} event - Click event
   * @private
   */
  _onGenerateEmail(event) {
    const actorId = event.currentTarget.dataset.actorId;
    const actor = game.actors.get(actorId);
    
    if (actor) {
      // Get the default domain from settings
      const defaultDomain = getSetting('defaultDomain') || "nightcity.net";
      
      // Generate a default email
      let sanitized = actor.name
        .toLowerCase()
        .replace(/[^\w\s]/gi, '')  // Remove special characters
        .replace(/\s+/g, '.');     // Replace spaces with periods
      
      // Open dialog to confirm or edit the generated email
      new Dialog({
        title: `Set Email for ${actor.name}`,
        content: `
          <div class="form-group">
            <label>Email Address:</label>
            <input type="text" name="email" value="${sanitized}@${defaultDomain}" placeholder="name@nightcity.net">
          </div>
        `,
        buttons: {
          save: {
            icon: '<i class="fas fa-save"></i>',
            label: "Save",
            callback: async (html) => {
              const email = html.find('[name="email"]').val();
              
              if (isValidEmail(email)) {
                await actor.setFlag(MODULE_ID, "emailAddress", email);
                ui.notifications.info(`Email set for ${actor.name}: ${email}`);
                this.render(true);
              } else {
                ui.notifications.error("Invalid email format");
              }
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel"
          }
        },
        default: "save"
      }).render(true);
    }
  }
  
  /**
   * Handle compose message button
   * @param {Event} event - Click event
   * @private
   */
  _onComposeMessage(event) {
    if (this.selectedCharacter && game.nightcity?.messenger?.openComposer) {
      game.nightcity.messenger.openComposer();
    } else {
      ui.notifications.warn("No character selected or composer not available");
    }
  }
  
  /**
   * Handle schedule message button
   * @param {Event} event - Click event
   * @private
   */
  _onScheduleMessage(event) {
    if (game.nightcity?.messenger?.openComposer) {
      game.nightcity.messenger.openComposer({ scheduledMode: true });
    }
  }
  
  /**
   * Handle mark all read button
   * @param {Event} event - Click event
   * @private
   */
  async _onMarkAllRead(event) {
    if (!this.selectedJournal) return;
    
    // Clear the unread messages flag
    await this.selectedJournal.setFlag(MODULE_ID, "unreadMessages", []);
    
    // Also update individual page flags
    for (const page of this.selectedJournal.pages.contents) {
      const status = page.getFlag(MODULE_ID, "status") || {};
      if (!status.read) {
        await page.setFlag(MODULE_ID, "status", { ...status, read: true });
      }
    }
    
    // Recalculate stats
    await this._calculateEmailStats();
    
    ui.notifications.info("All messages marked as read");
    this.render(true);
  }
  
  /**
   * Handle save settings button
   * @param {Event} event - Click event
   * @private
   */
  async _onSaveSettings(event) {
    const html = this.element;
    
    const enableSpam = html.find('#enable-spam').is(':checked');
    const spamFrequency = parseInt(html.find('#spam-frequency').val()) || 3;
    const defaultDomain = html.find('#default-domain').val() || "nightcity.net";
    
    // Save settings
    await game.settings.set(MODULE_ID, "enableSpamGeneration", enableSpam);
    await game.settings.set(MODULE_ID, "spamFrequency", spamFrequency);
    await game.settings.set(MODULE_ID, "defaultDomain", defaultDomain);
    
    ui.notifications.info("Settings saved");
  }
  
  /**
   * Handle view scheduled messages button
   * @param {Event} event - Click event
   * @private
   */
  _onViewScheduled(event) {
    if (game.nightcity?.messenger?.openScheduledMessagesManager) {
      game.nightcity.messenger.openScheduledMessagesManager();
    }
  }
  
  /**
   * Handle add contact button
   * @param {Event} event - Click event
   * @private
   */
  _onAddContact(event) {
    // Get list of actors to choose from
    const actorOptions = this.characters.map(c => 
      `<option value="${c.id}">${c.name}</option>`
    ).join('');
    
    new Dialog({
      title: "Add Contact",
      content: `
        <div class="form-group">
          <label>Contact Name:</label>
          <input type="text" name="name" placeholder="Contact Name">
        </div>
        <div class="form-group">
          <label>Email Address:</label>
          <input type="text" name="email" placeholder="email@domain.com">
        </div>
        <div class="form-group">
          <label>Link to Actor (Optional):</label>
          <select name="actor-id">
            <option value="">-- No Linked Actor --</option>
            ${actorOptions}
          </select>
          <p class="notes">Linking to an actor will use their portrait image</p>
        </div>
      `,
      buttons: {
        add: {
          icon: '<i class="fas fa-plus"></i>',
          label: "Add Contact",
          callback: async (html) => {
            const name = html.find('[name="name"]').val();
            const email = html.find('[name="email"]').val();
            const actorId = html.find('[name="actor-id"]').val();
            
            if (name && isValidEmail(email)) {
              // Get actor image if linked
              let img = null;
              if (actorId) {
                const actor = game.actors.get(actorId);
                if (actor) {
                  img = actor.img;
                }
              }
              
              // Add to GM's contacts
              const contacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
              contacts.push({
                name,
                email,
                img,
                linkedActorId: actorId || null,
                createdAt: new Date().toISOString()
              });
              
              await game.user.setFlag(MODULE_ID, "contacts", contacts);
              ui.notifications.info(`Contact ${name} added`);
              this.render(true);
            } else {
              ui.notifications.error("Please enter a valid name and email");
            }
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "add"
    }).render(true);
  }

  /**
   * Set current view to a specific character's inbox
   * Allows the GM to see exactly what a player sees
   * @param {string} characterId - Character ID
   * @private
   */
  async _viewAsCharacter(characterId) {
    const character = game.actors.get(characterId);
    if (!character) return;
    
    // Find the character's message journal
    const journalName = `${character.name}'s Messages`;
    const journal = game.journal.getName(journalName);
    
    if (!journal) {
      ui.notifications.warn(`No message journal found for ${character.name}`);
      return;
    }
    
    // Close this admin panel
    this.close();
    
    // Open the character's inbox in view mode
    if (game.nightcity?.messenger?.openViewer) {
      const viewer = game.nightcity.messenger.openViewer(journal.id);
      
      // Set a flag to indicate this is a GM viewing as character
      if (viewer) {
        viewer.viewingAsCharacter = character.name;
        // Add a visual indicator to the viewer
        setTimeout(() => {
          if (viewer.element) {
            const header = viewer.element.find('.header');
            const indicator = $(`<div class="gm-view-indicator">Viewing as: ${character.name}</div>`);
            header.append(indicator);
            
            // Style the indicator
            indicator.css({
              'position': 'absolute',
              'top': '5px',
              'left': '50%',
              'transform': 'translateX(-50%)',
              'background-color': 'rgba(246, 82, 97, 0.2)',
              'color': '#F65261',
              'padding': '2px 8px',
              'border-radius': '4px',
              'font-size': '0.8em',
              'border': '1px solid #F65261',
              'z-index': '101'
            });
          }
        }, 100);
      }
    }
  }
  
  /**
   * Handle edit contact button
   * @param {Event} event - Click event
   * @private
   */
  _onEditContact(event) {
    const email = event.currentTarget.dataset.email;
    const contact = this.contacts.find(c => c.email === email);
    
    if (!contact) return;
    
    // For character emails, edit the actor flag
    if (contact.type === "character") {
      const actor = game.actors.get(contact.id);
      
      if (actor) {
        new Dialog({
          title: `Edit Email for ${actor.name}`,
          content: `
            <div class="form-group">
              <label>Email Address:</label>
              <input type="text" name="email" value="${contact.email}" placeholder="name@nightcity.net">
            </div>
          `,
          buttons: {
            save: {
              icon: '<i class="fas fa-save"></i>',
              label: "Save",
              callback: async (html) => {
                const newEmail = html.find('[name="email"]').val();
                
                if (isValidEmail(newEmail)) {
                  await actor.setFlag(MODULE_ID, "emailAddress", newEmail);
                  ui.notifications.info(`Email updated for ${actor.name}`);
                  this.render(true);
                } else {
                  ui.notifications.error("Invalid email format");
                }
              }
            },
            cancel: {
              icon: '<i class="fas fa-times"></i>',
              label: "Cancel"
            }
          },
          default: "save"
        }).render(true);
      }
    }
    // For contacts, update in the user's flag
    else {
      new Dialog({
        title: "Edit Contact",
        content: `
          <div class="form-group">
            <label>Contact Name:</label>
            <input type="text" name="name" value="${contact.name}" placeholder="Contact Name">
          </div>
          <div class="form-group">
            <label>Email Address:</label>
            <input type="text" name="email" value="${contact.email}" placeholder="email@domain.com">
          </div>
        `,
        buttons: {
          save: {
            icon: '<i class="fas fa-save"></i>',
            label: "Save",
            callback: async (html) => {
              const newName = html.find('[name="name"]').val();
              const newEmail = html.find('[name="email"]').val();
              
              if (newName && isValidEmail(newEmail)) {
                // Update in GM's contacts - we don't try to edit other users' contacts
                const contacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
                const index = contacts.findIndex(c => c.email === contact.email);
                
                if (index !== -1) {
                  contacts[index] = {
                    ...contacts[index],
                    name: newName,
                    email: newEmail
                  };
                  
                  await game.user.setFlag(MODULE_ID, "contacts", contacts);
                  ui.notifications.info(`Contact ${newName} updated`);
                  this.render(true);
                } else {
                  ui.notifications.warn("Contact not found in your contacts");
                }
              } else {
                ui.notifications.error("Please enter a valid name and email");
              }
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel"
          }
        },
        default: "save"
      }).render(true);
    }
  }
  
  /**
   * Handle delete contact button
   * @param {Event} event - Click event
   * @private
   */
  async _onDeleteContact(event) {
    const email = event.currentTarget.dataset.email;
    const contact = this.contacts.find(c => c.email === email);
    
    if (!contact) return;
    
    // Character emails cannot be deleted, just edited
    if (contact.type === "character") {
      ui.notifications.warn("Character emails cannot be deleted, only edited");
      return;
    }
    
    // Show confirmation dialog
    new Dialog({
      title: "Delete Contact",
      content: `<p>Are you sure you want to delete the contact "${contact.name}"?</p>`,
      buttons: {
        delete: {
          icon: '<i class="fas fa-trash"></i>',
          label: "Delete",
          callback: async () => {
            // Delete from GM's contacts
            const contacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
            const updatedContacts = contacts.filter(c => c.email !== contact.email);
            
            await game.user.setFlag(MODULE_ID, "contacts", updatedContacts);
            ui.notifications.info(`Contact ${contact.name} deleted`);
            this.render(true);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "cancel"
    }).render(true);
  }
  
  /**
   * Handle mass message button
   * @param {Event} event - Click event
   * @private
   */
  _onMassMessage(event) {
    // Create a dialog with character list
    const characterOptions = this.characters.map(c => 
      `<div class="form-group">
        <label class="checkbox">
          <input type="checkbox" name="recipient" value="${c.id}">
          ${c.name}
        </label>
      </div>`
    ).join('');
    
    // Create a dialog with all senders
    const senderOptions = this.characters.map(c => {
      const email = c.getFlag(MODULE_ID, "emailAddress") || "No email set";
      return `<option value="${c.id}">${c.name} (${email})</option>`;
    }).join('');
    
    new Dialog({
      title: "Send Mass Message",
      content: `
        <div class="form-group">
          <label>Sender:</label>
          <select name="sender-select">
            <option value="custom">Custom Sender</option>
            ${senderOptions}
          </select>
        </div>
        <div id="custom-sender" style="display: none">
          <div class="form-group">
            <label>Custom Sender Name:</label>
            <input type="text" name="custom-name" placeholder="Sender Name">
          </div>
          <div class="form-group">
            <label>Custom Email:</label>
            <input type="text" name="custom-email" placeholder="sender@domain.com">
          </div>
        </div>
        <div class="form-group">
          <label>Subject:</label>
          <input type="text" name="subject" placeholder="Message Subject">
        </div>
        <div class="form-group">
          <label>Message:</label>
          <textarea name="content" rows="5" placeholder="Message content"></textarea>
        </div>
        <hr>
        <h3>Recipients</h3>
        <div class="form-group">
          <label class="checkbox">
            <input type="checkbox" id="select-all">
            Select All Characters
          </label>
        </div>
        <div class="recipient-list" style="max-height: 200px; overflow-y: auto; padding: 10px; border: 1px solid #F65261;">
          ${characterOptions}
        </div>
      `,
      buttons: {
        send: {
          icon: '<i class="fas fa-paper-plane"></i>',
          label: "Send to All Selected",
          callback: async (html) => {
            const senderSelect = html.find('[name="sender-select"]').val();
            let fromField;
            
            if (senderSelect === "custom") {
              const customName = html.find('[name="custom-name"]').val();
              const customEmail = html.find('[name="custom-email"]').val();
              
              if (!customName || !isValidEmail(customEmail)) {
                ui.notifications.error("Please enter a valid name and email for the custom sender");
                return;
              }
              
              fromField = `${customName} (${customEmail})`;
            } else {
              const sender = game.actors.get(senderSelect);
              const senderEmail = sender?.getFlag(MODULE_ID, "emailAddress") || "unknown@nightcity.net";
              fromField = `${sender.name} (${senderEmail})`;
            }
            
            // Get message data
            const subject = html.find('[name="subject"]').val();
            const content = html.find('[name="content"]').val();
            
            if (!subject || !content) {
              ui.notifications.error("Subject and content are required");
              return;
            }
            
            // Get recipients
            const recipientIds = html.find('input[name="recipient"]:checked').map(function() {
              return $(this).val();
            }).get();
            
            if (recipientIds.length === 0) {
              ui.notifications.warn("No recipients selected");
              return;
            }
            
            // Ask for confirmation
            new Dialog({
              title: "Confirm Mass Message",
              content: `
                <p>You are about to send a message to ${recipientIds.length} recipient(s).</p>
                <p>Are you sure you want to continue?</p>
              `,
              buttons: {
                confirm: {
                  icon: '<i class="fas fa-check"></i>',
                  label: "Send Messages",
                  callback: async () => {
                    // Show sending progress
                    this._sendMassMessages(fromField, subject, content, recipientIds);
                  }
                },
                cancel: {
                  icon: '<i class="fas fa-times"></i>',
                  label: "Cancel"
                }
              },
              default: "confirm"
            }).render(true);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "send",
      render: (html) => {
        // Toggle custom sender fields
        html.find('[name="sender-select"]').change(function() {
          if ($(this).val() === "custom") {
            html.find('#custom-sender').show();
          } else {
            html.find('#custom-sender').hide();
          }
        });
        
        // Select all checkbox
        html.find('#select-all').change(function() {
          const isChecked = $(this).prop('checked');
          html.find('input[name="recipient"]').prop('checked', isChecked);
        });
      }
    }).render(true);
  }
  
  /**
   * Send mass messages to multiple recipients
   * @param {string} fromField - Sender information
   * @param {string} subject - Message subject
   * @param {string} content - Message content
   * @param {Array} recipientIds - Array of recipient actor IDs
   * @private
   */
  async _sendMassMessages(fromField, subject, content, recipientIds) {
    // Create progress dialog
    const progressContent = `
      <div style="padding: 10px;">
        <p>Sending messages to ${recipientIds.length} recipients...</p>
        <div class="progress-bar" style="width: 100%; height: 20px; background-color: #1a1a1a; border: 1px solid #F65261; border-radius: 4px; overflow: hidden; margin: 10px 0;">
          <div class="progress-fill" style="height: 100%; width: 0%; background: linear-gradient(90deg, #F65261, #19f3f7); transition: width 0.3s ease;"></div>
        </div>
        <p class="progress-text" style="text-align: center;">0/${recipientIds.length}</p>
      </div>
    `;
    
    const dialog = new Dialog({
      title: "Sending Messages",
      content: progressContent,
      buttons: {},
      close: () => {}
    });
    
    dialog.render(true);
    
    // Send messages one by one
    let sentCount = 0;
    let failCount = 0;
    
    for (const recipientId of recipientIds) {
      try {
        const recipient = game.actors.get(recipientId);
        
        if (recipient) {
          // Create recipient string
          const recipientEmail = recipient.getFlag(MODULE_ID, "emailAddress") || "unknown@nightcity.net";
          const toField = `${recipient.name} (${recipientEmail})`;
          
          // Send message
          if (game.nightcity?.messenger?.sendMessage) {
            await game.nightcity.messenger.sendMessage({
              from: fromField,
              to: toField,
              subject: subject,
              content: content,
              date: getCurrentDateTime()
            });
            
            sentCount++;
          } else {
            failCount++;
          }
        } else {
          failCount++;
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Error sending mass message:`, error);
        failCount++;
      }
      
      // Update progress
      const progress = Math.round(((sentCount + failCount) / recipientIds.length) * 100);
      dialog.element.find('.progress-fill').css('width', `${progress}%`);
      dialog.element.find('.progress-text').text(`${sentCount + failCount}/${recipientIds.length}`);
      
      // Wait a moment between sends
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Close dialog after a short delay
    setTimeout(() => {
      dialog.close();
      ui.notifications.info(`Sent ${sentCount} messages (${failCount} failed)`);
    }, 1500);
  }
}