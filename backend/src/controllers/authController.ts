import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { DatabaseManager } from '../config/db.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { registerSchema, loginSchema, updateSettingsSchema } from '../validators/authValidator.js';

// Helper for generating tokens
const generateTokens = (user: { id: string; email: string; fullName: string; role: string }) => {
  const token = jwt.sign(
    { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    config.jwt.secret,
    { expiresIn: '7d' }
  );
  const refreshToken = jwt.sign(
    { id: user.id },
    config.jwt.refreshSecret,
    { expiresIn: '30d' }
  );
  return { token, refreshToken };
};

export const register = async (req: Request, res: Response): Promise<void> => {
  const parsed = registerSchema.parse(req.body);
  const { email, password, fullName } = parsed;

  // Check if user already exists
  const existing = await DatabaseManager.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'User with this email already exists' });
    return;
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Create user
  await DatabaseManager.query(
    'INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)',
    [userId, email.toLowerCase(), passwordHash, fullName, 'user']
  );

  // Initialize settings
  const settingsId = `set_${Date.now()}`;
  await DatabaseManager.query(
    'INSERT INTO user_settings (id, user_id, default_llm_provider, theme) VALUES ($1, $2, $3, $4)',
    [settingsId, userId, 'gemini', 'dark']
  );

  // Create default starter project
  const projectId = `proj_${Date.now()}`;
  await DatabaseManager.query(
    'INSERT INTO projects (id, user_id, name, description) VALUES ($1, $2, $3, $4)',
    [projectId, userId, 'Enterprise Operations & Analytics', 'Default project with company employee, department, and sales records.']
  );

  const userPayload = { id: userId, email: email.toLowerCase(), fullName, role: 'user' };
  const tokens = generateTokens(userPayload);

  res.status(201).json({
    message: 'User registered successfully',
    user: userPayload,
    ...tokens,
    defaultProjectId: projectId,
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.parse(req.body);
  const { email, password } = parsed;

  const userQuery = await DatabaseManager.query(
    'SELECT id, email, password_hash, full_name, role FROM users WHERE email = $1',
    [email.toLowerCase()]
  );

  if (userQuery.rows.length === 0) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const user = userQuery.rows[0];
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const userPayload = { id: user.id, email: user.email, fullName: user.full_name, role: user.role };
  const tokens = generateTokens(userPayload);

  // Get user projects
  const projects = await DatabaseManager.query('SELECT id, name FROM projects WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);

  res.json({
    message: 'Login successful',
    user: userPayload,
    ...tokens,
    projects: projects.rows,
  });
};

export const getProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const userQuery = await DatabaseManager.query(
    'SELECT id, email, full_name, role, created_at FROM users WHERE id = $1',
    [req.user.id]
  );

  if (userQuery.rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const settingsQuery = await DatabaseManager.query(
    'SELECT default_llm_provider, gemini_api_key, openai_api_key, theme, auto_execute_select, max_row_limit FROM user_settings WHERE user_id = $1',
    [req.user.id]
  );

  const settings = settingsQuery.rows[0] || {
    default_llm_provider: 'gemini',
    theme: 'dark',
    auto_execute_select: true,
    max_row_limit: 500,
  };

  res.json({
    user: userQuery.rows[0],
    settings: {
      ...settings,
      hasGeminiKey: Boolean(settings.gemini_api_key),
      hasOpenAIKey: Boolean(settings.openai_api_key),
      gemini_api_key: settings.gemini_api_key ? '••••••••' + settings.gemini_api_key.slice(-4) : '',
      openai_api_key: settings.openai_api_key ? '••••••••' + settings.openai_api_key.slice(-4) : '',
    },
  });
};

export const updateSettings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = updateSettingsSchema.parse(req.body);
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (body.defaultLlmProvider) {
    fields.push(`default_llm_provider = $${idx++}`);
    values.push(body.defaultLlmProvider);
  }
  if (body.geminiApiKey !== undefined) {
    fields.push(`gemini_api_key = $${idx++}`);
    values.push(body.geminiApiKey);
  }
  if (body.openaiApiKey !== undefined) {
    fields.push(`openai_api_key = $${idx++}`);
    values.push(body.openaiApiKey);
  }
  if (body.theme) {
    fields.push(`theme = $${idx++}`);
    values.push(body.theme);
  }
  if (body.autoExecuteSelect !== undefined) {
    fields.push(`auto_execute_select = $${idx++}`);
    values.push(body.autoExecuteSelect);
  }
  if (body.maxRowLimit !== undefined) {
    fields.push(`max_row_limit = $${idx++}`);
    values.push(body.maxRowLimit);
  }

  if (fields.length > 0) {
    values.push(req.user.id);
    await DatabaseManager.query(
      `UPDATE user_settings SET ${fields.join(', ')} WHERE user_id = $${idx}`,
      values
    );
  }

  res.json({ message: 'Settings updated successfully' });
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken: token } = req.body;
  if (!token) {
    res.status(400).json({ error: 'Refresh token is required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.refreshSecret) as { id: string };
    const userResult = await DatabaseManager.query(
      'SELECT id, email, full_name, role FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      res.status(401).json({ error: 'User no longer exists or session revoked' });
      return;
    }

    const user = userResult.rows[0];
    const userPayload = { id: user.id, email: user.email, fullName: user.full_name, role: user.role };
    const tokens = generateTokens(userPayload);

    res.json({
      message: 'Token refreshed successfully',
      ...tokens,
      user: userPayload,
    });
  } catch (err: any) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
};

export const logout = async (_req: Request, res: Response): Promise<void> => {
  res.json({ message: 'Logged out successfully' });
};
