export interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export interface UserSettings {
  default_llm_provider: 'gemini' | 'openai';
  gemini_api_key?: string;
  openai_api_key?: string;
  hasGeminiKey?: boolean;
  hasOpenAIKey?: boolean;
  theme: 'light' | 'dark';
  auto_execute_select: boolean;
  max_row_limit: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  table_name: string;
  file_type: string;
  row_count: number;
  schema_info?: any[];
  status: string;
  created_at: string;
}

export interface ColumnMetadata {
  name: string;
  type: string;
  is_primary_key?: boolean;
  is_foreign_key?: boolean;
  nullable?: boolean;
}

export interface RelationshipMetadata {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  type?: string;
}

export interface SchemaData {
  tables: Record<string, ColumnMetadata[]>;
  table_names: string[];
  relationships: RelationshipMetadata[];
}

export interface QueryResult {
  records: any[];
  columns: string[];
  row_count: number;
  duration_ms?: number;
}

export interface VisualizationConfig {
  chart_type: 'table' | 'bar' | 'grouped_bar' | 'stacked_bar' | 'pie' | 'donut' | 'line' | 'area' | 'scatter' | 'kpi';
  x_axis?: string;
  y_axis?: string;
  y_axes?: string[];
  title?: string;
  kpi_label?: string;
  kpi_value?: any;
  available_charts?: string[];
  reason?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  generated_sql?: string;
  query_result?: QueryResult;
  visualization_config?: VisualizationConfig;
  explanation?: { simple: string; technical: string } | string;
  requires_confirmation?: boolean;
  confirmation_status?: 'none' | 'pending' | 'confirmed' | 'rejected';
  error_message?: string;
  execution_time_ms?: number;
  intent_type?: string;
  document_sources?: DocumentSource[];
  created_at: string;
}

export interface DocumentSource {
  id: string;
  content: string;
  metadata: {
    source?: string;
    page_number?: number;
    chunk_index?: number;
    file_id?: string;
  };
  similarity?: number;
}

export interface Conversation {
  id: string;
  project_id: string;
  user_id?: string;
  title: string;
  message_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Dashboard {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  created_at: string;
}

export interface DashboardWidget {
  id: string;
  dashboard_id: string;
  title: string;
  widget_type: string;
  sql_query: string;
  chart_config: VisualizationConfig;
}
