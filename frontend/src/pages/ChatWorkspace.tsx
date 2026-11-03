import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Send,
  Sparkles,
  Bot,
  User as UserIcon,
  Code2,
  Table as TableIcon,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Sliders,
  Copy,
  CheckCheck,
  Paperclip,
  Database,
  BarChart3,
  FileText,
  Loader2,
  ChevronDown,
  ArrowUp,
  ExternalLink,
  Square,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api, ChatResponse, DocumentSource } from '../services/api';
import { Message, Conversation, QueryResult, VisualizationConfig } from '../types';
import { DataVisualization } from '../components/DataVisualization';
import { RightPanel } from '../components/RightPanel';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { MarkdownContent } from '../components/MarkdownContent';
import { cn } from '../utils/cn';

const SUGGESTIONS = [
  { title: 'Show average salary', desc: 'Grouped by department with employee count' },
  { title: 'Find high earners', desc: 'Employees earning more than their department average' },
  { title: 'Multiple projects', desc: 'Find staff members allocated to multiple initiatives' },
  { title: 'Explain Database Indexes', desc: 'Understand how B-Tree indexes speed up lookups' },
];

function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };
  return { copiedId, copy };
}

export const ChatWorkspace: React.FC = () => {
  const { activeProject, projects, setActiveProject } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeConvIdFromUrl = searchParams.get('c');

  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [streamingContent, setStreamingContent] = useState<string>('');

  // Right Inspector Panel
  const [activeSql, setActiveSql] = useState<string>('');
  const [activeResult, setActiveResult] = useState<QueryResult | undefined>(undefined);
  const [activeViz, setActiveViz] = useState<VisualizationConfig | undefined>(undefined);
  const [activeDuration, setActiveDuration] = useState<number | undefined>(undefined);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [dbMode, setDbMode] = useState<string>('postgres');

  useEffect(() => {
    api.getSystemStatus()
      .then(res => {
        if (res?.database_mode) setDbMode(res.database_mode);
      })
      .catch(() => {});
  }, []);

  // Mutation confirmation modal
  const [pendingConfirmationSql, setPendingConfirmationSql] = useState<string | null>(null);

  // File upload directly in chat
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { copiedId, copy } = useCopyToClipboard();

  // Load or switch conversation
  const loadConversation = async (convId: string) => {
    try {
      const res = await api.getConversation(convId);
      setActiveConv(res.conversation);
      setMessages(res.messages);

      // Restore inspector with last SQL if available
      const lastWithSql = [...res.messages].reverse().find(m => m.role === 'assistant' && m.generated_sql);
      if (lastWithSql) {
        setActiveSql(lastWithSql.generated_sql || '');
        setActiveResult(lastWithSql.query_result);
        setActiveViz(lastWithSql.visualization_config);
        setActiveDuration(lastWithSql.execution_time_ms);
        setActiveError(lastWithSql.error_message || null);
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  };

  useEffect(() => {
    if (!activeProject) return;

    if (activeConvIdFromUrl) {
      loadConversation(activeConvIdFromUrl);
    } else {
      // Fetch latest or create new
      api.listConversations(activeProject.id).then(res => {
        if (res.conversations && res.conversations.length > 0) {
          const first = res.conversations[0];
          setSearchParams({ c: first.id }, { replace: true });
          loadConversation(first.id);
        } else {
          api.createConversation(activeProject.id, 'New Chat').then(cRes => {
            setActiveConv(cRes.conversation);
            setSearchParams({ c: cRes.conversation.id }, { replace: true });
            window.dispatchEvent(new CustomEvent('chat-updated'));
          });
        }
      });
    }
  }, [activeProject?.id, activeConvIdFromUrl]);

  // Listen for sidebar switches
  useEffect(() => {
    const handleSwitch = (e: any) => {
      if (e.detail?.id) {
        loadConversation(e.detail.id);
      }
    };
    window.addEventListener('chat-switched', handleSwitch);
    return () => window.removeEventListener('chat-switched', handleSwitch);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [inputPrompt]);

  // Direct File Upload in Chat
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let targetProject = activeProject;
    if (!targetProject && projects && projects.length > 0) {
      targetProject = projects[0];
      setActiveProject(targetProject);
    }

    if (!targetProject) {
      alert('Please select or create a project before uploading files.');
      return;
    }

    setIsUploading(true);

    // If no active conversation, create one
    let targetConv = activeConv;
    if (!targetConv) {
      try {
        const newConvRes = await api.createConversation(targetProject.id, `Analysis: ${file.name}`);
        targetConv = newConvRes.conversation;
        setActiveConv(targetConv);
        setSearchParams({ c: targetConv.id });
        window.dispatchEvent(new CustomEvent('chat-updated'));
      } catch (e) {
        console.warn('Could not auto-create conversation for upload:', e);
      }
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('projectId', targetProject.id);

    try {
      const res = await api.uploadDataset(formData);
      const isDoc = file.name.endsWith('.pdf') || file.name.endsWith('.txt') || file.name.endsWith('.docx');
      const uploadNotice: Message = {
        id: `upload_${Date.now()}`,
        conversation_id: targetConv?.id || '',
        role: 'assistant',
        content: isDoc
          ? `📄 **Document Indexed**: "${file.name}" has been processed and added to semantic memory. You can now ask questions, request summaries, or extract key points from this document!`
          : `📁 **Dataset Imported**: "${file.name}" has been loaded into table \`${res.dataset.table_name}\` (${res.dataset.row_count} records). You can now ask analytical questions, filter records, or generate visual charts!`,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, uploadNotice]);
      window.dispatchEvent(new CustomEvent('chat-updated'));
    } catch (err: any) {
      alert(`File upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Stop current streaming generation
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setStreamingContent('');
  };

  // Send Message with Genuine Real-Time Token / SSE Streaming
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputPrompt).trim();
    if (!text || isLoading) return;

    let targetProject = activeProject;
    if (!targetProject && projects && projects.length > 0) {
      targetProject = projects[0];
      setActiveProject(targetProject);
    }
    if (!targetProject) {
      alert('Please select or create a project before sending messages.');
      return;
    }

    let targetConv = activeConv;
    if (!targetConv) {
      try {
        const title = text.slice(0, 30) + (text.length > 30 ? '...' : '');
        const newConvRes = await api.createConversation(targetProject.id, title);
        targetConv = newConvRes.conversation;
        setActiveConv(targetConv);
        setSearchParams({ c: targetConv.id });
        window.dispatchEvent(new CustomEvent('chat-updated'));
      } catch (err: any) {
        console.error('Failed to auto-create conversation:', err);
        return;
      }
    }

    setInputPrompt('');
    setIsLoading(true);
    setStreamingContent('');

    const tempUserId = `usr_${Date.now()}`;
    const userMsg: Message = {
      id: tempUserId,
      conversation_id: targetConv.id,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;
    let streamedText = '';
    let completedMsgData: any = null;

    try {
      await api.chatStream(
        {
          conversationId: targetConv.id,
          projectId: targetProject.id,
          message: text,
        },
        {
          onToken: (token: string) => {
            streamedText += token;
            setStreamingContent(streamedText);
          },
          onSql: (sqlData: any) => {
            if (sqlData.generated_sql) {
              setActiveSql(sqlData.generated_sql);
            }
          },
          onResult: (resData: any) => {
            if (resData.query_result) {
              setActiveResult(resData.query_result);
              setIsInspectorOpen(true);
            }
          },
          onStatus: (statusText: string) => {
            // Live status can be logged or displayed
          },
          onComplete: (data: any) => {
            completedMsgData = data;
          },
          onError: (errMsg: string) => {
            console.warn('Stream notification:', errMsg);
          },
        },
        abortCtrl.signal
      );

      setStreamingContent('');
      const finalContent = completedMsgData?.answer || streamedText || 'Processed successfully.';
      const assistantMsg: Message = {
        id: completedMsgData?.message_id || `ast_${Date.now()}`,
        conversation_id: targetConv.id,
        role: 'assistant',
        content: finalContent,
        generated_sql: completedMsgData?.generated_sql || undefined,
        query_result: completedMsgData?.query_result || activeResult,
        visualization_config: completedMsgData?.visualization_config,
        requires_confirmation: completedMsgData?.requires_confirmation || false,
        confirmation_status: completedMsgData?.requires_confirmation ? 'pending' : 'none',
        execution_time_ms: completedMsgData?.execution_time_ms,
        created_at: new Date().toISOString(),
        ...(completedMsgData?.intent ? { intent_type: completedMsgData.intent } : {}),
        ...(completedMsgData?.document_sources ? { document_sources: completedMsgData.document_sources } : {}),
      } as any;

      setMessages(prev => [...prev, assistantMsg]);

      if (completedMsgData?.generated_sql) {
        setActiveSql(completedMsgData.generated_sql);
        if (completedMsgData.query_result) {
          setActiveResult(completedMsgData.query_result);
          setIsInspectorOpen(true);
        }
      }
      setActiveViz(completedMsgData?.visualization_config);
      setActiveDuration(completedMsgData?.execution_time_ms);

      if (completedMsgData?.requires_confirmation && completedMsgData?.generated_sql) {
        setPendingConfirmationSql(completedMsgData.generated_sql);
      }

      window.dispatchEvent(new CustomEvent('chat-updated'));
    } catch (err: any) {
      if (err.name === 'AbortError') {
        if (streamedText) {
          setMessages(prev => [
            ...prev,
            {
              id: `ast_stopped_${Date.now()}`,
              conversation_id: targetConv?.id || '',
              role: 'assistant',
              content: streamedText + '\n\n*(Generation stopped by user)*',
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } else {
        // Fallback to standard chat endpoint if streaming protocol failed
        try {
          const fallbackRes = await api.chat({
            conversationId: targetConv.id,
            projectId: targetProject.id,
            message: text,
          });
          const fullAnswer = fallbackRes.answer || fallbackRes.explanation || 'Processed successfully.';
          const assistantMsg: Message = {
            id: fallbackRes.message_id,
            conversation_id: targetConv.id,
            role: 'assistant',
            content: fullAnswer,
            generated_sql: fallbackRes.generated_sql || undefined,
            query_result: fallbackRes.query_result,
            visualization_config: fallbackRes.visualization_config,
            requires_confirmation: fallbackRes.requires_confirmation,
            confirmation_status: fallbackRes.requires_confirmation ? 'pending' : 'none',
            execution_time_ms: fallbackRes.execution_time_ms,
            error_message: fallbackRes.error_message || undefined,
            created_at: new Date().toISOString(),
            ...(fallbackRes.intent ? { intent_type: fallbackRes.intent } : {}),
            ...(fallbackRes.document_sources ? { document_sources: fallbackRes.document_sources } : {}),
          } as any;
          setMessages(prev => [...prev, assistantMsg]);
        } catch (chatErr: any) {
          setMessages(prev => [
            ...prev,
            {
              id: `err_${Date.now()}`,
              conversation_id: targetConv?.id || activeConv?.id || '',
              role: 'assistant',
              content: `I encountered an issue processing your request: ${chatErr.message || err.message || 'Unknown error'}`,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      }
    } finally {
      setIsLoading(false);
      setStreamingContent('');
      abortControllerRef.current = null;
    }
  };

  // Regenerate Response from last user question
  const handleRegenerate = (msgIndex: number) => {
    if (isLoading) return;
    // Find preceding user message
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        handleSendMessage(messages[i].content);
        break;
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleOpenInspector = (msg: Message) => {
    if (msg.generated_sql) setActiveSql(msg.generated_sql);
    setActiveResult(msg.query_result);
    setActiveViz(msg.visualization_config);
    setActiveDuration(msg.execution_time_ms);
    setActiveError(msg.error_message || null);
    setIsInspectorOpen(true);
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
        setMessages(prev => [
          ...prev,
          {
            id: `conf_${Date.now()}`,
            conversation_id: activeConv.id,
            role: 'assistant',
            content: `Operation successfully executed: ${res.row_count} row(s) updated.`,
            generated_sql: pendingConfirmationSql,
            query_result: { records: res.records, columns: res.columns, row_count: res.row_count },
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (err: any) {
      setActiveError(err.message);
      setPendingConfirmationSql(null);
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* ── Main Chat Column ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Minimal Bar */}
        <header className="h-14 border-b border-border/60 px-6 flex items-center justify-between shrink-0 bg-background/50 backdrop-blur z-10">
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-sm text-foreground truncate max-w-sm">
              {activeConv?.title || 'New Conversation'}
            </h1>
            <span className={cn(
              "text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors",
              dbMode === 'postgres' ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" :
              dbMode === 'demo' ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" :
              "bg-muted text-muted-foreground border border-border"
            )}>
              {dbMode === 'postgres' ? 'PostgreSQL' : dbMode === 'demo' ? 'Demo Mode' : 'PostgreSQL'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsInspectorOpen(!isInspectorOpen)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                isInspectorOpen
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>SQL Inspector</span>
              {activeResult?.row_count !== undefined && (
                <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-primary/20 text-primary">
                  {activeResult.row_count}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full max-w-2xl mx-auto flex flex-col justify-center items-center text-center space-y-6 my-auto pt-16">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-sm">
                <Sparkles className="w-7 h-7" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-foreground">How can I help with your data today?</h2>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Ask natural language database questions, explore uploaded datasets, understand SQL concepts, or generate queries with schema awareness.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full pt-4">
                {SUGGESTIONS.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(s.title)}
                    className="flex flex-col items-start p-3.5 rounded-xl border border-border/70 hover:border-primary/50 bg-card hover:bg-muted/40 transition-all text-left group shadow-xs"
                  >
                    <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      {s.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                      {s.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((msg, idx) => {
                const isUser = msg.role === 'user';
                return (
                  <div key={msg.id} className={cn('flex gap-3.5 text-sm', isUser ? 'justify-end' : 'justify-start')}>
                    {!isUser && (
                      <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-4 h-4" />
                      </div>
                    )}

                    <div className={cn('flex flex-col gap-1 max-w-[85%]', isUser ? 'items-end' : 'items-start')}>
                      <div
                        className={cn(
                          'px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-xs',
                          isUser
                            ? 'bg-primary text-primary-foreground rounded-tr-xs'
                            : 'bg-card border border-border/80 text-foreground rounded-tl-xs'
                        )}
                      >
                        {isUser ? (
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        ) : (
                          <MarkdownContent content={msg.content} />
                        )}

                        {/* Inline Data Preview Table if SQL results exist */}
                        {!isUser && msg.query_result && msg.query_result.records?.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-border/60 w-full space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="font-semibold text-foreground flex items-center gap-1.5">
                                <TableIcon className="w-3.5 h-3.5 text-primary" />
                                {msg.query_result.row_count} rows returned
                              </span>
                              <button
                                onClick={() => handleOpenInspector(msg)}
                                className="text-primary hover:underline text-[11px] font-medium"
                              >
                                Open Visualization →
                              </button>
                            </div>

                            <div className="overflow-x-auto rounded-lg border border-border/60 max-h-48 text-xs">
                              <table className="w-full text-left">
                                <thead className="bg-muted/70 text-muted-foreground">
                                  <tr>
                                    {msg.query_result.columns?.slice(0, 5).map(col => (
                                      <th key={col} className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                                        {col}
                                      </th>
                                    ))}
                                    {(msg.query_result.columns?.length || 0) > 5 && (
                                      <th className="px-2.5 py-1.5 font-medium text-muted-foreground">...</th>
                                    )}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40">
                                  {msg.query_result.records.slice(0, 3).map((row, rIdx) => (
                                    <tr key={rIdx} className="hover:bg-muted/30">
                                      {msg.query_result!.columns?.slice(0, 5).map(col => (
                                        <td key={col} className="px-2.5 py-1.5 whitespace-nowrap text-foreground font-mono text-[11px]">
                                          {String(row[col] ?? 'null')}
                                        </td>
                                      ))}
                                      {(msg.query_result!.columns?.length || 0) > 5 && (
                                        <td className="px-2.5 py-1.5 text-muted-foreground">...</td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Document Source Citations */}
                        {!isUser && (msg as any).document_sources?.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-border/50 flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Citations:</span>
                            {((msg as any).document_sources as any[]).map((src, i) => {
                              const docName = src.document_name || src.metadata?.source || src.metadata?.original_name || 'Document';
                              const page = src.page_number || src.metadata?.page_number;
                              return (
                                <span
                                  key={i}
                                  className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-foreground border border-border/80 flex items-center gap-1 shadow-2xs"
                                  title={src.content_preview || src.content || ''}
                                >
                                  <FileText className="w-2.5 h-2.5 text-blue-500 shrink-0" />
                                  <span className="font-medium">{docName}</span>
                                  {page && <span className="text-primary font-mono text-[9px]">(p. {page})</span>}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Action buttons under assistant message */}
                      {!isUser && (
                        <div className="flex items-center gap-3 px-1 pt-0.5 text-xs text-muted-foreground">
                          {/* Copy Message Content */}
                          <button
                            onClick={() => copy(msg.content, msg.id + '-content')}
                            className="flex items-center gap-1 hover:text-foreground transition-colors text-[11px]"
                            title="Copy response"
                          >
                            {copiedId === msg.id + '-content' ? (
                              <>
                                <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                                <span className="text-emerald-500 font-medium">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>

                          {/* Regenerate Response */}
                          <button
                            onClick={() => handleRegenerate(idx)}
                            disabled={isLoading}
                            className="flex items-center gap-1 hover:text-foreground transition-colors text-[11px] disabled:opacity-40"
                            title="Regenerate response"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Regenerate</span>
                          </button>

                          {/* Copy SQL if present */}
                          {msg.generated_sql && (
                            <button
                              onClick={() => copy(msg.generated_sql!, msg.id + '-sql')}
                              className="flex items-center gap-1 hover:text-foreground transition-colors text-[11px]"
                            >
                              {copiedId === msg.id + '-sql' ? (
                                <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <Code2 className="w-3.5 h-3.5" />
                              )}
                              <span>Copy SQL</span>
                            </button>
                          )}

                          {msg.execution_time_ms !== undefined && msg.execution_time_ms > 0 && (
                            <span className="text-[10px] text-muted-foreground">• {msg.execution_time_ms}ms</span>
                          )}
                        </div>
                      )}
                    </div>

                    {isUser && (
                      <div className="w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 mt-0.5">
                        <UserIcon className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Real-time Streaming Placeholder */}
              {isLoading && streamingContent && (
                <div className="flex gap-3.5 text-sm justify-start">
                  <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl bg-card border border-border/80 text-foreground rounded-tl-xs shadow-xs max-w-[85%]">
                    <MarkdownContent content={streamingContent} />
                    <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 align-middle" />
                  </div>
                </div>
              )}

              {/* Loading Thinking Indicator */}
              {isLoading && !streamingContent && (
                <div className="flex gap-3.5 text-sm justify-start items-center">
                  <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-card border border-border text-muted-foreground text-xs flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span>Analyzing database schema & intent...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── ChatGPT Style Bottom Floating Input Bar ── */}
        <div className="p-4 md:px-8 border-t border-border/60 bg-background/80 backdrop-blur shrink-0">
          <div className="max-w-3xl mx-auto space-y-2">
            <div className="relative flex items-center bg-card border border-border/80 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary transition-all p-2">
              {/* Attachment file icon */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".csv,.json,.pdf,.txt,.docx"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isLoading}
                className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
                title="Upload Dataset (CSV, JSON, PDF, TXT, DOCX)"
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Paperclip className="w-4 h-4" />}
              </button>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={inputPrompt}
                onChange={e => setInputPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask anything about your database or upload a dataset..."
                className="flex-1 bg-transparent px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none max-h-40 min-h-[38px]"
                disabled={isLoading}
              />

              {/* Submit or Stop button */}
              {isLoading ? (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  className="w-8 h-8 rounded-xl bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90 transition-all shrink-0 ml-1 shadow-xs"
                  title="Stop generation"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!inputPrompt.trim() || isUploading}
                  className="w-8 h-8 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0 ml-1 shadow-xs"
                  title="Send message"
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              )}
            </div>

            <p className="text-[11px] text-center text-muted-foreground">
              Conversational SQL Analytics Assistant · PostgreSQL & pgvector schema grounded
            </p>
          </div>
        </div>
      </div>

      {/* ── Right Inspector Panel ── */}
      <RightPanel
        sql={activeSql}
        queryResult={activeResult}
        vizConfig={activeViz}
        executionTime={activeDuration}
        error={activeError}
        onExecute={customSql => {
          if (!activeProject) return;
          api.executeSQL({ projectId: activeProject.id, sql: customSql || activeSql, isConfirmed: true }).then(res => {
            setActiveResult({ records: res.records, columns: res.columns, row_count: res.row_count });
            setActiveDuration(res.execution_time_ms);
          });
        }}
        isOpen={isInspectorOpen}
        onToggle={() => setIsInspectorOpen(!isInspectorOpen)}
      />

      {/* Confirmation Modal for destructive mutations */}
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
