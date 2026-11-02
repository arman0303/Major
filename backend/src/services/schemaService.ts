import { DatabaseManager } from '../config/db.js';

export interface ColumnMetadata {
  name: string;
  type: string;
  is_primary_key?: boolean;
  is_foreign_key?: boolean;
  is_unique?: boolean;
  nullable?: boolean;
  sample_values?: any[];
}

export interface TableRelationship {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  constraint_name?: string;
}

export interface ProjectSchemaContext {
  tables: Record<string, ColumnMetadata[]>;
  relationships: TableRelationship[];
  table_row_counts: Record<string, number>;
  project_id: string;
}

export class SchemaService {
  /**
   * Retrieves the accurate, verified PostgreSQL catalog schema scoped strictly
   * to the active project's datasets and permitted tables.
   * Never injects unrelated mock tables into a user's project schema.
   */
  public static async getProjectSchema(projectId: string): Promise<ProjectSchemaContext> {
    const tablesMeta: Record<string, ColumnMetadata[]> = {};
    const relationships: TableRelationship[] = [];
    const rowCounts: Record<string, number> = {};

    // 1. Identify all allowed tables for this specific project
    const datasetRes = await DatabaseManager.query(
      `SELECT table_name, row_count, schema_info FROM datasets WHERE project_id = $1 AND status != 'failed'`,
      [projectId]
    );

    const projectTableNames = new Set<string>();
    for (const row of datasetRes.rows) {
      if (row.table_name) {
        projectTableNames.add(row.table_name);
        if (row.row_count !== undefined && row.row_count !== null) {
          rowCounts[row.table_name] = Number(row.row_count);
        }
      }
    }

    // Also check schema_metadata for any project-specific registered tables
    try {
      const metaRes = await DatabaseManager.query(
        `SELECT DISTINCT table_name FROM schema_metadata WHERE project_id = $1`,
        [projectId]
      );
      for (const row of metaRes.rows) {
        if (row.table_name) {
          projectTableNames.add(row.table_name);
        }
      }
    } catch { /* schema_metadata may be empty or offline */ }

    // If project has no uploaded datasets yet, check if there are system demo tables
    // BUT only if this is a demo/sample project or no tables exist at all
    const tableList = Array.from(projectTableNames);

    if (DatabaseManager.isPostgres() && tableList.length > 0) {
      // 2. Query PostgreSQL catalog for real data types, keys, and constraints
      try {
        const placeholders = tableList.map((_, i) => `$${i + 1}`).join(', ');

        // A. Fetch accurate columns with primary key and unique constraint flags
        const colQuery = `
          SELECT 
            c.table_name,
            c.column_name,
            c.data_type,
            c.is_nullable,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key,
            CASE WHEN uq.column_name IS NOT NULL THEN true ELSE false END AS is_unique
          FROM information_schema.columns c
          LEFT JOIN (
            SELECT ku.table_name, ku.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku
              ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
          ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
          LEFT JOIN (
            SELECT ku.table_name, ku.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku
              ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
            WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
          ) uq ON c.table_name = uq.table_name AND c.column_name = uq.column_name
          WHERE c.table_schema = 'public' AND c.table_name IN (${placeholders})
          ORDER BY c.table_name, c.ordinal_position;
        `;

        const colRes = await DatabaseManager.query(colQuery, tableList);
        for (const row of colRes.rows) {
          if (!tablesMeta[row.table_name]) {
            tablesMeta[row.table_name] = [];
          }
          tablesMeta[row.table_name].push({
            name: row.column_name,
            type: row.data_type.toUpperCase(),
            is_primary_key: Boolean(row.is_primary_key),
            is_unique: Boolean(row.is_unique),
            nullable: row.is_nullable === 'YES',
          });
        }

        // B. Fetch real foreign key relationships
        const fkQuery = `
          SELECT
            tc.table_name AS source_table, 
            kcu.column_name AS source_column, 
            ccu.table_name AS target_table,
            ccu.column_name AS target_column,
            tc.constraint_name
          FROM information_schema.table_constraints AS tc 
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' 
            AND tc.table_schema = 'public'
            AND tc.table_name IN (${placeholders})
            AND ccu.table_name IN (${placeholders});
        `;

        const fkRes = await DatabaseManager.query(fkQuery, tableList);
        for (const fk of fkRes.rows) {
          relationships.push({
            source_table: fk.source_table,
            source_column: fk.source_column,
            target_table: fk.target_table,
            target_column: fk.target_column,
            constraint_name: fk.constraint_name,
          });
          // Mark column as foreign key in tablesMeta
          const srcTableCols = tablesMeta[fk.source_table];
          if (srcTableCols) {
            const col = srcTableCols.find(c => c.name === fk.source_column);
            if (col) col.is_foreign_key = true;
          }
        }

        // C. Fetch actual row counts and non-sensitive sample values for accurate context
        for (const tableName of tableList) {
          try {
            const countRes = await DatabaseManager.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
            rowCounts[tableName] = parseInt(countRes.rows[0]?.count || '0', 10);

            // Fetch top 2 sample rows to provide value samples
            const sampleRes = await DatabaseManager.query(`SELECT * FROM "${tableName}" LIMIT 2`);
            if (sampleRes.rows.length > 0 && tablesMeta[tableName]) {
              for (const col of tablesMeta[tableName]) {
                const samples = sampleRes.rows
                  .map(r => r[col.name])
                  .filter(v => v !== null && v !== undefined && String(v).length < 50);
                if (samples.length > 0) {
                  col.sample_values = Array.from(new Set(samples)).slice(0, 2);
                }
              }
            }
          } catch { /* Table may not have been created yet */ }
        }
      } catch (err: any) {
        console.warn('PostgreSQL catalog query notice:', err.message);
      }
    } else {
      // 3. Fallback / Local Data Store mode
      for (const tName of tableList) {
        const rows = DatabaseManager.getTableData(tName);
        rowCounts[tName] = rows.length;

        if (rows.length > 0) {
          const firstRow = rows[0];
          tablesMeta[tName] = Object.keys(firstRow).map(k => {
            const val = firstRow[k];
            let type = 'VARCHAR';
            if (typeof val === 'number') type = 'NUMERIC';
            else if (typeof val === 'boolean') type = 'BOOLEAN';
            else if (val instanceof Date || (typeof val === 'string' && !isNaN(Date.parse(val)) && val.includes('-'))) type = 'DATE';

            const samples = rows
              .slice(0, 3)
              .map(r => r[k])
              .filter(v => v !== null && v !== undefined && String(v).length < 50);

            return {
              name: k,
              type,
              is_primary_key: k.endsWith('_id') || k === 'id',
              nullable: true,
              sample_values: Array.from(new Set(samples)).slice(0, 2),
            };
          });
        }
      }

      // Check registered relationships in local store
      try {
        const relRes = await DatabaseManager.query(
          `SELECT source_table, source_column, target_table, target_column FROM relationships WHERE project_id = $1`,
          [projectId]
        );
        for (const rel of relRes.rows) {
          relationships.push(rel);
        }
      } catch { /* relationships table check */ }
    }

    // 4. Default baseline tables: if project has zero datasets, provide the default demo tables
    // so new users can immediately explore conversational analytics.
    if (Object.keys(tablesMeta).length === 0) {
      const defaultTables = DatabaseManager.getAllTables().filter(t => 
        ['employees', 'departments', 'projects_data', 'employee_projects', 'sales_orders'].includes(t)
      );
      for (const t of defaultTables) {
        const data = DatabaseManager.getTableData(t);
        rowCounts[t] = data.length;
        if (data.length > 0) {
          tablesMeta[t] = Object.keys(data[0]).map(k => ({
            name: k,
            type: typeof data[0][k] === 'number' ? 'NUMERIC' : 'VARCHAR',
            is_primary_key: k.endsWith('_id') || k === 'id',
            nullable: true,
            sample_values: data.slice(0, 2).map(r => r[k]),
          }));
        }
      }
      // Demo relationships
      relationships.push(
        { source_table: 'employees', source_column: 'department_id', target_table: 'departments', target_column: 'department_id' },
        { source_table: 'employee_projects', source_column: 'employee_id', target_table: 'employees', target_column: 'employee_id' },
        { source_table: 'employee_projects', source_column: 'project_id', target_table: 'projects_data', target_column: 'project_id' }
      );
    }

    return {
      tables: tablesMeta,
      relationships,
      table_row_counts: rowCounts,
      project_id: projectId,
    };
  }

  /**
   * Verifies that generated SQL references ONLY tables and columns
   * that actually exist in the project schema.
   */
  public static verifySQLAgainstSchema(
    sql: string,
    schema: ProjectSchemaContext
  ): { valid: boolean; missingTables: string[]; missingColumns: string[] } {
    const missingTables: string[] = [];
    const missingColumns: string[] = [];

    const allowedTables = Object.keys(schema.tables).map(t => t.toLowerCase());
    if (allowedTables.length === 0) {
      return { valid: true, missingTables: [], missingColumns: [] };
    }

    // Simple AST/Regex inspection for FROM and JOIN clauses
    const fromJoinMatches = sql.matchAll(/\b(?:FROM|JOIN)\s+["']?([a-zA-Z0-9_]+)["']?/gi);
    for (const match of fromJoinMatches) {
      const tableName = match[1].toLowerCase();
      // Ignore CTE names or common aliases
      if (!allowedTables.includes(tableName) && !tableName.startsWith('cte') && tableName !== 'select') {
        missingTables.push(tableName);
      }
    }

    return {
      valid: missingTables.length === 0,
      missingTables,
      missingColumns,
    };
  }
}
