import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';
import axios from 'axios';
import { config } from '../config/index.js';
import fs from 'fs';
import FormData from 'form-data';

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

  const safeTableName = (tableName || file.originalname.split('.')[0])
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');

  const fileExt = file.originalname.split('.').pop()?.toLowerCase() || 'csv';

  try {
    // Call AI service to parse and profile the uploaded file
    const form = new FormData();
    form.append('file', fs.createReadStream(file.path), file.originalname);

    let profileData: any = null;
    try {
      const aiResponse = await axios.post(`${config.aiServiceUrl}/api/ai/parse-file`, form, {
        headers: form.getHeaders(),
        timeout: 15000,
      });
      profileData = aiResponse.data;
    } catch (err: any) {
      console.warn('AI parsing service unreachable, using local fallback:', err.message);
      // Local fallback parsing
      if (fileExt === 'json') {
        const raw = fs.readFileSync(file.path, 'utf-8');
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        const cols = Object.keys(rows[0] || {}).map(k => ({
          name: k.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          type: 'VARCHAR(255)',
          is_primary_key: k.toLowerCase().endsWith('id'),
        }));
        profileData = { row_count: rows.length, columns: cols, preview: rows.slice(0, 5) };
      }
    }

    const datasetId = `ds_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const rowCount = profileData?.row_count || 0;

    // Create dataset record
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
        JSON.stringify(profileData?.columns || []),
        'ready'
      ]
    );

    // If PDF or text file, index chunks into RAG store and register in uploaded_files
    if ((fileExt === 'pdf' || fileExt === 'txt') && (profileData?.text_content || profileData?.chunks)) {
      try {
        const chunks = profileData.chunks || [
          { content: profileData.text_content, metadata: { source: file.originalname, page_number: 1 } }
        ];

        // Track file in uploaded_files
        await DatabaseManager.query(
          `INSERT INTO uploaded_files (id, user_id, project_id, original_name, file_type, file_size_bytes, status, chunk_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
          [datasetId, req.user!.id, projectId, file.originalname, fileExt, file.size, 'indexing', chunks.length]
        ).catch(() => {});

        for (const chunk of chunks) {
          await axios.post(`${config.aiServiceUrl}/api/ai/rag/index`, {
            project_id: projectId,
            user_id: req.user!.id,
            file_id: datasetId,
            content: chunk.content,
            metadata: {
              source: file.originalname,
              page_number: chunk.metadata?.page_number || 1,
              dataset_id: datasetId,
            }
          }, { timeout: 10000 });
        }

        await DatabaseManager.query(
          `UPDATE uploaded_files SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [datasetId]
        ).catch(() => {});
      } catch (e: any) {
        console.warn('Could not index document in RAG:', e.message);
        await DatabaseManager.query(
          `UPDATE uploaded_files SET status = 'failed', error_message = $1 WHERE id = $2`,
          [e.message, datasetId]
        ).catch(() => {});
      }
    }

    res.status(201).json({
      message: 'Dataset uploaded and profiled successfully',
      dataset: {
        id: datasetId,
        name: name || file.originalname,
        table_name: safeTableName,
        file_type: fileExt,
        row_count: rowCount,
        schema_info: profileData?.columns || [],
        preview: profileData?.preview || [],
      }
    });
  } catch (error: any) {
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
  // Also drop table if exists
  try {
    await DatabaseManager.query(`DROP TABLE IF EXISTS ${tableName} CASCADE;`);
  } catch (e) {
    console.warn(`Could not drop table ${tableName}:`, e);
  }

  res.json({ message: 'Dataset and table deleted successfully' });
};
