import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../services/api';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggleCollapse }) => {
  const { user, projects, activeProject, setActiveProject, logout, refreshProjects } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

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

  const navItems = [
    { label: 'AI Assistant', path: '/chat', icon: MessageSquare },
    { label: 'Database Explorer', path: '/explorer', icon: Database },
    { label: 'Schema & ER View', path: '/schema', icon: Network },
    { label: 'Upload Datasets', path: '/datasets', icon: UploadCloud },
    { label: 'SQL Editor', path: '/editor', icon: Terminal },
    { label: 'Query History', path: '/history', icon: History },
    { label: 'Dashboards', path: '/dashboards', icon: LayoutDashboard },
    { label: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <aside
      className={`relative flex flex-col border-r border-border bg-card transition-all duration-300 z-20 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        {!collapsed && (
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-foreground tracking-tight leading-none">
                SQL Analytics
              </span>
              <span className="text-[10px] text-muted-foreground font-medium mt-0.5">
                Conversational AI
              </span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 mx-auto rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Project Switcher */}
      {!collapsed && (
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
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
                className="w-full text-xs font-medium bg-muted/60 border border-border rounded-lg px-2.5 py-2 text-foreground focus:outline-none appearance-none cursor-pointer"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <FolderOpen className="w-3.5 h-3.5 absolute right-2.5 top-3 pointer-events-none text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {navItems.map(item => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                } ${collapsed ? 'justify-center px-0' : ''}`
              }
              title={collapsed ? item.label : undefined}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* User & Theme Footer */}
      <div className="p-3 border-t border-border space-y-2">
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
