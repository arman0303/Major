import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const updateSettingsSchema = z.object({
  defaultLlmProvider: z.enum(['gemini', 'openai']).optional(),
  geminiApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  theme: z.enum(['light', 'dark']).optional(),
  autoExecuteSelect: z.boolean().optional(),
  maxRowLimit: z.number().int().min(10).max(5000).optional(),
});
