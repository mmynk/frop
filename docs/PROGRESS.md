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
- [ ] Peer disconnect detection
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

### 🐛 Peer Refresh Breaks Session for Both Peers
**Status:** Not fixed yet

**Problem:** When one peer refreshes their browser, both peers lose the ability to reconnect together:

1. PeerA and PeerB connected via session token
2. PeerA refreshes → PeerA's WebSocket closes
3. Backend notifies PeerB with "peer_disconnected" → PeerB sees disconnected view
4. PeerA auto-reconnects with session token (URL `?s=...`)
5. **PeerB tries to reconnect** → PeerA gets disconnected
6. No way for both to get back into the same session

**Root cause:** Backend session/room state management doesn't properly handle:
- One peer temporarily disconnecting (refresh) vs permanently leaving
- Both peers trying to reconnect to the same session
- Keeping session alive when peer count drops to 1

**Technical details from logs:**
```
09:06:00 Successfully joined room (peer reconnects)
09:06:02 websocket: close 1001 (going away) [both peers close]
09:06:02 First reconnect with session token succeeds
09:06:51 Second reconnect fails: "Both peers already connected"
09:07:31 Another reconnect fails: "Both peers already connected"
```

The backend tracks session state but doesn't properly handle stale WebSocket connections. When peers try to reconnect, it rejects them thinking both are already connected, even though the WebSocket connections are actually closed.

**Impact:** Users can't reliably refresh without breaking the connection for their peer.

**Code analysis (session.go):**
The defer in `handler.go:39-44` DOES fire and calls `s.Disconnect()` which:
- Removes connection from `sessionsByConn` map
- Sets `PeerA = nil` or `PeerB = nil`
- Notifies other peer with "peer_disconnected"

The `Reconnect()` function checks:
- If `PeerA == nil`, assign there
- Else if `PeerB == nil`, assign there
- Else return "Both peers already connected"

**Mystery:** When both peers close and reconnect, the second reconnect fails with "Both peers already connected", meaning both slots are somehow non-nil. Possible causes:
- Race condition: first reconnect happens before both defers complete?
- First reconnect assigns to wrong slot or both slots?
- Disconnect() not fully executing in some cases?

**Future work needed:**
- [ ] Backend: Debug why both peer slots are non-nil after both disconnect
- [ ] Backend: Consider locking/mutex in Session to prevent race conditions
- [ ] Backend: Add more detailed logging in Reconnect/Disconnect to trace state
- [ ] Backend: Maybe assign peers by identity (first to connect = PeerA always)?
- [ ] Backend: Add grace period before sending "peer_disconnected" (5-10 sec buffer)
- [ ] Frontend: Show "Peer temporarily disconnected" vs "Peer left" states
- [ ] Consider: Add "ping/pong" heartbeat to detect dead connections

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
