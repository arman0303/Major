import React, { useState, useEffect } from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { api } from '../services/api';

interface ConfirmationModalProps {
  isOpen: boolean;
  sql: string;
  projectId: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  sql,
  projectId,
  onConfirm,
  onCancel,
}) => {
  const [preview, setPreview] = useState<{ affected_count: number; preview_records: any[]; warning: string } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && sql) {
      setIsLoading(true);
      api.previewSQL(projectId, sql)
        .then(res => setPreview(res))
        .catch(err => console.warn('Preview failed:', err))
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, sql, projectId]);

  if (!isOpen) return null;

  const upper = sql.trim().toUpperCase();
  const isDrop = upper.startsWith('DROP') || upper.startsWith('TRUNCATE');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${isDrop ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-500'}`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {isDrop ? 'Destructive Action Confirmation' : 'Database Mutation Confirmation'}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Review SQL impact before applying changes to the database.
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* SQL Preview Box */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Pending SQL Command:</span>
          <pre className="p-3 rounded-lg bg-muted font-mono text-xs text-foreground overflow-x-auto border border-border">
            {sql}
          </pre>
        </div>

        {/* Impact Warning */}
        {preview && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs">
            {preview.warning}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-white shadow-sm transition-all ${
              isDrop ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Confirm & Execute
          </button>
        </div>
      </div>
    </div>
  );
};
