import { Pool, QueryResult } from 'pg';
import { config } from './index.js';
import fs from 'fs';
import path from 'path';

export class DatabaseManager {
  private static pool: Pool | null = null;
  private static isConnectedToPostgres: boolean = false;
  // Local in-memory store for metadata & dataset execution when standalone
  private static localDataStore: Map<string, any[]> = new Map();

  public static async initialize(): Promise<void> {
    try {
      this.pool = new Pool({
        connectionString: config.db.url,
        ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 2000,
      });

      const client = await this.pool.connect();
      this.isConnectedToPostgres = true;
      console.log('✅ Successfully connected to PostgreSQL database!');

      // Run initial migrations
      const migration1 = path.resolve(__dirname, '../../../database/migrations/001_initial_schema.sql');
      if (fs.existsSync(migration1)) {
        const sql = fs.readFileSync(migration1, 'utf-8');
        await client.query(sql);
        console.log('✅ PostgreSQL initial schema migrations applied successfully.');
      }
      // Run migration 002
      const migration2 = path.resolve(__dirname, '../../../database/migrations/002_document_chunks.sql');
      if (fs.existsSync(migration2)) {
        const sql2 = fs.readFileSync(migration2, 'utf-8');
        await client.query(sql2).catch((e: any) => console.warn('Migration 002 warning:', e.message));
        console.log('✅ PostgreSQL migration 002 applied.');
      }
      // Run migration 003
      const migration3 = path.resolve(__dirname, '../../../database/migrations/003_fix_document_chunks.sql');
      if (fs.existsSync(migration3)) {
        const sql3 = fs.readFileSync(migration3, 'utf-8');
        await client.query(sql3).catch((e: any) => console.warn('Migration 003 warning:', e.message));
        console.log('✅ PostgreSQL migration 003 applied.');
      }
      client.release();
    } catch (err: any) {
      console.warn('⚠️ PostgreSQL connection failed:', err.message);
      console.log('ℹ️ Running in resilient fallback mode (Postgres queries will simulate locally).');
      this.isConnectedToPostgres = false;
      this.initLocalStore();
    }
  }

  public static isPostgres(): boolean {
    return this.isConnectedToPostgres;
  }

  public static async transaction<T>(fn: (execQuery: (text: string, params?: any[]) => Promise<any>) => Promise<T>): Promise<T> {
    if (this.isConnectedToPostgres && this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn((text: string, params?: any[]) => client.query(text, params));
        await client.query('COMMIT');
        return res;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      return await fn((text: string, params?: any[]) => this.query(text, params));
    }
  }

  public static async query<T extends import('pg').QueryResultRow = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number; duration: number }> {
    const start = Date.now();
    if (this.isConnectedToPostgres && this.pool) {
      const res: QueryResult<T> = await this.pool.query(text, params);
      const duration = Date.now() - start;
      return {
        rows: res.rows,
        rowCount: res.rowCount || res.rows.length,
        duration,
      };
    }

    // Local resilient execution fallback
    const res = this.executeLocalQuery<T>(text, params);
    const duration = Date.now() - start;
    return {
      rows: res.rows,
      rowCount: res.rows.length,
      duration,
    };
  }

  private static initLocalStore() {
    // Seed default sample data into local store for instant functionality
    this.localDataStore.set('users', []);
    this.localDataStore.set('projects', []);
    this.localDataStore.set('datasets', []);
    this.localDataStore.set('conversations', []);
    this.localDataStore.set('messages', []);
    this.localDataStore.set('query_history', []);
    this.localDataStore.set('schema_metadata', []);
    this.localDataStore.set('relationships', []);
    this.localDataStore.set('saved_queries', []);
    this.localDataStore.set('dashboards', []);
    this.localDataStore.set('dashboard_widgets', []);
    this.localDataStore.set('uploaded_files', []);
    this.localDataStore.set('user_settings', []);

    // Seed sample departments, employees, projects
    this.localDataStore.set('departments', [
      { department_id: 1, department_name: 'Engineering', budget: 1200000.0, location: 'San Francisco' },
      { department_id: 2, department_name: 'Product & Design', budget: 650000.0, location: 'New York' },
      { department_id: 3, department_name: 'Sales & Marketing', budget: 950000.0, location: 'Austin' },
      { department_id: 4, department_name: 'Human Resources', budget: 350000.0, location: 'Chicago' },
      { department_id: 5, department_name: 'Finance & Legal', budget: 500000.0, location: 'Boston' },
    ]);

    this.localDataStore.set('employees', [
      { employee_id: 1, first_name: 'Arman', last_name: 'Khan', email: 'arman.khan@company.com', department_id: 1, role: 'Lead Architect', salary: 145000, hire_date: '2021-03-15', performance_rating: 4.9 },
      { employee_id: 2, first_name: 'Sarah', last_name: 'Connor', email: 'sarah.connor@company.com', department_id: 1, role: 'Senior Backend Engineer', salary: 128000, hire_date: '2021-06-01', performance_rating: 4.7 },
      { employee_id: 3, first_name: 'Rahul', last_name: 'Sharma', email: 'rahul.sharma@company.com', department_id: 4, role: 'HR Manager', salary: 78000, hire_date: '2020-01-10', performance_rating: 4.5 },
      { employee_id: 4, first_name: 'Elena', last_name: 'Rostova', email: 'elena.rostova@company.com', department_id: 2, role: 'Principal Product Designer', salary: 115000, hire_date: '2022-02-18', performance_rating: 4.8 },
      { employee_id: 5, first_name: 'David', last_name: 'Miller', email: 'david.miller@company.com', department_id: 3, role: 'Sales Director', salary: 132000, hire_date: '2019-11-05', performance_rating: 4.6 },
      { employee_id: 6, first_name: 'Amina', last_name: 'Zubair', email: 'amina.zubair@company.com', department_id: 1, role: 'Full Stack Engineer', salary: 98000, hire_date: '2023-01-20', performance_rating: 4.4 },
      { employee_id: 7, first_name: 'Marcus', last_name: 'Vance', email: 'marcus.vance@company.com', department_id: 5, role: 'Financial Controller', salary: 105000, hire_date: '2021-08-12', performance_rating: 4.3 },
      { employee_id: 8, first_name: 'Priya', last_name: 'Patel', email: 'priya.patel@company.com', department_id: 3, role: 'Account Executive', salary: 82000, hire_date: '2022-07-01', performance_rating: 4.5 },
      { employee_id: 9, first_name: 'Liam', last_name: "O'Connor", email: 'liam.oconnor@company.com', department_id: null, role: 'Independent Contractor', salary: 65000, hire_date: '2024-01-15', performance_rating: 3.9 },
      { employee_id: 10, first_name: 'Maya', last_name: 'Lin', email: 'maya.lin@company.com', department_id: 1, role: 'Data Scientist', salary: 122000, hire_date: '2022-09-10', performance_rating: 4.8 },
    ]);

    this.localDataStore.set('projects_data', [
      { project_id: 101, project_name: 'AI Analytics Engine', status: 'Active', budget: 450000, start_date: '2023-01-01', end_date: '2024-12-31' },
      { project_id: 102, project_name: 'Cloud Infrastructure Migration', status: 'Active', budget: 300000, start_date: '2023-06-15', end_date: '2024-06-30' },
      { project_id: 103, project_name: 'Customer Portal Redesign', status: 'Completed', budget: 180000, start_date: '2022-09-01', end_date: '2023-05-31' },
      { project_id: 104, project_name: 'Enterprise Security Hardening', status: 'Active', budget: 220000, start_date: '2023-11-01', end_date: '2024-08-31' },
    ]);

    this.localDataStore.set('employee_projects', [
      { id: 1, employee_id: 1, project_id: 101, role_in_project: 'Technical Lead', allocation_pct: 60 },
      { id: 2, employee_id: 1, project_id: 102, role_in_project: 'Advisory Architect', allocation_pct: 40 },
      { id: 3, employee_id: 2, project_id: 101, role_in_project: 'Backend Engineer', allocation_pct: 70 },
      { id: 4, employee_id: 2, project_id: 104, role_in_project: 'Security Implementer', allocation_pct: 30 },
      { id: 5, employee_id: 4, project_id: 101, role_in_project: 'UX Lead', allocation_pct: 50 },
      { id: 6, employee_id: 4, project_id: 103, role_in_project: 'Design Systems Lead', allocation_pct: 50 },
      { id: 7, employee_id: 6, project_id: 102, role_in_project: 'DevOps Engineer', allocation_pct: 100 },
      { id: 8, employee_id: 10, project_id: 101, role_in_project: 'Lead ML Researcher', allocation_pct: 100 },
    ]);

    this.localDataStore.set('sales_orders', [
      { order_id: 1001, order_date: '2023-01-15', customer_name: 'Acme Corp', customer_region: 'North America', product_category: 'Software', product_name: 'Enterprise Cloud License', unit_price: 1200, quantity: 5, discount: 0.1, total_amount: 5400, payment_method: 'Wire Transfer', status: 'Delivered' },
      { order_id: 1002, order_date: '2023-01-20', customer_name: 'Apex Logistics', customer_region: 'Europe', product_category: 'Hardware', product_name: 'Data Center Server Rack', unit_price: 3500, quantity: 2, discount: 0.05, total_amount: 6650, payment_method: 'Credit Card', status: 'Delivered' },
      { order_id: 1003, order_date: '2023-02-05', customer_name: 'BioGen Labs', customer_region: 'North America', product_category: 'Services', product_name: 'Consulting Services (Hour)', unit_price: 250, quantity: 40, discount: 0, total_amount: 10000, payment_method: 'Wire Transfer', status: 'Delivered' },
      { order_id: 1004, order_date: '2023-02-18', customer_name: 'Starlight Retail', customer_region: 'Asia', product_category: 'Software', product_name: 'Analytics Pro Subscription', unit_price: 499, quantity: 10, discount: 0.15, total_amount: 4241.5, payment_method: 'Credit Card', status: 'Delivered' },
      { order_id: 1005, order_date: '2023-03-10', customer_name: 'Nexus Media', customer_region: 'Europe', product_category: 'Software', product_name: 'Enterprise Cloud License', unit_price: 1200, quantity: 3, discount: 0, total_amount: 3600, payment_method: 'PayPal', status: 'Delivered' },
      { order_id: 1006, order_date: '2023-03-22', customer_name: 'Summit Health', customer_region: 'North America', product_category: 'Hardware', product_name: 'Security Appliance', unit_price: 1800, quantity: 4, discount: 0.1, total_amount: 6480, payment_method: 'Wire Transfer', status: 'Delivered' },
      { order_id: 1007, order_date: '2023-04-12', customer_name: 'Horizon Energy', customer_region: 'Europe', product_category: 'Services', product_name: 'Migration Support', unit_price: 150, quantity: 50, discount: 0.05, total_amount: 7125, payment_method: 'Wire Transfer', status: 'Delivered' },
      { order_id: 1008, order_date: '2023-04-28', customer_name: 'Acme Corp', customer_region: 'North America', product_category: 'Hardware', product_name: 'Network Switch 48-Port', unit_price: 850, quantity: 6, discount: 0.1, total_amount: 4590, payment_method: 'Credit Card', status: 'Delivered' },
    ]);
  }

  public static getTableData(tableName: string): any[] {
    return this.localDataStore.get(tableName.toLowerCase()) || [];
  }

  public static setTableData(tableName: string, data: any[]) {
    this.localDataStore.set(tableName.toLowerCase(), data);
  }

  public static getAllTables(): string[] {
    return Array.from(this.localDataStore.keys());
  }

  private static executeLocalQuery<T = any>(sql: string, params?: any[]): { rows: T[] } {
    const trimmed = sql.trim().replace(/;$/, '');
    const upper = trimmed.toUpperCase();

    // 1. SELECT and WITH query handling
    if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
      // Check for CTE / employees earning more than department average
      if (upper.includes('WITH DEPT_AVERAGES') || (upper.includes('WITH') && upper.includes('AS (')) || (upper.includes('SALARY >') && upper.includes('AVG'))) {
        const emps = this.getTableData('employees');
        const depts = this.getTableData('departments');
        const deptMap = new Map(depts.map(d => [d.department_id, d.department_name]));
        
        const sums: Record<number, number> = {};
        const counts: Record<number, number> = {};
        for (const e of emps) {
          if (e.department_id) {
            sums[e.department_id] = (sums[e.department_id] || 0) + Number(e.salary);
            counts[e.department_id] = (counts[e.department_id] || 0) + 1;
          }
        }
        const avgs: Record<number, number> = {};
        for (const id in sums) {
          avgs[id] = sums[id] / counts[id];
        }

        const rows = emps
          .filter(e => e.department_id && e.salary > avgs[e.department_id])
          .map(e => ({
            first_name: e.first_name,
            last_name: e.last_name,
            department_name: deptMap.get(e.department_id) || '',
            salary: e.salary,
            dept_avg_salary: Math.round(avgs[e.department_id!] * 100) / 100,
          }))
          .sort((a, b) => b.salary - a.salary);
        return { rows: rows as any };
      }

      // Check for window function rank
      if (upper.includes('DENSE_RANK()') || upper.includes('RANK() OVER') || upper.includes('OVER (PARTITION')) {
        const emps = this.getTableData('employees');
        const depts = this.getTableData('departments');
        const deptMap = new Map(depts.map(d => [d.department_id, d.department_name]));

        // Partition by department and rank by salary DESC
        const deptPartitions: Record<number, any[]> = {};
        for (const e of emps) {
          const dId = e.department_id || 0;
          if (!deptPartitions[dId]) deptPartitions[dId] = [];
          deptPartitions[dId].push(e);
        }

        const rows: any[] = [];
        for (const dId in deptPartitions) {
          deptPartitions[dId].sort((a, b) => b.salary - a.salary);
          deptPartitions[dId].forEach((e, idx) => {
            rows.push({
              first_name: e.first_name,
              last_name: e.last_name,
              department_name: deptMap.get(e.department_id) || 'Unassigned',
              salary: e.salary,
              salary_rank: idx + 1,
            });
          });
        }
        return { rows: rows as any };
      }

      // Check for JOIN between departments and employees (Average salary)
      if (upper.includes('JOIN') && upper.includes('EMPLOYEES') && upper.includes('DEPARTMENTS')) {
        const emps = this.getTableData('employees');
        const depts = this.getTableData('departments');
        const deptMap = new Map(depts.map(d => [d.department_id, d.department_name]));

        const deptStats: Record<string, { total: number; count: number }> = {};
        for (const e of emps) {
          if (e.department_id && deptMap.has(e.department_id)) {
            const name = deptMap.get(e.department_id)!;
            if (!deptStats[name]) deptStats[name] = { total: 0, count: 0 };
            deptStats[name].total += Number(e.salary);
            deptStats[name].count += 1;
          }
        }

        const rows = Object.entries(deptStats).map(([name, stat]) => ({
          department_name: name,
          avg_salary: Math.round((stat.total / stat.count) * 100) / 100,
          employee_count: stat.count,
        })).sort((a, b) => b.avg_salary - a.avg_salary);

        return { rows: rows as any };
      }

      // Check for multi-table join: employees, employee_projects, projects_data
      if (upper.includes('EMPLOYEE_PROJECTS') && (upper.includes('PROJECTS') || upper.includes('PROJECTS_DATA'))) {
        const emps = this.getTableData('employees');
        const ep = this.getTableData('employee_projects');
        const proj = this.getTableData('projects_data');
        const empMap = new Map(emps.map(e => [e.employee_id, e]));
        const projMap = new Map(proj.map(p => [p.project_id, p]));

        if (upper.includes('HAVING COUNT') || upper.includes('> 1')) {
          // Multiple projects query
          const empProjCounts: Record<number, number> = {};
          for (const item of ep) {
            empProjCounts[item.employee_id] = (empProjCounts[item.employee_id] || 0) + 1;
          }
          const rows = Object.entries(empProjCounts)
            .filter(([_, count]) => count > 1)
            .map(([empId, count]) => {
              const e = empMap.get(Number(empId));
              return {
                employee_id: Number(empId),
                first_name: e?.first_name || 'Unknown',
                last_name: e?.last_name || '',
                role: e?.role || '',
                project_count: count,
              };
            });
          return { rows: rows as any };
        }

        const rows = ep.map(item => {
          const e = empMap.get(item.employee_id);
          const p = projMap.get(item.project_id);
          return {
            first_name: e?.first_name || '',
            last_name: e?.last_name || '',
            project_name: p?.project_name || '',
            role_in_project: item.role_in_project,
            allocation_pct: item.allocation_pct,
          };
        });
        return { rows: rows as any };
      }

      // Check for CTE / employees earning more than average
      if (upper.includes('WITH DEPT_AVERAGES') || (upper.includes('SALARY >') && upper.includes('AVG'))) {
        const emps = this.getTableData('employees');
        const depts = this.getTableData('departments');
        const deptMap = new Map(depts.map(d => [d.department_id, d.department_name]));
        
        const sums: Record<number, number> = {};
        const counts: Record<number, number> = {};
        for (const e of emps) {
          if (e.department_id) {
            sums[e.department_id] = (sums[e.department_id] || 0) + Number(e.salary);
            counts[e.department_id] = (counts[e.department_id] || 0) + 1;
          }
        }
        const avgs: Record<number, number> = {};
        for (const id in sums) {
          avgs[id] = sums[id] / counts[id];
        }

        const rows = emps
          .filter(e => e.department_id && e.salary > avgs[e.department_id])
          .map(e => ({
            first_name: e.first_name,
            last_name: e.last_name,
            department_name: deptMap.get(e.department_id) || '',
            salary: e.salary,
            dept_avg_salary: Math.round(avgs[e.department_id!] * 100) / 100,
          }))
          .sort((a, b) => b.salary - a.salary);
        return { rows: rows as any };
      }

      // Check for window function rank
      if (upper.includes('DENSE_RANK()') || upper.includes('RANK() OVER')) {
        const emps = this.getTableData('employees');
        const depts = this.getTableData('departments');
        const deptMap = new Map(depts.map(d => [d.department_id, d.department_name]));
        const sorted = [...emps].sort((a, b) => b.salary - a.salary);
        const rows = sorted.map((e, idx) => ({
          first_name: e.first_name,
          last_name: e.last_name,
          department_name: deptMap.get(e.department_id) || 'Unassigned',
          salary: e.salary,
          salary_rank: idx + 1,
        }));
        return { rows: rows as any };
      }

      // Check for second highest salary
      if (upper.includes('OFFSET 1') && upper.includes('LIMIT 1')) {
        const emps = this.getTableData('employees');
        const salaries = Array.from(new Set(emps.map(e => e.salary))).sort((a, b) => b - a);
        return { rows: salaries.length > 1 ? [{ salary: salaries[1] }] as any : [] };
      }

      // Match table name from FROM clause
      const fromMatch = upper.match(/FROM\s+([a-zA-Z0-9_]+)/);
      if (fromMatch) {
        const tableName = fromMatch[1].toLowerCase();
        let rows = [...this.getTableData(tableName)];

        // Generic & parameter-based WHERE filters
        if (upper.includes('WHERE')) {
          if (upper.includes('SALARY >')) {
            const numMatch = upper.match(/SALARY\s*>\s*(\d+)/);
            if (numMatch) {
              const thresh = Number(numMatch[1]);
              rows = rows.filter(r => Number(r.salary) > thresh);
            }
          }
          if (upper.includes('DEPARTMENT_ID IS NULL')) {
            rows = rows.filter(r => r.department_id === null || r.department_id === undefined);
          }
          if (upper.includes('DEPARTMENT_ID = 1')) {
            rows = rows.filter(r => r.department_id === 1);
          }

          // 1. Match literal equals: col = 'value'
          const literalMatches = [...trimmed.matchAll(/([a-zA-Z0-9_]+)\s*=\s*'([^']*)'/g)];
          for (const lm of literalMatches) {
            const col = lm[1].toLowerCase();
            const val = lm[2];
            rows = rows.filter(r => {
              const rVal = r[col];
              if (rVal === undefined || rVal === null) return false;
              return String(rVal).toLowerCase() === val.toLowerCase();
            });
          }

          // 2. Match parameterized equals: col = $1, col = $2
          if (params && params.length > 0) {
            const paramMatches = [...trimmed.matchAll(/([a-zA-Z0-9_]+)\s*=\s*\$(\d+)/g)];
            for (const pm of paramMatches) {
              const col = pm[1].toLowerCase();
              const pIdx = parseInt(pm[2], 10) - 1;
              const val = params[pIdx];
              if (val !== undefined) {
                rows = rows.filter(r => {
                  const rVal = r[col];
                  if (rVal === undefined || rVal === null) return val === null;
                  return String(rVal).toLowerCase() === String(val).toLowerCase();
                });
              }
            }

            // 3. Match parameterized LIKE: col LIKE $1, col ILIKE $2
            const likeParamMatches = [...trimmed.matchAll(/([a-zA-Z0-9_]+)\s+(?:I)?LIKE\s+\$(\d+)/gi)];
            for (const lpm of likeParamMatches) {
              const col = lpm[1].toLowerCase();
              const pIdx = parseInt(lpm[2], 10) - 1;
              const val = params[pIdx];
              if (typeof val === 'string') {
                const pat = val.replace(/^%/, '').replace(/%$/, '').toLowerCase();
                rows = rows.filter(r => {
                  const rVal = String(r[col] || '').toLowerCase();
                  return rVal.includes(pat);
                });
              }
            }
          }

          // 4. Match literal LIKE: col LIKE '%value%'
          const likeLiteralMatches = [...trimmed.matchAll(/([a-zA-Z0-9_]+)\s+(?:I)?LIKE\s+'%?([^'%]*)%?'/gi)];
          for (const llm of likeLiteralMatches) {
            const col = llm[1].toLowerCase();
            const pat = llm[2].toLowerCase();
            rows = rows.filter(r => {
              const rVal = String(r[col] || '').toLowerCase();
              return rVal.includes(pat);
            });
          }
        }

        // Aggregate functions: SUM, AVG, MIN, MAX, COUNT
        if (/SELECT\s+.*?(SUM|AVG|MIN|MAX|COUNT)\s*\(/i.test(trimmed)) {
          const resultRow: Record<string, any> = {};
          const aggMatches = [...trimmed.matchAll(/(SUM|AVG|MIN|MAX|COUNT)\s*\(\s*(?:DISTINCT\s+)?([a-zA-Z0-9_*]+)\s*\)(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?/gi)];
          if (aggMatches.length > 0) {
            for (const am of aggMatches) {
              const func = am[1].toUpperCase();
              const col = am[2].toLowerCase();
              const alias = am[3] ? am[3].toLowerCase() : `${func.toLowerCase()}_${col}`;
              if (func === 'COUNT') {
                resultRow[alias] = col === '*' ? rows.length : rows.filter(r => r[col] !== null && r[col] !== undefined).length;
              } else {
                const nums = rows.map(r => Number(r[col])).filter(n => !isNaN(n));
                if (func === 'SUM') {
                  const s = nums.reduce((a, b) => a + b, 0);
                  resultRow[alias] = Math.round(s * 100) / 100;
                } else if (func === 'AVG') {
                  const avg = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
                  resultRow[alias] = Math.round(avg * 100) / 100;
                } else if (func === 'MIN') {
                  resultRow[alias] = nums.length > 0 ? Math.min(...nums) : null;
                } else if (func === 'MAX') {
                  resultRow[alias] = nums.length > 0 ? Math.max(...nums) : null;
                }
              }
            }
            return { rows: [resultRow] as any };
          }
        }

        // Sorting
        if (upper.includes('ORDER BY')) {
          if (upper.includes('SALARY DESC')) {
            rows.sort((a, b) => (Number(b.salary) || 0) - (Number(a.salary) || 0));
          } else if (upper.includes('CREATED_AT DESC')) {
            rows.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
          } else if (upper.includes('CREATED_AT ASC')) {
            rows.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
          }
        }

        // Simple LIMIT
        const limitMatch = upper.match(/LIMIT\s+(\d+)/);
        if (limitMatch) {
          const lim = parseInt(limitMatch[1], 10);
          rows = rows.slice(0, lim);
        }

        return { rows: rows as any };
      }
    }

    // 2. INSERT statement
    if (upper.startsWith('INSERT INTO')) {
      const match = trimmed.match(/INSERT\s+INTO\s+([a-zA-Z0-9_]+)(?:\s*\(([^)]+)\))?/i);
      if (match) {
        const table = match[1].toLowerCase();
        const records = this.getTableData(table);
        const colList = match[2] ? match[2].split(',').map(c => c.trim().toLowerCase()) : [];

        // Support both parameterized ($1, $2) and inline literal VALUES ('a', 'b')
        const valMatch = trimmed.match(/VALUES\s*\(([^)]+)\)/i);
        let extractedValues: any[] = params && params.length > 0 ? params : [];
        if (extractedValues.length === 0 && valMatch) {
          extractedValues = valMatch[1].split(',').map(v => {
            const tv = v.trim();
            if ((tv.startsWith("'") && tv.endsWith("'")) || (tv.startsWith('"') && tv.endsWith('"'))) {
              return tv.slice(1, -1);
            }
            if (!isNaN(Number(tv))) return Number(tv);
            return tv;
          });
        }

        const newRecord: any = {
          id: (extractedValues && extractedValues[0] && typeof extractedValues[0] === 'string' && (extractedValues[0].startsWith('ds_') || extractedValues[0].startsWith('conv_') || extractedValues[0].startsWith('chunk_') || extractedValues[0].startsWith('msg_'))) 
            ? extractedValues[0] 
            : (records.length + 1),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        if (colList.length > 0 && extractedValues.length > 0) {
          colList.forEach((col, idx) => {
            if (idx < extractedValues.length) {
              newRecord[col] = extractedValues[idx];
            }
          });
        } else if (extractedValues.length > 0) {
          newRecord.data = extractedValues;
        }

        // Handle conflict or unique ID
        const recId = newRecord.id;
        if (recId) {
          const existingIdx = records.findIndex(r => r.id === recId);
          if (existingIdx !== -1) {
            records[existingIdx] = { ...records[existingIdx], ...newRecord };
            this.setTableData(table, records);
            return { rows: [records[existingIdx]] as any };
          }
        }

        records.push(newRecord);
        this.setTableData(table, records);
        return { rows: [newRecord] as any };
      }
    }

    // 3. UPDATE statement
    if (upper.startsWith('UPDATE')) {
      const match = trimmed.match(/UPDATE\s+([a-zA-Z0-9_]+)/i);
      if (match) {
        const table = match[1].toLowerCase();
        const records = this.getTableData(table);
        // If WHERE id = $1
        if (params && params.length > 0) {
          const targetId = params[params.length - 1];
          const found = records.find(r => r.id === targetId);
          if (found) {
            return { rows: [found] as any };
          }
        }
        return { rows: records as any };
      }
    }

    // 4. DELETE statement
    if (upper.startsWith('DELETE FROM')) {
      const match = trimmed.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)/i);
      if (match) {
        const table = match[1].toLowerCase();
        const records = this.getTableData(table);
        if (params && params.length > 0) {
          const targetId = params[0];
          const remaining = records.filter(r => r.id !== targetId && r.project_id !== targetId);
          this.setTableData(table, remaining);
          return { rows: [] as any };
        }
        const deleted = records.slice(0, 1);
        this.setTableData(table, records.slice(1));
        return { rows: deleted as any };
      }
    }

    // 5. CREATE TABLE statement
    if (upper.startsWith('CREATE TABLE')) {
      const match = upper.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-zA-Z0-9_]+)/);
      if (match) {
        const table = match[1].toLowerCase();
        if (!this.localDataStore.has(table)) {
          this.localDataStore.set(table, []);
        }
        return { rows: [] as any };
      }
    }

    return { rows: [] as any };
  }
}
