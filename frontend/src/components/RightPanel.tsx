import React, { useState } from 'react';
import {
  Code,
  Table,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
} from 'lucide-react';
import { DataVisualization } from './DataVisualization';
import { QueryResult, VisualizationConfig } from '../types';

interface RightPanelProps {
  sql: string;
  queryResult?: QueryResult;
  vizConfig?: VisualizationConfig;
  executionTime?: number;
  error?: string | null;
  onExecute: (customSql?: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  sql,
  queryResult,
  vizConfig,
  executionTime,
  error,
  onExecute,
  isOpen,
  onToggle,
}) => {
  const [editableSql, setEditableSql] = useState<string>(sql);
  const [activeTab, setActiveTab] = useState<'visualize' | 'sql'>('visualize');
  const [copied, setCopied] = useState<boolean>(false);

  React.useEffect(() => {
    setEditableSql(sql);
  }, [sql]);

  const handleCopy = () => {
    navigator.clipboard.writeText(editableSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed right-0 top-1/2 -translate-y-1/2 bg-card border border-border p-2 rounded-l-lg shadow-lg hover:bg-muted text-muted-foreground z-30"
        title="Open Query Inspector"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div className="w-[480px] lg:w-[540px] border-l border-border bg-card flex flex-col h-full shadow-lg z-20">
      {/* Panel Header */}
      <div className="h-14 px-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex bg-muted p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('visualize')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                activeTab === 'visualize' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              Results & Charts
            </button>
            <button
              onClick={() => setActiveTab('sql')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                activeTab === 'sql' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              SQL Editor
            </button>
          </div>
        </div>

        <button
          onClick={onToggle}
          className="p-1 text-muted-foreground hover:text-foreground rounded"
          title="Close inspector"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Execution Status Banner */}
      <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between text-xs font-mono">
        {error ? (
          <div className="flex items-center gap-1.5 text-destructive font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Execution Failed</span>
          </div>
        ) : queryResult ? (
          <div className="flex items-center gap-1.5 text-emerald-500 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{queryResult.row_count} row(s) returned</span>
          </div>
        ) : (
          <span className="text-muted-foreground">Ready</span>
        )}

        {executionTime !== undefined && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{executionTime}ms</span>
          </div>
        )}
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-lg font-mono">
            {error}
          </div>
        )}

        {activeTab === 'visualize' && queryResult && (
          <DataVisualization
            records={queryResult.records}
            columns={queryResult.columns}
            config={vizConfig}
          />
        )}

        {activeTab === 'visualize' && !queryResult && (
          <div className="p-12 text-center text-muted-foreground border border-dashed border-border rounded-xl">
            <Sparkles className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-xs">Execute a query from the chat to inspect live results.</p>
          </div>
        )}

        {activeTab === 'sql' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                PostgreSQL Query
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <textarea
              value={editableSql}
              onChange={e => setEditableSql(e.target.value)}
              rows={12}
              className="w-full font-mono text-xs bg-muted/40 border border-border rounded-lg p-3 text-foreground focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed resize-none"
            />

            <button
              onClick={() => onExecute(editableSql)}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold text-xs py-2 rounded-lg hover:bg-primary/90 transition-all shadow-sm"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Execute Query
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
