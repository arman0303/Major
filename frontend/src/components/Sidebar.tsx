import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  MessageSquare,
  Database,
  Network,
  UploadCloud,
  Terminal,
  History,
  LayoutDashboard,
  Settings,
  Plus,
  FolderOpen,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Sun,
  Moon,
  Trash2,
  Edit3,
  Search,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../services/api';
import { Conversation } from '../types';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggleCollapse }) => {
  const { user, projects, activeProject, setActiveProject, logout, refreshProjects } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [chatSearch, setChatSearch] = useState('');
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Fetch conversations for the active project
  const loadConversations = async () => {
    if (!activeProject) return;
    try {
      const res = await api.listConversations(activeProject.id, chatSearch || undefined);
      setConversations(res.conversations || []);
    } catch (err) {
      console.error('Failed to load conversations in sidebar:', err);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [activeProject?.id, chatSearch]);

  // Listen to a custom window event when a chat is created or updated from ChatWorkspace
  useEffect(() => {
    const handleSync = () => loadConversations();
    window.addEventListener('chat-updated', handleSync);
    return () => window.removeEventListener('chat-updated', handleSync);
  }, [activeProject?.id]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    try {
      const res = await api.createProject({ name: newProjectName.trim() });
      await refreshProjects();
      setActiveProject(res.project);
      setNewProjectName('');
      setIsCreatingProject(false);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  const handleNewChat = async () => {
    if (!activeProject) return;
    try {
      const res = await api.createConversation(activeProject.id, 'New Chat');
      setConversations(prev => [res.conversation, ...prev]);
      navigate(`/chat?c=${res.conversation.id}`);
      window.dispatchEvent(new CustomEvent('chat-switched', { detail: { id: res.conversation.id } }));
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const handleSelectConv = (convId: string) => {
    navigate(`/chat?c=${convId}`);
    window.dispatchEvent(new CustomEvent('chat-switched', { detail: { id: convId } }));
  };

  const handleRenameConv = async (convId: string) => {
    if (!editTitle.trim()) {
      setEditingConvId(null);
      return;
    }
    try {
      await api.updateConversation(convId, editTitle.trim());
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: editTitle.trim() } : c));
      setEditingConvId(null);
      window.dispatchEvent(new CustomEvent('chat-updated'));
    } catch (err) {
      console.error('Failed to rename conversation:', err);
    }
  };

  const handleDeleteConv = async (convId: string) => {
    try {
      await api.deleteConversation(convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
      window.dispatchEvent(new CustomEvent('chat-updated'));
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const navTools = [
    { label: 'Database Explorer', path: '/explorer', icon: Database },
    { label: 'Schema View', path: '/schema', icon: Network },
    { label: 'Upload Datasets', path: '/datasets', icon: UploadCloud },
    { label: 'SQL Editor', path: '/editor', icon: Terminal },
    { label: 'Query History', path: '/history', icon: History },
    { label: 'Dashboards', path: '/dashboards', icon: LayoutDashboard },
    { label: 'Settings', path: '/settings', icon: Settings },
  ];

  const currentChatId = new URLSearchParams(location.search).get('c');

  return (
    <aside
      className={`relative flex flex-col border-r border-border bg-card transition-all duration-300 z-20 ${
        collapsed ? 'w-16' : 'w-72'
      }`}
    >
      {/* Brand Header */}
      <div className="h-14 flex items-center justify-between px-3 border-b border-border shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-foreground tracking-tight leading-none">
                DataPilot AI
              </span>
              <span className="text-[10px] text-muted-foreground font-medium mt-0.5">
                SQL Analytics
              </span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 mx-auto rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Project Switcher */}
      {!collapsed && (
        <div className="p-3 border-b border-border space-y-2 shrink-0">
          <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
            <span>Project</span>
            <button
              onClick={() => setIsCreatingProject(!isCreatingProject)}
              className="hover:text-foreground p-0.5 rounded transition-colors"
              title="Create new project"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {isCreatingProject ? (
            <form onSubmit={handleCreateProject} className="space-y-2">
              <input
                type="text"
                placeholder="Project name..."
                value={newProjectName}
                onChange={e => setNewProjectName(e.target.value)}
                autoFocus
                className="w-full text-xs bg-muted border border-border rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="submit"
                  className="flex-1 bg-primary text-primary-foreground text-[11px] font-semibold py-1 rounded hover:bg-primary/90"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingProject(false)}
                  className="px-2 py-1 text-[11px] border border-border rounded hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="relative">
              <select
                value={activeProject?.id || ''}
                onChange={e => {
                  const p = projects.find(proj => proj.id === e.target.value);
                  if (p) setActiveProject(p);
                }}
                className="w-full text-xs font-medium bg-muted/60 border border-border rounded-lg px-2.5 py-2 text-foreground focus:outline-none appearance-none cursor-pointer pr-8 truncate"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <FolderOpen className="w-3.5 h-3.5 absolute right-2.5 top-2.5 pointer-events-none text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      {/* ChatGPT-style New Chat button */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1 shrink-0">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border hover:border-primary/40 bg-card hover:bg-muted/80 text-foreground text-xs font-semibold shadow-sm transition-all group"
          >
            <Plus className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
            <span>New Chat</span>
          </button>
        </div>
      )}

      {/* Collapsed icon for New Chat */}
      {collapsed && (
        <div className="p-2 shrink-0 flex justify-center">
          <button
            onClick={handleNewChat}
            className="w-10 h-10 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors"
            title="New Chat"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* ChatGPT-style Search & Chat History list */}
      {!collapsed && (
        <div className="flex-1 flex flex-col min-h-0 border-b border-border">
          <div className="px-3 py-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                className="w-full pl-8 pr-2.5 py-1 text-xs bg-muted/60 rounded-lg outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground"
                placeholder="Search chats..."
                value={chatSearch}
                onChange={e => setChatSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pt-1 pb-1">
              Recent Conversations
            </div>

            {conversations.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground py-6">
                {chatSearch ? 'No matching chats' : 'No chats yet'}
              </div>
            ) : (
              conversations.map(conv => {
                const isSelected = location.pathname === '/chat' && (currentChatId === conv.id || (!currentChatId && conv === conversations[0]));
                const isEditing = editingConvId === conv.id;

                return (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConv(conv.id)}
                    className={`group flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                      isSelected
                        ? 'bg-muted text-foreground font-semibold'
                        : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                      {isEditing ? (
                        <input
                          type="text"
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onBlur={() => handleRenameConv(conv.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameConv(conv.id);
                            if (e.key === 'Escape') setEditingConvId(null);
                          }}
                          autoFocus
                          onClick={e => e.stopPropagation()}
                          className="w-full text-xs bg-background border border-primary rounded px-1.5 py-0.5 focus:outline-none"
                        />
                      ) : (
                        <span className="truncate">{conv.title}</span>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setEditingConvId(conv.id);
                            setEditTitle(conv.title);
                          }}
                          className="p-1 hover:text-foreground rounded"
                          title="Rename"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleDeleteConv(conv.id);
                          }}
                          className="p-1 hover:text-destructive rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Other App Tools Navigation (Collapsible) */}
      <div className={`p-2 shrink-0 ${collapsed ? 'flex-1' : ''}`}>
        {!collapsed && (
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pb-1">
            Workspace Tools
          </div>
        )}
        <nav className="space-y-0.5">
          {navTools.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  } ${collapsed ? 'justify-center px-0' : ''}`
                }
                title={collapsed ? item.label : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* User & Theme Footer */}
      <div className="p-3 border-t border-border shrink-0 space-y-2">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {!collapsed && (
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded"
              title="Log out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          )}
        </div>

        {!collapsed && user && (
          <div className="pt-1 flex items-center gap-2 px-1">
            <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs uppercase">
              {user.fullName ? user.fullName[0] : 'U'}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-xs font-semibold text-foreground truncate">
                {user.fullName}
              </span>
              <span className="text-[10px] text-muted-foreground truncate">
                {user.email}
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
