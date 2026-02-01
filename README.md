# Smart Home Platform ✅

A compact microservices-based smart home platform for demos, local development, and experimentation.

---

## Table of contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick start (Docker)](#quick-start-docker)
- [Run a single service](#run-a-single-service)
- [Frontend development](#frontend-development)
- [Environment variables](#environment-variables)
- [Services & endpoints](#services--endpoints)
- [Functions](#functions)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing) ✅
- [License](#license)

---

## Overview
- Backend services: `user-service`, `device-service`, `automation-service`, `notification-service` (Node.js)
- Frontend shell: React app in `frontend/shell`
- Serverless functions: `functions/motion-detector`
- Messaging & infra (used by samples): Redis, RabbitMQ, Kafka, Postgres, MongoDB
- Reverse proxy / gateway: `nginx` (see `nginx/nginx.conf`)

## Architecture 🔧
Simple microservices architecture:

```
[Browser] <---> [nginx gateway] <---> [frontend] / [backend services]
                               |
                               +--> Messaging (RabbitMQ / Kafka / Redis)
                               +--> DBs (Postgres / Mongo)
```

The repo is arranged to make it easy to run everything locally via Docker Compose or work on services individually.

## Prerequisites
- Docker & Docker Compose (v2+)
- Node.js (for local frontend/service development)
- npm or yarn

## Quick start (Docker) 🚀
1. From repository root, build and start all services & infra:

```bash
# builds images and starts services in detached mode
docker compose up -d --build
```

2. Verify services:
- Frontend: http://localhost:3000
- User service health: http://localhost:3001/health
- Device service health: http://localhost:3002/health
- Automation service health: http://localhost:3003/health
- Notification service health: http://localhost:3004/health

3. Tail logs for all containers:

```bash
docker compose logs -f
```

> Tip: Use `docker compose ps` to see running containers and ports.

## Run a single service
To start only one service (useful for development):

```bash
# Start just the user service and required infra
docker compose up -d --build user-service
```

Replace `user-service` with `device-service`, `automation-service`, or `notification-service` as needed.

## Frontend development (local) 💻
1. Open a terminal and cd into the frontend shell:

```bash
cd frontend/shell
npm install
npm start
```

2. The dev server runs at http://localhost:3000 by default.
3. When using the dev server, configure `frontend/shell/.env`:

```
REACT_APP_API_URL=http://localhost:3001
```

Adjust `REACT_APP_API_URL` to point to whichever backend service URL you need.

## Environment variables
- Services include Dockerfile / package.json; consult each service folder for specific env vars.
- Example `.env` entries for local testing:

```
# Postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=smart_home

# RabbitMQ / Redis defaults are set in docker-compose
```

## Services & endpoints
- `user-service` — user management & auth (http://localhost:3001)
- `device-service` — device registration & telemetry (http://localhost:3002)
- `automation-service` — automation rules & execution (http://localhost:3003)
- `notification-service` — push / email / in-app notifications (http://localhost:3004)

Each service exposes a `/health` endpoint for quick checks.

## Functions
- `functions/motion-detector` contains a demo serverless-style function (handler in `handler.js`) for motion events. It's packaged to run in a container for testing.

## Troubleshooting ⚠️
- If ports are already in use, stop conflicting services or change ports in `docker-compose.yml`.
- If a container fails to start, inspect logs:

```bash
docker compose logs <service-name>
```

- If you see DB connection issues, ensure the DB containers are healthy and available.

## Contributing ✨
- Create a branch: `git checkout -b feat/your-feature`
- Open a pull request against `main`
- Keep changes small and focused, add README updates for new features

## License
MIT — see the `LICENSE` file for details.

---

If you'd like, I can also add badges, a short architecture diagram image, or service-specific README files under each service folder. Would you like me to add those now? 💡
