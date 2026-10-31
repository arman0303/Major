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

export const api = {
  // Auth
  register: (body: any) => request<{ user: User; token: string; refreshToken: string; defaultProjectId: string }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: any) => request<{ user: User; token: string; refreshToken: string; projects: Project[] }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  getProfile: () => request<{ user: User; settings: UserSettings }>('/auth/profile'),
  updateSettings: (body: Partial<UserSettings>) => request<{ message: string }>('/auth/settings', { method: 'PUT', body: JSON.stringify(body) }),

  // Projects
  listProjects: () => request<{ projects: Project[] }>('/projects'),
  createProject: (body: { name: string; description?: string }) => request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  getProject: (id: string) => request<{ project: Project; datasets: Dataset[] }>(`/projects/${id}`),
  updateProject: (id: string, body: { name: string; description?: string }) => request<{ message: string }>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request<{ message: string }>(`/projects/${id}`, { method: 'DELETE' }),

  // Datasets
  listDatasets: (projectId: string) => request<{ datasets: Dataset[] }>(`/datasets?projectId=${projectId}`),
  uploadDataset: (formData: FormData) => request<{ dataset: Dataset }>('/datasets/upload', { method: 'POST', body: formData }),
  deleteDataset: (id: string) => request<{ message: string }>(`/datasets/${id}`, { method: 'DELETE' }),

  // Schema
  getSchema: (projectId: string) => request<SchemaData>(`/schema?projectId=${projectId}`),
  generateSchema: (prompt: string) => request<any>('/schema/generate', { method: 'POST', body: JSON.stringify({ prompt }) }),
  executeDDL: (ddlStatements: string[], isConfirmed: boolean) => request<any>('/schema/execute', { method: 'POST', body: JSON.stringify({ ddlStatements, isConfirmed }) }),

  // Conversations
  listConversations: (projectId: string) => request<{ conversations: Conversation[] }>(`/conversations?projectId=${projectId}`),
  createConversation: (projectId: string, title?: string) => request<{ conversation: Conversation }>('/conversations', { method: 'POST', body: JSON.stringify({ projectId, title }) }),
  getConversation: (id: string) => request<{ conversation: Conversation; messages: Message[] }>(`/conversations/${id}`),
  updateConversation: (id: string, title: string) => request<{ message: string }>(`/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  deleteConversation: (id: string) => request<{ message: string }>(`/conversations/${id}`, { method: 'DELETE' }),

  // SQL Execution
  validateSQL: (sql: string) => request<any>('/sql/validate', { method: 'POST', body: JSON.stringify({ sql }) }),
  previewSQL: (projectId: string, sql: string) => request<any>('/sql/preview', { method: 'POST', body: JSON.stringify({ projectId, sql }) }),
  executeSQL: (body: { projectId: string; sql: string; isConfirmed?: boolean; limit?: number }) => request<{ status: string; executed_sql: string; records: any[]; columns: string[]; row_count: number; execution_time_ms: number; query_type: string }>('/sql/execute', { method: 'POST', body: JSON.stringify(body) }),
  getQueryHistory: (projectId: string) => request<{ history: any[] }>(`/sql/history?projectId=${projectId}`),

  // AI
  chat: (body: { conversationId: string; projectId: string; message: string }) => request<{
    message_id: string;
    intent: string;
    generated_sql: string;
    query_type: string;
    explanation: string;
    requires_confirmation: boolean;
    query_result?: QueryResult;
    visualization_config?: any;
    execution_time_ms?: number;
    error_message?: string;
  }>('/ai/chat', { method: 'POST', body: JSON.stringify(body) }),
  getInsights: (body: { rows: any[]; columns: string[]; query?: string }) => request<any>('/ai/insights', { method: 'POST', body: JSON.stringify(body) }),

  // Dashboards
  listDashboards: (projectId: string) => request<{ dashboards: Dashboard[] }>(`/dashboards?projectId=${projectId}`),
  createDashboard: (body: { projectId: string; title: string; description?: string }) => request<{ dashboard: Dashboard }>('/dashboards', { method: 'POST', body: JSON.stringify(body) }),
  getDashboard: (id: string) => request<{ dashboard: Dashboard; widgets: DashboardWidget[] }>(`/dashboards/${id}`),
  addWidget: (dashboardId: string, body: any) => request<any>(`/dashboards/${dashboardId}/widgets`, { method: 'POST', body: JSON.stringify(body) }),
};
