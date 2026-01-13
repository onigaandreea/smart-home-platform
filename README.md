# Smart Home Platform

A small microservices-based smart home platform used for demo / dev purposes.

## Overview
- Backend services: `user-service`, `device-service`, `automation-service`, `notification-service` (Node.js)
- Frontend shell: React app in `frontend/shell`
- Messaging & infra: Redis, RabbitMQ, Kafka, Postgres, Mongo
- Reverse proxy: `nginx` configured as gateway and WebSocket proxy

## Quick start (Docker)
1. Build and start all services:

```bash
docker compose up -d --build
```

2. Check services:
- Frontend: http://localhost:3000
- User service: http://localhost:3001/health
- Device service: http://localhost:3002/health
- Automation service: http://localhost:3003/health
- Notification service: http://localhost:3004/health

3. Tail logs:

```bash
docker compose logs -f
```

## Local frontend development
1. cd `frontend/shell`
2. Install dependencies: `npm install`
3. Start dev server: `npm start` (http://localhost:3000)

> If using the dev server, set `frontend/shell/.env` to point at your backend (e.g. `REACT_APP_API_URL=http://localhost:3001`).

## Contributing
- Create a branch for your feature/fix
- Open a PR against `main`

## License
MIT (see `LICENSE`)
