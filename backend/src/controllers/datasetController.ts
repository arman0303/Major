import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';
import axios from 'axios';
import { config } from '../config/index.js';
import fs from 'fs';
import FormData from 'form-data';
import csv from 'csv-parser';

// ── Helpers for Local File Parsing ───────────────────────────────────────────

function parseCSVLocally(filePath: string): Promise<{ columns: any[]; rows: any[]; rowCount: number; preview: any[] }> {
  return new Promise((resolve, reject) => {
    const rows: any[] = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        const cleanRow: Record<string, any> = {};
        for (const [k, v] of Object.entries(data)) {
          const cleanKey = k.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
          let val: any = v;
          if (typeof val === 'string') {
            const trimmed = val.trim();
            if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'none') {
              val = null;
            } else {
              val = trimmed;
            }
          }
          cleanRow[cleanKey] = val;
        }
        rows.push(cleanRow);
      })
      .on('end', () => {
        if (rows.length === 0) {
          return resolve({ columns: [], rows: [], rowCount: 0, preview: [] });
        }
        const first = rows[0];
        const columns = Object.keys(first).map(col => {
          let isNum = true;
          let isInt = true;
          let isDate = true;
          let isBool = true;
          let nonNullCount = 0;

          for (const r of rows.slice(0, 50)) {
            const v = r[col];
            if (v !== null && v !== undefined) {
              nonNullCount++;
              const strV = String(v);
              if (isNaN(Number(v))) isNum = false;
              if (!Number.isInteger(Number(v))) isInt = false;
              if (isNaN(Date.parse(strV)) || !strV.includes('-') && !strV.includes('/')) isDate = false;
              if (strV.toLowerCase() !== 'true' && strV.toLowerCase() !== 'false') isBool = false;
            }
          }

          let type = 'VARCHAR(255)';
          if (nonNullCount > 0) {
            if (isBool) type = 'BOOLEAN';
            else if (isNum) type = isInt ? 'BIGINT' : 'NUMERIC(14,2)';
            else if (isDate) type = 'TIMESTAMP';
          }

          return {
            name: col,
            type,
            is_primary_key: col.endsWith('_id') || col === 'id',
            nullable: true,
          };
        });

        // Cast rows according to inferred types
        const typedRows = rows.map(r => {
          const newR: Record<string, any> = {};
          for (const c of columns) {
            const raw = r[c.name];
            if (raw === null || raw === undefined) {
              newR[c.name] = null;
            } else if (c.type === 'BIGINT') {
              newR[c.name] = parseInt(raw, 10);
            } else if (c.type === 'NUMERIC(14,2)') {
              newR[c.name] = parseFloat(raw);
            } else if (c.type === 'BOOLEAN') {
              newR[c.name] = String(raw).toLowerCase() === 'true';
            } else {
              newR[c.name] = raw;
            }
          }
          return newR;
        });

        resolve({
          columns,
          rows: typedRows,
          rowCount: typedRows.length,
          preview: typedRows.slice(0, 10),
        });
      })
      .on('error', reject);
  });
}

function parseJSONLocally(filePath: string): { columns: any[]; rows: any[]; rowCount: number; preview: any[] } {
  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) && typeof parsed === 'object') {
    for (const val of Object.values(parsed)) {
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        parsed = val;
        break;
      }
    }
  }
  const rawRows: any[] = Array.isArray(parsed) ? parsed : [parsed];
  const rows = rawRows.map(r => {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) {
      const cleanKey = k.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      clean[cleanKey] = v === '' ? null : v;
    }
    return clean;
  });

  const first = rows[0] || {};
  const columns = Object.keys(first).map(k => ({
    name: k,
    type: typeof first[k] === 'number'
      ? Number.isInteger(first[k]) ? 'BIGINT' : 'NUMERIC(14,2)'
      : typeof first[k] === 'boolean' ? 'BOOLEAN' : 'VARCHAR(255)',
    is_primary_key: k.endsWith('_id') || k === 'id',
    nullable: true,
  }));

  return {
    columns,
    rows,
    rowCount: rows.length,
    preview: rows.slice(0, 10),
  };
}

// ── Controllers ─────────────────────────────────────────────────────────────

export const listDatasets = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId } = req.query;
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  const result = await DatabaseManager.query(
    'SELECT id, name, table_name, file_type, row_count, schema_info, status, created_at FROM datasets WHERE project_id = $1 ORDER BY created_at DESC',
    [projectId]
  );
  res.json({ datasets: result.rows });
};

export const uploadDataset = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const file = req.file;
  const { projectId, name, tableName } = req.body;

  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }

  let baseTableName = (tableName || file.originalname.split('.')[0])
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^[^a-z_]+/, 'tbl_');

  // Prevent cross-project table collisions: check if table_name is already owned by another project
  let safeTableName = baseTableName;
  try {
    const existingTableCheck = await DatabaseManager.query(
      `SELECT project_id FROM datasets WHERE table_name = $1 AND project_id != $2 LIMIT 1`,
      [baseTableName, projectId]
    );
    if (existingTableCheck.rows.length > 0) {
      // Append project-specific short hash to isolate table namespace
      const pHash = projectId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
      safeTableName = `${baseTableName}_p${pHash}`;
    }
  } catch { /* proceed with baseTableName */ }

  const fileExt = file.originalname.split('.').pop()?.toLowerCase() || 'csv';

  try {
    let profileData: any = null;
    let parsedRows: any[] = [];

    // 1. Attempt AI Parsing Service first
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(file.path), file.originalname);

      const aiResponse = await axios.post(`${config.aiServiceUrl}/api/ai/parse-file`, form, {
        headers: form.getHeaders(),
        timeout: 10000,
      });
      profileData = aiResponse.data;
    } catch (err: any) {
      console.warn('AI parsing service unreachable, using robust local parsing:', err.message);
    }

    // 2. Local parser fallback & full data extraction
    if (fileExt === 'csv') {
      const localResult = await parseCSVLocally(file.path).catch(e => {
        console.warn('CSV local parsing error:', e);
        return { columns: [], rows: [], rowCount: 0, preview: [] };
      });
      parsedRows = localResult.rows;
      if (!profileData || !profileData.columns || profileData.columns.length === 0) {
        profileData = localResult;
      }
    } else if (fileExt === 'json') {
      try {
        const localResult = parseJSONLocally(file.path);
        parsedRows = localResult.rows;
        if (!profileData || !profileData.columns || profileData.columns.length === 0) {
          profileData = localResult;
        }
      } catch (e: any) {
        console.warn('JSON local parsing error:', e);
      }
    }

    const datasetId = `ds_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const rowCount = parsedRows.length || profileData?.row_count || 0;
    const columns = profileData?.columns || [];

    // 3. Persist Structured Tables (CSV & JSON) using transactional multi-row batch insert
    if (fileExt === 'csv' || fileExt === 'json') {
      // Always store in DatabaseManager local store for immediate local simulation
      if (parsedRows.length > 0) {
        DatabaseManager.setTableData(safeTableName, parsedRows);
      }

      // If PostgreSQL is connected, dynamically create table and batch-insert EVERY row
      if (DatabaseManager.isPostgres() && columns.length > 0) {
        await DatabaseManager.transaction(async (execQuery) => {
          // Replace policy: drop existing table for this project if re-uploading
          await execQuery(`DROP TABLE IF EXISTS "${safeTableName}" CASCADE;`);

          const colDefs = columns.map((c: any) => `"${c.name}" ${c.type || 'VARCHAR(255)'}`).join(', ');
          await execQuery(`CREATE TABLE "${safeTableName}" (${colDefs});`);

          // Batch insert in chunks of 100 rows to optimize throughput and stay within bind parameters
          const BATCH_SIZE = 100;
          for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
            const batch = parsedRows.slice(i, i + BATCH_SIZE);
            const valueClauses: string[] = [];
            const flatValues: any[] = [];

            batch.forEach((row, rowIdx) => {
              const rowPlaceholders: string[] = [];
              columns.forEach((c: any, colIdx: number) => {
                const paramIdx = rowIdx * columns.length + colIdx + 1;
                rowPlaceholders.push(`$${paramIdx}`);
                const val = row[c.name];
                flatValues.push(val === undefined || val === '' ? null : val);
              });
              valueClauses.push(`(${rowPlaceholders.join(', ')})`);
            });

            const colNames = columns.map((c: any) => `"${c.name}"`).join(', ');
            const insertSql = `INSERT INTO "${safeTableName}" (${colNames}) VALUES ${valueClauses.join(', ')}`;
            await execQuery(insertSql, flatValues);
          }

          // Verify inserted row count
          const countRes = await execQuery(`SELECT COUNT(*) AS count FROM "${safeTableName}"`);
          const actualInserted = parseInt(countRes.rows[0]?.count || '0', 10);
          if (actualInserted !== parsedRows.length) {
            throw new Error(`Row count mismatch: expected ${parsedRows.length} rows, but database has ${actualInserted}`);
          }

          // Refresh schema_metadata for project
          await execQuery(`DELETE FROM schema_metadata WHERE project_id = $1 AND table_name = $2`, [projectId, safeTableName]);
          for (const col of columns) {
            await execQuery(
              `INSERT INTO schema_metadata (project_id, table_name, column_name, data_type, is_nullable, is_primary_key)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [projectId, safeTableName, col.name, col.type, col.nullable ?? true, col.is_primary_key ?? false]
            );
          }
        });
      } else {
        // Fallback store metadata refresh
        try {
          await DatabaseManager.query(`DELETE FROM schema_metadata WHERE project_id = $1 AND table_name = $2`, [projectId, safeTableName]);
          for (const col of columns) {
            await DatabaseManager.query(
              `INSERT INTO schema_metadata (project_id, table_name, column_name, data_type, is_nullable, is_primary_key)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [projectId, safeTableName, col.name, col.type, col.nullable ?? true, col.is_primary_key ?? false]
            );
          }
        } catch { /* local store */ }
      }
    }

    // 4. Create dataset inventory record
    await DatabaseManager.query(
      'INSERT INTO datasets (id, project_id, name, table_name, file_type, file_path, row_count, schema_info, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        datasetId,
        projectId,
        name || file.originalname,
        safeTableName,
        fileExt,
        file.path,
        rowCount,
        JSON.stringify(columns),
        'ready'
      ]
    );

    // 5. Index Document Chunks for PDF & TXT into RAG Store
    if (fileExt === 'pdf' || fileExt === 'txt') {
      let chunks: any[] = [];
      if (profileData?.chunks && profileData.chunks.length > 0) {
        chunks = profileData.chunks;
      } else {
        let textContent = '';
        if (fileExt === 'txt') {
          textContent = fs.readFileSync(file.path, 'utf-8');
        } else if (profileData?.text_content) {
          textContent = profileData.text_content;
        }

        if (textContent) {
          const chunkSize = 800;
          for (let i = 0; i < textContent.length; i += 700) {
            chunks.push({
              content: textContent.substring(i, i + chunkSize),
              metadata: { source: file.originalname, page_number: Math.floor(i / 1500) + 1 }
            });
          }
        }
      }

      // Record in uploaded_files
      await DatabaseManager.query(
        `INSERT INTO uploaded_files (id, user_id, project_id, original_name, file_type, file_size_bytes, status, chunk_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [datasetId, req.user?.id || 'default_user', projectId, file.originalname, fileExt, file.size, 'ready', chunks.length]
      ).catch(() => {});

      // Index chunks into RAG store
      for (const chunk of chunks) {
        try {
          await axios.post(`${config.aiServiceUrl}/api/ai/rag/index`, {
            project_id: projectId,
            user_id: req.user?.id || 'default_user',
            file_id: datasetId,
            content: chunk.content,
            metadata: {
              source: file.originalname,
              page_number: chunk.metadata?.page_number || 1,
              dataset_id: datasetId,
            }
          }, { timeout: 10000 });
        } catch (ragErr: any) {
          console.warn('RAG indexing chunk notice:', ragErr.message);
        }
      }
    }

    res.status(201).json({
      message: 'Dataset uploaded, profiled, and loaded successfully',
      dataset: {
        id: datasetId,
        name: name || file.originalname,
        table_name: safeTableName,
        file_type: fileExt,
        row_count: rowCount,
        schema_info: columns,
        preview: profileData?.preview || parsedRows.slice(0, 10),
      }
    });
  } catch (error: any) {
    console.error('Upload processing error:', error);
    res.status(500).json({ error: `Upload processing failed: ${error.message}` });
  }
};

export const getDataset = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const result = await DatabaseManager.query('SELECT * FROM datasets WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Dataset not found' });
    return;
  }
  res.json({ dataset: result.rows[0] });
};

export const deleteDataset = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const result = await DatabaseManager.query('SELECT table_name FROM datasets WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Dataset not found' });
    return;
  }

  const tableName = result.rows[0].table_name;
  await DatabaseManager.query('DELETE FROM datasets WHERE id = $1', [id]);
  await DatabaseManager.query('DELETE FROM uploaded_files WHERE id = $1', [id]);
  
  // Drop table from Postgres
  try {
    await DatabaseManager.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`);
  } catch (e) {
    console.warn(`Could not drop table ${tableName}:`, e);
  }

  res.json({ message: 'Dataset and table deleted successfully' });
};
