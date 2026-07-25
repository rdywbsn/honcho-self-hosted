# Honcho Dashboard

Production snapshot of the self-hosted Honcho memory dashboard used at `memory.robet.id`.

## Contents

- `static/` — static frontend served by Caddy.
- `bridge/honcho-dashboard-bridge.py` — local API bridge with SSE and PostgreSQL polling.
- `systemd/honcho-dashboard-bridge.service` — service unit for the bridge.

## Runtime notes

- Frontend calls the bridge via same-origin `/api/*` routes and Honcho API via `/honcho-api`.
- Bridge expects local Docker container `honcho-database-1` and PostgreSQL on `127.0.0.1:5432`.
- Realtime updates use Server-Sent Events at `/api/events` with heartbeat and change detection.
