import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation Error',
      details: err.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
    });
    return;
  }

  const statusCode = err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500);
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    code: err.code || 'INTERNAL_ERROR',
  });
};
