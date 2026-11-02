import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';
import { SchemaService, ProjectSchemaContext } from '../services/schemaService.js';
import axios from 'axios';
import { config } from '../config/index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getUserAIConfig(userId: string) {
  try {
    const r = await DatabaseManager.query(
      'SELECT default_llm_provider, gemini_api_key, openai_api_key FROM user_settings WHERE user_id = $1',
      [userId]
    );
    const s = r.rows[0] || {};
    const provider = s.default_llm_provider || 'gemini';
    const apiKey = provider === 'gemini' ? s.gemini_api_key : s.openai_api_key;
    return { provider, apiKey: apiKey || null };
  } catch {
    return { provider: 'gemini', apiKey: null };
  }
}

async function getSchemaContext(projectId: string): Promise<ProjectSchemaContext> {
  return await SchemaService.getProjectSchema(projectId);
}

async function getConversationHistory(conversationId: string, limit = 10): Promise<Array<{ role: string; content: string }>> {
  try {
    const r = await DatabaseManager.query(
      `SELECT role, content FROM messages 
       WHERE conversation_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [conversationId, limit]
    );
    // Reverse so oldest first
    return r.rows.reverse().map(m => ({ role: m.role, content: m.content || '' }));
  } catch {
    return [];
  }
}

async function getPreviousSql(conversationId: string): Promise<string | null> {
  try {
    const r = await DatabaseManager.query(
      `SELECT generated_sql FROM messages 
       WHERE conversation_id = $1 AND generated_sql IS NOT NULL 
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId]
    );
    return r.rows[0]?.generated_sql || null;
  } catch {
    return null;
  }
}

async function hasUploadedDocs(projectId: string): Promise<boolean> {
  try {
    const r = await DatabaseManager.query(
      `SELECT COUNT(*) as cnt FROM uploaded_files WHERE project_id = $1 AND status = 'ready'`,
      [projectId]
    );
    return parseInt(r.rows[0]?.cnt || '0') > 0;
  } catch {
    return false;
  }
}

async function autoTitleConversation(
  conversationId: string,
  firstMessage: string,
  provider: string,
  apiKey: string | null
): Promise<void> {
  try {
    // Only auto-title if current title is the default
    const convR = await DatabaseManager.query(
      'SELECT title, message_count FROM conversations WHERE id = $1',
      [conversationId]
    );
    const conv = convR.rows[0];
    if (!conv || (conv.message_count > 0)) return; // already has messages, skip

    let title = firstMessage.length > 50
      ? firstMessage.substring(0, 47) + '...'
      : firstMessage;

    // Try AI title generation
    try {
      const titleRes = await axios.post(`${config.aiServiceUrl}/api/ai/generate-title`, {
        message: firstMessage,
        provider,
        api_key: apiKey,
      }, { timeout: 5000 });
      if (titleRes.data?.title) {
        title = titleRes.data.title;
      }
    } catch { /* use fallback title */ }

    await DatabaseManager.query(
      'UPDATE conversations SET title = $1 WHERE id = $2',
      [title, conversationId]
    );
  } catch { /* non-fatal */ }
}

// ─── Main Chat Handler ────────────────────────────────────────────────────────

export const handleAIChat = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { conversationId, projectId, message } = req.body;

  if (!conversationId || !projectId || !message) {
    res.status(400).json({ error: 'conversationId, projectId, and message are required' });
    return;
  }

  try {
    const userId = req.user!.id;

    // 1. Verify conversation belongs to this user's project (and user when user_id column exists)
    const convCheck = await DatabaseManager.query(
      'SELECT id FROM conversations WHERE id = $1 AND project_id = $2 AND (user_id = $3 OR user_id IS NULL)',
      [conversationId, projectId, userId]
    );
    if (convCheck.rows.length === 0) {
      res.status(403).json({ error: 'Conversation not found or access denied' });
      return;
    }

    // 2. Get user AI settings
    const { provider, apiKey } = await getUserAIConfig(userId);

    // 3. Build context in parallel
    const [schemaContext, conversationHistory, previousSql, docsAvailable] = await Promise.all([
      getSchemaContext(projectId),
      getConversationHistory(conversationId, 12),
      getPreviousSql(conversationId),
      hasUploadedDocs(projectId),
    ]);

    // 4. Save user message
    const userMsgId = `msg_usr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    await DatabaseManager.query(
      'INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)',
      [userMsgId, conversationId, 'user', message]
    );

    // 5. Auto-title conversation from first message
    autoTitleConversation(conversationId, message, provider, apiKey).catch(() => {});

    // 6. Call unified AI chat endpoint
    let aiResponse: any;
    const aiPayload = {
      message,
      schema_context: {
        tables: schemaContext.tables,
        relationships: schemaContext.relationships,
        row_counts: schemaContext.table_row_counts,
      },
      conversation_history: conversationHistory,
      previous_sql: previousSql,
      project_id: projectId,
      user_id: userId,
      has_uploaded_docs: docsAvailable,
      provider,
      api_key: apiKey,
    };

    try {
      const aiRes = await axios.post(`${config.aiServiceUrl}/api/ai/chat`, aiPayload, {
        timeout: 30000,
      });
      aiResponse = aiRes.data;
    } catch (aiErr: any) {
      console.warn('AI chat service error:', aiErr.message);
      const isConnectionError = aiErr.code === 'ECONNREFUSED' || aiErr.message?.includes('ECONNREFUSED');
      const errorMsg = isConnectionError
        ? `The AI microservice (${config.aiServiceUrl}) is currently unreachable. Please ensure the Python service is running ('uvicorn app.main:app --port 8000').`
        : `AI Service Error: ${aiErr.response?.data?.detail || aiErr.message}`;

      res.status(502).json({
        error: errorMsg,
        service: 'ai-service',
        status: 'unavailable'
      });
      return;
    }

    const intent = aiResponse.intent || 'sql_analytics';
    const responseType = aiResponse.response_type || intent;
    const generatedSql = aiResponse.generated_sql || null;
    const queryType = aiResponse.query_type || (generatedSql ? 'SELECT' : null);
    const requiresConfirmation =
      aiResponse.requires_confirmation ||
      ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'CREATE', 'ALTER'].includes(queryType || '');

    let queryResult: any = null;
    let executionDuration = 0;
    let vizConfig: any = aiResponse.visualization_recommendation || null;
    let executionError: string | null = null;
    let answerText = aiResponse.answer || aiResponse.explanation || `Processed ${intent} request.`;

    // 7. Security Validation, Schema Verification, and Automated Execution for Safe SELECT Queries
    if (!requiresConfirmation && queryType === 'SELECT' && generatedSql) {
      // Security Check A: Reject multi-statement queries
      const statements = generatedSql.split(';').map((s: string) => s.trim()).filter(Boolean);
      if (statements.length > 1) {
        executionError = 'Security Violation: Multiple SQL statements in a single execution are prohibited.';
      }

      // Security Check B: Block dangerous / administrative commands
      const dangerousPatterns = ['pg_sleep', 'pg_read_file', 'pg_write_file', 'copy ', 'grant ', 'revoke ', 'drop role', 'alter system', 'pg_terminate_backend'];
      if (!executionError && dangerousPatterns.some(d => generatedSql.toLowerCase().includes(d))) {
        executionError = 'Security Violation: Execution of privileged administrative SQL commands is strictly blocked.';
      }

      // Schema Check C: Verify referenced tables exist in project schema
      if (!executionError) {
        const schemaCheck = SchemaService.verifySQLAgainstSchema(generatedSql, schemaContext);
        if (!schemaCheck.valid) {
          executionError = `Schema Validation Error: Query references non-existent table(s): ${schemaCheck.missingTables.join(', ')}.`;
        }
      }

      // Only execute if all validations pass
      if (!executionError) {
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

          // Post-Execution Answer Synthesis: Ground answer in real returned rows
          try {
            const synthRes = await axios.post(`${config.aiServiceUrl}/api/ai/synthesize-answer`, {
              question: message,
              sql: generatedSql,
              rows: dbRes.rows.slice(0, 30),
              columns,
              row_count: dbRes.rowCount,
              provider,
              api_key: apiKey,
            }, { timeout: 12000 });
            if (synthRes.data?.synthesized_answer) {
              answerText = synthRes.data.synthesized_answer;
            }
          } catch (synthErr: any) {
            console.warn('Answer synthesis notice:', synthErr.message);
          }

          // Get chart recommendation if not provided
          if (!vizConfig && dbRes.rows.length > 0) {
            try {
              const chartRes = await axios.post(`${config.aiServiceUrl}/api/ai/suggest-chart`, {
                rows: dbRes.rows.slice(0, 100),
                columns,
                query_intent: intent,
              }, { timeout: 5000 });
              vizConfig = chartRes.data;
            } catch {
              vizConfig = { chart_type: 'table' };
            }
          }
        } catch (execErr: any) {
          executionError = execErr.message;
          // Attempt auto-correction with real LLM
          if (apiKey) {
            try {
              const correctRes = await axios.post(`${config.aiServiceUrl}/api/ai/correct-sql`, {
                failed_sql: generatedSql,
                error_message: execErr.message,
                schema_context: { tables: schemaContext.tables },
                provider,
                api_key: apiKey,
              }, { timeout: 10000 });
              if (correctRes.data?.corrected_sql) {
                const correctedSql = correctRes.data.corrected_sql;
                // Re-verify corrected query against schema and security checks
                const correctedCheck = SchemaService.verifySQLAgainstSchema(correctedSql, schemaContext);
                if (correctedCheck.valid) {
                  const fixedRes = await DatabaseManager.query(correctedSql);
                  const fixedColumns = fixedRes.rows.length > 0 ? Object.keys(fixedRes.rows[0]) : [];
                  queryResult = {
                    records: fixedRes.rows,
                    columns: fixedColumns,
                    row_count: fixedRes.rowCount,
                  };
                  aiResponse.generated_sql = correctedSql;
                  executionError = null;

                  // Post-execution synthesis on corrected query result
                  try {
                    const synthRes = await axios.post(`${config.aiServiceUrl}/api/ai/synthesize-answer`, {
                      question: message,
                      sql: correctedSql,
                      rows: fixedRes.rows.slice(0, 30),
                      columns: fixedColumns,
                      row_count: fixedRes.rowCount,
                      provider,
                      api_key: apiKey,
                    }, { timeout: 12000 });
                    if (synthRes.data?.synthesized_answer) {
                      answerText = synthRes.data.synthesized_answer;
                    }
                  } catch {}
                }
              }
            } catch { /* auto-correct failed */ }
          }
        }
      }
    }

    if (executionError) {
      answerText = `Execution notice: ${executionError}`;
    }

    // 9. Save assistant message
    const assistantMsgId = `msg_ast_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    await DatabaseManager.query(
      `INSERT INTO messages (
        id, conversation_id, role, content, generated_sql, query_result,
        visualization_config, explanation, requires_confirmation, confirmation_status,
        error_message, execution_time_ms, intent_type, document_sources
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        assistantMsgId,
        conversationId,
        'assistant',
        answerText,
        aiResponse.generated_sql || null,
        queryResult ? JSON.stringify(queryResult) : null,
        vizConfig ? JSON.stringify(vizConfig) : null,
        JSON.stringify({ simple: answerText, technical: `Query type: ${queryType}` }),
        requiresConfirmation,
        requiresConfirmation ? 'pending' : 'none',
        executionError,
        executionDuration,
        intent,
        aiResponse.document_sources ? JSON.stringify(aiResponse.document_sources) : null,
      ]
    );

    // 10. Update conversation timestamp and message count
    await DatabaseManager.query(
      'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP, message_count = COALESCE(message_count, 0) + 2 WHERE id = $1',
      [conversationId]
    );

    res.json({
      message_id: assistantMsgId,
      intent,
      response_type: responseType,
      answer: answerText,
      generated_sql: aiResponse.generated_sql || null,
      query_type: queryType,
      explanation: answerText,
      requires_confirmation: requiresConfirmation,
      query_result: queryResult,
      visualization_config: vizConfig,
      execution_time_ms: executionDuration,
      error_message: executionError,
      document_sources: aiResponse.document_sources || [],
      ddl_statements: aiResponse.ddl_statements || [],
    });
  } catch (err: any) {
    console.error('AI chat pipeline error:', err);
    res.status(500).json({ error: `AI chat pipeline failed: ${err.message}` });
  }
};

// ─── Insights ─────────────────────────────────────────────────────────────────

export const getInsights = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { rows, columns, query } = req.body;
  try {
    const aiRes = await axios.post(`${config.aiServiceUrl}/api/ai/insights`, {
      rows: rows || [],
      columns: columns || [],
      query: query || '',
    }, { timeout: 10000 });
    res.json(aiRes.data);
  } catch (err: any) {
    res.status(500).json({ error: `Insight derivation failed: ${err.message}` });
  }
};

// ─── Document Indexing ────────────────────────────────────────────────────────

export const indexDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { fileId, projectId, content, metadata, chunks } = req.body;
  if (!projectId || (!content && !chunks)) {
    res.status(400).json({ error: 'projectId and content or chunks are required' });
    return;
  }

  const userId = req.user!.id;
  const { provider, apiKey } = await getUserAIConfig(userId);

  try {
    // If chunks are provided (e.g., from PDF parsing), index each chunk
    const chunksToIndex = chunks && chunks.length > 0
      ? chunks
      : [{ content, metadata: metadata || {} }];

    let totalIndexed = 0;
    const errors: string[] = [];

    for (const chunk of chunksToIndex) {
      try {
        await axios.post(`${config.aiServiceUrl}/api/ai/rag/index`, {
          project_id: projectId,
          user_id: userId,
          file_id: fileId,
          content: chunk.content || chunk,
          metadata: chunk.metadata || metadata || {},
          chunk_size: 800,
          chunk_overlap: 100,
        }, { timeout: 10000 });
        totalIndexed++;
      } catch (e: any) {
        errors.push(e.message);
      }
    }

    // Update file status in database
    if (fileId) {
      await DatabaseManager.query(
        `UPDATE uploaded_files SET status = $1, chunk_count = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [errors.length === 0 ? 'ready' : 'partial', totalIndexed, fileId]
      ).catch(() => {});
    }

    res.json({
      indexed: true,
      chunks_indexed: totalIndexed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Document indexing failed: ${err.message}` });
  }
};
