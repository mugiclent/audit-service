/**
 * Full message shape received from the `audit` queue.
 *
 * The outer fields (event_id, version, source, timestamp) come from the
 * platform event envelope added by the publishing service's `publish()` helper.
 * The inner fields (actor_id … ip) come from the AuditEvent payload.
 */
export interface AuditEvent {
  event_id: string; // UUID v4 — used as idempotency key
  version: number;
  source: string; // originating service, e.g. "user-service"
  timestamp: string; // ISO-8601 — when the action occurred

  actor_id: string; // UUID of the user who performed the action
  org_id?: string; // UUID of the actor's org (absent for passengers)
  action: string; // e.g. "login", "create", "update", "delete"
  resource: string; // e.g. "User", "Org"
  resource_id: string; // UUID of the affected entity
  delta?: Record<string, unknown>; // before/after snapshot for mutations
  ip?: string; // client IP address
}
