# Frop

**File Drop for the web** - A real-time file sharing webapp that works like AirDrop, but universal across any device with a browser.

Share files instantly: one person creates a room, the other joins with a 6-character code. No accounts, no file storage - files stream directly between browsers through the server.

**🚀 Live at:** [frop.mmynk.com](https://frop.mmynk.com)

## Current Status

✅ **v1 Complete** - File transfer working!

**What works:**
- Create/join rooms with 6-character codes
- Persistent sessions (bookmark the URL to rejoin)
- Auto-reconnect on page refresh
- File transfer (drag-drop, streaming, real-time progress)
- Folder support with preserved directory structure
- Cancel transfers mid-stream
- Clipboard sharing between peers (Ctrl+V or button)

## Tech Stack

- **Frontend:** TypeScript (no framework), vanilla JS
- **Backend:** Go with WebSockets
- **Build:** esbuild for frontend bundling

## Quick Start

**Prerequisites:** Go 1.21+, Docker (optional)

### Using Makefile (recommended)

```bash
make run          # Run server locally (no Docker)
make dev          # Build container + run
make test         # Run backend tests
make frontend     # Build frontend only
```

### Manual

```bash
cd backend
go run cmd/server/main.go
```

Open `http://localhost:8080` in your browser.

### Build frontend (optional)

The repo includes a built frontend. To rebuild:

```bash
cd frontend
bun install        # First time only
bun run build      # Build once
```

## How to Use

1. **Person A:** Open the app → click "Create Room" → share the 6-character code
2. **Person B:** Open the app → enter the code → click "Join"
3. **Both:** Once connected, your browser URL updates with a session token you can bookmark
4. **Send files:** Drag files/folders onto the page, or click "Select Files" → they stream to your peer in real-time!
5. **Send clipboard:** Click "📋 Clipboard" or press Ctrl+V → your clipboard text appears on your peer's screen

## API (for developers)

If you want to integrate or build on top of Frop:

**REST:**
- `POST /api/room` → Returns `{"code":"ABC123"}`
- `GET /api/room/:code` → Returns `{"exists": true, "peerCount": 1, "isFull": false}`

**WebSocket (`/ws`):**
```json
// Join with code
{"type": "join", "code": "ABC123"}

// Server response
{"type": "connected", "sessionToken": "uuid"}

// File transfer
{"type": "file_start", "name": "photo.jpg", "size": 1024000}
[binary frames with file data]
{"type": "file_end", "name": "photo.jpg"}

// Clipboard sharing
{"type": "clipboard", "content": "Hello from the other side!"}
```

See `/backend/models/` for full protocol.

## Contributing

See [AGENTS.md](./AGENTS.md) for development approach and [PROGRESS.md](./docs/PROGRESS.md) for current status.
