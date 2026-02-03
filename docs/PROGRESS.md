# Frop Development Progress

This document tracks implementation progress to help maintain context across sessions.

## Current Status: Milestone 2 Complete ✅ — File Transfer Working!

Last updated: 2026-02-02

---

## Frontend (Claude)

### Completed
- [x] HTML structure with 4 views (landing, waiting, connected, disconnected)
- [x] CSS styling (dark theme, responsive, progress bars)
- [x] TypeScript + esbuild build setup
- [x] Main app logic in `src/main.ts`
- [x] State management (view switching)
- [x] DOM event listeners (buttons, forms)
- [x] WebSocket client connection
- [x] Room creation flow (call POST /api/room, display code)
- [x] Room joining flow (enter code, connect via WebSocket)
- [x] Reconnection handling with session tokens
- [x] URL-based session tokens (`?s=token` for auto-reconnect on page load/refresh)

- [x] File selection (button) and drag-drop handling
- [x] File chunking (256 KB) and sending via WebSocket binary frames
- [x] File receiving with chunk reassembly and auto-download
- [x] Progress bar UI updates during transfer
- [x] Folder selection with relative path preservation
- [x] Send queue for sequential file transfer (prevents interleaving)
- [x] XSS-safe filename rendering

### Not Started
- [ ] Error display improvements

---

## Backend (Human)

### Completed
- [x] Basic HTTP server structure
- [x] Static file serving from frontend/
- [x] Go module setup with gorilla/websocket
- [x] 6-character room code generation (3 letters + 3 digits)
- [x] Room store (in-memory map of active rooms)
- [x] `POST /api/room` endpoint returning `{"code":"ABC123"}`
- [x] Models package for API responses
- [x] Test for code generation
- [x] WebSocket `/ws` endpoint
- [x] WebSocket message parsing (JSON)
- [x] `JoinRoom` - attach peer to existing room
- [x] Send `"connected"` response after join
- [x] Integration tests for full room flow
- [x] Session token generation (UUID)
- [x] Session token storage for peer pairing
- [x] Reconnection flow with session tokens
- [x] Integration tests for session tokens and reconnection

- [x] Binary frame relay between peers (inline forwarding in handler.go)
- [x] `file_start` / `file_end` JSON framing for transfer control
- [x] `GetPeer(conn)` for finding the other peer in a session
- [x] Integration tests for file transfer (single-chunk, multi-chunk, bidirectional, no-session)
- [x] Peer struct extracted to own file with `SendRequest`, `SendResponse`, `SendChunk`

### Not Started
- [ ] `GET /api/room/:code` endpoint
- [ ] Room expiration/cleanup

---

## Milestone Tracker

### Milestone 1: Room Creation & Joining ✅
- [x] Backend: POST /api/room returns code
- [x] Backend: WebSocket accepts "join" message
- [x] Backend: Pairs two peers, sends "connected" with session token
- [x] Backend: Reconnection with session token
- [x] Frontend: Create room button calls API, shows code
- [x] Frontend: Join room connects via WebSocket
- [x] Frontend: View switches to "connected" state
- [x] Frontend: Reconnection handling

### Milestone 2: Basic File Transfer ✅
- [x] Backend: Relay binary frames to peer
- [x] Backend: `file_start`/`file_end` JSON framing relay
- [x] Backend: Integration tests (TDD — tests written first, then implementation)
- [x] Frontend: File selection via button or drag-drop
- [x] Frontend: Chunk file (256 KB) and send via WebSocket
- [x] Frontend: Receive chunks and reassemble file
- [x] Frontend: Trigger download of received file
- [x] Frontend: Progress bars during transfer
- [x] Frontend: Folder support with relative paths

### Milestone 3: Polish ← NEXT
- [ ] Error handling and user feedback
- [ ] Room expiration/cleanup
- [ ] Session expiration/cleanup
- [ ] Handle transfer interruption (peer disconnect mid-transfer)

---

## Known Limitations

### Session Expiration
⚠️ **Sessions currently never expire.** Once a session token is created, it remains valid indefinitely in memory until the server restarts. This means:
- Session tokens in URLs work forever (until server restart)
- No automatic cleanup of inactive sessions
- Memory usage grows with each room created

**Future work needed:**
- [ ] Add session expiration (e.g., 24 hours of inactivity)
- [ ] Periodic cleanup of expired sessions
- [ ] Handle expired session gracefully on frontend (already implemented - shows landing view)

### Room Code Reuse
⚠️ **Room codes can be reused by 3rd parties.** After two peers connect, the original 6-character room code remains valid in the room store. A third person could theoretically join with that code, breaking the 2-peer model.

**Mitigation:** The URL-based session token workflow encourages users to share the session URL (`?s=token`) instead of the room code, which pairs with an existing session rather than creating new connections.

---

## Known Issues

None currently! 🎉

---

## Session Notes

### 2026-02-01 (Session 1)
- Reviewed project state after initial scaffolding
- Updated AGENTS.md with TypeScript setup and dev approach
- Created this progress doc
- Committed scaffolding
- Implemented room creation: POST /api/room endpoint working
- Implemented WebSocket /ws with join message handling
- Fixed: Client-per-connection (was sharing state across connections)
- Fixed: json.Unmarshal for WebSocket messages (was using HTTP body decoder)
- Added integration tests (TDD approach)

### 2026-02-01 (Session 2) - Milestone 1 Complete! 🎉
- **Claude**: Implemented frontend WebSocket client and room flows
  - State management and view switching
  - Room creation (POST /api/room → display code)
  - Room joining (WebSocket "join" message)
  - Reconnection handling with session tokens
- **Human**: Implemented session tokens and reconnection
  - Session token generation (UUID) on peer pairing
  - Session token storage for reconnection lookup
  - Integration tests for session token flows
- Documented TDD approach in AGENTS.md
- Next: Milestone 2 - File Transfer!

### 2026-02-02 (Session 3) - URL-based Session Tokens
- **Discussion**: Identified UX issue - users can't rejoin rooms after browser refresh
- **Solution**: Automatically add session token to URL (`?s=token`) for shareable, bookmarkable reconnection
- **Claude**: Implemented URL-based session token workflow
  - URL parameter parsing on page load for auto-reconnect
  - Browser URL updates to `?s=token` when connected
  - Graceful failure handling (clears URL, returns to landing)
  - Visual feedback (shows "waiting" view during reconnection)
- **Benefits**: Browser refresh "just works", users can bookmark/share session URLs
- **Documented**: Known limitations (sessions never expire, room codes can be reused)
- Created README.md with project overview and setup instructions
- Next: Milestone 2 - File Transfer!

### 2026-02-02 (Session 4) - Fixed Peer Refresh Bug 🐛→✅
- **Bug**: When PeerA refreshed, PeerB's UI showed "Connection Lost" but wasn't notified when PeerA reconnected
- **Root cause**: `Reconnect()` only notified the reconnecting peer, not the waiting peer
- **Human**: Fixed `session.go` - call `s.Notify()` instead of single peer notification
- **Claude**: Improved disconnect UX
  - Changed "Connection lost" → "Waiting for peer..." (less alarming for temporary disconnects)
  - Removed unnecessary "Reconnect" button (user is still connected, just waiting)
  - Cleaned up unused `reconnect()` function
- Peer refresh now works seamlessly for both parties!

### 2026-02-02 (Session 5) - Milestone 2 Complete! 🎉
- **Claude**: Wrote backend integration tests (TDD red phase)
  - 4 test cases: single-chunk, multi-chunk (600KB), bidirectional, no-session rejection
  - Tests defined the relay contract before implementation
- **Human**: Implemented backend file relay
  - Binary/text frame discrimination in handler.go
  - `handleFraming` for file_start/file_end JSON relay
  - `relayFile` for binary chunk forwarding
  - `GetPeer(conn)` in session.go
  - Added TransferStart/TransferEnd types to models
- **Bug found & fixed**: `bytes.Buffer` was accumulating chunks across sends — switched to direct pass-through
- **Claude**: Cleaned up backend code (removed unused `NewClient`, `RecvChunk`, commented relay.go code)
- **Claude**: Implemented full frontend file transfer
  - `ws.binaryType = "arraybuffer"` for binary message handling
  - File sending: 256KB chunking with `file.slice()`, sequential queue
  - File receiving: chunk accumulation, Blob reassembly, auto-download
  - Drag-drop, file input, folder input wiring
  - Progress bars with percentage updates
- End-to-end file transfer working between two browser tabs!
