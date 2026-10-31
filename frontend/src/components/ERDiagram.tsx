import React from 'react';
import { SchemaData } from '../types';
import { Key, Link as LinkIcon, Database, Table as TableIcon } from 'lucide-react';

interface ERDiagramProps {
  schema: SchemaData;
}

export const ERDiagram: React.FC<ERDiagramProps> = ({ schema }) => {
  const { tables, relationships } = schema;
  const tableNames = Object.keys(tables || {});

  if (tableNames.length === 0) {
    return (
      <div className="p-12 text-center text-muted-foreground border border-dashed border-border rounded-xl">
        <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No database tables detected in this project.</p>
        <p className="text-xs mt-1">Upload a dataset or create a schema using natural language.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Relational Table Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tableNames.map(tableName => {
          const columns = tables[tableName] || [];
          return (
            <div
              key={tableName}
              className="rounded-xl border border-border bg-card shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
            >
              {/* Table Header */}
              <div className="bg-primary/10 border-b border-border px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TableIcon className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm text-foreground">{tableName}</span>
                </div>
                <span className="text-[10px] font-mono bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                  {columns.length} columns
                </span>
              </div>

              {/* Columns List */}
              <div className="p-3 divide-y divide-border/50 flex-1">
                {columns.map(col => (
                  <div key={col.name} className="py-1.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      {col.is_primary_key ? (
                        <span title="Primary Key">
                          <Key className="w-3.5 h-3.5 text-amber-500 fill-amber-500/20" />
                        </span>
                      ) : col.is_foreign_key ? (
                        <span title="Foreign Key">
                          <LinkIcon className="w-3 h-3 text-blue-500" />
                        </span>
                      ) : (
                        <span className="w-3.5 inline-block text-center text-muted-foreground/40">•</span>
                      )}
                      <span className={`font-mono ${col.is_primary_key ? 'font-semibold text-foreground' : 'text-foreground/90'}`}>
                        {col.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                      {col.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Relationships Map Section */}
      {relationships && relationships.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-primary" />
            Confirmed Foreign Key Relationships
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {relationships.map((rel, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg border border-border/80 bg-muted/30 flex items-center justify-between text-xs font-mono"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-primary">{rel.source_table}</span>
                  <span className="text-muted-foreground">({rel.source_column})</span>
                </div>
                <span className="text-muted-foreground font-sans px-2">──►</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-primary">{rel.target_table}</span>
                  <span className="text-muted-foreground">({rel.target_column})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
