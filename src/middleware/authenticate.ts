import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';

/**
 * Reads the trusted identity headers injected by the api-gw and populates req.user.
 * The gateway verifies JWTs; this middleware just deserializes the pre-verified identity.
 *
 * Expected headers (set by gateway, never by the client):
 *   X-User-ID    — user UUID
 *   X-Org-ID     — org UUID, or absent for passengers
 *   X-User-Type  — "passenger" | "staff"
 *   X-User-Roles — JSON array of role slugs, e.g. ["org_admin"]
 */
export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  const userId = req.headers['x-user-id'] as string | undefined;

  if (!userId) {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
    return;
  }

  try {
    req.user = {
      id: userId,
      org_id: (req.headers['x-org-id'] as string | undefined) ?? null,
      user_type: (req.headers['x-user-type'] as 'passenger' | 'staff') ?? 'passenger',
      role_slugs: JSON.parse(
        (req.headers['x-user-roles'] as string | undefined) ?? '[]',
      ) as string[],
    };
    next();
  } catch {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
  }
};
