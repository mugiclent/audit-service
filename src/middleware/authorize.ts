import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';

/**
 * Restricts the route to staff users only.
 * Must be used after the `authenticate` middleware.
 */
export const authorizeStaff = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.user?.user_type !== 'staff') {
    next(new AppError(403, 'FORBIDDEN', 'Staff access required'));
    return;
  }
  next();
};
