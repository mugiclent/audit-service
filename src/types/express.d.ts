// Augments the Express Request type with the authenticated user injected
// by the api-gw via X-User-ID / X-Org-ID / X-User-Type / X-User-Roles headers.
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        org_id: string | null;
        user_type: 'passenger' | 'staff';
        role_slugs: string[];
      };
    }
  }
}

export {};
