import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';

export const listConversations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId } = req.query;
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  const result = await DatabaseManager.query(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE project_id = $1 ORDER BY updated_at DESC',
    [projectId]
  );
  res.json({ conversations: result.rows });
};

export const createConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId, title } = req.body;
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  const convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  await DatabaseManager.query(
    'INSERT INTO conversations (id, project_id, title) VALUES ($1, $2, $3)',
    [convId, projectId, title || 'New Analysis']
  );

  res.status(201).json({
    conversation: {
      id: convId,
      project_id: projectId,
      title: title || 'New Analysis',
    }
  });
};

export const getConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const convResult = await DatabaseManager.query('SELECT * FROM conversations WHERE id = $1', [id]);
  if (convResult.rows.length === 0) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  const messagesResult = await DatabaseManager.query(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [id]
  );

  res.json({
    conversation: convResult.rows[0],
    messages: messagesResult.rows.map(m => ({
      ...m,
      query_result: typeof m.query_result === 'string' ? JSON.parse(m.query_result) : m.query_result,
      visualization_config: typeof m.visualization_config === 'string' ? JSON.parse(m.visualization_config) : m.visualization_config,
      explanation: typeof m.explanation === 'string' ? JSON.parse(m.explanation) : m.explanation,
    })),
  });
};

export const updateConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { title } = req.body;

  await DatabaseManager.query(
    'UPDATE conversations SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [title, id]
  );

  res.json({ message: 'Conversation updated' });
};

export const deleteConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  await DatabaseManager.query('DELETE FROM conversations WHERE id = $1', [id]);
  res.json({ message: 'Conversation deleted' });
};
