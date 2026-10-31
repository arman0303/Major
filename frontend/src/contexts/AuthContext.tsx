import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Project } from '../types';
import { api } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  projects: Project[];
  activeProject: Project | null;
  setActiveProject: (project: Project | null) => void;
  isLoading: boolean;
  login: (credentials: any) => Promise<void>;
  register: (credentials: any) => Promise<void>;
  logout: () => void;
  refreshProjects: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshProjects = async () => {
    try {
      const res = await api.listProjects();
      setProjects(res.projects);
      if (res.projects.length > 0 && !activeProject) {
        // Restore saved project or default to first
        const savedProjId = localStorage.getItem('activeProjectId');
        const found = res.projects.find(p => p.id === savedProjId) || res.projects[0];
        setActiveProject(found);
      }
    } catch (e) {
      console.warn('Failed to load projects:', e);
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      if (token) {
        try {
          const profile = await api.getProfile();
          setUser(profile.user);
          await refreshProjects();
        } catch (err) {
          console.warn('Session expired or invalid, logging out');
          logout();
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, [token]);

  const handleSetActiveProject = (project: Project | null) => {
    setActiveProject(project);
    if (project) {
      localStorage.setItem('activeProjectId', project.id);
    } else {
      localStorage.removeItem('activeProjectId');
    }
  };

  const login = async (credentials: any) => {
    const res = await api.login(credentials);
    localStorage.setItem('token', res.token);
    setToken(res.token);
    setUser(res.user);
    setProjects(res.projects || []);
    if (res.projects && res.projects.length > 0) {
      handleSetActiveProject(res.projects[0]);
    }
  };

  const register = async (credentials: any) => {
    const res = await api.register(credentials);
    localStorage.setItem('token', res.token);
    setToken(res.token);
    setUser(res.user);
    if (res.defaultProjectId) {
      const proj = { id: res.defaultProjectId, name: 'Enterprise Operations & Analytics' };
      setProjects([proj]);
      handleSetActiveProject(proj);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('activeProjectId');
    setToken(null);
    setUser(null);
    setProjects([]);
    setActiveProject(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        projects,
        activeProject,
        setActiveProject: handleSetActiveProject,
        isLoading,
        login,
        register,
        logout,
        refreshProjects,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
