import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';

// ─── List Conversations ───────────────────────────────────────────────────────

export const listConversations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId, search } = req.query;
  const userId = req.user!.id;

  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  // Verify project belongs to this user
  const projectCheck = await DatabaseManager.query(
    'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId]
  );
  if (projectCheck.rows.length === 0) {
    res.status(403).json({ error: 'Project not found or access denied' });
    return;
  }

  try {
    let query: string;
    let params: any[];

    if (search && typeof search === 'string' && search.trim()) {
      query = `
        SELECT id, title, created_at, updated_at, message_count
        FROM conversations 
        WHERE project_id = $1 
          AND (user_id = $2 OR user_id IS NULL)
          AND LOWER(title) LIKE LOWER($3)
        ORDER BY updated_at DESC
        LIMIT 100
      `;
      params = [projectId, userId, `%${search.trim()}%`];
    } else {
      query = `
        SELECT id, title, created_at, updated_at, message_count
        FROM conversations 
        WHERE project_id = $1 
          AND (user_id = $2 OR user_id IS NULL)
        ORDER BY updated_at DESC
        LIMIT 100
      `;
      params = [projectId, userId];
    }

    const result = await DatabaseManager.query(query, params);
    res.json({ conversations: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Create Conversation ──────────────────────────────────────────────────────

export const createConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId, title } = req.body;
  const userId = req.user!.id;

  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  // Verify project belongs to this user
  const projectCheck = await DatabaseManager.query(
    'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
    [projectId, userId]
  );
  if (projectCheck.rows.length === 0) {
    res.status(403).json({ error: 'Project not found or access denied' });
    return;
  }

  const convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const convTitle = title || 'New Chat';

  try {
    await DatabaseManager.query(
      'INSERT INTO conversations (id, project_id, user_id, title, message_count) VALUES ($1, $2, $3, $4, $5)',
      [convId, projectId, userId, convTitle, 0]
    );

    res.status(201).json({
      conversation: {
        id: convId,
        project_id: projectId,
        user_id: userId,
        title: convTitle,
        message_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Get Conversation with Messages ─────────────────────────────────────────

export const getConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { page = '1', limit = '50' } = req.query;
  const userId = req.user!.id;

  const pageNum = Math.max(1, parseInt(page as string) || 1);
  const limitNum = Math.min(200, parseInt(limit as string) || 50);
  const offset = (pageNum - 1) * limitNum;

  try {
    // Verify conversation belongs to this user
    const convResult = await DatabaseManager.query(
      'SELECT * FROM conversations WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)',
      [id, userId]
    );
    if (convResult.rows.length === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const messagesResult = await DatabaseManager.query(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
      [id, limitNum, offset]
    );

    const messages = messagesResult.rows.map(m => {
      const safeparse = (val: any) => {
        if (!val) return null;
        if (typeof val === 'string') {
          try { return JSON.parse(val); } catch { return null; }
        }
        return val;
      };
      return {
        ...m,
        query_result: safeparse(m.query_result),
        visualization_config: safeparse(m.visualization_config),
        explanation: safeparse(m.explanation),
        document_sources: safeparse(m.document_sources),
      };
    });

    res.json({
      conversation: convResult.rows[0],
      messages,
      pagination: {
        page: pageNum,
        limit: limitNum,
        has_more: messagesResult.rows.length === limitNum,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Update Conversation (rename) ────────────────────────────────────────────

export const updateConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { title } = req.body;
  const userId = req.user!.id;

  if (!title || !title.trim()) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  try {
    const result = await DatabaseManager.query(
      'UPDATE conversations SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND (user_id = $3 OR user_id IS NULL)',
      [title.trim(), id, userId]
    );

    if ((result.rowCount || 0) === 0) {
      res.status(404).json({ error: 'Conversation not found or access denied' });
      return;
    }

    res.json({ message: 'Conversation renamed', title: title.trim() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Delete Conversation (cascade) ───────────────────────────────────────────

export const deleteConversation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.id;

  try {
    // Verify ownership
    const check = await DatabaseManager.query(
      'SELECT id FROM conversations WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)',
      [id, userId]
    );
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Conversation not found or access denied' });
      return;
    }

    // Delete messages first (cascade)
    await DatabaseManager.query('DELETE FROM messages WHERE conversation_id = $1', [id]);
    await DatabaseManager.query('DELETE FROM conversations WHERE id = $1', [id]);

    res.json({ message: 'Conversation and all messages deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Search Conversations ────────────────────────────────────────────────────

export const searchConversations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { q, projectId } = req.query;
  const userId = req.user!.id;

  if (!q || typeof q !== 'string') {
    res.status(400).json({ error: 'Search query q is required' });
    return;
  }

  try {
    const params: any[] = [userId, `%${q.trim()}%`];
    let query = `
      SELECT c.id, c.title, c.project_id, c.created_at, c.updated_at, c.message_count
      FROM conversations c
      WHERE (c.user_id = $1 OR c.user_id IS NULL)
        AND LOWER(c.title) LIKE LOWER($2)
    `;

    if (projectId) {
      query += ` AND c.project_id = $${params.length + 1}`;
      params.push(projectId);
    }

    query += ' ORDER BY c.updated_at DESC LIMIT 20';

    const result = await DatabaseManager.query(query, params);
    res.json({ conversations: result.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
