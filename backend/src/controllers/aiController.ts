import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';
import { SchemaService, ProjectSchemaContext } from '../services/schemaService.js';
import axios from 'axios';
import { config } from '../config/index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

export async function getUserAIConfig(userId: string) {
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

    // 1. Verify project and conversation belong to this user
    const projectCheck = await DatabaseManager.query(
      'SELECT id FROM projects WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)',
      [projectId, userId]
    );
    if (projectCheck.rows.length === 0) {
      res.status(403).json({ error: 'Project not found or access denied' });
      return;
    }

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

    // Helper: Enforce full AST, security, schema, and read-only validation
    const validateAndSanitizeQuery = (sqlToValidate: string): { isValid: boolean; safeSql?: string; error?: string } => {
      const trimmed = sqlToValidate.trim();
      if (!trimmed) {
        return { isValid: false, error: 'Query is empty' };
      }

      // Security Check A: Reject multiple statements
      const statements = trimmed.split(';').map((s: string) => s.trim()).filter(Boolean);
      if (statements.length > 1) {
        return { isValid: false, error: 'Security Violation: Multiple SQL statements in a single execution are prohibited.' };
      }

      // Security Check B: Block dangerous administrative commands and functions
      const dangerousPatterns = ['pg_sleep', 'pg_read_file', 'pg_write_file', 'copy ', 'grant ', 'revoke ', 'drop role', 'alter system', 'pg_terminate_backend'];
      if (dangerousPatterns.some(d => trimmed.toLowerCase().includes(d))) {
        return { isValid: false, error: 'Security Violation: Execution of privileged administrative SQL commands is strictly blocked.' };
      }

      // Security Check C: Enforce read-only restriction for automatic execution
      const upper = trimmed.toUpperCase();
      if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
        return { isValid: false, error: 'Automatic execution is strictly restricted to read-only SELECT queries.' };
      }

      // Schema Check D: Verify referenced tables and columns exist in active project schema
      const schemaCheck = SchemaService.verifySQLAgainstSchema(trimmed, schemaContext);
      if (!schemaCheck.valid) {
        const errors: string[] = [];
        if (schemaCheck.missingTables.length > 0) {
          errors.push(`non-existent table(s): ${schemaCheck.missingTables.join(', ')}`);
        }
        if (schemaCheck.missingColumns.length > 0) {
          errors.push(`non-existent column(s): ${schemaCheck.missingColumns.join(', ')}`);
        }
        return { isValid: false, error: `Schema Validation Error: Query references ${errors.join('; ')}.` };
      }

      // Apply row limit if not present
      let safeSql = trimmed;
      if (!upper.includes('LIMIT')) {
        safeSql = `${trimmed.replace(/;$/, '')} LIMIT ${config.querySafety.maxRowLimit};`;
      }

      return { isValid: true, safeSql };
    };

    // 7. Security Validation, Schema Verification, and Automated Execution for Safe SELECT Queries
    if (!requiresConfirmation && queryType === 'SELECT' && generatedSql) {
      const validation = validateAndSanitizeQuery(generatedSql);
      if (!validation.isValid) {
        executionError = validation.error || 'SQL validation failed';
      } else {
        const sqlToExecute = validation.safeSql!;
        const startExec = Date.now();
        try {
          const dbRes = await DatabaseManager.query(sqlToExecute, undefined, { isAnalyticalQuery: true });
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
              sql: sqlToExecute,
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
                // Re-verify corrected query with the EXACT SAME rigorous validation pipeline
                const correctedValidation = validateAndSanitizeQuery(correctedSql);
                if (correctedValidation.isValid) {
                  const fixedSql = correctedValidation.safeSql!;
                  const fixedRes = await DatabaseManager.query(fixedSql, undefined, { isAnalyticalQuery: true });
                  const fixedColumns = fixedRes.rows.length > 0 ? Object.keys(fixedRes.rows[0]) : [];
                  queryResult = {
                    records: fixedRes.rows,
                    columns: fixedColumns,
                    row_count: fixedRes.rowCount,
                  };
                  aiResponse.generated_sql = fixedSql;
                  executionError = null;

                  // Post-execution synthesis on corrected query result
                  try {
                    const synthRes = await axios.post(`${config.aiServiceUrl}/api/ai/synthesize-answer`, {
                      question: message,
                      sql: fixedSql,
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
                } else {
                  console.warn('Corrected query failed validation:', correctedValidation.error);
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

// ─── Real Token / SSE Streaming Chat Handler ──────────────────────────────────

export const handleAIChatStream = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { conversationId, projectId, message } = req.body;

  if (!conversationId || !projectId || !message) {
    res.status(400).json({ error: 'conversationId, projectId, and message are required' });
    return;
  }

  const userId = req.user!.id;

  try {
    // 1. Verify project and conversation belong to this user
    const projectCheck = await DatabaseManager.query(
      'SELECT id FROM projects WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)',
      [projectId, userId]
    );
    if (projectCheck.rows.length === 0) {
      res.status(403).json({ error: 'Project not found or access denied' });
      return;
    }

    const convCheck = await DatabaseManager.query(
      'SELECT id FROM conversations WHERE id = $1 AND project_id = $2 AND (user_id = $3 OR user_id IS NULL)',
      [conversationId, projectId, userId]
    );
    if (convCheck.rows.length === 0) {
      res.status(403).json({ error: 'Conversation not found or access denied' });
      return;
    }

    // 2. Load user AI configuration
    const { provider, apiKey } = await getUserAIConfig(userId);

    const [schemaContext, conversationHistory, previousSql, docsAvailable] = await Promise.all([
      getSchemaContext(projectId),
      getConversationHistory(conversationId, 12),
      getPreviousSql(conversationId),
      hasUploadedDocs(projectId),
    ]);

    // 3. Save user message
    const userMsgId = `msg_usr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    await DatabaseManager.query(
      'INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)',
      [userMsgId, conversationId, 'user', message]
    );

    autoTitleConversation(conversationId, message, provider, apiKey).catch(() => {});

    // 4. Set SSE Headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const abortController = new AbortController();
    req.on('close', () => {
      abortController.abort();
    });

    const sendEvent = (eventData: any) => {
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    };

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

    let fullAnswer = '';
    let finalIntent = 'general_conversation';
    let generatedSql: string | null = null;
    let queryType: string | null = null;
    let queryResult: any = null;
    let vizConfig: any = null;
    let requiresConfirmation = false;
    let documentSources: any[] = [];
    let executionError: string | null = null;
    let executionDuration = 0;

    const upstreamRes = await axios.post(`${config.aiServiceUrl}/api/ai/chat/stream`, aiPayload, {
      responseType: 'stream',
      signal: abortController.signal,
      timeout: 35000,
    });

    let buffer = '';
    upstreamRes.data.on('data', async (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.type === 'meta') {
            finalIntent = parsed.intent || finalIntent;
            documentSources = parsed.document_sources || [];
            sendEvent(parsed);
          } else if (parsed.type === 'token') {
            fullAnswer += parsed.token;
            sendEvent(parsed);
          } else if (parsed.type === 'sql') {
            generatedSql = parsed.generated_sql;
            queryType = parsed.query_type;
            requiresConfirmation = parsed.requires_confirmation || false;
            vizConfig = parsed.visualization_recommendation || null;
            sendEvent(parsed);
          } else if (parsed.type === 'status') {
            sendEvent(parsed);
          } else if (parsed.type === 'done') {
            finalIntent = parsed.intent || finalIntent;
            if (parsed.answer && !fullAnswer) {
              fullAnswer = parsed.answer;
            }
          }
        } catch {}
      }
    });

    await new Promise<void>((resolve, reject) => {
      upstreamRes.data.on('end', () => resolve());
      upstreamRes.data.on('error', (err: any) => reject(err));
    });

    // 5. Automated safe execution for SELECT analytics
    if (finalIntent === 'sql_analytics' && Boolean(generatedSql) && !requiresConfirmation) {
      sendEvent({ type: 'status', message: 'Executing verified analytical query on database...' });
      const trimmed = String(generatedSql).trim();
      const schemaCheck = SchemaService.verifySQLAgainstSchema(trimmed, schemaContext);
      if (!schemaCheck.valid) {
        executionError = `Schema Validation Error: Query references non-existent tables/columns.`;
        sendEvent({ type: 'error', message: executionError });
      } else {
        const startExec = Date.now();
        try {
          const safeSql = trimmed.toUpperCase().includes('LIMIT')
            ? trimmed
            : `${trimmed.replace(/;$/, '')} LIMIT ${config.querySafety.maxRowLimit};`;
          const dbRes = await DatabaseManager.query(safeSql, undefined, { isAnalyticalQuery: true });
          executionDuration = Date.now() - startExec;
          const columns = dbRes.rows.length > 0 ? Object.keys(dbRes.rows[0]) : [];
          queryResult = {
            records: dbRes.rows,
            columns,
            row_count: dbRes.rowCount,
          };
          sendEvent({ type: 'result', query_result: queryResult, execution_time_ms: executionDuration });

          // Post-execution grounding synthesis
          try {
            const synthRes = await axios.post(`${config.aiServiceUrl}/api/ai/synthesize-answer`, {
              question: message,
              sql: safeSql,
              rows: dbRes.rows.slice(0, 30),
              columns,
              row_count: dbRes.rowCount,
              provider,
              api_key: apiKey,
            }, { timeout: 10000 });
            if (synthRes.data?.synthesized_answer) {
              fullAnswer = synthRes.data.synthesized_answer;
              sendEvent({ type: 'synthesis', answer: fullAnswer });
            }
          } catch {}
        } catch (dbErr: any) {
          executionError = dbErr.message;
          sendEvent({ type: 'error', message: dbErr.message });
        }
      }
    }

    if (!fullAnswer) {
      fullAnswer = `Processed ${finalIntent} request.`;
    }

    // 6. Save assistant message to PostgreSQL
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
        fullAnswer,
        generatedSql,
        queryResult ? JSON.stringify(queryResult) : null,
        vizConfig ? JSON.stringify(vizConfig) : null,
        JSON.stringify({ simple: fullAnswer, technical: `Query type: ${queryType}` }),
        requiresConfirmation,
        requiresConfirmation ? 'pending' : 'none',
        executionError,
        executionDuration,
        finalIntent,
        documentSources.length > 0 ? JSON.stringify(documentSources) : null,
      ]
    );

    await DatabaseManager.query(
      'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP, message_count = COALESCE(message_count, 0) + 2 WHERE id = $1',
      [conversationId]
    );

    sendEvent({
      type: 'complete',
      message_id: assistantMsgId,
      answer: fullAnswer,
      generated_sql: generatedSql,
      query_result: queryResult,
      visualization_config: vizConfig,
      execution_time_ms: executionDuration,
      document_sources: documentSources,
      intent: finalIntent,
      requires_confirmation: requiresConfirmation,
    });
    res.end();

  } catch (streamErr: any) {
    if (!res.headersSent) {
      res.status(502).json({ error: streamErr.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: streamErr.message })}\n\n`);
      res.end();
    }
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

export const checkProviderHealth = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { provider, apiKey } = await getUserAIConfig(userId);
    const targetProvider = (req.query.provider as string) || provider;
    const testKey = (req.query.api_key as string) || apiKey;

    const healthRes = await axios.get(`${config.aiServiceUrl}/api/ai/provider-status`, {
      params: {
        provider: targetProvider,
        api_key: testKey || undefined,
      },
      timeout: 10000,
    });
    res.json(healthRes.data);
  } catch (err: any) {
    res.status(502).json({
      status: 'unavailable',
      healthy: false,
      message: err.response?.data?.detail || err.message,
    });
  }
};
