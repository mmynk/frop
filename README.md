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

## Tech Stack

- **Frontend:** TypeScript (no framework), vanilla JS
- **Backend:** Go with WebSockets
- **Build:** esbuild for frontend bundling

## Quick Start

**Prerequisites:** Go 1.21+

### Run the server

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
4. **Send files:** Drag files/folders onto the page, or click "Send Files" → they stream to your peer in real-time!

## API (for developers)

If you want to integrate or build on top of Frop:

**REST:**
- `POST /api/room` → Returns `{"code":"ABC123"}`

**WebSocket (`/ws`):**
```json
// Join with code
{"type": "join", "code": "ABC123"}

// Server response
{"type": "connected", "sessionToken": "uuid"}
```

See `/backend/models/` for full protocol.

## Contributing

See [AGENTS.md](./AGENTS.md) for development approach and [PROGRESS.md](./docs/PROGRESS.md) for current status.
