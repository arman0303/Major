import React, { useState, useEffect } from 'react';
import { History, CheckCircle2, AlertCircle, Clock, Copy, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

export const QueryHistoryPage: React.FC = () => {
  const { activeProject } = useAuth();
  const [history, setHistory] = useState<any[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (activeProject) {
      api.getQueryHistory(activeProject.id)
        .then(res => setHistory(res.history))
        .catch(err => console.error(err));
    }
  }, [activeProject]);

  const handleCopy = (id: string, sql: string) => {
    navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-background">
      <div className="border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <History className="w-6 h-6 text-primary" />
          Audit & Query History
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Complete log of all executed SELECT queries, mutations, and DDL commands for security and performance audits.
        </p>
      </div>

      {history.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground border border-border rounded-xl">
          No queries recorded yet in this project.
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60 border-b border-border">
              <tr>
                <th className="px-4 py-3 font-semibold text-foreground">Type</th>
                <th className="px-4 py-3 font-semibold text-foreground">SQL Statement</th>
                <th className="px-4 py-3 font-semibold text-foreground">Status</th>
                <th className="px-4 py-3 font-semibold text-foreground">Duration</th>
                <th className="px-4 py-3 font-semibold text-foreground">Rows</th>
                <th className="px-4 py-3 font-semibold text-foreground text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.map(item => (
                <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-primary">
                    {item.query_type}
                  </td>
                  <td className="px-4 py-3 font-mono text-foreground max-w-md truncate">
                    {item.sql_statement}
                  </td>
                  <td className="px-4 py-3">
                    {item.status === 'success' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Success
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-destructive font-medium">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Failed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">
                    {item.execution_time_ms}ms
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {item.row_count ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleCopy(item.id, item.sql_statement)}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy SQL"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
