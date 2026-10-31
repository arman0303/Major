import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';
import axios from 'axios';
import { config } from '../config/index.js';

export const getSchema = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId } = req.query;

  // Retrieve all tables and columns
  const tablesMeta: Record<string, any[]> = {};
  const relationships: any[] = [];

  if (DatabaseManager.isPostgres()) {
    const columnsQuery = await DatabaseManager.query(`
      SELECT 
        c.table_name, 
        c.column_name, 
        c.data_type,
        c.is_nullable,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.table_name, ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
      ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position;
    `);

    for (const row of columnsQuery.rows) {
      if (!tablesMeta[row.table_name]) {
        tablesMeta[row.table_name] = [];
      }
      tablesMeta[row.table_name].push({
        name: row.column_name,
        type: row.data_type,
        is_primary_key: row.is_primary_key,
        nullable: row.is_nullable === 'YES',
      });
    }

    // Retrieve foreign key relationships
    const fkQuery = await DatabaseManager.query(`
      SELECT
        tc.table_name AS source_table, 
        kcu.column_name AS source_column, 
        ccu.table_name AS target_table,
        ccu.column_name AS target_column
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY';
    `);
    relationships.push(...fkQuery.rows);
  } else {
    // Resilient local store schema
    tablesMeta['departments'] = [
      { name: 'department_id', type: 'INTEGER', is_primary_key: true, nullable: false },
      { name: 'department_name', type: 'VARCHAR(100)', is_primary_key: false, nullable: false },
      { name: 'budget', type: 'NUMERIC(15,2)', is_primary_key: false, nullable: false },
      { name: 'location', type: 'VARCHAR(100)', is_primary_key: false, nullable: false },
    ];
    tablesMeta['employees'] = [
      { name: 'employee_id', type: 'INTEGER', is_primary_key: true, nullable: false },
      { name: 'first_name', type: 'VARCHAR(50)', is_primary_key: false, nullable: false },
      { name: 'last_name', type: 'VARCHAR(50)', is_primary_key: false, nullable: false },
      { name: 'email', type: 'VARCHAR(100)', is_primary_key: false, nullable: false },
      { name: 'department_id', type: 'INTEGER', is_primary_key: false, is_foreign_key: true, nullable: true },
      { name: 'role', type: 'VARCHAR(100)', is_primary_key: false, nullable: false },
      { name: 'salary', type: 'NUMERIC(12,2)', is_primary_key: false, nullable: false },
      { name: 'hire_date', type: 'DATE', is_primary_key: false, nullable: false },
      { name: 'performance_rating', type: 'NUMERIC(3,2)', is_primary_key: false, nullable: true },
    ];
    tablesMeta['projects_data'] = [
      { name: 'project_id', type: 'INTEGER', is_primary_key: true, nullable: false },
      { name: 'project_name', type: 'VARCHAR(150)', is_primary_key: false, nullable: false },
      { name: 'status', type: 'VARCHAR(50)', is_primary_key: false, nullable: false },
      { name: 'budget', type: 'NUMERIC(15,2)', is_primary_key: false, nullable: false },
      { name: 'start_date', type: 'DATE', is_primary_key: false, nullable: false },
      { name: 'end_date', type: 'DATE', is_primary_key: false, nullable: true },
    ];
    tablesMeta['employee_projects'] = [
      { name: 'id', type: 'INTEGER', is_primary_key: true, nullable: false },
      { name: 'employee_id', type: 'INTEGER', is_primary_key: false, is_foreign_key: true, nullable: false },
      { name: 'project_id', type: 'INTEGER', is_primary_key: false, is_foreign_key: true, nullable: false },
      { name: 'role_in_project', type: 'VARCHAR(100)', is_primary_key: false, nullable: false },
      { name: 'allocation_pct', type: 'INTEGER', is_primary_key: false, nullable: false },
    ];
    tablesMeta['sales_orders'] = [
      { name: 'order_id', type: 'INTEGER', is_primary_key: true, nullable: false },
      { name: 'order_date', type: 'DATE', is_primary_key: false, nullable: false },
      { name: 'customer_name', type: 'VARCHAR(150)', is_primary_key: false, nullable: false },
      { name: 'customer_region', type: 'VARCHAR(100)', is_primary_key: false, nullable: false },
      { name: 'product_category', type: 'VARCHAR(100)', is_primary_key: false, nullable: false },
      { name: 'product_name', type: 'VARCHAR(150)', is_primary_key: false, nullable: false },
      { name: 'unit_price', type: 'NUMERIC(12,2)', is_primary_key: false, nullable: false },
      { name: 'quantity', type: 'INTEGER', is_primary_key: false, nullable: false },
      { name: 'total_amount', type: 'NUMERIC(14,2)', is_primary_key: false, nullable: false },
      { name: 'payment_method', type: 'VARCHAR(50)', is_primary_key: false, nullable: false },
      { name: 'status', type: 'VARCHAR(50)', is_primary_key: false, nullable: false },
    ];

    relationships.push(
      { source_table: 'employees', source_column: 'department_id', target_table: 'departments', target_column: 'department_id' },
      { source_table: 'employee_projects', source_column: 'employee_id', target_table: 'employees', target_column: 'employee_id' },
      { source_table: 'employee_projects', source_column: 'project_id', target_table: 'projects_data', target_column: 'project_id' }
    );
  }

  // Include all user-uploaded datasets for this project in the schema
  if (projectId) {
    try {
      const dsRes = await DatabaseManager.query('SELECT table_name, schema_info FROM datasets WHERE project_id = $1', [projectId]);
      for (const ds of dsRes.rows) {
        if (ds.table_name && !tablesMeta[ds.table_name]) {
          try {
            const cols = typeof ds.schema_info === 'string' ? JSON.parse(ds.schema_info) : ds.schema_info;
            if (Array.isArray(cols) && cols.length > 0) {
              tablesMeta[ds.table_name] = cols;
            }
          } catch {}
        }
      }
    } catch {}
  }

  res.json({
    tables: tablesMeta,
    table_names: Object.keys(tablesMeta),
    relationships,
  });
};

export const generateSchema = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { prompt } = req.body;
  if (!prompt) {
    res.status(400).json({ error: 'Prompt is required' });
    return;
  }

  try {
    const aiRes = await axios.post(`${config.aiServiceUrl}/api/ai/generate-schema`, { prompt });
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
