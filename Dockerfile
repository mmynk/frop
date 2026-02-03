# --- Build frontend ---
FROM node:25-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# --- Build backend ---
FROM golang:1.25 AS backend
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o frop cmd/server/main.go

# --- Runtime ---
FROM alpine:3.21
RUN apk add --no-cache ca-certificates
WORKDIR /app/backend
COPY --from=backend /app/backend/frop .
COPY --from=frontend /app/frontend/ ../frontend/
EXPOSE 8080
CMD ["./frop"]
