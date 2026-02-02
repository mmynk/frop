# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

Frop is a real-time file sharing webapp (like AirDrop, but universal). Two users connect via a short code, then either can send files/directories to the other with real-time streaming.

## Architecture

- **Frontend**: TypeScript, bundled with esbuild (no UI framework)
- **Backend**: Go with WebSocket for real-time communication
- **API**: REST for room creation, WebSocket for file transfer

### Core Concepts

**Room**: A temporary space identified by a 6-character code where two peers connect.

**Transfer Flow**:
1. Person A opens app → gets a 6-char code → waits in room
2. Person B enters code → joins room → both connected
3. Either party can send files to the other
4. Files stream in real-time through the server (relay model)

**Session Token**: UUID issued when both peers connect. Used for reconnection if connection drops. Code becomes irrelevant after pairing.

### WebSocket Protocol

Control messages are JSON, file data uses binary frames.

```
// Joining
{ "type": "join", "code": "ABC123" }
{ "type": "connected", "sessionToken": "uuid" }

// File transfer
{ "type": "file_start", "name": "path/to/file.jpg", "size": 1024000 }
[binary frame with chunk data]
{ "type": "file_end", "name": "path/to/file.jpg" }

// Reconnection
{ "type": "reconnect", "sessionToken": "uuid" }
{ "type": "peer_disconnected" }
```

Directory structure is preserved via relative paths in file names.

### Project Structure

```
frontend/
├── index.html
├── css/style.css
├── src/
│   └── main.ts         # Main app logic, state, WebSocket client
├── dist/
│   └── bundle.js       # Built output (esbuild)
├── package.json
└── tsconfig.json

backend/
├── cmd/server/main.go  # Entry point, HTTP routes
├── internal/
│   ├── room/room.go    # Room + Store, code generation
│   ├── ws/handler.go   # WebSocket upgrade, message routing
│   └── transfer/relay.go  # Binary data forwarding
└── go.mod
```

## Development Commands

### Backend
```bash
cd backend
go run cmd/server/main.go       # Run server
go build -o frop cmd/server/main.go
go test ./...                   # All tests
go test -v -run TestRoomJoin ./internal/room  # Single test
```

### Frontend
```bash
cd frontend
bun install                     # Install deps
bun run build                   # Build once
bun run watch                   # Build on change

# Serve via Go backend, or for standalone dev:
python3 -m http.server 8080 --directory frontend
```

## REST Endpoints

- `POST /api/room` → Creates room, returns `{ "code": "ABC123" }`
- `GET /api/room/:code` → Check if room exists and status
- `GET /ws` → WebSocket upgrade for file transfer

## Development Approach

**Division of labor:**
- **Claude (AI)**: Frontend TypeScript - UI logic, state management, WebSocket client, file handling
- **Human**: Backend Go - HTTP server, room management, WebSocket server, file relay

This split allows the human to learn Go by implementing the backend while Claude handles the frontend implementation.

**Test-Driven Development (TDD):**
For new backend features, Claude writes integration tests first that define the expected behavior. Human then implements until tests pass. This approach:
- Provides clear "done" criteria
- Documents expected API contracts
- Catches regressions early

Run tests with: `cd backend && go test -v ./...`
