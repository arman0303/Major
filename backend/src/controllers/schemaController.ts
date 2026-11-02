import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';
import { SchemaService } from '../services/schemaService.js';
import axios from 'axios';
import { config } from '../config/index.js';

export const getSchema = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId } = req.query;
  const pId = (projectId as string) || 'default_project';

  try {
    const projectSchema = await SchemaService.getProjectSchema(pId);

    res.json({
      tables: projectSchema.tables,
      table_names: Object.keys(projectSchema.tables),
      relationships: projectSchema.relationships,
      table_row_counts: projectSchema.table_row_counts,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Schema retrieval failed: ${err.message}` });
  }
};

export const generateSchema = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { prompt } = req.body;
  if (!prompt) {
    res.status(400).json({ error: 'Prompt is required' });
    return;
  }

  try {
    const userId = req.user?.id;
    let provider = 'gemini';
    let apiKey = null;
    if (userId) {
      try {
        const userSettings = await DatabaseManager.query(
          'SELECT default_llm_provider, gemini_api_key, openai_api_key FROM user_settings WHERE user_id = $1',
          [userId]
        );
        const s = userSettings.rows[0] || {};
        provider = s.default_llm_provider || 'gemini';
        apiKey = provider === 'gemini' ? s.gemini_api_key : s.openai_api_key;
      } catch { /* use defaults */ }
    }

    const aiRes = await axios.post(`${config.aiServiceUrl}/api/ai/generate-schema`, {
      prompt,
      provider,
      api_key: apiKey,
    });
    res.json(aiRes.data);
  } catch (err: any) {
    res.status(500).json({ error: `Schema generation failed: ${err.message}` });
  }
};

export const executeDDL = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { ddlStatements, isConfirmed } = req.body;

  if (!isConfirmed) {
    res.status(403).json({ error: 'DDL execution requires explicit user confirmation', code: 'CONFIRMATION_REQUIRED' });
    return;
  }

  if (!Array.isArray(ddlStatements) || ddlStatements.length === 0) {
    res.status(400).json({ error: 'ddlStatements array is required' });
    return;
  }

  const executed: string[] = [];
  try {
    for (const stmt of ddlStatements) {
      await DatabaseManager.query(stmt);
      executed.push(stmt);
    }
    res.json({
      message: 'DDL executed successfully',
      executedCount: executed.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: `DDL execution failed: ${err.message}` });
  }
};
