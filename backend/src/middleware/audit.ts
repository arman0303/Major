import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.js';

export const auditLogger = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const start = Date.now();
  const userId = req.user?.id || 'anonymous';
  const method = req.method;
  const path = req.originalUrl;

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (res.statusCode >= 400 || method !== 'GET') {
      console.log(`[AUDIT] User: ${userId} | ${method} ${path} | Status: ${res.statusCode} | Duration: ${duration}ms`);
    }
  });

  next();
};
