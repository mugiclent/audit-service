import { Router } from 'express';
import Joi from 'joi';
import { authenticate } from '../middleware/authenticate.js';
import { authorizeStaff } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { getAuditLog, getAuditLogs } from './audit.controller.js';

const UUID = Joi.string().uuid();
const ISO_DATE = Joi.string().isoDate();

const querySchema = Joi.object({
  actor_id:    UUID,
  org_id:      UUID,
  resource:    Joi.string().max(64),
  resource_id: UUID,
  action:      Joi.string().max(64),
  source:      Joi.string().max(64),
  from:        ISO_DATE,
  to:          ISO_DATE,
  page:        Joi.number().integer().min(1),
  limit:       Joi.number().integer().min(1).max(200),
});

const router = Router();

router.get('/',    authenticate, authorizeStaff, validate(querySchema, 'query'), getAuditLogs);
router.get('/:id', authenticate, authorizeStaff, getAuditLog);

export { router as auditRouter };
