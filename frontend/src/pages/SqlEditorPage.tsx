import React, { useState } from 'react';
import { Terminal, Play, RotateCcw, Download, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { DataVisualization } from '../components/DataVisualization';
import { QueryResult } from '../types';

export const SqlEditorPage: React.FC = () => {
  const { activeProject } = useAuth();
  const [sql, setSql] = useState<string>(
    'SELECT d.department_name, ROUND(AVG(e.salary), 2) AS avg_salary, COUNT(e.employee_id) AS total_employees\nFROM departments d\nJOIN employees e ON d.department_id = e.department_id\nGROUP BY d.department_name\nORDER BY avg_salary DESC;'
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  const handleRunQuery = async () => {
    if (!sql.trim() || !activeProject) return;

    setIsExecuting(true);
    setError(null);
    try {
      const res = await api.executeSQL({
        projectId: activeProject.id,
        sql: sql.trim(),
        isConfirmed: true,
      });

      setResult({
        records: res.records,
        columns: res.columns,
        row_count: res.row_count,
      });
      setExecutionTime(res.execution_time_ms);
    } catch (err: any) {
      setError(err.message || 'Execution failed');
      setResult(null);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-background">
      {/* Header */}
      <div className="border-b border-border pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Terminal className="w-6 h-6 text-primary" />
            Direct SQL Editor
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Write, test, and execute raw PostgreSQL statements against your project database with live safety verification.
          </p>
        </div>

        <button
          onClick={handleRunQuery}
          disabled={isExecuting || !sql.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-semibold text-xs rounded-xl hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50"
        >
          <Play className="w-4 h-4 fill-current" />
          {isExecuting ? 'Executing...' : 'Run Query (F5)'}
        </button>
      </div>

      {/* Editor Box */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="bg-muted/60 px-4 py-2 border-b border-border flex items-center justify-between text-xs font-mono text-muted-foreground">
          <span>PostgreSQL Dialect</span>
          <button
            onClick={() => setSql('')}
            className="hover:text-foreground flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Clear
          </button>
        </div>
        <textarea
          value={sql}
          onChange={e => setSql(e.target.value)}
          rows={7}
          className="w-full bg-card p-4 font-mono text-xs text-foreground focus:outline-none leading-relaxed resize-y"
          placeholder="Enter SQL statement here..."
        />
      </div>

      {/* Error Output */}
      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold">PostgreSQL Execution Error:</span>
            <p className="whitespace-pre-wrap">{error}</p>
          </div>
        </div>
      )}

      {/* Execution Results */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Query executed successfully ({result.row_count} rows returned)
            </span>
            {executionTime !== null && <span>Duration: {executionTime}ms</span>}
          </div>

          <DataVisualization
            records={result.records}
            columns={result.columns}
          />
        </div>
      )}
    </div>
  );
};
