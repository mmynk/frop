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

### In Progress
- [ ] Room management system

### Not Started
- [ ] 6-character room code generation
- [ ] Room store (in-memory map of active rooms)
- [ ] `POST /api/room` endpoint
- [ ] `GET /api/room/:code` endpoint
- [ ] WebSocket `/ws` endpoint (currently commented out)
- [ ] WebSocket message routing (join, file_start, file_end, etc.)
- [ ] Session token generation (UUID)
- [ ] Binary frame relay between peers
- [ ] Peer disconnect detection
- [ ] Reconnection flow
- [ ] Room expiration/cleanup

---

## Milestone Tracker

### Milestone 1: Room Creation & Joining
- [ ] Backend: POST /api/room returns code
- [ ] Backend: WebSocket accepts "join" message
- [ ] Backend: Pairs two peers, sends "connected" with session token
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
- Next: Commit current state, then start Milestone 1
