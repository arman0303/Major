import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User as UserIcon,
  Code2,
  Table,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Sliders,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { Message, Conversation, QueryResult, VisualizationConfig } from '../types';
import { DataVisualization } from '../components/DataVisualization';
import { RightPanel } from '../components/RightPanel';
import { ConfirmationModal } from '../components/ConfirmationModal';

const SUGGESTED_PROMPTS = [
  'Show the average salary of every department',
  'Find employees working on multiple projects',
  'Rank employees by salary within each department',
  'Find employees earning more than their department average',
  'Find departments without any employees',
  'Show monthly revenue trends and order counts',
];

export const ChatWorkspace: React.FC = () => {
  const { activeProject } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Inspector panel state
  const [activeSql, setActiveSql] = useState<string>('');
  const [activeResult, setActiveResult] = useState<QueryResult | undefined>(undefined);
  const [activeViz, setActiveViz] = useState<VisualizationConfig | undefined>(undefined);
  const [activeDuration, setActiveDuration] = useState<number | undefined>(undefined);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);

  // Confirmation modal state
  const [pendingConfirmationSql, setPendingConfirmationSql] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load conversations
  useEffect(() => {
    if (activeProject) {
      api.listConversations(activeProject.id)
        .then(res => {
          setConversations(res.conversations);
          if (res.conversations.length > 0) {
            loadConversation(res.conversations[0].id);
          } else {
            // Create default conversation
            createNewConversation();
          }
        })
        .catch(err => console.error(err));
    }
  }, [activeProject]);

  const loadConversation = async (convId: string) => {
    try {
      const res = await api.getConversation(convId);
      setActiveConv(res.conversation);
      setMessages(res.messages);

      // Set inspector to the latest assistant query
      const lastAssistant = [...res.messages].reverse().find(m => m.role === 'assistant' && m.generated_sql);
      if (lastAssistant) {
        setActiveSql(lastAssistant.generated_sql || '');
        setActiveResult(lastAssistant.query_result);
        setActiveViz(lastAssistant.visualization_config);
        setActiveDuration(lastAssistant.execution_time_ms);
        setActiveError(lastAssistant.error_message || null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const createNewConversation = async () => {
    if (!activeProject) return;
    try {
      const res = await api.createConversation(activeProject.id, 'New Analysis');
      setConversations(prev => [res.conversation, ...prev]);
      setActiveConv(res.conversation);
      setMessages([]);
      setActiveSql('');
      setActiveResult(undefined);
      setActiveViz(undefined);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async (customPrompt?: string) => {
    const text = (customPrompt || inputPrompt).trim();
    if (!text || !activeConv || !activeProject || isLoading) return;

    setInputPrompt('');
    setIsLoading(true);

    // Optimistic user message
    const tempUserMsg: Message = {
      id: `temp_${Date.now()}`,
      conversation_id: activeConv.id,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await api.chat({
        conversationId: activeConv.id,
        projectId: activeProject.id,
        message: text,
      });

      const assistantMsg: Message = {
        id: res.message_id,
        conversation_id: activeConv.id,
        role: 'assistant',
        content: res.explanation || 'Processed query.',
        generated_sql: res.generated_sql,
        query_result: res.query_result,
        visualization_config: res.visualization_config,
        requires_confirmation: res.requires_confirmation,
        confirmation_status: res.requires_confirmation ? 'pending' : 'none',
        execution_time_ms: res.execution_time_ms,
        error_message: res.error_message,
        created_at: new Date().toISOString(),
      };

      setMessages(prev => [...prev, assistantMsg]);

      // Update Inspector panel
      setActiveSql(res.generated_sql);
      setActiveResult(res.query_result);
      setActiveViz(res.visualization_config);
      setActiveDuration(res.execution_time_ms);
      setActiveError(res.error_message || null);

      if (res.query_result) {
        setIsInspectorOpen(true);
      }
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          conversation_id: activeConv.id,
          role: 'assistant',
          content: `Error: ${err.message || 'Failed to process request.'}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
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

      // Update inspector with mutation outcome
      setActiveResult({
        records: res.records,
        columns: res.columns,
        row_count: res.row_count,
      });
      setActiveDuration(res.execution_time_ms);
      setActiveError(null);
      setPendingConfirmationSql(null);

      // Add success response
      if (activeConv) {
        setMessages(prev => [
          ...prev,
          {
            id: `conf_${Date.now()}`,
            conversation_id: activeConv.id,
            role: 'assistant',
            content: `Operation successfully committed: ${res.row_count} row(s) affected.`,
            generated_sql: pendingConfirmationSql,
            query_result: {
              records: res.records,
              columns: res.columns,
              row_count: res.row_count,
            },
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (err: any) {
      setActiveError(err.message);
      setPendingConfirmationSql(null);
    }
  };

  const handleExecuteFromInspector = async (customSql?: string) => {
    const query = customSql || activeSql;
    if (!query || !activeProject) return;
    try {
      const res = await api.executeSQL({
        projectId: activeProject.id,
        sql: query,
        isConfirmed: true,
      });
      setActiveResult({
        records: res.records,
        columns: res.columns,
        row_count: res.row_count,
      });
      setActiveDuration(res.execution_time_ms);
      setActiveError(null);
    } catch (err: any) {
      setActiveError(err.message);
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Central Conversation Column */}
      <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
        {/* Top Workspace Header */}
        <div className="h-14 px-6 border-b border-border flex items-center justify-between bg-card/60 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-sm text-foreground">
              {activeConv?.title || 'Interactive SQL Workspace'}
            </span>
            <span className="text-xs text-muted-foreground border-l border-border pl-3">
              Project: <span className="text-foreground font-medium">{activeProject?.name}</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={createNewConversation}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted font-medium transition-colors"
            >
              + New Chat
            </button>
            <button
              onClick={() => setIsInspectorOpen(!isInspectorOpen)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                isInspectorOpen ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Inspector
            </button>
          </div>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 && (
            <div className="max-w-2xl mx-auto py-12 text-center space-y-6">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-sm">
                <Sparkles className="w-7 h-7" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold tracking-tight text-foreground">
                  Conversational SQL Analytics
                </h2>
                <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                  Ask any question about your data in natural English. The AI engine will write PostgreSQL queries, execute them safely, and generate interactive charts.
                </p>
              </div>

              {/* Suggested Questions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-4 text-left">
                {SUGGESTED_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(prompt)}
                    className="p-3 text-xs rounded-xl border border-border bg-card/80 hover:bg-muted/70 text-foreground transition-all flex items-center justify-between group shadow-sm hover:border-primary/50"
                  >
                    <span>{prompt}</span>
                    <Sparkles className="w-3.5 h-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-3 max-w-3xl ${
                msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'
              }`}
            >
              {/* Avatar */}
              <div
                className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-xs font-bold ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted border border-border text-foreground'
                }`}
              >
                {msg.role === 'user' ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4 text-primary" />}
              </div>

              {/* Bubble */}
              <div
                className={`rounded-2xl p-4 text-xs space-y-3 leading-relaxed shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-tr-none'
                    : 'bg-card border border-border text-foreground rounded-tl-none'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>

                {/* Generated SQL snippet */}
                {msg.generated_sql && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="font-semibold flex items-center gap-1">
                        <Code2 className="w-3.5 h-3.5" />
                        Generated SQL:
                      </span>
                      {msg.execution_time_ms !== undefined && (
                        <span>Executed in {msg.execution_time_ms}ms</span>
                      )}
                    </div>
                    <pre className="p-3 rounded-lg bg-muted/90 font-mono text-xs overflow-x-auto border border-border/80 text-foreground">
                      {msg.generated_sql}
                    </pre>
                  </div>
                )}

                {/* Mutation Confirmation Warning Card */}
                {msg.requires_confirmation && msg.confirmation_status === 'pending' && (
                  <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-xs">
                      <AlertTriangle className="w-4 h-4" />
                      <span>User Confirmation Required</span>
                    </div>
                    <p className="text-[11px] leading-normal">
                      This query will modify or delete records in your database. Click below to review the impact before executing.
                    </p>
                    <button
                      onClick={() => setPendingConfirmationSql(msg.generated_sql || '')}
                      className="px-3 py-1.5 bg-amber-500 text-white font-semibold rounded-md text-[11px] hover:bg-amber-600 transition-colors"
                    >
                      Review & Confirm Changes
                    </button>
                  </div>
                )}

                {/* Inline Visualization Summary Button */}
                {msg.query_result && msg.query_result.records.length > 0 && (
                  <div className="pt-1">
                    <button
                      onClick={() => {
                        setActiveSql(msg.generated_sql || '');
                        setActiveResult(msg.query_result);
                        setActiveViz(msg.visualization_config);
                        setActiveDuration(msg.execution_time_ms);
                        setIsInspectorOpen(true);
                      }}
                      className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
                    >
                      <Table className="w-3.5 h-3.5" />
                      View {msg.query_result.row_count} records in Inspector & Visualizer →
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3 max-w-xl mr-auto">
              <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary animate-pulse" />
              </div>
              <div className="bg-card border border-border rounded-2xl rounded-tl-none p-3.5 text-xs flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
                <span className="text-muted-foreground font-medium">Generating PostgreSQL query & analyzing data...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-border bg-card/80 backdrop-blur">
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2 max-w-4xl mx-auto"
          >
            <input
              type="text"
              placeholder="Ask a question in plain English (e.g. 'Show the top 10 highest-paid employees')..."
              value={inputPrompt}
              onChange={e => setInputPrompt(e.target.value)}
              disabled={isLoading}
              className="flex-1 bg-muted/60 border border-border rounded-xl px-4 py-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
            />
            <button
              type="submit"
              disabled={!inputPrompt.trim() || isLoading}
              className="bg-primary text-primary-foreground p-3 rounded-xl hover:bg-primary/90 transition-all disabled:opacity-50 shadow-sm shrink-0"
              title="Send Prompt"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Right Inspector Panel */}
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
          isOpen={Boolean(pendingConfirmationSql)}
          sql={pendingConfirmationSql}
          projectId={activeProject?.id || ''}
          onConfirm={handleConfirmMutation}
          onCancel={() => setPendingConfirmationSql(null)}
        />
      )}
    </div>
  );
};
