import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';
import { createProjectSchema } from '../validators/sqlValidator.js';

export const listProjects = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const result = await DatabaseManager.query(
    'SELECT id, name, description, created_at, updated_at FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  res.json({ projects: result.rows });
};

export const createProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { name, description } = createProjectSchema.parse(req.body);

  const projectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  await DatabaseManager.query(
    'INSERT INTO projects (id, user_id, name, description) VALUES ($1, $2, $3, $4)',
    [projectId, userId, name, description || '']
  );

  res.status(201).json({
    message: 'Project created successfully',
    project: { id: projectId, name, description, user_id: userId }
  });
};

export const getProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const result = await DatabaseManager.query(
    'SELECT id, name, description, created_at FROM projects WHERE id = $1 AND user_id = $2',
    [id, userId]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Project not found or access denied' });
    return;
  }

  // Fetch associated datasets
  const datasets = await DatabaseManager.query(
    'SELECT id, name, table_name, file_type, row_count, created_at FROM datasets WHERE project_id = $1 ORDER BY created_at DESC',
    [id]
  );

  res.json({
    project: result.rows[0],
    datasets: datasets.rows,
  });
};

export const updateProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;
  const { name, description } = createProjectSchema.parse(req.body);

  const check = await DatabaseManager.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [id, userId]);
  if (check.rows.length === 0) {
    res.status(404).json({ error: 'Project not found or access denied' });
    return;
  }

  await DatabaseManager.query(
    'UPDATE projects SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    [name, description || '', id]
  );

  res.json({ message: 'Project updated successfully' });
};

export const deleteProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { id } = req.params;

  const check = await DatabaseManager.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [id, userId]);
  if (check.rows.length === 0) {
    res.status(404).json({ error: 'Project not found or access denied' });
    return;
  }

  await DatabaseManager.query('DELETE FROM projects WHERE id = $1', [id]);
  res.json({ message: 'Project deleted successfully' });
};
