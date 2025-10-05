/**
 * Message Composer application for Night City Messenger
 */
import { MODULE_ID, AUDIO, TEMPLATES } from './constants.js';
import { getCurrentDateTime, formatMessage, isValidEmail, extractEmailAddress } from './utils.js';
import { getSetting } from './settings.js';

/**
 * The message composer application
 */
export class CyberpunkMessageComposer extends Application {
  /**
   * Constructor
   */
  constructor() {
    super();
    this.editors = {};
    this.emailMetadata = game.user.getFlag(MODULE_ID, "emailAddress") || "";
    this.characters = game.actors.filter(a => a.type === "character") || [];
    this.isGM = game.user.isGM;
    this.currentChar = game.user.character;
    this.contacts = [];
    this.recipientData = null;
    this.subjectData = null;
    this.contentData = null;
    this.replyData = null;
    this.scheduler = {
      initialized: false
    };
  }
  
  /**
   * Application configuration
   */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      template: TEMPLATES.COMPOSER,
      title: "Compose Message",
      id: "cyberpunk-messenger-composer",
      width: 720,
      height: 800,
      resizable: true,
      minimizable: true,
      classes: ["cyberpunk-app"]
    });
  }
  
  /**
   * Initialize the composer
   * @returns {Promise<CyberpunkMessageComposer>} The initialized composer
   */
  async initialize() {
    await this._loadContacts();
    return this;
  }
  
  /**
   * Load contacts from the contact manager
   * @private
   */
  async _loadContacts() {
    try {
      // Use the global contact manager if available
      if (game.nightcity?.contactManager) {
        this.contacts = await game.nightcity.contactManager.getAll();
      } else {
        // Fallback to legacy method
        this.contacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
        
        // Also load from messages
        if (game.user.character) {
          const journalName = `${game.user.character.name}'s Messages`;
          const journal = game.journal.getName(journalName);
          
          if (journal && journal.pages) {
            const senderEmails = journal.pages.contents
              .map(page => {
                if (!page?.text?.content) return null;
                const content = page.text.content;
                const fromMatch = content.match(/\[From\](.+?)\[End\]/)?.[1];
                if (fromMatch) {
                  const email = extractEmailAddress(fromMatch);
                  const name = fromMatch.split('(')[0].trim();
                  return email ? { name, email } : null;
                }
                return null;
              })
              .filter(contact => contact && !this.contacts.some(c => c.email === contact.email));
              
            this.contacts = [...this.contacts, ...senderEmails];
            await game.user.setFlag(MODULE_ID, "contacts", this.contacts);
          }
        }
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error loading contacts:`, error);
      this.contacts = [];
    }
  }
  
  /**
   * Set initial recipient data
   * @param {string} recipient - Recipient email or name+email
   * @returns {CyberpunkMessageComposer} This app instance
   */
  setRecipient(recipient) {
    this.recipientData = recipient;
    return this;
  }
  
  /**
   * Set initial subject
   * @param {string} subject - Message subject
   * @returns {CyberpunkMessageComposer} This app instance
   */
  setSubject(subject) {
    this.subjectData = subject;
    return this;
  }
  
  /**
   * Set initial content
   * @param {string} content - Message content
   * @returns {CyberpunkMessageComposer} This app instance
   */
  setContent(content) {
    this.contentData = content;
    return this;
  }
  
  /**
   * Set reply data
   * @param {Object} replyData - Reply data
   * @returns {CyberpunkMessageComposer} This app instance
   */
  setReplyData(replyData) {
    this.replyData = replyData;
    return this;
  }
  
  /**
   * Get data for the template
   */
  getData() {
    // Get safe character email if available
    const currentCharEmail = this.currentChar && this.currentChar.id 
      ? this.currentChar.getFlag(MODULE_ID, "emailAddress") || "No email set"
      : "No email set";
    
    return {
      characters: this.characters,
      isGM: this.isGM,
      currentChar: this.currentChar,
      currentCharEmail: currentCharEmail,
      contacts: this.contacts,
      currentTime: getCurrentDateTime(),
      recipientData: this.recipientData,
      subjectData: this.subjectData,
      contentData: this.contentData,
      replyData: this.replyData
    };
  }
  
  /**
   * Add a contact
   * @param {string} name - Contact name
   * @param {string} email - Email address
   * @returns {Promise<Object>} Added contact
   */
  async addContact(name, email) {
    if (!isValidEmail(email)) {
      ui.notifications.error("Invalid email format");
      return null;
    }
    
    try {
      // Use contact manager if available, otherwise direct flags
      if (game.nightcity?.contactManager) {
        const contact = await game.nightcity.contactManager.add(name, email);
        // Update local cache
        this.contacts = await game.nightcity.contactManager.getAll();
        return contact;
      } else {
        // Legacy direct flag method (consider deprecating)
        const contacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
        if (!contacts.some(c => c.email === email)) {
          const newContact = { name, email, createdAt: new Date().toISOString() };
          contacts.push(newContact);
          await game.user.setFlag(MODULE_ID, "contacts", contacts);
          this.contacts = contacts;
          return newContact;
        }
        return contacts.find(c => c.email === email);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error adding contact:`, error);
      return null;
    }
  }
  
  /**
   * Update the contact dropdown in the UI
   * @param {Object} contact - The contact to add
   * @private
   */
  _updateContactDropdown(contact) {
    const selectElement = this.element.find('#recipient-select');
    if (selectElement.length && !selectElement.find(`option[value="${contact.email}"]`).length) {
      const option = `<option value="${contact.email}">${contact.name} (${contact.email})</option>`;
      selectElement.append(option);
    }
  }
  
  /**
   * Find an actor by email address
   * @param {string} email - Email address
   * @returns {Actor|null} Actor or null if not found
   * @private
   */
  _findActorByEmail(email) {
    return game.actors.find(a => {
      const actorEmail = a.id ? a.getFlag(MODULE_ID, "emailAddress") : null;
      return actorEmail === email;
    });
  }
  
  /**
   * Update portrait display
   * @param {jQuery} html - The app HTML
   * @param {string} type - Portrait type (sender or recipient)
   * @param {string} actorId - Actor ID
   * @returns {Promise<void>}
   * @private
   */
  async _updatePortraitDisplay(html, type, actorId) {
    const portraitContainer = html.find(`.${type}-portrait-container`);
    
    if (actorId && actorId !== 'custom') {
      const actor = game.actors.get(actorId);
      if (actor?.img) {
        portraitContainer.html(`<img class="character-portrait" src="${actor.img}" title="${actor.name}" />`);
      }
    } else {
      portraitContainer.html('');
    }
  }
  
  /**
   * Update recipient from email
   * @param {string} email - Email address
   * @returns {Promise<void>}
   * @private
   */
  async _updateRecipientFromEmail(email) {
    const recipientInput = this.element.find('#recipient-email-input');
    recipientInput.val(email);
    
    // Find actor or contact info
    const actor = this._findActorByEmail(email);
    if (actor) {
      this._updatePortraitDisplay(this.element, 'recipient', actor.id);
    }
    
    // Update select if it exists as an option
    const selectElement = this.element.find('#recipient-select');
    selectElement.val(email);
  }
  
  /**
   * Get form data - with editor error handling
   * @param {jQuery} html - The app HTML
   * @returns {Object} Form data
   * @private
   */
  _getFormData(html) {
    // Get sender information
    let fromText;
    if (this.isGM) {
      const fromSelect = html.find('#sender-select').val();
      if (fromSelect === 'custom') {
        fromText = html.find('#custom-sender-input').val() || 'Unknown Sender';
      } else {
        const sender = game.actors.get(fromSelect);
        if (sender) {
          const email = sender.id ? sender.getFlag(MODULE_ID, "emailAddress") || "unknown@nightcity.net" : "unknown@nightcity.net";
          fromText = `${sender.name} (${email})`;
        } else {
          fromText = 'Unknown Sender';
        }
      }
    } else if (this.currentChar) {
      const email = this.currentChar.id ? this.currentChar.getFlag(MODULE_ID, "emailAddress") || "unknown@nightcity.net" : "unknown@nightcity.net";
      fromText = `${this.currentChar.name} (${email})`;
    } else {
      fromText = 'Unknown Sender';
    }

    // Get recipient information
    const recipientEmail = html.find('#recipient-email-input').val();
    let toText = recipientEmail || 'Unknown Recipient';
    
    // Process multiple recipients (comma-separated)
    if (toText.includes(',')) {
      const recipientParts = toText.split(',').map(email => email.trim());
      const formattedRecipients = recipientParts.map(email => {
        if (email.includes('(')) return email;
        
        // Try to find a contact for this email
        const contact = this.contacts.find(c => c.email === email);
        if (contact) {
          return `${contact.name} (${email})`;
        } else {
          // Try to find an actor for this email
          const actor = this._findActorByEmail(email);
          if (actor) {
            return `${actor.name} (${email})`;
          } else {
            // Just use the email as is
            return `Contact (${email})`;
          }
        }
      });
      
      toText = formattedRecipients.join(', ');
    } else if (!toText.includes('(') && isValidEmail(toText)) {
      // Single recipient without formatted name
      // Try to find a contact for this email
      const contact = this.contacts.find(c => c.email === toText);
      if (contact) {
        toText = `${contact.name} (${toText})`;
      } else {
        // Try to find an actor for this email
        const actor = this._findActorByEmail(toText);
        if (actor) {
          toText = `${actor.name} (${toText})`;
        } else {
          // Just use the email as is
          toText = `Contact (${toText})`;
        }
      }
    }

    // Get message content - WITH ERROR HANDLING
    let content = "";
    try {
      if (this.editors.content) {
        if (typeof this.editors.content.getData === 'function') {
          content = this.editors.content.getData();
        } else if (typeof this.editors.content.getContent === 'function') {
          content = this.editors.content.getContent();
        } else if (typeof this.editors.content.saveContent === 'function') {
          this.editors.content.saveContent();
          content = html.find('.editor-content').html() || "";
        } else {
          console.warn(`${MODULE_ID} | Editor API methods not found, getting HTML directly`);
          content = html.find('.editor-content').html() || "";
        }
      } else {
        console.warn(`${MODULE_ID} | Editor not found, getting HTML directly`);
        content = html.find('.editor-content').html() || "";
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error getting editor content:`, error);
      content = html.find('.editor-content').html() || "";
    }
    
    // Clean up content
    content = this._cleanContent(content);

    return {
      from: fromText,
      to: toText,
      subject: html.find('#subject-input').val() || '',
      content: content,
      date: getCurrentDateTime()
    };
  }
  
  /**
   * Clean HTML content
   * @param {string} content - The content to clean
   * @returns {string} Cleaned content
   * @private
   */
  _cleanContent(content) {
    if (!content) return '';
    
    // Remove any leading empty paragraphs
    let cleaned = content.trim();
    
    // Remove empty paragraphs at the beginning
    while (cleaned.startsWith('<p>&nbsp;</p>') || cleaned.startsWith('<p></p>')) {
      cleaned = cleaned.replace(/^<p>&nbsp;<\/p>|^<p><\/p>/, '').trim();
    }
    
    // If the content starts with a paragraph tag, we'll keep it
    // But if it's plain text, we need to ensure it doesn't get wrapped in a paragraph
    if (!cleaned.startsWith('<')) {
      // Convert newlines to breaks for plain text
      cleaned = cleaned.replace(/\n/g, '<br>');
    }
    
    // Ensure there's no extra space at the beginning
    cleaned = cleaned.replace(/^\s+/, '');
    
    return cleaned;
  }
  
  /**
   * Send the message
   * @param {Object} messageData - Message data
   * @returns {Promise<JournalEntryPage>} Created message
   * @private
   */
  async _sendMessage(messageData) {
    try {
      // Check if there are multiple recipients
      const recipients = messageData.to.split(',').map(rec => rec.trim());
      let sentPages = [];
      
      for (const recipient of recipients) {
        // Create a copy of the message data for this recipient
        const singleRecipientData = { ...messageData, to: recipient };
        
        // Format the message
        const formattedContent = formatMessage({
          date: singleRecipientData.date, 
          from: singleRecipientData.from,
          to: singleRecipientData.to,
          subject: singleRecipientData.subject,
          content: singleRecipientData.content
        });
        
        // Extract recipient name
        const recipientName = singleRecipientData.to.split('(')[0].trim();
        
        // Find or create journal for recipient
        let journal;
        
        // Try to find a journal by recipient name
        if (recipientName) {
          const journalName = `${recipientName}'s Messages`;
          journal = game.journal.getName(journalName);
        }
        
        // If no journal found and user is GM, create one
        if (!journal && game.user.isGM) {
          // Create journal folder if it doesn't exist
          let folder = game.folders.find(f => f.name === "Player Messages" && f.type === "JournalEntry");
          if (!folder) {
            folder = await Folder.create({
              name: "Player Messages",
              type: "JournalEntry",
              parent: null
            });
          }
          
          // Create the journal
          journal = await JournalEntry.create({
            name: `${recipientName}'s Messages`,
            folder: folder.id
          });
        }
        
        if (!journal) {
          console.warn(`${MODULE_ID} | No message journal found for ${recipientName}`);
          continue; // Skip this recipient and continue with the next one
        }
        
        // Create the message with createdAt timestamp
        const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
          name: singleRecipientData.subject,
          type: "text",
          text: {
            content: formattedContent
          },
          [`flags.${MODULE_ID}.status`]: {
            read: false,
            saved: false,
            spam: false
          },
          [`flags.${MODULE_ID}.createdAt`]: new Date().toISOString()
        }]);
        
        if (page) {
          sentPages.push(page);
          
          // Very important: make sure the page is explicitly in the unread list
          let unreadMessages = await journal.getFlag(MODULE_ID, "unreadMessages") || [];
          if (!Array.isArray(unreadMessages)) unreadMessages = [];
          
          if (!unreadMessages.includes(page.id)) {
            unreadMessages.push(page.id);
            await journal.setFlag(MODULE_ID, "unreadMessages", unreadMessages);
            console.log(`${MODULE_ID} | Added ${page.id} to unread messages for ${journal.name}`);
          }
        }
        
        // Add recipient to contacts (if not already there)
        const recipientEmail = extractEmailAddress(singleRecipientData.to);
        if (recipientEmail && recipientName) {
          await this.addContact(recipientName, recipientEmail);
        }
        
        // Find the recipient user to notify them
        const recipientUser = game.users.find(u => 
          u.character && u.character.name === recipientName
        );
        
        if (recipientUser) {
          console.log(`${MODULE_ID} | Sending notification to ${recipientUser.name}`);
          
          // FIRST socket message for notification
          if (getSetting('enableNotifications')) {
            game.socket.emit(`module.${MODULE_ID}`, {
              operation: 'notification',
              userId: recipientUser.id,
              message: `New message from ${singleRecipientData.from.split('(')[0].trim()}: ${singleRecipientData.subject}`
            });
          }
          
          // SECOND socket message to trigger inbox update - important!
          game.socket.emit(`module.${MODULE_ID}`, {
            operation: 'updateInbox',
            targetUserId: recipientUser.id,
            journalId: journal.id,
            pageId: page?.id,
            fromName: singleRecipientData.from.split('(')[0].trim(),
            toName: recipientName,
            subject: singleRecipientData.subject
          });
        }
        
        // Also notify all active GMs if the setting is enabled
        if (getSetting('gmReceivesAllNotifications') && game.user.id !== recipientUser?.id) {
          const gmUsers = game.users.filter(u => u.isGM && u.active);
          for (const gmUser of gmUsers) {
            if (gmUser.id !== game.user.id) { // Don't notify self
              game.socket.emit(`module.${MODULE_ID}`, {
                operation: 'updateInbox',
                targetUserId: gmUser.id,
                journalId: journal.id,
                pageId: page?.id,
                fromName: singleRecipientData.from.split('(')[0].trim(),
                toName: recipientName,
                subject: singleRecipientData.subject
              });
            }
          }
        }
      }
      
      // Return the first created page or null if none were created
      return sentPages.length > 0 ? sentPages[0] : null;
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending message:`, error);
      ui.notifications.error("Failed to send message. Please try again.");
      throw error;
    }
  }
  
  /**
   * Activate application listeners
   * @param {jQuery} html - The app HTML
   */
  activateListeners(html) {
    super.activateListeners(html);
    
    // Initialize the editor
    this._initializeEditor(html);
    
    // Initialize portraits
    this._initializePortraits(html);
    
    // Handle GM controls
    if (this.isGM) {
      this._activateGMControls(html);
    } else {
      this._activatePlayerControls(html);
    }
    
    // Email recipient interactions
    this._setupRecipientControls(html);
    
    // Preview button
    html.find('#preview-button').on('click', ev => this._onPreviewClick(ev));
    
    // Send button
    html.find('#send-button').on('click', ev => this._onSendClick(ev));

    // Schedule Send button
    html.find('#schedule-button').click(ev => this._onScheduleClick(ev));
  }
  
  /**
   * Initialize the content editor
   * @param {jQuery} html - The app HTML
   * @private
   */
  async _initializeEditor(html) {
    const target = html.find(".editor-content")[0];
    if (!target) {
      console.error(`${MODULE_ID} | Could not find editor content element`);
      return;
    }
    
    try {
      // Create the editor with different method depending on Foundry version
      if (typeof TextEditor.create === 'function') {
        // Foundry V9+ method
        this.editors.content = await TextEditor.create({
          target: target,
          content: this.contentData || "",
          engine: "prosemirror",
          collaborate: false,
          editable: true
        });
        
        console.log(`${MODULE_ID} | Editor initialized successfully with TextEditor.create`);
      } else {
        // Legacy method for older Foundry versions
        this.editors.content = await TextEditor.createEditor({
          target: target,
          content: this.contentData || "",
          editable: true,
          collaborate: false,
          engine: "prosemirror",
        });
        
        console.log(`${MODULE_ID} | Editor initialized successfully with TextEditor.createEditor`);
      }
      
      // Set initial content data if any
      if (this.contentData && this.editors.content) {
        if (typeof this.editors.content.setContent === 'function') {
          this.editors.content.setContent(this.contentData);
        } else if (typeof this.editors.content.setValue === 'function') {
          this.editors.content.setValue(this.contentData);
        } else {
          console.warn(`${MODULE_ID} | Could not set editor content, unsupported editor API`);
          $(target).html(this.contentData);
        }
      }
      
      // If this is a reply, set up reply content
      if (this.replyData) {
        // Set subject if not already set
        if (this.replyData.subject && !this.subjectData) {
          html.find('#subject-input').val(this.replyData.subject);
        }
        
        // Set recipient if not already set
        if (this.replyData.to && !this.recipientData) {
          html.find('#recipient-email-input').val(this.replyData.to);
          this._updateRecipientFromEmail(extractEmailAddress(this.replyData.to));
        }
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error initializing editor:`, error);
      // Fallback to a plain textarea if the editor fails
      $(target).html(this.contentData || "");
    }
  }
  
  /**
   * Initialize portrait images
   * @param {jQuery} html - The app HTML
   * @private
   */
  _initializePortraits(html) {
    if (this.isGM) {
      if (this.characters.length > 0) {
        // For GM, show first character in the list as sender
        this._updatePortraitDisplay(html, 'sender', this.characters[0].id);
        
        const firstActor = game.actors.get(this.characters[0].id);
        const senderEmail = firstActor && firstActor.id ? 
          firstActor.getFlag(MODULE_ID, "emailAddress") || "No email set" : 
          "No email set";
          
        html.find('#sender-email').text(senderEmail);
      }
    } else if (this.currentChar?.id) {
      // For players, show their assigned character as sender
      this._updatePortraitDisplay(html, 'sender', this.currentChar.id);
    }
  }
  
  /**
   * Set up GM-specific controls
   * @param {jQuery} html - The app HTML
   * @private
   */
  _activateGMControls(html) {
    // Directory button
    html.find('#manage-emails').on('click', () => {
      if (getSetting('enableSounds')) {
        try {
          AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
        } catch (e) {
          console.warn("Could not play audio:", e);
        }
      }
      this._showEmailDirectoryDialog();
    });
    
    // Quick add email button
    html.find('#quick-add-email').on('click', () => {
      if (getSetting('enableSounds')) {
        try {
          AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
        } catch (e) {
          console.warn("Could not play audio:", e);
        }
      }
      this._showQuickAddEmailDialog();
    });
    
    // Sender select
    html.find('#sender-select').on('change', ev => {
      if (getSetting('enableSounds')) {
        try {
          AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
        } catch (e) {
          console.warn("Could not play audio:", e);
        }
      }
      
      const val = ev.currentTarget.value;
      this._updatePortraitDisplay(html, 'sender', val);
      
      if (val === 'custom') {
        html.find('#sender-email').text('');
      } else {
        const actor = game.actors.get(val);
        const email = actor && actor.id ? 
          actor.getFlag(MODULE_ID, "emailAddress") || "No email set" : 
          "No email set";
        html.find('#sender-email').text(email);
      }
    });
  }
  
  /**
   * Set up player-specific controls
   * @param {jQuery} html - The app HTML
   * @private
   */
  _activatePlayerControls(html) {
    // View contacts button
    html.find('#view-contacts').on('click', () => {
      if (getSetting('enableSounds')) {
        try {
          AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
        } catch (e) {
          console.warn("Could not play audio:", e);
        }
      }
      this._showContactsDialog();
    });
  }
  
  /**
   * Set up recipient controls
   * @param {jQuery} html - The app HTML
   * @private
   */
  _setupRecipientControls(html) {
    const emailInput = html.find('#recipient-email-input');
    const suggestions = html.find('.email-suggestions');
    const recipientSelect = html.find('#recipient-select');
    
    // Set initial values if provided
    if (this.recipientData) {
      emailInput.val(this.recipientData);
      this._updateRecipientFromEmail(extractEmailAddress(this.recipientData));
    }
    
    if (this.subjectData) {
      html.find('#subject-input').val(this.subjectData);
    }
    
    // Email input handler
    emailInput.on('input', ev => {
      const value = ev.target.value.toLowerCase();
      if (!value) {
        suggestions.hide();
        return;
      }
      
      // Find matching contacts and actors
      const matchingContacts = this.contacts.filter(c => 
        c.name.toLowerCase().includes(value) || 
        c.email.toLowerCase().includes(value)
      );
      
      const matchingActors = game.actors.filter(a => {
        if (!a.id) return false;
        const email = a.getFlag(MODULE_ID, "emailAddress");
        return email && (
          a.name.toLowerCase().includes(value) ||
          email.toLowerCase().includes(value)
        );
      });
      
      // Combine matches, removing duplicates
      const allMatches = [];
      const addedEmails = new Set();
      
      // Add contacts first
      for (const contact of matchingContacts) {
        if (!addedEmails.has(contact.email)) {
          allMatches.push({
            name: contact.name,
            email: contact.email,
            img: contact.img
          });
          addedEmails.add(contact.email);
        }
      }
      
      // Add actors if not already added
      for (const actor of matchingActors) {
        if (!actor.id) continue;
        const email = actor.getFlag(MODULE_ID, "emailAddress");
        if (email && !addedEmails.has(email)) {
          allMatches.push({
            name: actor.name,
            email: email,
            img: actor.img
          });
          addedEmails.add(email);
        }
      }
      
      // Show suggestions if we have matches or a valid email
      if (allMatches.length || isValidEmail(value)) {
        // Create suggestion HTML
        const suggestionsHtml = allMatches.map(match => `
          <div class="email-suggestion" data-email="${match.email}">
            ${match.img ? `<img src="${match.img}" alt="${match.name}"/>` : '<i class="fas fa-user"></i>'}
            <div>
              <div class="name">${match.name}</div>
              <div class="email">${match.email}</div>
            </div>
          </div>
        `).join('');
        
        // Add "Add to contacts" option if it's a valid email not already in contacts
        if (isValidEmail(value) && !addedEmails.has(value)) {
          suggestions.html(suggestionsHtml + `
            <div class="email-suggestion add-new">
              <i class="fas fa-plus"></i>
              <div>
                <div class="name">Add to contacts</div>
                <div class="email">${value}</div>
              </div>
            </div>
          `);
        } else {
          suggestions.html(suggestionsHtml);
        }
        
        suggestions.show();
      } else {
        suggestions.hide();
      }
    });
    
    // Suggestion click handler
    suggestions.on('click', '.email-suggestion', async ev => {
      if (getSetting('enableSounds')) {
        try {
          AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
        } catch (e) {
          console.warn("Could not play audio:", e);
        }
      }
      
      const target = $(ev.currentTarget);
      if (target.hasClass('add-new')) {
        const email = emailInput.val();
        const name = await this._promptContactName(email);
        if (name) {
          await this.addContact(name, email);
        }
      } else {
        const email = target.data('email');
        emailInput.val(email);
        const actor = this._findActorByEmail(email);
        if (actor) {
          this._updatePortraitDisplay(html, 'recipient', actor.id);
        }
      }
      suggestions.hide();
    });
    
    // Recipient select handler
    recipientSelect.on('change', ev => {
      if (getSetting('enableSounds')) {
        try {
          AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
        } catch (e) {
          console.warn("Could not play audio:", e);
        }
      }
      
      const email = ev.target.value;
      emailInput.val(email);
      const actor = this._findActorByEmail(email);
      if (actor) {
        this._updatePortraitDisplay(html, 'recipient', actor.id);
      }
    });
    
    // Change sender email button
    html.find('#change-sender-email').on('click', async ev => {
      ev.preventDefault();
      
      if (getSetting('enableSounds')) {
        try {
          AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
        } catch (e) {
          console.warn("Could not play audio:", e);
        }
      }
      
      const actorId = html.find('#sender-select').val();
      if (actorId === 'custom') return;
      
      const actor = game.actors.get(actorId);
      if (!actor) return;
      
      // Check if user has permission to modify this actor
      if (!this.isGM && !actor.isOwner) return;
      
      const currentEmail = actor.id ? actor.getFlag(MODULE_ID, "emailAddress") || "" : "";
      
      new Dialog({
        title: `Set Email for ${actor.name}`,
        content: `
          <div class="form-group">
            <label>Email Address:</label>
            <input type="text"
                  name="email" 
                  value="${currentEmail}" 
                  placeholder="name@nightcity.net"
                  autocomplete="off"/>
          </div>
        `,
        buttons: {
          save: {
            label: "Save",
            callback: async (html) => {
              const email = html.find('[name="email"]').val();
              await this._updateActorEmail(actorId, email);
              this.element.find('#sender-email').text(email || "No email set");
            }
          },
          cancel: {
            label: "Cancel"
          }
        }
      }).render(true);
    });
  }

  /**
   * Handle schedule button click
   * Add this to activateListeners in messageComposer.js
   * html.find('#schedule-button').click(ev => this._onScheduleClick(ev));
   */
  _onScheduleClick(event) {
    event.preventDefault();
    
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const formData = this._getFormData(this.element);
    
    // Validate required fields
    if (!formData.subject) {
      ui.notifications.error("Please enter a subject for your message.");
      return;
    }
    
    if (!formData.content) {
      ui.notifications.error("Please enter content for your message.");
      return;
    }
    
    if (!formData.to) {
      ui.notifications.error("Please select a recipient.");
      return;
    }
    
    // Show scheduling dialog
    this._showScheduleDialog(formData);
  }


  /**
   * Register a hook to check for scheduled messages
   * @private
   */
  _registerScheduledMessageChecker() {
    console.log(`${MODULE_ID} | Registering scheduled message checker`);
    
    // For real-world time scheduling
    setInterval(() => {
      if (game.user.isGM) {
        this._checkScheduledMessages();
      }
    }, 60000); // Check every minute
    
    // For SimpleCalendar integration
    if (game.modules.get("foundryvtt-simple-calendar")?.active) {
      Hooks.on('simple-calendar.dateChanged', () => {
        if (game.user.isGM) {
          console.log(`${MODULE_ID} | Calendar date changed, checking scheduled messages`);
          this._checkScheduledMessages(true);
        }
      });
    }
    
    // Verify scheduler is working
    console.log(`${MODULE_ID} | Scheduled message system initialized`);
  }


  /**
   * Check for scheduled messages that need to be sent
   * @param {boolean} calendarChange - Whether this check is triggered by a calendar change
   * @private
   */
  static checkScheduledMessages(fromCalendar = false) {
    if (!game.user.isGM) return;
    
    console.log(`${MODULE_ID} | Checking scheduled messages (fromCalendar: ${fromCalendar})`);
    
    // Get latest scheduled messages
    const scheduledMessages = game.settings.get(MODULE_ID, "scheduledMessages") || [];
    console.log(`${MODULE_ID} | Found ${scheduledMessages.length} scheduled messages`);
    
    // Get SimpleCalendar timestamp if available
    let simpleCalendarTimestamp;
    if (game.modules.get("foundryvtt-simple-calendar")?.active && SimpleCalendar?.api) {
      try {
        simpleCalendarTimestamp = SimpleCalendar.api.timestamp();
        console.log(`${MODULE_ID} | Current SimpleCalendar timestamp:`, simpleCalendarTimestamp);
      } catch (error) {
        console.error(`${MODULE_ID} | Error getting SimpleCalendar timestamp:`, error);
      }
    } else if (fromCalendar) {
      console.warn(`${MODULE_ID} | Called from calendar but SimpleCalendar is not available`);
    }
    
    // Filter for past-due messages
    const now = new Date();
    const pastDueMessages = [];
    const remainingMessages = [];
    
    // Check each message
    for (const message of scheduledMessages) {
      try {
        // Normalize useSimpleCalendar to be boolean
        const useSimpleCalendar = message.useSimpleCalendar === true || 
                                 message.useSimpleCalendar === "true";
        
        let isPastDue = false;
        
        // Check based on type
        if (useSimpleCalendar && simpleCalendarTimestamp !== undefined) {
          console.log(`${MODULE_ID} | Checking in-game scheduled message:`, message);
          
          const scheduledDate = new Date(message.scheduledTime);
          
          try {
            // Convert to SimpleCalendar timestamp
            const dateData = {
              year: scheduledDate.getFullYear(),
              month: scheduledDate.getMonth(), // JavaScript months are 0-indexed
              day: scheduledDate.getDate(),
              hour: scheduledDate.getHours(),
              minute: scheduledDate.getMinutes(),
              second: 0
            };
            
            const scheduledTimestamp = SimpleCalendar.api.dateToTimestamp(dateData);
            
            console.log(`${MODULE_ID} | SimpleCalendar comparison - Scheduled: ${scheduledTimestamp}, Current: ${simpleCalendarTimestamp}`);
            
            // Compare timestamps
            isPastDue = simpleCalendarTimestamp >= scheduledTimestamp;
            
            console.log(`${MODULE_ID} | Message is past due: ${isPastDue}`);
          } catch (error) {
            console.error(`${MODULE_ID} | Error converting date to SimpleCalendar timestamp:`, error);
            isPastDue = false;
          }
        } else {
          // Regular real-world time comparison
          const scheduledTime = new Date(message.scheduledTime);
          isPastDue = now >= scheduledTime;
          
          console.log(`${MODULE_ID} | Real-world comparison - Scheduled: ${scheduledTime.toISOString()}, Current: ${now.toISOString()}, Past Due: ${isPastDue}`);
        }
        
        // Sort into appropriate array
        if (isPastDue) {
          pastDueMessages.push(message);
        } else {
          remainingMessages.push(message);
        }
      } catch (error) {
        console.error(`${MODULE_ID} | Error processing scheduled message:`, error);
        remainingMessages.push(message); // Keep on error
      }
    }
    
    // If there are past-due messages, prompt to send them
    if (pastDueMessages.length > 0) {
      console.log(`${MODULE_ID} | Found ${pastDueMessages.length} past-due messages`);
      
      new Dialog({
        title: "Past-Due Messages",
        content: `
          <p>There are ${pastDueMessages.length} scheduled messages that are past their scheduled time.</p>
          <p>Would you like to send them now?</p>
        `,
        buttons: {
          yes: {
            icon: '<i class="fas fa-paper-plane"></i>',
            label: "Send All",
            callback: async () => await this._sendPastDueMessages(pastDueMessages, remainingMessages)
          },
          manager: {
            icon: '<i class="fas fa-calendar-alt"></i>',
            label: "Open Manager",
            callback: () => this.openScheduledMessagesManager()
          },
          no: {
            icon: '<i class="fas fa-times"></i>',
            label: "Not Now"
          }
        },
        default: "yes"
      }).render(true);
    } else if (fromCalendar) {
      console.log(`${MODULE_ID} | No past-due messages found after calendar change`);
    }
  }
  
  /**
   * Send a scheduled message
   * @param {Object} message - Scheduled message data
   * @private
   */
  async _sendScheduledMessage(message) {
    try {
      // Update the date field to current time
      message.date = getCurrentDateTime();
      
      console.log(`${MODULE_ID} | Sending scheduled message:`, message);
      
      // Use the game.nightcity.messenger instead of NightCityMessenger
      if (game.nightcity?.messenger?.sendMessage) {
        await game.nightcity.messenger.sendMessage({
          to: message.to,
          from: message.from,
          subject: message.subject,
          content: message.content,
          date: message.date
        });
        
        // Notify the original sender
        if (message.sender && message.sender !== game.user.id) {
          const user = game.users.get(message.sender);
          if (user && user.active) {
            game.socket.emit(`module.${MODULE_ID}`, {
              operation: 'notification',
              userId: user.id,
              message: `Your scheduled message to ${message.to.split('(')[0].trim()} has been sent!`
            });
          }
        } else {
          // Notify the GM (self)
          ui.notifications.info(`Scheduled message sent to ${message.to.split('(')[0].trim()}: ${message.subject}`);
        }
        
        return true;
      } else {
        throw new Error("Messaging system not properly initialized");
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Error sending scheduled message:`, error);
      ui.notifications.error(`Failed to send scheduled message: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Handle preview button click
   * @param {Event} event - Click event
   * @private
   */
  _onPreviewClick(event) {
    event.preventDefault();
    
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const previewContainer = this.element.find('.formatted-preview');
    const messageContainer = this.element.find('.message-body');
    const button = $(event.currentTarget);
    
    if (previewContainer.is(':visible')) {
      previewContainer.hide();
      messageContainer.show();
      button.html('<i class="fas fa-eye"></i> Preview');
    } else {
      const formData = this._getFormData(this.element);
      if (!formData.subject || !formData.content) {
        ui.notifications.error("Please fill in both subject and message content.");
        return;
      }
      
      // Format the message for preview
      const messagePreview = formatMessage({
        date: formData.date,
        from: formData.from,
        to: formData.to,
        subject: formData.subject,
        content: formData.content
      });
      
      previewContainer.html(messagePreview).show();
      messageContainer.hide();
      button.html('<i class="fas fa-edit"></i> Edit');
    }
  }
  
  /**
   * Handle send button click
   * @param {Event} event - Click event
   * @private
   */
  async _onSendClick(event) {
    event.preventDefault();
    
    if (getSetting('enableSounds')) {
      try {
        AUDIO.click.play().catch(e => console.warn("Audio play failed:", e));
      } catch (e) {
        console.warn("Could not play audio:", e);
      }
    }
    
    const formData = this._getFormData(this.element);
    
    // Validate required fields
    if (!formData.subject) {
      ui.notifications.error("Please enter a subject for your message.");
      return;
    }
    
    if (!formData.content) {
      ui.notifications.error("Please enter content for your message.");
      return;
    }
    
    if (!formData.to) {
      ui.notifications.error("Please select a recipient.");
      return;
    }
    
    // Check if we're in scheduled mode (passed through options)
    if (this.options.scheduledMode) {
      this._showScheduleDialog(formData);
      return;
    }
    
    // Get recipient name
    const recipientName = formData.to.split('(')[0].trim();
    
    // Create a very simple animation overlay
    const overlay = $(`
      <div id="sending-overlay" style="position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); z-index:100000; display:flex; align-items:center; justify-content:center; font-family:'Rajdhani',sans-serif;">
        <div style="width:400px; background:#1a1a1a; border:1px solid #F65261; color:#F65261; border-radius:4px; overflow:hidden; box-shadow:0 0 20px rgba(246,82,97,0.5);">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 15px; border-bottom:1px solid rgba(246,82,97,0.3);">
            <div><i class="fas fa-satellite-dish"></i></div>
            <div style="font-weight:bold; letter-spacing:1px; text-transform:uppercase;">TRANSMITTING</div>
            <div style="color:#19f3f7; font-size:0.9em;"><span class="status-text">SENDING</span>...</div>
          </div>
          <div style="padding:20px;">
            <div style="margin-bottom:15px; border-bottom:1px solid rgba(246,82,97,0.3); padding-bottom:10px;">
              <div style="color:#F65261; font-weight:bold; font-size:0.9em;">RECIPIENT: ${recipientName || 'Unknown'}</div>
            </div>
            <div style="height:10px; background:rgba(246,82,97,0.2); border-radius:5px; overflow:hidden; border:1px solid rgba(246,82,97,0.3); margin-bottom:10px;">
              <div class="progress-fill" style="height:100%; width:0%; background:linear-gradient(90deg, #F65261, #19f3f7); border-radius:5px;"></div>
            </div>
            <div style="text-align:center; color:#F65261;" class="progress-text">0%</div>
          </div>
        </div>
      </div>
    `);
    
    // Add to DOM
    $('body').append(overlay);
    
    // Simple animation progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 5) + 1;
      if (progress > 100) progress = 100;
      
      // Update progress bar
      overlay.find('.progress-fill').css('width', `${progress}%`);
      overlay.find('.progress-text').text(`${progress}%`);
      
      if (progress === 100) {
        clearInterval(interval);
        
        // Update status and wait before removing
        overlay.find('.status-text').text('DELIVERED');
        
        setTimeout(() => {
          overlay.fadeOut(500, () => {
            overlay.remove();
            
            // Send the message after animation completes
            this._sendMessage(formData)
              .then(() => {
                ui.notifications.info("Message sent successfully!");
                this.close();
              })
              .catch(error => {
                console.error(`${MODULE_ID} | Error sending message:`, error);
                ui.notifications.error("Failed to send message. Please try again.");
              });
          });
        }, 800);
      }
    }, 100);
  }

  /**
   * Enhanced schedule dialog method
   * Improves the UI and adds direct scheduling
   * @param {Object} messageData - Message data to schedule
   */
  _showScheduleDialog(messageData) {
    // Check if SimpleCalendar is available
    const hasSimpleCalendar = game.modules.get("foundryvtt-simple-calendar")?.active && SimpleCalendar?.api;
    
    // Get current date/time string using the existing utility function
    const currentDateTimeStr = getCurrentDateTime();
    console.log(`${MODULE_ID} | Current date/time from utils:`, currentDateTimeStr);
    
    // Parse the current time string into a JS Date
    // Format from getCurrentDateTime is: "M/D/YYYY, H:MM AM/PM"
    const dateMatch = currentDateTimeStr.match(/(\d+)\/(\d+)\/(\d+),\s+(\d+):(\d+)\s+(AM|PM)/i);
    let defaultDateTimeValue = "";
    
    if (dateMatch) {
      let [_, month, day, year, hours, minutes, ampm] = dateMatch;
      
      // Convert to numbers
      month = parseInt(month);
      day = parseInt(day);
      year = parseInt(year);
      hours = parseInt(hours);
      minutes = parseInt(minutes);
      
      // Adjust for PM
      if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
      // Adjust for 12 AM
      if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
      
      // Add one hour for default scheduling time
      hours = (hours + 1) % 24;
      
      // Create a JS Date (month is 0-indexed!)
      const jsDate = new Date(year, month - 1, day, hours, minutes);
      
      // Format for datetime-local input
      defaultDateTimeValue = jsDate.toISOString().slice(0, 16);
      console.log(`${MODULE_ID} | Parsed in-game date for input:`, defaultDateTimeValue);
    } else {
      // Fallback to standard JS Date
      const defaultDate = new Date();
      defaultDate.setHours(defaultDate.getHours() + 1);
      defaultDateTimeValue = defaultDate.toISOString().slice(0, 16);
    }
    
    // Create dialog content
    let content = `
      <div class="schedule-dialog-content">
        <p>Schedule this message to be sent automatically at a future time.</p>
        
        <div class="form-group">
          <label>Schedule Message For:</label>
          <input type="datetime-local" name="scheduled-time" value="${defaultDateTimeValue}" min="${new Date().toISOString().slice(0, 16)}">
        </div>
    `;
    
    // If SimpleCalendar is available, add option to use it
    if (hasSimpleCalendar) {
      content += `
        <div class="form-group">
          <label>
            <input type="checkbox" name="use-simple-calendar" checked>
            Use In-Game Calendar Time
          </label>
          <div class="simple-calendar-info">
            <p><strong>Current in-game time:</strong> ${currentDateTimeStr}</p>
            <p class="calendar-note">The message will be sent when the in-game date/time reaches the specified time.</p>
            <p class="calendar-note"><i>Note: The GM must be online for scheduled messages to be sent.</i></p>
          </div>
        </div>
      `;
    } else {
      content += `
        <div class="form-group">
          <p class="calendar-note"><i>Note: The GM must be online for scheduled messages to be sent.</i></p>
        </div>
      `;
    }
    
    content += `</div>`;
    
    // Create dialog
    new Dialog({
      title: "Schedule Message",
      content: content,
      buttons: {
        schedule: {
          icon: '<i class="fas fa-calendar-check"></i>',
          label: "Schedule",
          callback: html => {
            const scheduledTime = html.find('[name="scheduled-time"]').val();
            const useSimpleCalendar = hasSimpleCalendar && html.find('[name="use-simple-calendar"]').is(':checked');
            
            if (!scheduledTime) {
              ui.notifications.error("Please select a valid date and time.");
              return;
            }
            
            this._scheduleMessage(messageData, scheduledTime, useSimpleCalendar);
          }
        },
        send: {
          icon: '<i class="fas fa-paper-plane"></i>',
          label: "Send Now Instead",
          callback: () => {
            // Close this dialog and send immediately
            this._sendMessage(messageData)
              .then(() => {
                ui.notifications.info("Message sent successfully!");
                this.close();
              })
              .catch(error => {
                console.error(`${MODULE_ID} | Error sending message:`, error);
                ui.notifications.error("Failed to send message. Please try again.");
              });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "schedule",
      render: html => {
        // Add styling enhancements
        html.find('.dialog .window-content').css({
          'background': '#330000',
          'color': '#F65261',
          'font-family': 'Rajdhani, sans-serif'
        });
        
        html.find('.form-group label').css('color', '#F65261');
        
        html.find('input[type="datetime-local"]').css({
          'background': '#1a1a1a',
          'border': '1px solid #F65261',
          'color': '#FFFFFF',
          'padding': '5px',
          'width': '100%'
        });
        
        html.find('.simple-calendar-info').css({
          'background': '#1a1a1a',
          'border': '1px solid #F65261',
          'border-radius': '4px',
          'padding': '10px',
          'margin-top': '10px'
        });
        
        html.find('.calendar-note').css({
          'font-size': '0.9em',
          'color': '#19f3f7',
          'margin-top': '5px'
        });
        
        // Toggle SimpleCalendar info visibility
        html.find('input[name="use-simple-calendar"]').change(function() {
          html.find('.simple-calendar-info').toggle(this.checked);
        });
      }
    }).render(true);
  }

  /**
   * Improved schedule message functionality
   * @param {Object} messageData - Message data
   * @param {string} scheduledTime - ISO datetime string
   * @param {boolean} useSimpleCalendar - Whether to use SimpleCalendar
   * @private
   */
  async _scheduleMessage(messageData, scheduledTime, useSimpleCalendar) {
    try {
      // Create a scheduled message data object
      const scheduledMessageData = {
        ...messageData,
        scheduledTime: scheduledTime,
        useSimpleCalendar: useSimpleCalendar, // Make sure this gets set correctly!
        sender: game.user.id,
        created: new Date().toISOString()
      };
      
      console.log(`${MODULE_ID} | Scheduling message:`, scheduledMessageData);
      
      // Store in game settings
      const scheduledMessages = game.settings.get(MODULE_ID, "scheduledMessages") || [];
      scheduledMessages.push(scheduledMessageData);
      
      await game.settings.set(MODULE_ID, "scheduledMessages", scheduledMessages);
      
      // Format display date
      const displayDate = new Date(scheduledTime).toLocaleString();
      
      ui.notifications.info(`Message scheduled for ${displayDate}`);
      this.close();
      
      // Offer to open the scheduled messages manager
      setTimeout(() => {
        new Dialog({
          title: "View Scheduled Messages",
          content: "<p>Would you like to view all your scheduled messages?</p>",
          buttons: {
            yes: {
              icon: '<i class="fas fa-calendar-alt"></i>',
              label: "View Messages",
              callback: () => {
                // Use the API to open the manager
                if (game.nightcity?.messenger?.openScheduledMessagesManager) {
                  game.nightcity.messenger.openScheduledMessagesManager();
                } else {
                  ui.notifications.warn("Scheduled messages manager not available");
                }
              }
            },
            no: {
              icon: '<i class="fas fa-times"></i>',
              label: "Not Now"
            }
          },
          default: "yes"
        }).render(true);
      }, 500);
    } catch (error) {
      console.error(`${MODULE_ID} | Error scheduling message:`, error);
      ui.notifications.error("Failed to schedule message. Please try again.");
    }
  }

  
  /**
     * Show the email directory dialog
     * @private
     */
    async _showEmailDirectoryDialog() {
      // Get all character actors
      const actors = game.actors.filter(a => a.type === "character");
      
      // Load contacts
      const contacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
      
      // Create dialog content
      const content = `
        <style>
          .email-directory {
            max-height: 400px;
            overflow-y: auto;
          }
          .email-entry {
            display: grid;
            grid-template-columns: auto 1fr auto auto;
            gap: 8px;
            align-items: center;
            padding: 8px;
            border-bottom: 1px solid #FF6B6B;
          }
          .email-entry img {
            width: 32px;
            height: 32px;
            border: 1px solid #FF6B6B;
            border-radius: 3px;
          }
          .email-info {
            display: flex;
            flex-direction: column;
          }
          .email-name {
            color: #FF6B6B;
            font-weight: bold;
          }
          .email-address {
            color: #19f3f7;
            font-size: 0.9em;
          }
          .action-buttons {
            display: flex;
            gap: 4px;
          }
        </style>
        <div class="email-directory">
          <!-- Character Actors -->
          ${actors.map(actor => {
            if (!actor.id) return '';
            const email = actor.getFlag(MODULE_ID, "emailAddress");
            return email ? `
              <div class="email-entry">
                <img src="${actor.img}" alt="${actor.name}">
                <div class="email-info">
                  <div class="email-name">${actor.name}</div>
                  <div class="email-address">${email}</div>
                </div>
                <div class="action-buttons">
                  <button type="button" class="cyber-button small send-to" data-email="${email}">
                    <i class="fas fa-paper-plane"></i>
                  </button>
                  <button type="button" class="cyber-button small edit-email" data-actor-id="${actor.id}">
                    <i class="fas fa-edit"></i>
                  </button>
                </div>
              </div>
            ` : '';
          }).join('')}
          
          <!-- Custom Contacts -->
          ${contacts.map(contact => {
            // Skip if this is an actor contact
            const isActorContact = actors.some(a => a.id && a.getFlag(MODULE_ID, "emailAddress") === contact.email);
            if (isActorContact) return '';
            
            return `
              <div class="email-entry">
                <div style="width: 32px; height: 32px; background: #1a1a1a; border: 1px solid #FF6B6B; border-radius: 3px; display: flex; align-items: center; justify-content: center;">
                  <i class="fas fa-user" style="color: #FF6B6B;"></i>
                </div>
                <div class="email-info">
                  <div class="email-name">${contact.name}</div>
                  <div class="email-address">${contact.email}</div>
                </div>
                <div class="action-buttons">
                  <button type="button" class="cyber-button small send-to" data-email="${contact.email}">
                    <i class="fas fa-paper-plane"></i>
                  </button>
                  <button type="button" class="cyber-button small remove-contact" data-email="${contact.email}">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      
      // Create dialog
      const dialog = new Dialog({
        title: "Email Directory",
        content: content,
        buttons: {
          add: {
            label: "Add Contact",
            callback: () => this._showQuickAddEmailDialog()
          },
          close: {
            label: "Close"
          }
        },
        render: html => {
          // Send to button
          html.find('.send-to').on('click', ev => {
            const email = ev.currentTarget.dataset.email;
            this._updateRecipientFromEmail(email);
            dialog.close();
          });
          
          // Edit actor email
          html.find('.edit-email').on('click', async ev => {
            const actorId = ev.currentTarget.dataset.actorId;
            await this._editActorEmail(actorId);
            dialog.render(true);
          });
          
          // Remove contact
          html.find('.remove-contact').on('click', async ev => {
            const email = ev.currentTarget.dataset.email;
            await this._removeContact(email);
            dialog.render(true);
          });
        }
      });
      
      dialog.render(true);
    }
    
    /**
     * Show the contacts dialog for players
     * @private
     */
    async _showContactsDialog() {
      // Get all character actors
      const actors = game.actors.filter(a => a.type === "character");
      
      // Load contacts
      const contacts = await game.user.getFlag(MODULE_ID, "contacts") || [];
      
      // Filter out duplicate contacts
      const uniqueContacts = contacts.filter((contact, index) => {
        return contacts.findIndex(c => c.email === contact.email) === index;
      });
      
      // Create dialog content
      const content = `
        <style>
          .contacts-list {
            max-height: 400px;
            overflow-y: auto;
          }
          .contact-entry {
            display: grid;
            grid-template-columns: auto 1fr auto;
            gap: 10px;
            align-items: center;
            padding: 8px;
            border-bottom: 1px solid #FF6B6B;
          }
          .contact-info {
            display: flex;
            flex-direction: column;
          }
          .contact-name {
            color: #FF6B6B;
            font-weight: bold;
          }
          .contact-email {
            color: #19f3f7;
            font-size: 0.9em;
          }
          .contact-actions {
            display: flex;
            gap: 4px;
          }
        </style>
        <div class="contacts-list">
          <!-- Actor Contacts -->
          ${actors.map(actor => {
            if (!actor.id) return '';
            const email = actor.getFlag(MODULE_ID, "emailAddress");
            return email ? `
              <div class="contact-entry">
                <img src="${actor.img}" style="width: 32px; height: 32px; border: 1px solid #FF6B6B; border-radius: 3px;">
                <div class="contact-info">
                  <div class="contact-name">${actor.name}</div>
                  <div class="contact-email">${email}</div>
                </div>
                <div class="contact-actions">
                  <button type="button" class="cyber-button small select-contact" data-email="${email}">
                    <i class="fas fa-paper-plane"></i>
                  </button>
                </div>
              </div>
            ` : '';
          }).join('')}
          
          <!-- Custom Contacts -->
          ${uniqueContacts.map(contact => {
            // Skip if this is an actor contact
            const isActorContact = actors.some(a => a.id && a.getFlag(MODULE_ID, "emailAddress") === contact.email);
            if (isActorContact) return '';
            
            return `
              <div class="contact-entry">
                <div style="width: 32px; height: 32px; background: #1a1a1a; border: 1px solid #FF6B6B; border-radius: 3px; display: flex; align-items: center; justify-content: center;">
                  <i class="fas fa-user" style="color: #FF6B6B;"></i>
                </div>
                <div class="contact-info">
                  <div class="contact-name">${contact.name}</div>
                  <div class="contact-email">${contact.email}</div>
                </div>
                <div class="contact-actions">
                  <button type="button" class="cyber-button small select-contact" data-email="${contact.email}">
                    <i class="fas fa-paper-plane"></i>
                  </button>
                  <button type="button" class="cyber-button small remove-contact" data-email="${contact.email}">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      
      // Create dialog
      const dialog = new Dialog({
        title: "Your Contacts",
        content: content,
        buttons: {
          add: {
            label: "Add Contact",
            callback: () => this._showQuickAddEmailDialog()
          },
          close: {
            label: "Close"
          }
        },
        render: html => {
          // Select contact
          html.find('.select-contact').on('click', ev => {
            const email = ev.currentTarget.dataset.email;
            this._updateRecipientFromEmail(email);
            dialog.close();
          });
          
          // Remove contact
          html.find('.remove-contact').on('click', async ev => {
            const email = ev.currentTarget.dataset.email;
            await this._removeContact(email);
            dialog.render(true);
          });
        }
      });
      
      dialog.render(true);
      
      // Save cleaned up contacts if needed
      if (contacts.length !== uniqueContacts.length) {
        await game.user.setFlag(MODULE_ID, "contacts", uniqueContacts);
      }
    }
    
    /**
     * Show dialog to add a new contact
     * @private
     */
    _showQuickAddEmailDialog() {
      const content = `
        <form>
          <div class="form-group">
            <label>Contact Name:</label>
            <input type="text"
                  name="name"
                  placeholder="Enter contact name"
                  autocomplete="off"/>
          </div>
          <div class="form-group">
            <label>Email Address:</label>
            <input type="text"
                  name="email"
                  placeholder="name@nightcity.net"
                  autocomplete="off"/>
          </div>
        </form>
      `;
      
      new Dialog({
        title: "Add New Contact",
        content: content,
        buttons: {
          add: {
            label: "Add Contact",
            callback: async html => {
              const name = html.find('[name="name"]').val();
              const email = html.find('[name="email"]').val();
              if (name && email) {
                await this.addContact(name, email);
                ui.notifications.info(`Contact ${name} added successfully`);
              }
            }
          },
          cancel: {
            label: "Cancel"
          }
        },
        default: "add"
      }).render(true);
    }
    
    /**
     * Update an actor's email address
     * @param {string} actorId - Actor ID
     * @param {string} email - Email address
     * @returns {Promise<void>}
     * @private
     */
    async _updateActorEmail(actorId, email) {
      const actor = game.actors.get(actorId);
      if (!actor || !actor.id) return;
      
      await actor.setFlag(MODULE_ID, "emailAddress", email);
      
      // If this is the player's character, update their user flag too
      if (game.user.character?.id === actorId) {
        await game.user.setFlag(MODULE_ID, "emailAddress", email);
      }
    }
    
    /**
     * Edit an actor's email address
     * @param {string} actorId - Actor ID
     * @returns {Promise<void>}
     * @private
     */
    async _editActorEmail(actorId) {
      const actor = game.actors.get(actorId);
      if (!actor || !actor.id) return;
      
      const currentEmail = actor.getFlag(MODULE_ID, "emailAddress") || "";
      
      const content = `
        <form>
          <div class="form-group">
            <label>Email Address for ${actor.name}:</label>
            <input type="text"
                  name="email"
                  placeholder="name@nightcity.net"
                  value="${currentEmail}"
                  autocomplete="off"/>
          </div>
        </form>
      `;
      
      new Dialog({
        title: "Edit Email Address",
        content: content,
        buttons: {
          save: {
            label: "Save",
            callback: async html => {
              const email = html.find('[name="email"]').val();
              await this._updateActorEmail(actorId, email);
              ui.notifications.info(`Email updated for ${actor.name}`);
            }
          },
          cancel: {
            label: "Cancel"
          }
        },
        default: "save"
      }).render(true);
    }
    
    /**
     * Remove a contact
     * @param {string} email - Email address
     * @returns {Promise<boolean>} Success flag
     */
    async _removeContact(email) {
      try {
        // Use the global contact manager if available
        if (game.nightcity?.contactManager) {
          const success = await game.nightcity.contactManager.remove(email);
          
          // Reload contacts
          this.contacts = await game.nightcity.contactManager.getAll();
          
          // Update UI
          const selectElement = this.element.find('#recipient-select');
          selectElement.find(`option[value="${email}"]`).remove();
          
          return success;
        }
        
        // Fallback to legacy method
        const initialLength = this.contacts.length;
        this.contacts = this.contacts.filter(c => c.email !== email);
        
        // Only update if something changed
        if (initialLength !== this.contacts.length) {
          await game.user.setFlag(MODULE_ID, "contacts", this.contacts);
          
          // Update UI
          const selectElement = this.element.find('#recipient-select');
          selectElement.find(`option[value="${email}"]`).remove();
          
          return true;
        }
        
        return false;
      } catch (error) {
        console.error(`${MODULE_ID} | Error removing contact:`, error);
        return false;
      }
    }
    
    /**
     * Prompt for a contact name
     * @param {string} email - Email address
     * @returns {Promise<string|null>} Contact name or null if cancelled
     */
    async _promptContactName(email) {
      return new Promise(resolve => {
        new Dialog({
          title: "Add Contact",
          content: `
            <div class="form-group">
              <label>Contact Name:</label>
              <input type="text"
                    name="name"
                    placeholder="Enter contact name"
                    autocomplete="off"/>
            </div>
          `,
          buttons: {
            save: {
              label: "Save",
              callback: html => resolve(html.find('[name="name"]').val())
            },
            cancel: {
              label: "Cancel",
              callback: () => resolve(null)
            }
          },
          default: "save"
        }).render(true);
      });
    }
    
    /**
     * Close the application
     */
    close(options = {}) {
      if (this.editors.content) {
        if (typeof this.editors.content.destroy === 'function') {
          this.editors.content.destroy();
        }
        delete this.editors.content;
      }
      
      if (getSetting('enableSounds')) {
        try {
          AUDIO.close.play().catch(e => console.warn("Audio play failed:", e));
        } catch (e) {
          console.warn("Could not play audio:", e);
        }
      }
      
      return super.close(options);
    }
  }