# audit-service

Consumes audit events from RabbitMQ and persists them to PostgreSQL for long-term querying. Exposes a staff-only REST API for querying the audit trail.

---

## Role in the Katisha platform

```
user-service ──► RabbitMQ (logs exchange, routing key: audit.logs)
(future services)         │
                          ▼
                      audit queue
                          │
                          ▼
                   audit-service
                          │
                          ▼
                  audit_db (PostgreSQL)
                          │
                          ▼
              GET /api/v1/audit-logs  ◄── api-gw ◄── staff clients
```

Publishing services fire and forget — they do not wait for a response. The audit-service is the only consumer of the `audit` queue. It never publishes to any exchange.

---

## Infrastructure dependencies

| Dependency | Container | Address | Notes |
|---|---|---|---|
| PostgreSQL | `pgbouncer` | `pgbouncer:6432` | Always via pgbouncer — never direct to `db:5432` |
| RabbitMQ | `rabbitmq` | `rabbitmq:5672` | AMQP — single channel with prefetch(1) |
| Docker network | `katisha-net` | external bridge | All services communicate by container name |

---

## RabbitMQ topology

```
logs exchange (topic)
  └── audit queue  ←── routing key: audit.logs  ──► DLX on failure

audit.dlx exchange (fanout) — dead-letter sink
  └── audit.dead queue ←── exhausted/malformed messages land here for manual inspection
```

Single AMQP channel with `prefetch(1)` — processes exactly one message at a time. The message stays UNACKED throughout the retry window; if the process crashes mid-retry, the broker requeues it automatically.

> **Warning:** The `audit` queue must be declared with `x-dead-letter-exchange: audit.dlx`. RabbitMQ queue arguments are immutable. If the queue was previously created without this argument, delete it in the management UI before deploying — the service will recreate it correctly on startup.

---

## Event format

Every message on the `audit` queue must match this envelope:

```json
{
  "event_id": "<uuid-v4>",
  "version": 1,
  "source": "user-service",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "actor_id": "<user-uuid>",
  "org_id": "<org-uuid>",
  "action": "login",
  "resource": "User",
  "resource_id": "<user-uuid>",
  "delta": { "before": {}, "after": {} },
  "ip": "1.2.3.4"
}
```

| Field | Required | Description |
|---|---|---|
| `event_id` | yes | UUID v4 — idempotency key; duplicates are silently acked |
| `version` | yes | Envelope version (currently `1`) |
| `source` | yes | Originating service in kebab-case e.g. `"user-service"` |
| `timestamp` | yes | ISO-8601 — when the action occurred (stored as `occurred_at`) |
| `actor_id` | yes | UUID of the user who performed the action |
| `org_id` | no | UUID of the actor's organisation (absent for passengers) |
| `action` | yes | Verb e.g. `"login"`, `"create"`, `"update"`, `"delete"` |
| `resource` | yes | Entity type e.g. `"User"`, `"Org"` |
| `resource_id` | yes | UUID of the affected entity |
| `delta` | no | Before/after snapshot for mutations |
| `ip` | no | Client IP address (IPv4 or IPv6) |

---

## Retry policy

Each message is attempted up to 3 times:

| Attempt | Delay before attempt |
|---|---|
| 1 | immediate |
| 2 | 2 seconds |
| 3 | 8 seconds |

- **Bad JSON**: nacked immediately → DLX. No retries — the payload will never fix itself.
- **Duplicate `event_id`** (Prisma P2002): acked immediately — idempotent by design.
- **DB error after 3 attempts**: nacked → moves to `audit.dead`.

---

## Dead-letter handling

Messages in `audit.dead` require manual intervention:

1. Inspect in the RabbitMQ management UI (`rabbitmq:15672`)
2. Identify the failure cause (bad payload shape, DB unavailability, etc.)
3. Fix the root cause
4. Shovel the message back to the `audit` queue manually if it should be retried

There is no automatic re-queue — that would create infinite loops.

---

## Database

One table: `audit_logs`.

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `event_id` | UUID | Unique — idempotency key from the event envelope |
| `version` | int | Envelope version |
| `source` | varchar(64) | Originating service |
| `actor_id` | UUID | User who performed the action |
| `org_id` | UUID? | Actor's organisation (null for passengers) |
| `action` | varchar(64) | e.g. `login`, `create`, `update`, `delete` |
| `resource` | varchar(64) | Entity type e.g. `User`, `Org` |
| `resource_id` | UUID | Affected entity |
| `delta` | json? | Before/after snapshot |
| `ip` | varchar(45)? | Client IP address |
| `occurred_at` | timestamp | When the action happened (from event envelope) |
| `created_at` | timestamp | When audit-service persisted the record |

Indexes on `actor_id`, `org_id`, `(resource, resource_id)`, `action`, `source`, and `occurred_at`.

---

## REST API

All endpoints require a valid JWT (verified by the api-gw) and `user_type: staff`. Non-staff requests receive `403 FORBIDDEN`.

### List — `GET /api/v1/audit-logs`

Returns a paginated list. The list view omits `delta`, `version`, `ip`, `event_id`, and `created_at` to keep rows lightweight.

**Query parameters (all optional):**

| Parameter | Type | Description |
|---|---|---|
| `actor_id` | UUID | Filter by the user who acted |
| `org_id` | UUID | Filter by organisation |
| `resource` | string | Filter by entity type e.g. `User` |
| `resource_id` | UUID | Filter by specific entity |
| `action` | string | Filter by action e.g. `login` |
| `source` | string | Filter by originating service |
| `from` | ISO date | `occurred_at >= from` |
| `to` | ISO date | `occurred_at <= to` |
| `page` | integer ≥ 1 | Page number, default `1` |
| `limit` | integer 1–200 | Page size, default `15` |

**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "source": "user-service",
      "actor_id": "...",
      "org_id": "...",
      "action": "login",
      "resource": "User",
      "resource_id": "...",
      "occurred_at": "2026-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "total": 47,
    "page": 1,
    "limit": 15,
    "totalPages": 4
  }
}
```

### Detail — `GET /api/v1/audit-logs/:id`

Returns the full record including `delta`, `version`, `ip`, `event_id`, and `created_at`.

**Response:**
```json
{
  "data": {
    "id": "...",
    "event_id": "...",
    "version": 1,
    "source": "user-service",
    "actor_id": "...",
    "org_id": "...",
    "action": "update",
    "resource": "User",
    "resource_id": "...",
    "delta": { "before": { "email": "old@example.com" }, "after": { "email": "new@example.com" } },
    "ip": "1.2.3.4",
    "occurred_at": "2026-01-01T00:00:00.000Z",
    "created_at": "2026-01-01T00:00:01.123Z"
  }
}
```

Returns `404 NOT_FOUND` if the id does not exist.

### Health — `GET /health`

```json
{ "status": "ok", "timestamp": "..." }
```

---

## Resilience

- **Startup**: both Prisma and RabbitMQ retry indefinitely with 3s backoff until their dependencies are ready. The service does not crash on startup if the DB or broker is not yet available.
- **Runtime**: if the RabbitMQ connection drops unexpectedly, the service reconnects automatically after 3s. An `isShuttingDown` flag prevents reconnect loops during graceful shutdown.
- **Graceful shutdown**: `SIGTERM`/`SIGINT` closes the HTTP server, disconnects Prisma, and closes the AMQP channel cleanly.

---

## Environment variables

All app secrets are stored in **Infisical** at path `/audit-svc` (project: katisha, env: dev). They are injected at container startup via `infisical run`. See `actions.env` for the full list of GitHub Actions secrets required for deployment.

| Variable | Description |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `8101` |
| `DB_PASSWORD` | Password for the `audit_svc` postgres user |
| `RABBITMQ_USER` | RabbitMQ username — same value as in Infisical `/rabbitmq` |
| `RABBITMQ_PASSWORD` | RabbitMQ password — same value as in Infisical `/rabbitmq` |

Connection strings are **constructed in code** from these credentials using fixed hostnames (`pgbouncer:6432`, `rabbitmq:5672`). No full URLs are stored in secrets.

---

## Database setup (first deploy)

The `db` repo handles this automatically on every push via its deploy workflow. To do it manually:

```bash
# 1. Create the user and database (idempotent)
docker exec -i db psql -U <POSTGRES_USER> < db/init/06-audit.sql

# 2. Set the password
docker exec db psql -U <POSTGRES_USER> -d postgres \
  -c "ALTER USER audit_svc WITH PASSWORD '<DB_PASSWORD>';"

# 3. Run Prisma migrations
npx prisma db push
```

The `audit_db` entry in `pgbouncer/config/pgbouncer.ini` is already present in the pgbouncer repo.

---

## Dockerfile notes

The runtime image is `node:22-bookworm-slim`. **OpenSSL must be explicitly installed** in the runtime stage:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
```

`bookworm-slim` strips OpenSSL to reduce image size. Prisma's native binary links against it at runtime and will crash on startup without it — regardless of whether the database connection uses TLS. This applies to **any Katisha service that uses Prisma on bookworm-slim**.

---

## Local development

```bash
# Copy and fill in local credentials (already set up for docker-compose.local.yml)
cp .env.example .env

# Start postgres + rabbitmq + the service (hot-reload via tsx watch)
docker compose -f docker-compose.local.yml up --build

# RabbitMQ management UI
open http://localhost:15674   # guest / guest
```

Publish a test audit event via the management UI:
- **Exchange**: `logs`
- **Routing key**: `audit.logs`
- **Body**:
```json
{
  "event_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "version": 1,
  "source": "user-service",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "actor_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "org_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
  "action": "login",
  "resource": "User",
  "resource_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "ip": "127.0.0.1"
}
```

Query the persisted log:
```bash
curl -s "http://localhost:8101/api/v1/audit-logs" \
  -H "X-User-ID: dddddddd-dddd-dddd-dddd-dddddddddddd" \
  -H "X-User-Type: staff" | jq .
```
