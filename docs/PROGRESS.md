# Frop Development Progress

This document tracks implementation progress to help maintain context across sessions.

## Current Status: Milestone 1 Complete ✅ + URL-based Reconnection

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

### Not Started
- [ ] File selection and drag-drop handling
- [ ] File chunking for transfer
- [ ] File reassembly on receive
- [ ] Progress tracking UI updates
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

### Not Started
- [ ] `GET /api/room/:code` endpoint
- [ ] Binary frame relay between peers
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

### Milestone 2: Basic File Transfer ← CURRENT
- [ ] Frontend: File selection via button or drag-drop
- [ ] Frontend: Chunk file and send via WebSocket
- [ ] Backend: Relay binary frames to peer
- [ ] Frontend: Receive chunks and reassemble file
- [ ] Frontend: Trigger download of received file

### Milestone 3: Polish
- [ ] Progress bars during transfer
- [ ] Multiple file / directory support
- [ ] Error handling and user feedback
- [ ] Room expiration/cleanup

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
