# Frop Development Progress

This document tracks implementation progress to help maintain context across sessions.

## Current Status: Early Development

Last updated: 2026-02-01

---

## Frontend (Claude)

### Completed
- [x] HTML structure with 4 views (landing, waiting, connected, disconnected)
- [x] CSS styling (dark theme, responsive, progress bars)
- [x] TypeScript + esbuild build setup

### In Progress
- [ ] Main app logic in `src/main.ts`

### Not Started
- [ ] State management (view switching)
- [ ] DOM event listeners (buttons, dropzone)
- [ ] WebSocket client connection
- [ ] Room creation flow (call POST /api/room, display code)
- [ ] Room joining flow (enter code, connect via WebSocket)
- [ ] File selection and drag-drop handling
- [ ] File chunking for transfer
- [ ] File reassembly on receive
- [ ] Progress tracking UI updates
- [ ] Reconnection handling
- [ ] Error display

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

### In Progress
- [ ] Session token generation (UUID)

### Not Started
- [ ] `GET /api/room/:code` endpoint
- [ ] Binary frame relay between peers
- [ ] Peer disconnect detection
- [ ] Reconnection flow
- [ ] Room expiration/cleanup

---

## Milestone Tracker

### Milestone 1: Room Creation & Joining
- [x] Backend: POST /api/room returns code
- [x] Backend: WebSocket accepts "join" message
- [x] Backend: Pairs two peers, sends "connected" *(session token pending)*
- [ ] Frontend: Create room button calls API, shows code
- [ ] Frontend: Join room connects via WebSocket
- [ ] Frontend: View switches to "connected" state

### Milestone 2: Basic File Transfer
- [ ] Frontend: File selection via button or drag-drop
- [ ] Frontend: Chunk file and send via WebSocket
- [ ] Backend: Relay binary frames to peer
- [ ] Frontend: Receive chunks and reassemble file
- [ ] Frontend: Trigger download of received file

### Milestone 3: Polish
- [ ] Progress bars during transfer
- [ ] Multiple file / directory support
- [ ] Reconnection with session token
- [ ] Error handling and user feedback
- [ ] Room expiration

---

## Session Notes

### 2026-02-01
- Reviewed project state after initial scaffolding
- Updated AGENTS.md with TypeScript setup and dev approach
- Created this progress doc
- Committed scaffolding
- Implemented room creation: POST /api/room endpoint working
- Implemented WebSocket /ws with join message handling
- Fixed: Client-per-connection (was sharing state across connections)
- Fixed: json.Unmarshal for WebSocket messages (was using HTTP body decoder)
- Added integration tests (TDD approach)
- Next: Session tokens, then frontend wiring
