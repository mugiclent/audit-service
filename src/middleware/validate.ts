import type { Request, Response, NextFunction } from 'express';
import type { Schema } from 'joi';
import { AppError } from '../utils/AppError.js';

/**
 * Returns an Express middleware that validates req[source] against the given
 * Joi schema. On failure, passes a VALIDATION_ERROR AppError to next().
 */
export const validate =
  (schema: Schema, source: 'query' | 'body') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      next(
        new AppError(422, 'VALIDATION_ERROR', error.details.map((d) => d.message).join('; ')),
      );
      return;
    }

    req[source] = value;
    next();
  };
