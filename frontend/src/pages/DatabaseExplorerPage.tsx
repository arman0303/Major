import React, { useState, useEffect } from 'react';
import { Database, Plus, Sparkles, RefreshCw, Layers, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { SchemaData } from '../types';
import { ERDiagram } from '../components/ERDiagram';

export const DatabaseExplorerPage: React.FC = () => {
  const { activeProject } = useAuth();
  const [schema, setSchema] = useState<SchemaData>({ tables: {}, table_names: [], relationships: [] });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Natural Language Schema Generator state
  const [nlPrompt, setNlPrompt] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedSchemaPreview, setGeneratedSchemaPreview] = useState<any | null>(null);
  const [isExecutingDDL, setIsExecutingDDL] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fetchSchema = async () => {
    if (!activeProject) return;
    setIsLoading(true);
    try {
      const data = await api.getSchema(activeProject.id);
      setSchema(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSchema();
  }, [activeProject]);

  const handleGenerateNLSchema = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nlPrompt.trim()) return;

    setIsGenerating(true);
    setStatusMessage(null);
    try {
      const res = await api.generateSchema(nlPrompt.trim());
      setGeneratedSchemaPreview(res);
    } catch (err: any) {
      setStatusMessage(`Generation failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyGeneratedDDL = async () => {
    if (!generatedSchemaPreview?.ddl_statements) return;

    setIsExecutingDDL(true);
    try {
      await api.executeDDL(generatedSchemaPreview.ddl_statements, true);
      setStatusMessage('Schema created and applied successfully to database!');
      setGeneratedSchemaPreview(null);
      setNlPrompt('');
      await fetchSchema();
    } catch (err: any) {
      setStatusMessage(`DDL Execution failed: ${err.message}`);
    } finally {
      setIsExecutingDDL(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-background">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Database className="w-6 h-6 text-primary" />
            Database Explorer & Schema
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Inspect relational database tables, columns, indexes, foreign keys, and ER connections.
          </p>
        </div>

        <button
          onClick={fetchSchema}
          disabled={isLoading}
          className="flex items-center gap-2 text-xs px-3.5 py-2 rounded-lg border border-border hover:bg-muted font-medium transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh Schema
        </button>
      </div>

      {/* Natural Language Database Creator Box */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Natural Language Database Creation</h3>
            <p className="text-xs text-muted-foreground">
              Describe the business entities and requirements. The AI will design normalized tables and foreign key relationships.
            </p>
          </div>
        </div>

        <form onSubmit={handleGenerateNLSchema} className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. 'Create a customer relationship database with leads, contacts, opportunities, and deals'..."
            value={nlPrompt}
            onChange={e => setNlPrompt(e.target.value)}
            disabled={isGenerating}
            className="flex-1 bg-background border border-border rounded-xl px-4 py-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
          />
          <button
            type="submit"
            disabled={!nlPrompt.trim() || isGenerating}
            className="px-5 py-2.5 bg-primary text-primary-foreground text-xs font-semibold rounded-xl hover:bg-primary/90 transition-all disabled:opacity-50 shrink-0"
          >
            {isGenerating ? 'Designing...' : 'Generate Schema'}
          </button>
        </form>

        {statusMessage && (
          <div className="text-xs font-medium text-primary bg-primary/10 p-3 rounded-lg border border-primary/20">
            {statusMessage}
          </div>
        )}

        {/* DDL Preview & Confirmation */}
        {generatedSchemaPreview && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">
                Schema Architecture Preview ({generatedSchemaPreview.tables?.length || 0} tables)
              </span>
              <button
                onClick={handleApplyGeneratedDDL}
                disabled={isExecutingDDL}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white font-semibold text-xs rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
              >
                <ShieldCheck className="w-4 h-4" />
                {isExecutingDDL ? 'Executing DDL...' : 'Confirm & Apply Schema to DB'}
              </button>
            </div>

            <p className="text-xs text-muted-foreground">{generatedSchemaPreview.summary}</p>

            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Generated PostgreSQL DDL:
              </span>
              <pre className="p-3 bg-muted font-mono text-xs rounded-lg overflow-x-auto border border-border max-h-48 text-foreground">
                {generatedSchemaPreview.ddl_statements?.join('\n\n')}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Relational Schema & ER Diagram */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          Active Database Tables ({schema.table_names?.length || 0})
        </h2>
        <ERDiagram schema={schema} />
      </div>
    </div>
  );
};
