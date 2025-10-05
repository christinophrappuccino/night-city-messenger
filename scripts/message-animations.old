/**
 * Message Animations for Night City Messenger
 * Adds sci-fi style animations for sending and receiving messages
 */
import { MODULE_ID, AUDIO } from './constants.js';
import { getSetting } from './settings.js';

/**
 * Generate a random message ID
 * @returns {string} Random message ID
 */
function generateMessageId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return `MSG-${id}`;
}

/**
 * Get current time formatted for notifications
 * @returns {string} Formatted time
 */
function getCurrentTime() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
  
  return `${formattedHours}:${formattedMinutes} ${ampm}`;
}

/**
 * Show animated sending confirmation
 * @param {Object} options - Configuration options
 * @param {string} options.recipient - Recipient name
 * @param {Function} options.onComplete - Callback when animation completes
 */
export function showSendingAnimation(options = {}) {
  // Remove any existing animations
  $('#cyberpunk-sending-overlay').remove();
  
  // Create overlay
  const overlay = $(`
    <div id="cyberpunk-sending-overlay">
      <div class="sending-container">
        <div class="sending-header">
          <div class="sending-icon">
            <i class="fas fa-satellite-dish"></i>
          </div>
          <div class="sending-title">TRANSMITTING</div>
          <div class="sending-status">
            <span class="status-text">SENDING</span>
            <span class="status-dots"><span>.</span><span>.</span><span>.</span></span>
          </div>
        </div>
        
        <div class="sending-content">
          <div class="recipient-info">
            <div class="recipient-label">RECIPIENT:</div>
            <div class="recipient-name">${options.recipient || 'Unknown'}</div>
          </div>
          
          <div class="status-display">
            <div class="status-phases">
              <div class="phase phase-1 active">
                <i class="fas fa-satellite"></i>
                <span>CONNECTING</span>
              </div>
              <div class="phase phase-2">
                <i class="fas fa-exchange-alt"></i>
                <span>TRANSMITTING</span>
              </div>
              <div class="phase phase-3">
                <i class="fas fa-check-circle"></i>
                <span>DELIVERED</span>
              </div>
            </div>
            
            <div class="progress-bar">
              <div class="progress-track">
                <div class="progress-fill"></div>
              </div>
              <div class="progress-text">0%</div>
            </div>
          </div>
        </div>
        
        <div class="sending-footer">
          <div class="encryption-info">ENCRYPTION: AES-256</div>
          <div class="message-id">ID: ${generateMessageId()}</div>
        </div>
      </div>
    </div>
  `);
  
  // Add styles if not already present
  if (!$('#cyberpunk-sending-styles').length) {
    const styles = $(`
      <style id="cyberpunk-sending-styles">
        #cyberpunk-sending-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          z-index: 100000;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Rajdhani', sans-serif;
          animation: fadeIn 0.3s ease-out;
        }
        
        .sending-container {
          width: 400px;
          background: #1a1a1a;
          border: 1px solid #F65261;
          color: #F65261;
          border-radius: 4px;
          overflow: hidden;
          box-shadow: 0 0 20px rgba(246, 82, 97, 0.5), 0 0 40px rgba(0, 0, 0, 0.6);
        }
        
        .sending-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 15px;
          border-bottom: 1px solid rgba(246, 82, 97, 0.3);
          position: relative;
        }
        
        .sending-header::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, #F65261, #19f3f7);
        }
        
        .sending-icon {
          color: #F65261;
          font-size: 1.2em;
          animation: pulse 1.5s infinite;
        }
        
        .sending-title {
          color: #F65261;
          font-weight: bold;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        
        .sending-status {
          display: flex;
          align-items: center;
          gap: 5px;
          color: #19f3f7;
          font-size: 0.9em;
        }
        
        .status-dots span {
          opacity: 0;
          animation: dotFade 1.5s infinite;
        }
        
        .status-dots span:nth-child(2) {
          animation-delay: 0.5s;
        }
        
        .status-dots span:nth-child(3) {
          animation-delay: 1s;
        }
        
        .sending-content {
          padding: 20px;
        }
        
        .recipient-info {
          display: flex;
          gap: 10px;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(246, 82, 97, 0.3);
        }
        
        .recipient-label {
          color: #F65261;
          font-weight: bold;
          font-size: 0.9em;
        }
        
        .recipient-name {
          color: #fff;
          font-weight: bold;
        }
        
        .status-phases {
          display: flex;
          justify-content: space-between;
          margin-bottom: 15px;
        }
        
        .phase {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          color: rgba(246, 82, 97, 0.5);
          font-size: 0.8em;
          position: relative;
          width: 100px;
          text-align: center;
        }
        
        .phase.active, .phase.completed {
          color: #F65261;
        }
        
        .phase i {
          font-size: 1.5em;
        }
        
        .phase.active i {
          animation: pulse 1.5s infinite;
        }
        
        .phase.completed i {
          color: #19f3f7;
        }
        
        .progress-bar {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .progress-track {
          flex: 1;
          height: 10px;
          background: rgba(246, 82, 97, 0.2);
          border-radius: 5px;
          overflow: hidden;
          border: 1px solid rgba(246, 82, 97, 0.3);
        }
        
        .progress-fill {
          height: 100%;
          width: 0%;
          background: linear-gradient(90deg, #F65261, #19f3f7);
          border-radius: 5px;
          transition: width 0.1s linear;
        }
        
        .progress-text {
          min-width: 40px;
          color: #F65261;
          font-size: 0.9em;
          text-align: right;
        }
        
        .sending-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 15px;
          border-top: 1px solid rgba(246, 82, 97, 0.3);
          font-size: 0.8em;
          color: rgba(246, 82, 97, 0.8);
        }
        
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
        
        @keyframes dotFade {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        
        /* Notification animation for received messages */
        .cyberpunk-message-received {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #1a1a1a;
          border: 1px solid #19f3f7;
          padding: 0;
          z-index: 1000;
          animation: slideIn 0.5s ease-out;
          width: 350px;
          box-shadow: 0 0 20px rgba(25, 243, 247, 0.3), 0 5px 10px rgba(0, 0, 0, 0.6);
          overflow: hidden;
          cursor: pointer;
          font-family: 'Rajdhani', sans-serif;
        }
        
        .notification-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: rgba(25, 243, 247, 0.1);
          position: relative;
        }
        
        .notification-header::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, #19f3f7, #F65261, #19f3f7);
          background-size: 200% 100%;
          animation: moveGradient 2s linear infinite;
        }
        
        .notification-icon {
          color: #19f3f7;
          font-size: 1.2em;
          animation: pulse 1.5s infinite;
        }
        
        .notification-title {
          color: #19f3f7;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        
        .notification-status {
          color: #F65261;
          font-size: 0.8em;
          background: rgba(246, 82, 97, 0.1);
          padding: 2px 5px;
          border-radius: 3px;
          border: 1px solid rgba(246, 82, 97, 0.3);
        }
        
        .notification-content {
          padding: 12px;
        }
        
        .notification-from {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        
        .notification-from-label {
          color: #19f3f7;
          font-weight: bold;
          font-size: 0.9em;
        }
        
        .notification-from-name {
          color: #fff;
          font-weight: bold;
        }
        
        .notification-subject {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        
        .notification-subject-label {
          color: #19f3f7;
          font-weight: bold;
          font-size: 0.9em;
        }
        
        .notification-subject-text {
          color: #fff;
        }
        
        .notification-preview {
          padding: 8px;
          background: rgba(25, 243, 247, 0.05);
          border-left: 2px solid #19f3f7;
          margin-top: 8px;
          font-style: italic;
          color: rgba(255, 255, 255, 0.7);
          font-size: 0.9em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .notification-footer {
          display: flex;
          justify-content: space-between;
          padding: 8px 12px;
          border-top: 1px solid rgba(25, 243, 247, 0.2);
          font-size: 0.8em;
          color: rgba(25, 243, 247, 0.7);
        }
        
        @keyframes moveGradient {
          0% { background-position: 100% 0; }
          100% { background-position: 0 0; }
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
    `);
    
    $('head').append(styles);
  }
  
  // Add to DOM
  $('body').append(overlay);
  
  // Play transmission sound
  if (getSetting('enableSounds')) {
    try {
      // Use the transmission sound from constants
      if (AUDIO && AUDIO.transmission) {
        AUDIO.transmission.volume = 0.6;
        AUDIO.transmission.play().catch(e => console.warn("Audio play failed:", e));
      } else {
        // Fallback if constant not available
        const audio = new Audio('modules/cyberpunkred-messenger/sounds/transmission.mp3');
        audio.volume = 0.6;
        audio.play().catch(e => console.warn("Audio play failed:", e));
      }
    } catch (e) {
      console.warn("Could not play transmission audio:", e);
    }
  }
  
  // Start animation sequence
  let progress = 0;
  let currentPhase = 1;
  const phases = [
    { start: 0, end: 30 },
    { start: 31, end: 90 },
    { start: 91, end: 100 }
  ];
  
  // Update progress at random intervals
  const interval = setInterval(() => {
    // Skip ahead a random amount
    progress += Math.floor(Math.random() * 5) + 1;
    
    if (progress > 100) progress = 100;
    
    // Update progress bar
    overlay.find('.progress-fill').css('width', `${progress}%`);
    overlay.find('.progress-text').text(`${progress}%`);
    
    // Update phase
    updatePhase();
    
    // When complete, clean up and call onComplete
    if (progress === 100) {
      clearInterval(interval);
      
      // Update status text
      overlay.find('.status-text').text('DELIVERED');
      
      // Play message sent sound
      if (getSetting('enableSounds')) {
        try {
          // Use the message sent sound from constants
          if (AUDIO && AUDIO.messageSent) {
            AUDIO.messageSent.volume = 0.7;
            AUDIO.messageSent.play().catch(e => console.warn("Audio play failed:", e));
          } else {
            // Fallback if constant not available
            const audio = new Audio('modules/cyberpunkred-messenger/sounds/message-sent.mp3');
            audio.volume = 0.7;
            audio.play().catch(e => console.warn("Audio play failed:", e));
          }
        } catch (e) {
          console.warn("Could not play message sent audio:", e);
        }
      }
      
      // Wait a bit, then fade out
      setTimeout(() => {
        overlay.css('animation', 'fadeOut 0.5s forwards');
        
        setTimeout(() => {
          overlay.remove();
          if (typeof options.onComplete === 'function') {
            options.onComplete();
          }
        }, 500);
      }, 800);
    }
  }, 100);
  
  // Update the active phase based on progress
  function updatePhase() {
    let newPhase = 1;
    
    for (let i = 0; i < phases.length; i++) {
      if (progress >= phases[i].start && progress <= phases[i].end) {
        newPhase = i + 1;
      }
    }
    
    if (newPhase !== currentPhase) {
      // Mark previous phases as completed
      for (let i = 1; i < newPhase; i++) {
        overlay.find(`.phase-${i}`).removeClass('active').addClass('completed');
      }
      
      // Set current phase as active
      overlay.find(`.phase-${newPhase}`).addClass('active');
      
      // Update status text based on phase
      const statusTexts = ['CONNECTING', 'TRANSMITTING', 'DELIVERED'];
      overlay.find('.status-text').text(statusTexts[newPhase - 1]);
      
      currentPhase = newPhase;
    }
  }
}

/**
 * Show animated message received notification
 * @param {Object} options - Configuration options
 * @param {string} options.from - Sender name
 * @param {string} options.subject - Message subject
 * @param {string} options.preview - Message preview text
 * @param {Function} options.onClick - Callback when notification is clicked
 */
export function showMessageReceivedNotification(options = {}) {
  // Remove any existing notifications
  $('.cyberpunk-message-received').remove();
  
  // Create notification
  const notification = $(`
    <div class="cyberpunk-message-received">
      <div class="notification-header">
        <div class="notification-icon">
          <i class="fas fa-envelope"></i>
        </div>
        <div class="notification-title">NEW MESSAGE</div>
        <div class="notification-status">UNREAD</div>
      </div>
      
      <div class="notification-content">
        <div class="notification-from">
          <div class="notification-from-label">FROM:</div>
          <div class="notification-from-name">${options.from || 'Unknown Sender'}</div>
        </div>
        
        <div class="notification-subject">
          <div class="notification-subject-label">SUBJECT:</div>
          <div class="notification-subject-text">${options.subject || 'No Subject'}</div>
        </div>
        
        <div class="notification-preview">
          ${options.preview || 'No preview available'}
        </div>
      </div>
      
      <div class="notification-footer">
        <div class="message-time">${getCurrentTime()}</div>
        <div class="message-action">Click to view message</div>
      </div>
    </div>
  `);
  
  // Add to DOM
  $('body').append(notification);
  
  // Play message received sound
  if (getSetting('enableSounds')) {
    try {
      // Use the message received sound from constants
      if (AUDIO && AUDIO.messageReceived) {
        AUDIO.messageReceived.volume = 0.7;
        AUDIO.messageReceived.play().catch(e => console.warn("Audio play failed:", e));
      } else {
        // Fallback if constant not available
        const audio = new Audio('modules/cyberpunkred-messenger/sounds/message-received.mp3');
        audio.volume = 0.7;
        audio.play().catch(e => console.warn("Audio play failed:", e));
      }
    } catch (e) {
      console.warn("Could not play message received audio:", e);
    }
  }
  
  // Add click handler
  notification.on('click', () => {
    // Animate out
    notification.css('animation', 'slideOut 0.3s forwards');
    
    // Call callback after animation
    setTimeout(() => {
      notification.remove();
      if (typeof options.onClick === 'function') {
        options.onClick();
      }
    }, 300);
  });
  
  // Auto dismiss after 8 seconds
  setTimeout(() => {
    notification.css('animation', 'slideOut 0.3s forwards');
    setTimeout(() => notification.remove(), 300);
  }, 8000);
}