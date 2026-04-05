import type { Request, Response, NextFunction } from 'express';
import { AuditService } from '../services/audit.service.js';

export const getAuditLog = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const log = await AuditService.findById(req.params['id']!);
    res.json({ data: log });
  } catch (err) {
    next(err);
  }
};

export const getAuditLogs = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const q = req.query as Record<string, string | undefined>;

    const result = await AuditService.queryLogs({
      actor_id:    q['actor_id'],
      org_id:      q['org_id'],
      resource:    q['resource'],
      resource_id: q['resource_id'],
      action:      q['action'],
      source:      q['source'],
      from:        q['from']   ? new Date(q['from'])   : undefined,
      to:          q['to']     ? new Date(q['to'])      : undefined,
      page:        q['page']   ? Number(q['page'])      : undefined,
      limit:       q['limit']  ? Number(q['limit'])     : undefined,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};
