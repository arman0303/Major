import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';
import axios from 'axios';
import { config } from '../config/index.js';

export const handleAIChat = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { conversationId, projectId, message } = req.body;

  if (!conversationId || !projectId || !message) {
    res.status(400).json({ error: 'conversationId, projectId, and message are required' });
    return;
  }

  try {
    // 1. Get user settings for API key / provider
    const settingsRes = await DatabaseManager.query(
      'SELECT default_llm_provider, gemini_api_key, openai_api_key FROM user_settings WHERE user_id = $1',
      [req.user!.id]
    );
    const userSettings = settingsRes.rows[0] || {};
    const provider = userSettings.default_llm_provider || 'gemini';
    const apiKey = provider === 'gemini' ? userSettings.gemini_api_key : userSettings.openai_api_key;

    // 2. Fetch schema context
    const tablesMeta: Record<string, any[]> = {};
    const schemaRes = await DatabaseManager.query(`
      SELECT table_name, column_name, data_type 
      FROM schema_metadata WHERE project_id = $1
    `, [projectId]);

    // Use default tables if project schema empty
    const defaultTables = DatabaseManager.getAllTables();
    for (const t of defaultTables) {
      const data = DatabaseManager.getTableData(t);
      if (data.length > 0) {
        tablesMeta[t] = Object.keys(data[0]).map(k => ({ name: k, type: typeof data[0][k] === 'number' ? 'NUMERIC' : 'VARCHAR' }));
      }
    }

    // 3. Fetch previous message in conversation for context
    const prevMsgRes = await DatabaseManager.query(
      'SELECT generated_sql FROM messages WHERE conversation_id = $1 AND generated_sql IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [conversationId]
    );
    const previousSql = prevMsgRes.rows[0]?.generated_sql || null;

    // 4. Save User Message
    const userMsgId = `msg_usr_${Date.now()}`;
    await DatabaseManager.query(
      'INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)',
      [userMsgId, conversationId, 'user', message]
    );

    // 5. Call AI Service to Generate SQL
    let aiSqlResult: any;
    try {
      const aiGenRes = await axios.post(`${config.aiServiceUrl}/api/ai/generate-sql`, {
        question: message,
        schema_context: { tables: tablesMeta },
        previous_sql: previousSql,
        provider,
        api_key: apiKey,
      }, { timeout: 15000 });
      aiSqlResult = aiGenRes.data;
    } catch (aiErr: any) {
      console.warn('AI microservice error or unavailable, falling back internally:', aiErr.message);
      aiSqlResult = {
        intent: 'Query data',
        generated_sql: 'SELECT * FROM employees LIMIT 100;',
        query_type: 'SELECT',
        explanation: 'Default fallback query for employee records.',
        requires_confirmation: false,
      };
    }

    const generatedSql = aiSqlResult.generated_sql;
    const queryType = aiSqlResult.query_type || 'SELECT';
    const requiresConfirmation = aiSqlResult.requires_confirmation || ['INSERT', 'UPDATE', 'DELETE', 'DROP'].includes(queryType);

    let queryResult: any = null;
    let executionDuration = 0;
    let vizConfig: any = aiSqlResult.visualization_recommendation || null;
    let executionError: string | null = null;

    // 6. Execute SELECT query automatically
    if (!requiresConfirmation && queryType === 'SELECT') {
      const startExec = Date.now();
      try {
        const dbRes = await DatabaseManager.query(generatedSql);
        executionDuration = Date.now() - startExec;
        const columns = dbRes.rows.length > 0 ? Object.keys(dbRes.rows[0]) : [];

        queryResult = {
          records: dbRes.rows,
          columns,
          row_count: dbRes.rowCount,
        };

        // If visualization config wasn't provided, suggest chart
        if (!vizConfig && dbRes.rows.length > 0) {
          try {
            const chartRes = await axios.post(`${config.aiServiceUrl}/api/ai/suggest-chart`, {
              rows: dbRes.rows.slice(0, 100),
              columns,
              query_intent: aiSqlResult.intent,
            });
            vizConfig = chartRes.data;
          } catch (e) {
            vizConfig = { chart_type: 'table' };
          }
        }
      } catch (execErr: any) {
        executionError = execErr.message;
        // Attempt automatic error correction via AI
        try {
          const correctRes = await axios.post(`${config.aiServiceUrl}/api/ai/correct-sql`, {
            failed_sql: generatedSql,
            error_message: execErr.message,
            schema_context: { tables: tablesMeta },
          });
          if (correctRes.data?.corrected_sql) {
            aiSqlResult.generated_sql = correctRes.data.corrected_sql;
            aiSqlResult.explanation = `${aiSqlResult.explanation} (Auto-corrected: ${correctRes.data.explanation_of_fix})`;
            // Re-execute corrected
            const fixedDbRes = await DatabaseManager.query(correctRes.data.corrected_sql);
            queryResult = {
              records: fixedDbRes.rows,
              columns: fixedDbRes.rows.length > 0 ? Object.keys(fixedDbRes.rows[0]) : [],
              row_count: fixedDbRes.rowCount,
            };
            executionError = null;
          }
        } catch (repairErr) {
          console.warn('Auto-repair failed:', repairErr);
        }
      }
    }

    // 7. Save Assistant Message
    const assistantMsgId = `msg_ast_${Date.now()}`;
    await DatabaseManager.query(
      `INSERT INTO messages (
        id, conversation_id, role, content, generated_sql, query_result, 
        visualization_config, explanation, requires_confirmation, confirmation_status, error_message, execution_time_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        assistantMsgId,
        conversationId,
        'assistant',
        aiSqlResult.explanation || `Executed ${queryType} query.`,
        generatedSql,
        queryResult ? JSON.stringify(queryResult) : null,
        vizConfig ? JSON.stringify(vizConfig) : null,
        JSON.stringify({ simple: aiSqlResult.explanation, technical: `Query type: ${queryType}` }),
        requiresConfirmation,
        requiresConfirmation ? 'pending' : 'none',
        executionError,
        executionDuration
      ]
    );

    // Update conversation timestamp
    await DatabaseManager.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [conversationId]);

    res.json({
      message_id: assistantMsgId,
      intent: aiSqlResult.intent,
      generated_sql: generatedSql,
      query_type: queryType,
      explanation: aiSqlResult.explanation,
      requires_confirmation: requiresConfirmation,
      query_result: queryResult,
      visualization_config: vizConfig,
      execution_time_ms: executionDuration,
      error_message: executionError,
    });
  } catch (err: any) {
    res.status(500).json({ error: `AI chat pipeline failed: ${err.message}` });
  }
};

export const getInsights = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { rows, columns, query } = req.body;
  try {
    const aiRes = await axios.post(`${config.aiServiceUrl}/api/ai/insights`, {
      rows: rows || [],
      columns: columns || [],
      query: query || '',
    });
    res.json(aiRes.data);
  } catch (err: any) {
    res.status(500).json({ error: `Insight derivation failed: ${err.message}` });
  }
};
