import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';
import { executeSqlSchema, previewSqlSchema } from '../validators/sqlValidator.js';
import axios from 'axios';
import { config } from '../config/index.js';

export const validateSQL = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { sql } = req.body;
  if (!sql) {
    res.status(400).json({ error: 'SQL is required' });
    return;
  }

  const upper = sql.trim().toUpperCase();
  const isMulti = sql.split(';').filter((s: string) => s.trim().length > 0).length > 1;

  if (isMulti) {
    res.status(400).json({
      is_valid: false,
      error: 'Multiple SQL statements are prohibited for security.',
      query_type: 'MULTI_STATEMENT',
    });
    return;
  }

  let queryType = 'UNKNOWN';
  if (upper.startsWith('SELECT') || upper.startsWith('WITH')) queryType = 'SELECT';
  else if (upper.startsWith('INSERT')) queryType = 'INSERT';
  else if (upper.startsWith('UPDATE')) queryType = 'UPDATE';
  else if (upper.startsWith('DELETE')) queryType = 'DELETE';
  else if (upper.startsWith('CREATE')) queryType = 'CREATE';
  else if (upper.startsWith('DROP')) queryType = 'DROP';

  const requiresConfirmation = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE'].includes(queryType);

  res.json({
    is_valid: true,
    query_type: queryType,
    requires_confirmation: requiresConfirmation,
  });
};

export const previewSQL = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { sql, projectId } = previewSqlSchema.parse(req.body);
  const userId = req.user!.id;

  // Validate authenticated user ownership of the project
  const projectCheck = await DatabaseManager.query(
    'SELECT id FROM projects WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)',
    [projectId, userId]
  );
  if (projectCheck.rows.length === 0) {
    res.status(403).json({ error: 'Project not found or access denied' });
    return;
  }

  const upper = sql.trim().toUpperCase();

  // If UPDATE or DELETE, preview affected records by converting to SELECT
  if (upper.startsWith('UPDATE') || upper.startsWith('DELETE')) {
    let previewQuery = '';
    if (upper.startsWith('DELETE FROM')) {
      previewQuery = sql.replace(/DELETE\s+FROM/i, 'SELECT * FROM');
    } else if (upper.startsWith('UPDATE')) {
      const match = sql.match(/UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+.*?(WHERE\s+.*)/i);
      if (match) {
        previewQuery = `SELECT * FROM ${match[1]} ${match[2]}`;
      } else {
        const tableMatch = sql.match(/UPDATE\s+([a-zA-Z0-9_]+)/i);
        if (tableMatch) previewQuery = `SELECT * FROM ${tableMatch[1]}`;
      }
    }

    if (previewQuery) {
      try {
        const previewRes = await DatabaseManager.query(previewQuery);
        res.json({
          affected_count: previewRes.rows.length,
          preview_records: previewRes.rows.slice(0, 5),
          warning: `This operation will modify/delete ${previewRes.rows.length} record(s).`
        });
        return;
      } catch (err: any) {
        // Fallback
      }
    }
  }

  res.json({
    affected_count: 1,
    preview_records: [],
    warning: 'Operation requires confirmation before persisting changes.'
  });
};

export const executeSQL = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId, sql, isConfirmed, limit } = executeSqlSchema.parse(req.body);
  const userId = req.user!.id;

  // Validate authenticated user ownership of the project
  const projectCheck = await DatabaseManager.query(
    'SELECT id FROM projects WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)',
    [projectId, userId]
  );
  if (projectCheck.rows.length === 0) {
    res.status(403).json({ error: 'Project not found or access denied' });
    return;
  }

  // Security Check A: Reject multi-statement queries
  const statements = sql.split(';').map((s: string) => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    res.status(400).json({
      status: 'error',
      error: 'Security Violation: Multiple SQL statements in a single execution are prohibited.',
    });
    return;
  }

  // Security Check B: Block dangerous administrative commands
  const dangerousPatterns = ['pg_sleep', 'pg_read_file', 'pg_write_file', 'copy ', 'grant ', 'revoke ', 'drop role', 'alter system', 'pg_terminate_backend'];
  if (dangerousPatterns.some(d => sql.toLowerCase().includes(d))) {
    res.status(400).json({
      status: 'error',
      error: 'Security Violation: Execution of privileged administrative SQL commands is strictly blocked.',
    });
    return;
  }

  const upper = sql.trim().toUpperCase();
  const isSelect = upper.startsWith('SELECT') || upper.startsWith('WITH');
  const isMutation = upper.startsWith('INSERT') || upper.startsWith('UPDATE') || upper.startsWith('DELETE') || upper.startsWith('DROP');

  if (isMutation && !isConfirmed) {
    res.status(403).json({
      error: 'This database modification requires user confirmation.',
      code: 'CONFIRMATION_REQUIRED',
      sql,
    });
    return;
  }

  // Apply row limit to SELECT query if not present
  let safeSql = sql.trim();
  if (isSelect && !safeSql.toUpperCase().includes('LIMIT')) {
    const rowLimit = limit || config.querySafety.maxRowLimit;
    safeSql = `${safeSql.replace(/;$/, '')} LIMIT ${rowLimit};`;
  }

  const startTime = Date.now();
  let queryType = isSelect ? 'SELECT' : 'MUTATION';
  if (upper.startsWith('INSERT')) queryType = 'INSERT';
  if (upper.startsWith('UPDATE')) queryType = 'UPDATE';
  if (upper.startsWith('DELETE')) queryType = 'DELETE';
  if (upper.startsWith('CREATE')) queryType = 'CREATE';
  if (upper.startsWith('DROP')) queryType = 'DROP';

  try {
    const execResult = await DatabaseManager.query(safeSql, undefined, { isAnalyticalQuery: true });
    const duration = Date.now() - startTime;

    const columnNames = execResult.rows.length > 0 ? Object.keys(execResult.rows[0]) : [];

    // Log query history
    const historyId = `qh_${Date.now()}`;
    await DatabaseManager.query(
      'INSERT INTO query_history (id, project_id, user_id, raw_query, sql_statement, query_type, execution_time_ms, row_count, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [historyId, projectId, userId, sql, safeSql, queryType, duration, execResult.rowCount, 'success']
    );

    res.json({
      status: 'success',
      executed_sql: safeSql,
      records: execResult.rows,
      columns: columnNames,
      row_count: execResult.rowCount,
      execution_time_ms: duration,
      query_type: queryType,
      database_mode: execResult.mode || DatabaseManager.getDatabaseMode(),
    });
  } catch (err: any) {
    const duration = Date.now() - startTime;

    // Log error in history
    await DatabaseManager.query(
      'INSERT INTO query_history (id, project_id, user_id, raw_query, sql_statement, query_type, execution_time_ms, row_count, status, error_details) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [`qh_${Date.now()}`, projectId, userId, sql, safeSql, queryType, duration, 0, 'error', err.message]
    );

    res.status(400).json({
      status: 'error',
      executed_sql: safeSql,
      error: err.message,
      execution_time_ms: duration,
    });
  }
};

export const getQueryHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId } = req.query;
  const userId = req.user!.id;

  const result = await DatabaseManager.query(
    'SELECT * FROM query_history WHERE user_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 50',
    [userId, projectId]
  );

  res.json({ history: result.rows });
};
