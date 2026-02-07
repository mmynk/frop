.PHONY: dev build test clean frontend backend deploy logs

# Build and run locally with podman
dev: build
	podman run --rm --name frop-test -p 8080:8080 frop

# Build container image
build:
	podman build -t frop .

# Run backend tests
test:
	cd backend && go test -v ./...

# Build frontend only (for quick iteration)
frontend:
	cd frontend && bun run build

# Build backend only
backend:
	cd backend && go build -o frop cmd/server/main.go

# Run backend locally (without container)
run: frontend
	cd backend && go run cmd/server/main.go

# Stop and remove container
clean:
	-podman stop frop-test 2>/dev/null
	-podman rm frop-test 2>/dev/null

# Deploy to Fly.io
deploy:
	fly deploy -a frop

# View container logs (if running detached)
logs:
	podman logs -f frop-test
