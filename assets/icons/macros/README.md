# NCM macro icons

One SVG per shipped macro. **Replace any file with your own art using the
exact same filename.** Your file is never overwritten — `dev/tools/gen-macros.cjs`
only writes a neon placeholder when a file is missing. Replacing a file in
place takes effect immediately (no regen, no reinstall) because the macro
points at this fixed path.

Keep the `.svg` extension (the path is baked into the macro documents). To
switch to PNG/WebP instead, change `ICON_WEB_BASE`/extension in
`dev/tools/gen-macros.cjs`, rerun it, then reinstall via Admin → Tools.

| File | Macro | Pack |
|---|---|---|
| `player-open-messenger.svg` | Open My Messenger | Player |
| `player-compose.svg` | Compose Message | Player |
| `player-contacts.svg` | My Contacts | Player |
| `player-check-unread.svg` | Check Unread | Player |
| `player-hack-shard.svg` | Hack Selected Shard | Player |
| `player-present-key.svg` | Present Key Item | Player |
| `gm-send-message.svg` | Send NPC Message | GM |
| `gm-schedule-message.svg` | Schedule Message | GM |
| `gm-convert-shard.svg` | Convert Selected Item To Shard | GM |
| `gm-force-decrypt.svg` | Force-Decrypt Selected Shard | GM |
| `gm-relock-shard.svg` | Relock Selected Shard | GM |
| `gm-damage-shard.svg` | Damage Selected Shard | GM |
| `gm-add-shard-message.svg` | Add Message To Selected Shard | GM |
| `gm-push-contact.svg` | Push Contact To Player | GM |
| `gm-add-master-contact.svg` | Add Master Contact | GM |
| `gm-set-network.svg` | Set Active Network | GM |
| `gm-toggle-deadzone.svg` | Toggle Dead Zone (This Scene) | GM |
| `gm-open-admin.svg` | Open Admin Panel | GM |
| `gm-open-network-mgmt.svg` | Open Network Management | GM |
| `gm-open-gm-contacts.svg` | Open GM Contacts | GM |
