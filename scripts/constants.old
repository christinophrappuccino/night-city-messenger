/**
 * Constants for the Night City Messenger module
 */

export const MODULE_ID = 'cyberpunkred-messenger';

// Sound effects
export const SOUNDS = {
  OPEN: "modules/cyberpunkred-messenger/sounds/2077openphone.wav",
  CLICK: "modules/cyberpunkred-messenger/sounds/messageselect.mp3",
  CLOSE: "modules/cyberpunkred-messenger/sounds/2077closephone.wav",
  NOTIFICATION: "modules/cyberpunkred-messenger/sounds/notification.mp3"
};

// Audio instances
export const AUDIO = {
  open: new Audio(SOUNDS.OPEN),
  click: new Audio(SOUNDS.CLICK),
  close: new Audio(SOUNDS.CLOSE),
  notification: new Audio(SOUNDS.NOTIFICATION)
};

// Message metadata field keys
export const MESSAGE_METADATA = {
  DATE: "Date",
  FROM: "From",
  TO: "To",
  SUBJECT: "Subject"
};

// Message status constants
export const MESSAGE_STATUS = {
  READ: "read",
  SAVED: "saved", 
  SPAM: "spam",
  DELETED: "deleted",
  ARCHIVED: "archived"
};

// Message categories
export const MESSAGE_CATEGORIES = {
  INBOX: "inbox",
  SAVED: "saved",
  SPAM: "spam",
  SENT: "sent"
};

// Template paths
export const TEMPLATES = {
  VIEWER: `modules/${MODULE_ID}/templates/viewer.html`,
  COMPOSER: `modules/${MODULE_ID}/templates/composer.html`,
  MESSAGE_LIST_ITEM: `modules/${MODULE_ID}/templates/partials/message-list-item.html`,
  MESSAGE_DETAIL: `modules/${MODULE_ID}/templates/partials/message-detail.html`,
  MESSAGE_SHARED: `modules/${MODULE_ID}/templates/partials/message-shared.html`,
  CONTACT_LIST: `modules/${MODULE_ID}/templates/partials/contact-list.html`
};

// Socket operations
export const SOCKET_OPERATIONS = {
  UPDATE_MESSAGE_STATUS: "updateMessageStatus"
};

// Folder name for message journals
export const MESSAGE_FOLDER_NAME = "Player Messages";

// SPAM message templates
export const SPAM_TEMPLATES = [
  {
    subject: "URGENT: Your Cyberdeck Warranty",
    content: "Your cyberdeck's extended warranty is about to expire! Act now to protect your neural interface investment...",
    sender: "warranty@arasaka-scam.net"
  },
  {
    subject: "Hot Local Cyberware Deals",
    content: "AUTHENTIC Militech implants at 90% off! Direct from our Night City warehouse...",
    sender: "deals@totally-legit-cyber.net"
  },
  {
    subject: "You've Won FREE Eddies!",
    content: "Congratulations! You've been selected to receive 100,000 FREE Eurodollars...",
    sender: "prizes@nightcity-lotto.net"
  },
  {
    subject: "Singles in YOUR ZONE",
    content: "Joytoys in Night City looking to connect with YOU! Verified Dolls available today...",
    sender: "contact@nightcity-connections.net"
  },
  {
    subject: "YOUR ACCOUNT IS LOCKED",
    content: "Your EuroDollar account requires immediate verification. Send 500 eddies to unlock your funds...",
    sender: "security@ncbank-verification.net"
  }
];