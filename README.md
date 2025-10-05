# Night City Messenger

A messaging module for Foundry VTT designed for Cyberpunk RED, with a stylized interface inspired by Cyberpunk 2077.

![Night City Messenger Screenshot](screenshots/messenger-preview.jpg)

## Features

- **In-character Messaging**: Send and receive in-character messages between players and NPCs
- **Cyberpunk UI**: Styled to match the Cyberpunk 2077 aesthetic
- **Message Management**: Store, view, and organize messages in categories (Inbox, Saved, Spam)
- **Contact System**: Save contacts with email addresses for easy messaging
- **Integrated Sound Effects**: Audio feedback for interface interactions
- **Message Actions**: Save, mark as spam, reply, forward, and share messages to chat
- **Search & Filter**: Advanced filtering capabilities including by sender and date
- **SimpleCalendar Integration**: Uses game world time for message timestamps

## Installation

### Method 1: Direct Installation
1. In Foundry VTT, navigate to "Add-on Modules"
2. Click "Install Module"
3. Paste the following URL in the "Manifest URL" field:
```
https://github.com/yourusername/cyberpunkred-messenger/releases/latest/download/module.json
```
4. Click "Install"

### Method 2: Manual Installation
1. Download the [latest release](https://github.com/yourusername/cyberpunkred-messenger/releases)
2. Extract the archive into your Foundry VTT modules directory
3. Restart Foundry VTT
4. Enable the module in your game world

## Requirements

- Foundry VTT v11.0+
- Simple Calendar module

## Usage

### Accessing Messages

1. **As a Player**: Use the "Night City Messages" macro or click on the messages icon in the player toolbar
2. **As a GM**: You can view and manage messages for all characters

### Sending Messages

1. Click the "Compose" button in the message viewer or use the "Compose Message" macro
2. Fill in the recipient, subject, and message content
3. Click "Send"

### Message Actions

- **Save/Unsave**: Mark important messages for later reference
- **Share**: Share a message to the group chat
- **Spam/Unspam**: Mark or unmark a message as spam
- **Reply**: Quickly compose a response to the sender
- **Forward**: Forward the message to a different recipient
- **Export**: Export the message as a journal entry or data shard

## Configuration

Several module settings can be adjusted in the module settings menu:

- **Default Email Domain**: Set the default domain used when generating email addresses
- **Enable Sound Effects**: Toggle sound effects on/off
- **Messages Per Page**: Adjust how many messages are displayed per page
- **Enable Spam Generation**: Periodically generate spam messages for immersion
- **Spam Frequency**: Control how often spam messages are generated

## Macros

The module provides two global API functions that can be used in macros:

```js
// Open the message viewer
game.nightcity.messenger.openViewer();

// Open the message composer
game.nightcity.messenger.openComposer();

// Send a message programmatically
game.nightcity.messenger.sendMessage({
  to: "Character Name (email@nightcity.net)",
  from: "Sender Name (sender@nightcity.net)",
  subject: "Message Subject",
  content: "Message content here"
});
```

## Permissions

- Players can only access their character's messages
- GMs can access all characters' messages
- Messages are stored in character-specific journals
- Permissions are automatically handled for player access

## Credits

Developed by Christian Phanthasy

Sound effects:
- Open/Close sounds from Cyberpunk 2077
- Message select sound from Cyberpunk 2077

## License

This module is licensed under the MIT License - see the LICENSE file for details.

## Support

If you encounter any issues or have suggestions, please [open an issue](https://github.com/yourusername/cyberpunkred-messenger/issues) on GitHub.