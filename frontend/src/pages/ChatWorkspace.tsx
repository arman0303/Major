import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send, Plus, Search, Bot, User as UserIcon, Code2,
  Trash2, Edit3, Check, X, Loader2, FileText,
  Database, MessageSquare, ChevronLeft, ChevronRight,
  Copy, CheckCheck, AlertTriangle, Sparkles,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api, ChatResponse, DocumentSource } from '../services/api';
import { Message, Conversation, QueryResult, VisualizationConfig } from '../types';
import { DataVisualization } from '../components/DataVisualization';
import { RightPanel } from '../components/RightPanel';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { cn } from '../utils/cn';

// ── Suggested prompts that vary by type ──────────────────────────────────────
const SUGGESTED_PROMPTS = [
  { text: 'Show the average salary of every department', icon: '📊' },
  { text: 'Find employees working on multiple projects', icon: '👥' },
  { text: 'What is the difference between INNER JOIN and LEFT JOIN?', icon: '📚' },
  { text: 'Rank employees by salary within each department', icon: '🏆' },
  { text: 'Show monthly revenue trends', icon: '📈' },
  { text: 'Find employees earning more than their department average', icon: '💰' },
];

// ── Intent badge colors ───────────────────────────────────────────────────────
const INTENT_COLORS: Record<string, string> = {
  sql_analytics: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  document_qa: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  general_knowledge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  greeting: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  schema_management: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  data_modification: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  hybrid: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
};

const INTENT_LABELS: Record<string, string> = {
  sql_analytics: '⚡ SQL Query',
  document_qa: '📄 Document',
  general_knowledge: '💡 Knowledge',
  greeting: '👋 Chat',
  schema_management: '🏗️ Schema',
  data_modification: '✏️ Mutation',
  hybrid: '🔀 Hybrid',
  ambiguous: '❓ Clarifying',
};

// ── Copy button hook ──────────────────────────────────────────────────────────
function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };
  return { copied, copy };
}

// ── Conversation Sidebar Item ─────────────────────────────────────────────────
interface ConvItemProps {
  conv: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onRename: (newTitle: string) => void;
  onDelete: () => void;
}

const ConvItem: React.FC<ConvItemProps> = ({ conv, isActive, onSelect, onRename, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conv.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleRename = () => {
    if (editTitle.trim() && editTitle.trim() !== conv.title) {
      onRename(editTitle.trim());
    }
    setEditing(false);
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'hover:bg-muted text-muted-foreground hover:text-foreground'
      )}
      onClick={() => !editing && onSelect()}
    >
      <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />

      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 bg-transparent outline-none text-foreground text-xs min-w-0"
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={e => {
            if (e.key === 'Enter') handleRename();
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate text-xs leading-relaxed">{conv.title}</span>
      )}

      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        <button
          className="p-0.5 hover:text-primary rounded"
          onClick={e => { e.stopPropagation(); setEditing(true); setEditTitle(conv.title); }}
          title="Rename"
        >
          <Edit3 className="w-3 h-3" />
        </button>
        <button
          className="p-0.5 hover:text-destructive rounded"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

// ── Message Bubble ────────────────────────────────────────────────────────────
interface MessageBubbleProps {
  msg: Message;
  onViewInPanel: () => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ msg, onViewInPanel }) => {
  const { copied, copy } = useCopyToClipboard();
  const isUser = msg.role === 'user';
  const intent = (msg as any).intent_type;

  const content = typeof msg.content === 'string'
    ? msg.content
    : (msg as any).explanation?.simple || 'Processed.';

  return (
    <div className={cn('flex gap-3 max-w-4xl', isUser ? 'ml-auto flex-row-reverse' : '')}>
      {/* Avatar */}
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1',
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted border border-border'
      )}>
        {isUser ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Content */}
      <div className={cn('flex flex-col gap-1 max-w-[85%]', isUser ? 'items-end' : 'items-start')}>
        {/* Intent badge for assistant */}
        {!isUser && intent && INTENT_LABELS[intent] && (
          <span className={cn(
            'text-[10px] font-medium px-2 py-0.5 rounded-full',
            INTENT_COLORS[intent] || 'bg-muted text-muted-foreground'
          )}>
            {INTENT_LABELS[intent]}
          </span>
        )}

        {/* Message bubble */}
        <div className={cn(
          'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-card border border-border rounded-tl-sm text-foreground'
        )}>
          {/* Error state */}
          {msg.error_message && !msg.query_result && (
            <div className="flex items-center gap-2 text-destructive mb-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="text-xs">Query failed</span>
            </div>
          )}

          {/* Main content with basic markdown */}
          <div className="whitespace-pre-wrap">{content}</div>

          {/* Document sources */}
          {(msg as any).document_sources && (msg as any).document_sources.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground mb-1">Sources:</p>
              <div className="flex flex-wrap gap-1">
                {((msg as any).document_sources as DocumentSource[]).slice(0, 3).map((src, i) => (
                  <span key={i} className="text-[10px] bg-muted px-2 py-0.5 rounded-full">
                    📄 {src.metadata?.source || 'Document'}
                    {src.metadata?.page_number ? ` p.${src.metadata.page_number}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action buttons for assistant messages with SQL/results */}
        {!isUser && (msg.generated_sql || msg.query_result) && (
          <div className="flex items-center gap-2 px-1">
            {msg.generated_sql && (
              <button
                onClick={() => copy(msg.generated_sql!, msg.id + '-sql')}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied === msg.id + '-sql' ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                Copy SQL
              </button>
            )}
            {msg.query_result && (
              <button
                onClick={onViewInPanel}
                className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
              >
                <Database className="w-3 h-3" />
                View Results
              </button>
            )}
            {msg.execution_time_ms !== undefined && msg.execution_time_ms > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {msg.execution_time_ms}ms
              </span>
            )}
          </div>
        )}

        {/* Inline mini result preview for SQL responses */}
        {!isUser && msg.query_result && msg.query_result.records && msg.query_result.records.length > 0 && (
          <div className="w-full mt-1 rounded-xl border border-border overflow-hidden bg-card">
            <div className="overflow-x-auto max-h-40">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    {msg.query_result.columns?.slice(0, 6).map(col => (
                      <th key={col} className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">{col}</th>
                    ))}
                    {(msg.query_result.columns?.length || 0) > 6 && (
                      <th className="px-3 py-1.5 text-left text-muted-foreground">+{(msg.query_result.columns?.length || 0) - 6} more</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {msg.query_result.records.slice(0, 4).map((row, i) => (
                    <tr key={i} className="border-t border-border/50">
                      {msg.query_result!.columns?.slice(0, 6).map(col => (
                        <td key={col} className="px-3 py-1.5 text-foreground whitespace-nowrap">
                          {row[col] === null || row[col] === undefined ? (
                            <span className="text-muted-foreground italic">null</span>
                          ) : String(row[col]).length > 30
                            ? String(row[col]).slice(0, 27) + '...'
                            : String(row[col])
                          }
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(msg.query_result.row_count || 0) > 4 && (
              <div className="px-3 py-1 border-t border-border/50 bg-muted/30">
                <button onClick={onViewInPanel} className="text-[11px] text-primary hover:underline">
                  View all {msg.query_result.row_count} rows →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Requires confirmation notice */}
        {!isUser && msg.requires_confirmation && msg.confirmation_status === 'pending' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-yellow-500/40 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300 text-xs w-full">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>This operation modifies data. Review the SQL in the right panel before confirming.</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main ChatWorkspace ────────────────────────────────────────────────────────
export const ChatWorkspace: React.FC = () => {
  const { activeProject } = useAuth();

  // Sidebar
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Active conversation
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Right panel state
  const [activeSql, setActiveSql] = useState('');
  const [activeResult, setActiveResult] = useState<QueryResult | undefined>(undefined);
  const [activeViz, setActiveViz] = useState<VisualizationConfig | undefined>(undefined);
  const [activeDuration, setActiveDuration] = useState<number | undefined>(undefined);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  // Confirmation modal
  const [pendingConfirmationSql, setPendingConfirmationSql] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Load conversations ──
  const loadConversations = useCallback(async () => {
    if (!activeProject) return;
    try {
      const res = await api.listConversations(activeProject.id, searchQuery || undefined);
      setConversations(res.conversations);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, [activeProject, searchQuery]);

  useEffect(() => {
    if (activeProject) {
      loadConversations();
    }
  }, [activeProject, searchQuery]);

  // Auto-create or load first conversation
  useEffect(() => {
    if (!activeProject) return;
    api.listConversations(activeProject.id)
      .then(res => {
        setConversations(res.conversations);
        if (res.conversations.length > 0) {
          loadConversation(res.conversations[0].id);
        } else {
          createNewConversation();
        }
      })
      .catch(console.error);
  }, [activeProject?.id]);

  const loadConversation = async (convId: string) => {
    try {
      const res = await api.getConversation(convId);
      setActiveConv(res.conversation);
      setMessages(res.messages);

      // Prime inspector with latest result
      const last = [...res.messages].reverse().find(m => m.role === 'assistant' && m.generated_sql);
      if (last) {
        setActiveSql(last.generated_sql || '');
        setActiveResult(last.query_result);
        setActiveViz(last.visualization_config);
        setActiveDuration(last.execution_time_ms);
        setActiveError(last.error_message || null);
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  };

  const createNewConversation = async () => {
    if (!activeProject) return;
    try {
      const res = await api.createConversation(activeProject.id, 'New Chat');
      setConversations(prev => [res.conversation, ...prev]);
      setActiveConv(res.conversation);
      setMessages([]);
      setActiveSql('');
      setActiveResult(undefined);
      setActiveViz(undefined);
      setActiveError(null);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const handleRenameConversation = async (convId: string, newTitle: string) => {
    try {
      await api.updateConversation(convId, newTitle);
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: newTitle } : c));
      if (activeConv?.id === convId) {
        setActiveConv(prev => prev ? { ...prev, title: newTitle } : prev);
      }
    } catch (err) {
      console.error('Failed to rename:', err);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    try {
      await api.deleteConversation(convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (activeConv?.id === convId) {
        const remaining = conversations.filter(c => c.id !== convId);
        if (remaining.length > 0) {
          loadConversation(remaining[0].id);
        } else {
          createNewConversation();
        }
      }
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputPrompt]);

  // ── Send Message ──
  const handleSendMessage = async (customPrompt?: string) => {
    const text = (customPrompt || inputPrompt).trim();
    if (!text || !activeConv || !activeProject || isLoading) return;

    setInputPrompt('');
    setIsLoading(true);

    // Optimistic user message
    const tempId = `temp_${Date.now()}`;
    const tempUserMsg: Message = {
      id: tempId,
      conversation_id: activeConv.id,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const res: ChatResponse = await api.chat({
        conversationId: activeConv.id,
        projectId: activeProject.id,
        message: text,
      });

      // Replace temp message + add assistant response
      const assistantMsg: Message = {
        id: res.message_id,
        conversation_id: activeConv.id,
        role: 'assistant',
        content: res.answer || res.explanation || 'Processed.',
        generated_sql: res.generated_sql || undefined,
        query_result: res.query_result,
        visualization_config: res.visualization_config,
        requires_confirmation: res.requires_confirmation,
        confirmation_status: res.requires_confirmation ? 'pending' : 'none',
        execution_time_ms: res.execution_time_ms,
        error_message: res.error_message || undefined,
        created_at: new Date().toISOString(),
        // Extra fields
        ...(res.intent ? { intent_type: res.intent } : {}),
        ...(res.document_sources ? { document_sources: res.document_sources } : {}),
      } as any;

      setMessages(prev => [...prev.filter(m => m.id !== tempId), assistantMsg]);

      // Update inspector
      if (res.generated_sql) {
        setActiveSql(res.generated_sql);
        setIsInspectorOpen(true);
      }
      if (res.query_result) {
        setActiveResult(res.query_result);
      }
      setActiveViz(res.visualization_config);
      setActiveDuration(res.execution_time_ms);
      setActiveError(res.error_message || null);

      // Handle DDL confirmation for schema management
      if (res.requires_confirmation && res.generated_sql) {
        setPendingConfirmationSql(res.generated_sql);
      }

      // Refresh conversation title if it changed
      const updatedConvs = await api.listConversations(activeProject.id);
      setConversations(updatedConvs.conversations);
      const updatedConv = updatedConvs.conversations.find(c => c.id === activeConv.id);
      if (updatedConv) setActiveConv(updatedConv);

    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== tempId).concat({
        id: `err_${Date.now()}`,
        conversation_id: activeConv.id,
        role: 'assistant',
        content: `I encountered an error: ${err.message || 'Request failed. Please try again.'}`,
        created_at: new Date().toISOString(),
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleConfirmMutation = async () => {
    if (!pendingConfirmationSql || !activeProject) return;
    try {
      const res = await api.executeSQL({
        projectId: activeProject.id,
        sql: pendingConfirmationSql,
        isConfirmed: true,
      });

      setActiveResult({ records: res.records, columns: res.columns, row_count: res.row_count });
      setActiveDuration(res.execution_time_ms);
      setActiveError(null);
      setPendingConfirmationSql(null);

      if (activeConv) {
        setMessages(prev => [...prev, {
          id: `conf_${Date.now()}`,
          conversation_id: activeConv.id,
          role: 'assistant',
          content: `Operation completed: ${res.row_count} row(s) affected.`,
          generated_sql: pendingConfirmationSql,
          query_result: { records: res.records, columns: res.columns, row_count: res.row_count },
          created_at: new Date().toISOString(),
        }]);
      }
    } catch (err: any) {
      setActiveError(err.message);
      setPendingConfirmationSql(null);
    }
  };

  const handleViewInPanel = (msg: Message) => {
    setActiveSql(msg.generated_sql || '');
    setActiveResult(msg.query_result);
    setActiveViz(msg.visualization_config);
    setActiveDuration(msg.execution_time_ms);
    setActiveError(msg.error_message || null);
    setIsInspectorOpen(true);
  };

  const handleExecuteFromInspector = async (customSql?: string) => {
    const query = customSql || activeSql;
    if (!query || !activeProject) return;
    try {
      const res = await api.executeSQL({ projectId: activeProject.id, sql: query, isConfirmed: true });
      setActiveResult({ records: res.records, columns: res.columns, row_count: res.row_count });
      setActiveDuration(res.execution_time_ms);
      setActiveError(null);
    } catch (err: any) {
      setActiveError(err.message);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── Left Chat History Sidebar ── */}
      <div className={cn(
        'flex flex-col border-r border-border bg-card/40 transition-all duration-200 shrink-0',
        sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
      )}>
        {sidebarOpen && (
          <>
            {/* New Chat button */}
            <div className="p-3 border-b border-border">
              <button
                onClick={createNewConversation}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Chat
              </button>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted rounded-lg outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {conversations.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8">
                  {searchQuery ? 'No chats match your search' : 'No chats yet'}
                </div>
              ) : (
                conversations.map(conv => (
                  <ConvItem
                    key={conv.id}
                    conv={conv}
                    isActive={activeConv?.id === conv.id}
                    onSelect={() => loadConversation(conv.id)}
                    onRename={newTitle => handleRenameConversation(conv.id, newTitle)}
                    onDelete={() => handleDeleteConversation(conv.id)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Toggle sidebar */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-4 h-8 bg-border hover:bg-muted-foreground/20 rounded-r flex items-center justify-center transition-colors"
        style={{ left: sidebarOpen ? '256px' : '0' }}
      >
        {sidebarOpen ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {/* ── Central Conversation Column ── */}
      <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
        {/* Header */}
        <div className="h-14 px-6 border-b border-border flex items-center justify-between bg-card/60 backdrop-blur shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-sm text-foreground truncate max-w-xs">
              {activeConv?.title || 'No conversation selected'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {activeProject?.name}
            </span>
            <button
              onClick={() => setIsInspectorOpen(!isInspectorOpen)}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors',
                isInspectorOpen
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">SQL Panel</span>
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-6 max-w-2xl mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-2">What would you like to analyze?</h2>
                <p className="text-muted-foreground text-sm max-w-md">
                  Ask a database question, query your data, explore uploaded documents, or ask anything about SQL and data analysis.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTED_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendMessage(p.text)}
                    className="flex items-start gap-2 text-left px-3 py-2.5 rounded-xl border border-border bg-card hover:bg-muted hover:border-primary/30 transition-colors text-sm"
                  >
                    <span className="text-base shrink-0">{p.icon}</span>
                    <span className="text-foreground text-xs leading-relaxed">{p.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                onViewInPanel={() => handleViewInPanel(msg)}
              />
            ))
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Analyzing your request…</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="px-4 pb-4 pt-2 border-t border-border bg-background/80 backdrop-blur">
          <div className="flex items-end gap-2 max-w-4xl mx-auto">
            <div className="flex-1 flex items-end gap-2 bg-card border border-border rounded-2xl px-4 py-2 focus-within:border-primary/50 transition-colors">
              <textarea
                ref={textareaRef}
                className="flex-1 bg-transparent outline-none resize-none text-sm text-foreground placeholder:text-muted-foreground min-h-[36px] max-h-40 py-1"
                placeholder="Ask a question, request SQL, or explore your documents…"
                value={inputPrompt}
                onChange={e => setInputPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={isLoading || !activeConv}
              />
            </div>
            <button
              onClick={() => handleSendMessage()}
              disabled={!inputPrompt.trim() || isLoading || !activeConv}
              className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-center text-[10px] text-muted-foreground mt-1.5">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* ── Right Inspector Panel ── */}
      <RightPanel
        sql={activeSql}
        queryResult={activeResult}
        vizConfig={activeViz}
        executionTime={activeDuration}
        error={activeError}
        onExecute={handleExecuteFromInspector}
        isOpen={isInspectorOpen}
        onToggle={() => setIsInspectorOpen(!isInspectorOpen)}
      />

      {/* Confirmation Modal */}
      {pendingConfirmationSql && (
        <ConfirmationModal
          isOpen={!!pendingConfirmationSql}
          sql={pendingConfirmationSql}
          projectId={activeProject?.id || ''}
          onConfirm={handleConfirmMutation}
          onCancel={() => setPendingConfirmationSql(null)}
        />
      )}
    </div>
  );
};
