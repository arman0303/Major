import React, { useState, useEffect } from 'react';
import { UploadCloud, FileText, FileSpreadsheet, Trash2, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { Dataset } from '../types';

export const DatasetManagerPage: React.FC = () => {
  const { activeProject, projects, setActiveProject } = useAuth();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customTableName, setCustomTableName] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const currentProj = activeProject || (projects && projects[0]) || null;

  const fetchDatasets = async () => {
    if (!currentProj) return;
    try {
      const res = await api.listDatasets(currentProj.id);
      setDatasets(res.datasets);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!activeProject && projects && projects.length > 0) {
      setActiveProject(projects[0]);
    }
    fetchDatasets();
  }, [activeProject, projects]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProj = currentProj;
    if (!selectedFile) {
      setStatusMessage({ type: 'error', text: 'Please select a file to upload.' });
      return;
    }
    if (!targetProj) {
      setStatusMessage({ type: 'error', text: 'No active project found. Please create or select a project first.' });
      return;
    }

    setIsUploading(true);
    setStatusMessage(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('projectId', targetProj.id);
    if (customTableName) {
      formData.append('tableName', customTableName);
    }

    try {
      const res = await api.uploadDataset(formData);
      setStatusMessage({ 
        type: 'success', 
        text: `Successfully uploaded '${selectedFile.name}'! Ingested into table '${res.dataset.table_name}' with ${res.dataset.row_count} records.` 
      });
      setSelectedFile(null);
      setCustomTableName('');
      await fetchDatasets();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Upload processing failed.' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete dataset '${name}' and its associated table?`)) return;
    try {
      await api.deleteDataset(id);
      await fetchDatasets();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-background">
      {/* Header */}
      <div className="border-b border-border pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <UploadCloud className="w-6 h-6 text-primary" />
          Dataset Upload Manager
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Upload JSON, CSV, or PDF documents. The engine automatically infers schema types, cleans column names, and ingests into PostgreSQL tables.
        </p>
      </div>

      {/* Upload Zone */}
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center space-y-4 max-w-2xl mx-auto shadow-sm">
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
          <UploadCloud className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Select a dataset file to import</h3>
          <p className="text-xs text-muted-foreground">Supported formats: JSON arrays, CSV spreadsheets, PDF, and DOCX documents (up to 50MB)</p>
        </div>

        <form onSubmit={handleUpload} className="space-y-4 max-w-md mx-auto pt-2">
          <input
            type="file"
            accept=".csv,.json,.pdf,.txt,.docx"
            onChange={e => setSelectedFile(e.target.files?.[0] || null)}
            className="w-full text-xs text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
          />

          {selectedFile && (
            <input
              type="text"
              placeholder="Custom Table Name (optional)..."
              value={customTableName}
              onChange={e => setCustomTableName(e.target.value)}
              className="w-full text-xs bg-muted/60 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}

          <button
            type="submit"
            disabled={!selectedFile || isUploading}
            className="w-full py-2.5 px-4 bg-primary text-primary-foreground font-semibold text-xs rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 shadow-sm"
          >
            {isUploading ? 'Parsing & Ingesting Dataset...' : 'Import to PostgreSQL Database'}
          </button>
        </form>

        {statusMessage && (
          <div
            className={`p-3 rounded-lg text-xs font-medium flex items-center justify-center gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                : 'bg-destructive/10 text-destructive border border-destructive/20'
            }`}
          >
            {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{statusMessage.text}</span>
          </div>
        )}
      </div>

      {/* Dataset Inventory Table */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">
          Imported Datasets ({datasets.length})
        </h2>

        {datasets.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground border border-border rounded-xl">
            No datasets uploaded yet for this project.
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/60 border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-semibold text-foreground">Dataset Name</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Target Table</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Format</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Row Count</th>
                  <th className="px-4 py-3 font-semibold text-foreground">Status</th>
                  <th className="px-4 py-3 font-semibold text-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {datasets.map(ds => (
                  <tr key={ds.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground flex items-center gap-2">
                      {ds.file_type === 'csv' ? (
                        <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <FileText className="w-4 h-4 text-blue-500" />
                      )}
                      <span>{ds.name}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-primary font-semibold">
                      {ds.table_name}
                    </td>
                    <td className="px-4 py-3 uppercase font-mono text-[10px] text-muted-foreground">
                      {ds.file_type}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {ds.row_count?.toLocaleString() || 0}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
                        <CheckCircle2 className="w-3 h-3" />
                        Ready
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(ds.id, ds.name)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded"
                        title="Delete dataset"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
