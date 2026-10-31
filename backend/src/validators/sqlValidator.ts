import { z } from 'zod';

export const executeSqlSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  sql: z.string().min(1, 'SQL statement cannot be empty'),
  isConfirmed: z.boolean().default(false),
  limit: z.number().int().min(1).max(5000).optional(),
});

export const previewSqlSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  sql: z.string().min(1, 'SQL statement cannot be empty'),
});

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100),
  description: z.string().max(500).optional(),
});
