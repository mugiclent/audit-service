import { prisma } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import type { AuditLog, Prisma } from '../models/index.js';
import type { AuditEvent } from '../types/events.js';

// Fields returned in the list view — delta and version are omitted.
const LIST_SELECT = {
  id:          true,
  source:      true,
  actor_id:    true,
  org_id:      true,
  action:      true,
  resource:    true,
  resource_id: true,
  occurred_at: true,
} as const;

export type AuditLogListItem = Prisma.AuditLogGetPayload<{ select: typeof LIST_SELECT }>;
export type { AuditLog };

export interface QueryFilters {
  actor_id?: string;
  org_id?: string;
  resource?: string;
  resource_id?: string;
  action?: string;
  source?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export interface QueryResult {
  data: AuditLogListItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const AuditService = {
  /**
   * Persists a single audit event.
   * Throws on DB error — caller (subscriber) handles retries and DLX routing.
   * Duplicate event_id throws Prisma P2002 — subscriber acks it as idempotent.
   */
  async persist(event: AuditEvent): Promise<void> {
    await prisma.auditLog.create({
      data: {
        event_id: event.event_id,
        version: event.version,
        source: event.source,
        actor_id: event.actor_id,
        org_id: event.org_id ?? undefined,
        action: event.action,
        resource: event.resource,
        resource_id: event.resource_id,
        delta: event.delta as Prisma.InputJsonValue | undefined,
        ip: event.ip ?? undefined,
        occurred_at: new Date(event.timestamp),
      },
    });
  },

  /**
   * Queries audit logs (list view — delta/version excluded).
   * Returns a page of results with total count for UI pagination controls.
   */
  async queryLogs(filters: QueryFilters): Promise<QueryResult> {
    const limit = Math.min(filters.limit ?? 15, 200);
    const page  = Math.max(filters.page ?? 1, 1);
    const skip  = (page - 1) * limit;

    const where = {
      ...(filters.actor_id    && { actor_id:    filters.actor_id }),
      ...(filters.org_id      && { org_id:      filters.org_id }),
      ...(filters.resource    && { resource:    filters.resource }),
      ...(filters.resource_id && { resource_id: filters.resource_id }),
      ...(filters.action      && { action:      filters.action }),
      ...(filters.source      && { source:      filters.source }),
      ...(filters.from || filters.to
        ? {
            occurred_at: {
              ...(filters.from && { gte: filters.from }),
              ...(filters.to   && { lte: filters.to }),
            },
          }
        : {}),
    };

    const [total, data] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        select: LIST_SELECT,
        where,
        orderBy: { occurred_at: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async findById(id: string) {
    const log = await prisma.auditLog.findUnique({ where: { id } });
    if (!log) throw new AppError(404, 'NOT_FOUND', 'Audit log not found');
    return log;
  },
};
