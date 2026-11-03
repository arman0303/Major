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

  if (response.status === 401 && data.code === 'TOKEN_EXPIRED') {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          if (refreshData.token) {
            localStorage.setItem('token', refreshData.token);
            if (refreshData.refreshToken) {
              localStorage.setItem('refreshToken', refreshData.refreshToken);
            }
            // Retry original request with renewed access token
            headers['Authorization'] = `Bearer ${refreshData.token}`;
            const retryRes = await fetch(`${API_BASE}${endpoint}`, {
              ...options,
              headers,
            });
            const retryData = await retryRes.json().catch(() => ({}));
            if (retryRes.ok) {
              return retryData as T;
            }
          }
        }
      } catch {
        // Fall through to error handling below
      }
    }
  }

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
  refreshToken: (refreshToken: string) => request<{ message: string; token: string; refreshToken: string; user: User }>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  logout: () => request<{ message: string }>('/auth/logout', { method: 'POST' }).finally(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  }),
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
  chatStream: async (
    body: { conversationId: string; projectId: string; message: string },
    handlers: {
      onToken?: (token: string) => void;
      onSql?: (data: any) => void;
      onResult?: (data: any) => void;
      onStatus?: (status: string) => void;
      onComplete?: (data: any) => void;
      onError?: (error: string) => void;
    },
    signal?: AbortSignal
  ) => {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/ai/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new ApiError(errData.error || `HTTP ${response.status} Stream Error`, errData.code);
    }

    if (!response.body) {
      throw new ApiError('No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.type === 'token' && handlers.onToken) {
            handlers.onToken(parsed.token);
          } else if (parsed.type === 'sql' && handlers.onSql) {
            handlers.onSql(parsed);
          } else if (parsed.type === 'result' && handlers.onResult) {
            handlers.onResult(parsed);
          } else if (parsed.type === 'status' && handlers.onStatus) {
            handlers.onStatus(parsed.message);
          } else if (parsed.type === 'synthesis' && handlers.onToken) {
            handlers.onToken(parsed.answer);
          } else if (parsed.type === 'complete' && handlers.onComplete) {
            handlers.onComplete(parsed);
          } else if (parsed.type === 'error' && handlers.onError) {
            handlers.onError(parsed.message);
          }
        } catch {}
      }
    }
  },
  getInsights: (body: { rows: any[]; columns: string[]; query?: string }) =>
    request<any>('/ai/insights', { method: 'POST', body: JSON.stringify(body) }),
  indexDocument: (body: { fileId?: string; projectId: string; content?: string; chunks?: any[]; metadata?: any }) =>
    request<{ indexed: boolean; chunks_indexed: number }>('/ai/index-document', { method: 'POST', body: JSON.stringify(body) }),

  // ── System ──
  getSystemStatus: () => request<{ database_mode: string; status: string }>('/system/status'),
  checkProviderHealth: (provider?: string, apiKey?: string) => {
    const params = new URLSearchParams();
    if (provider) params.set('provider', provider);
    if (apiKey) params.set('api_key', apiKey);
    return request<{
      status: string;
      healthy: boolean;
      provider: string;
      active_model?: string;
      message: string;
      is_retryable?: boolean;
    }>(`/system/provider-health?${params}`);
  },

  // ── Dashboards ──
  listDashboards: (projectId: string) => request<{ dashboards: Dashboard[] }>(`/dashboards?projectId=${projectId}`),
  createDashboard: (body: { projectId: string; title: string; description?: string }) => request<{ dashboard: Dashboard }>('/dashboards', { method: 'POST', body: JSON.stringify(body) }),
  getDashboard: (id: string) => request<{ dashboard: Dashboard; widgets: DashboardWidget[] }>(`/dashboards/${id}`),
  addWidget: (dashboardId: string, body: any) => request<any>(`/dashboards/${dashboardId}/widgets`, { method: 'POST', body: JSON.stringify(body) }),
};
