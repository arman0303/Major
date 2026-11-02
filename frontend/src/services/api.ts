import { User, UserSettings, Project, Dataset, SchemaData, Conversation, Message, QueryResult, Dashboard, DashboardWidget } from '../types';

const API_BASE = '/api';

export class ApiError extends Error {
  code?: string;
  details?: any;
  constructor(message: string, code?: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Remove content-type if body is FormData
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(data.error || 'Request failed', data.code, data.details);
  }

  return data as T;
}

// ── Chat Response Type ────────────────────────────────────────────────────────

export interface ChatResponse {
  message_id: string;
  intent: string;
  response_type: string;
  answer: string;
  explanation: string;
  generated_sql?: string | null;
  query_type?: string | null;
  requires_confirmation: boolean;
  query_result?: QueryResult;
  visualization_config?: any;
  execution_time_ms?: number;
  error_message?: string;
  document_sources?: DocumentSource[];
  ddl_statements?: string[];
  intent_confidence?: number;
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

// ── API Client ────────────────────────────────────────────────────────────────

export const api = {
  // ── Auth ──
  register: (body: any) => request<{ user: User; token: string; refreshToken: string; defaultProjectId: string }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: any) => request<{ user: User; token: string; refreshToken: string; projects: Project[] }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  getProfile: () => request<{ user: User; settings: UserSettings }>('/auth/profile'),
  updateSettings: (body: Partial<UserSettings>) => request<{ message: string }>('/auth/settings', { method: 'PUT', body: JSON.stringify(body) }),

  // ── Projects ──
  listProjects: () => request<{ projects: Project[] }>('/projects'),
  createProject: (body: { name: string; description?: string }) => request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  getProject: (id: string) => request<{ project: Project; datasets: Dataset[] }>(`/projects/${id}`),
  updateProject: (id: string, body: { name: string; description?: string }) => request<{ message: string }>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<{ message: string }>(`/projects/${id}`, { method: 'DELETE' }),

  // ── Datasets ──
  listDatasets: (projectId: string) => request<{ datasets: Dataset[] }>(`/datasets?projectId=${projectId}`),
  uploadDataset: (formData: FormData) => request<{ dataset: Dataset }>('/datasets/upload', { method: 'POST', body: formData }),
  deleteDataset: (id: string) => request<{ message: string }>(`/datasets/${id}`, { method: 'DELETE' }),

  // ── Schema ──
  getSchema: (projectId: string) => request<SchemaData>(`/schema?projectId=${projectId}`),
  generateSchema: (prompt: string) => request<any>('/schema/generate', { method: 'POST', body: JSON.stringify({ prompt }) }),
  executeDDL: (ddlStatements: string[], isConfirmed: boolean) => request<any>('/schema/execute', { method: 'POST', body: JSON.stringify({ ddlStatements, isConfirmed }) }),

  // ── Conversations ──
  listConversations: (projectId: string, search?: string) => {
    const params = new URLSearchParams({ projectId });
    if (search) params.set('search', search);
    return request<{ conversations: Conversation[] }>(`/conversations?${params}`);
  },
  searchConversations: (q: string, projectId?: string) => {
    const params = new URLSearchParams({ q });
    if (projectId) params.set('projectId', projectId);
    return request<{ conversations: Conversation[] }>(`/conversations/search?${params}`);
  },
  createConversation: (projectId: string, title?: string) =>
    request<{ conversation: Conversation }>('/conversations', { method: 'POST', body: JSON.stringify({ projectId, title }) }),
  getConversation: (id: string, page?: number) => {
    const params = new URLSearchParams();
    if (page) params.set('page', String(page));
    return request<{ conversation: Conversation; messages: Message[]; pagination: any }>(`/conversations/${id}?${params}`);
  },
  updateConversation: (id: string, title: string) =>
    request<{ message: string; title: string }>(`/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  deleteConversation: (id: string) =>
    request<{ message: string }>(`/conversations/${id}`, { method: 'DELETE' }),

  // ── SQL Execution ──
  validateSQL: (sql: string) => request<any>('/sql/validate', { method: 'POST', body: JSON.stringify({ sql }) }),
  previewSQL: (projectId: string, sql: string) => request<any>('/sql/preview', { method: 'POST', body: JSON.stringify({ projectId, sql }) }),
  executeSQL: (body: { projectId: string; sql: string; isConfirmed?: boolean; limit?: number }) =>
    request<{ status: string; executed_sql: string; records: any[]; columns: string[]; row_count: number; execution_time_ms: number; query_type: string }>('/sql/execute', { method: 'POST', body: JSON.stringify(body) }),
  getQueryHistory: (projectId: string) => request<{ history: any[] }>(`/sql/history?projectId=${projectId}`),

  // ── AI ──
  chat: (body: { conversationId: string; projectId: string; message: string }) =>
    request<ChatResponse>('/ai/chat', { method: 'POST', body: JSON.stringify(body) }),
  getInsights: (body: { rows: any[]; columns: string[]; query?: string }) =>
    request<any>('/ai/insights', { method: 'POST', body: JSON.stringify(body) }),
  indexDocument: (body: { fileId?: string; projectId: string; content?: string; chunks?: any[]; metadata?: any }) =>
    request<{ indexed: boolean; chunks_indexed: number }>('/ai/index-document', { method: 'POST', body: JSON.stringify(body) }),

  // ── System ──
  getSystemStatus: () => request<{ database_mode: string; status: string }>('/system/status'),

  // ── Dashboards ──
  listDashboards: (projectId: string) => request<{ dashboards: Dashboard[] }>(`/dashboards?projectId=${projectId}`),
  createDashboard: (body: { projectId: string; title: string; description?: string }) => request<{ dashboard: Dashboard }>('/dashboards', { method: 'POST', body: JSON.stringify(body) }),
  getDashboard: (id: string) => request<{ dashboard: Dashboard; widgets: DashboardWidget[] }>(`/dashboards/${id}`),
  addWidget: (dashboardId: string, body: any) => request<any>(`/dashboards/${dashboardId}/widgets`, { method: 'POST', body: JSON.stringify(body) }),
};
