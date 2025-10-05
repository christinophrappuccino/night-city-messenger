/**
 * Utility functions for the Night City Messenger module
 * Refactored and streamlined to eliminate redundancies
 */
import { MODULE_ID, AUDIO } from './constants.js';
import { getSetting } from './settings.js';

/**
 * Clean HTML content by removing metadata tags and empty paragraphs
 * CONSOLIDATED: All content extraction logic in one place
 * @param {string} content - The raw message content
 * @returns {string} Cleaned content
 */
export function cleanHtmlContent(content) {
  if (!content) return '<p>No content available</p>';
  
  try {
    // Convert to string if needed
    const contentStr = String(content);
    
    // Check if this is our new formatted content with hidden metadata
    if (contentStr.includes('journal-email-display')) {
      // Create a temporary DOM element to parse the HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = contentStr;
      
      // Find the inner content div that contains just the message content
      const contentDiv = tempDiv.querySelector('div[style*="padding:15px"]');
      
      if (contentDiv) {
        return contentDiv.innerHTML; // Return just the inner HTML
      }
    }
    
    // Fall back to the original method if needed
    const lastEndIndex = contentStr.lastIndexOf('[End]');
    if (lastEndIndex !== -1) {
      return contentStr.substring(lastEndIndex + 5).trim();
    }
    
    return contentStr;
  } catch (error) {
    console.error(`${MODULE_ID} | Error cleaning HTML content:`, error);
    return '<p>Error processing message content</p>';
  }
}

/**
 * Extract metadata from message content
 * @param {string} content - Message content
 * @returns {Object} Extracted metadata
 */
export function extractMessageMetadata(content) {
  if (!content) {
    return {
      date: "Unknown Date",
      from: "Unknown Sender",
      to: "Unknown Recipient",
      subject: "No Subject",
      content: "No content available"
    };
  }
  
  try {
    // Convert to string if not already
    const contentStr = String(content);
    
    // Extract each metadata field with fallbacks
    const dateMatch = contentStr.match(/\[Date\](.*?)\[End\]/s);
    const fromMatch = contentStr.match(/\[From\](.*?)\[End\]/s);
    const toMatch = contentStr.match(/\[To\](.*?)\[End\]/s);
    const subjectMatch = contentStr.match(/\[Subject\](.*?)\[End\]/s);
    
    // Get the actual content by removing metadata
    let messageContent = contentStr
      .replace(/\[Date\].*?\[End\]/gs, "")
      .replace(/\[From\].*?\[End\]/gs, "")
      .replace(/\[To\].*?\[End\]/gs, "")
      .replace(/\[Subject\].*?\[End\]/gs, "");
    
    // Clean the content
    messageContent = messageContent.trim() || "No content available";
    
    return {
      date: dateMatch ? dateMatch[1].trim() : "Unknown Date",
      from: fromMatch ? fromMatch[1].trim() : "Unknown Sender",
      to: toMatch ? toMatch[1].trim() : "Unknown Recipient",
      subject: subjectMatch ? subjectMatch[1].trim() : "No Subject",
      content: messageContent
    };
  } catch (error) {
    console.error(`${MODULE_ID} | Error extracting message metadata:`, error);
    return {
      date: "Unknown Date",
      from: "Unknown Sender",
      to: "Unknown Recipient",
      subject: "Error",
      content: "Error processing message content"
    };
  }
}

/**
 * Extract the sender name from the from field (removing email part)
 * @param {string} fromRaw - The raw From field content
 * @returns {string} Cleaned sender name
 */
export function extractSenderName(fromRaw) {
  if (!fromRaw) return "Unknown Sender";
  
  try {
    // First remove email part in parentheses
    let senderName = fromRaw.replace(/\s*\([^)]+\)/, "").trim();
    
    // Handle quoted names and ensure proper spacing
    senderName = senderName.replace(/"([^"]+)"/g, function(match, group) {
      return `"${group}" `;
    }).trim();
    
    return senderName || "Unknown Sender";
  } catch (error) {
    console.error(`${MODULE_ID} | Error extracting sender name:`, error);
    return fromRaw || "Unknown Sender"; 
  }
}

/**
 * Extract email address from the parentheses in the sender field
 * @param {string} fromRaw - The raw From field content
 * @returns {string} Email address or empty string if not found
 */
export function extractEmailAddress(fromRaw) {
  if (!fromRaw) return "";
  
  try {
    const emailMatch = fromRaw.match(/\((.*?)\)/);
    return emailMatch ? emailMatch[1].trim() : "";
  } catch (error) {
    console.error(`${MODULE_ID} | Error extracting email address:`, error);
    return "";
  }
}

/**
 * Format a message with proper metadata tags
 * @param {Object} data - Message data
 * @returns {string} Formatted message content
 */
export function formatMessage(data) {
  // Store the metadata tags in a hidden div (won't be visible in the journal)
  const hiddenMetadata = `<div style="display: none;">
[Date] ${data.date} [End]
[From] ${data.from} [End]
[To] ${data.to} [End]
[Subject] ${data.subject} [End]
</div>`;

  // Create a visually appealing email display for journals only
  const emailDisplay = `<div class="journal-email-display" style="border: 1px solid #F65261; border-radius: 4px; overflow: hidden; background-color: #1a1a1a; margin-bottom: 10px; font-family: 'Rajdhani', sans-serif;">
  <div style="background-color: #330000; padding: 10px; border-bottom: 1px solid #F65261;">
    <div style="font-size: 16px; font-weight: bold; color: #F65261; margin-bottom: 8px;">${data.subject}</div>
    <div style="color: #ffffff; opacity: 0.9; font-size: 14px;">
      <div><span style="color: #F65261; font-weight: bold;">From:</span> ${data.from}</div>
      <div><span style="color: #F65261; font-weight: bold;">To:</span> ${data.to}</div>
      <div><span style="color: #F65261; font-weight: bold;">Date:</span> ${data.date}</div>
    </div>
  </div>
  <div style="padding: 15px; color: #ffffff; background-color: #1a1a1a;">
    ${data.content}
  </div>
</div>`;

  // Return both - hidden metadata for app to parse, and visual display for journal
  return hiddenMetadata + emailDisplay;
}

/**
 * Parse a date string in various formats and return a timestamp
 * @param {string} dateStr - Date string to parse
 * @returns {number} Timestamp or 0 if parsing failed
 */
export function parseDateTime(dateStr) {
  if (!dateStr) return 0;
  
  try {
    // Try to handle our standard format MM/DD/YYYY, HH:MM AM/PM
    if (dateStr.includes('/')) {
      const parts = dateStr.split(/[\s,]+/); // Split by whitespace or commas
      const datePart = parts[0]; // The date portion (MM/DD/YYYY)
      
      if (datePart && datePart.includes('/')) {
        const [month, day, year] = datePart.split('/').map(p => parseInt(p.trim(), 10));
        if (month && day && year) {
          const dateObj = new Date(year, month - 1, day);
          
          // If there's a time part like "10:30 AM"
          if (parts.length > 1 && parts[1]?.includes(':')) {
            const timePart = parts[1] + ' ' + (parts[2] || ''); // Include AM/PM part if exists
            const timeMatch = timePart.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
            
            if (timeMatch) {
              let [_, hours, minutes, seconds = '0', period] = timeMatch;
              hours = parseInt(hours, 10);
              minutes = parseInt(minutes, 10);
              seconds = parseInt(seconds, 10);
              
              if (period) {
                if (period.toUpperCase() === 'PM' && hours !== 12) hours += 12;
                if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
              }
              
              dateObj.setHours(hours, minutes, seconds);
            }
          } else {
            // If no time specified, set to noon
            dateObj.setHours(12, 0, 0, 0);
          }
          
          return dateObj.getTime();
        }
      }
    }
    
    // Handle YYYY-MM-DD format from date inputs
    const yyyymmddPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
    const yyyymmddMatches = dateStr.match(yyyymmddPattern);
    
    if (yyyymmddMatches) {
      let [_, year, month, day] = yyyymmddMatches;
      
      // Convert to numbers
      year = parseInt(year, 10);
      month = parseInt(month, 10);
      day = parseInt(day, 10);
      
      const date = new Date(year, month - 1, day, 12, 0, 0); // Set to noon to avoid timezone issues
      return date.getTime();
    }
    
    // Fallback to standard date parsing
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
    
    return 0;
  } catch (error) {
    console.error(`${MODULE_ID} | Error parsing date:`, dateStr, error);
    return 0;
  }
}

/**
 * Get the current date and time, with diagnostic logging
 * @returns {string} Formatted date string
 */
/**
 * Get the current date and time, preferring SimpleCalendar if available
 * @returns {string} Formatted date string
 */
export function getCurrentDateTime() {
  try {
    // Check if SimpleCalendar is available and active
    if (!game.modules.get("foundryvtt-simple-calendar")?.active || !SimpleCalendar?.api) {
      return formatRealDateTime();
    }

    // Since getCurrentDate() doesn't exist, use timestamp directly
    const timestamp = SimpleCalendar.api.timestamp();
    
    // Validate timestamp
    if (typeof timestamp !== "number" || isNaN(timestamp)) {
      return formatRealDateTime();
    }
    
    // Get date from timestamp
    const dateObj = SimpleCalendar.api.timestampToDate(timestamp);
    if (!dateObj || typeof dateObj !== "object") {
      return formatRealDateTime();
    }

    // Extract components and manually add 1 day to fix the discrepancy
    const { year, month, day, hour, minute } = dateObj;
    
    // Create a JS Date to handle incrementing the day properly
    // (handles month/year rollovers correctly)
    const tempDate = new Date(year, month, day + 1, hour, minute);
    
    // Format using our corrected date
    const correctedMonth = tempDate.getMonth();
    const correctedDay = tempDate.getDate();
    const correctedYear = tempDate.getFullYear();
    const correctedHour = tempDate.getHours();
    const correctedMinute = tempDate.getMinutes();
    
    // Format time
    const ampm = correctedHour >= 12 ? "PM" : "AM";
    const formattedHour = correctedHour % 12 === 0 ? 12 : correctedHour % 12;
    const formattedMinute = correctedMinute.toString().padStart(2, "0");
    
    // Return the formatted date with the day correction
    return `${correctedMonth + 1}/${correctedDay}/${correctedYear}, ${formattedHour}:${formattedMinute} ${ampm}`;
  } catch (e) {
    console.error(`${MODULE_ID} | SimpleCalendar API error, falling back to real-world time:`, e);
    return formatRealDateTime();
  }
}

/**
 * Format real world date and time in a consistent format
 * @returns {string} Formatted date string
 */
function formatRealDateTime() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const formattedHour = hours % 12 === 0 ? 12 : hours % 12;
  const formattedMinute = minutes.toString().padStart(2, "0");
  
  return `${month}/${day}/${year}, ${formattedHour}:${formattedMinute} ${ampm}`;
}

/**
 * Create or get message journal for a character
 * @param {string} characterName - Character name
 * @returns {Promise<JournalEntry>} Journal entry
 */
export async function ensureMessageJournal(characterName) {
  const journalName = `${characterName}'s Messages`;
  let journal = game.journal.getName(journalName);
  
  if (!journal) {
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
      name: journalName,
      folder: folder.id
    });
  }
  
  return journal;
}

/**
 * Show notification for new messages
 * @param {string} message - Notification message
 */
export function showNotification(message) {
  if (!message) return;
  
  // Create the notification element if it doesn't exist
  if (!$('#notification-styles').length) {
    $(`
      <style id="notification-styles">
        .cyberpunk-message-notification {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #1a1a1a;
          border: 1px solid #F65261;
          padding: 15px;
          color: #F65261;
          z-index: 1000;
          animation: slideIn 0.3s ease-out;
          display: flex;
          align-items: center;
          gap: 10px;
          border-radius: 4px;
          box-shadow: 0 2px 10px rgba(246, 82, 97, 0.3);
          max-width: 400px;
          cursor: pointer;
        }

        .cyberpunk-message-notification:hover {
          box-shadow: 0 2px 15px rgba(246, 82, 97, 0.5);
        }

        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }

        @keyframes slideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      </style>
    `).appendTo('head');
  }

  // Remove any existing notifications (prevent stacking)
  $('.cyberpunk-message-notification').remove();

  // Create and add the notification
  const notification = $(`
    <div class="cyberpunk-message-notification">
      <i class="fas fa-envelope"></i>
      <span>${message}</span>
    </div>
  `).appendTo('body');

  // Play notification sound
  if (getSetting('enableSounds')) {
    try {
      AUDIO.notification.play().catch(e => console.warn(`${MODULE_ID} | Audio play failed:`, e));
    } catch (e) {
      console.warn(`${MODULE_ID} | Could not play notification sound:`, e);
    }
  }

  // Clicking on the notification opens the messages
  notification.on('click', () => {
    // Use the global NightCityMessenger if available
    if (game.nightcity?.messenger?.openViewer) {
      game.nightcity.messenger.openViewer();
    }
    notification.remove();
  });

  // Remove after 4 seconds
  setTimeout(() => {
    notification.css('animation', 'slideOut 0.3s ease-in forwards');
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 4000);
}

/**
 * Validate if a string is a valid email address
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email
 */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}