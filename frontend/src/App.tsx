import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { Layout } from './components/Layout';

import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ChatWorkspace } from './pages/ChatWorkspace';
import { DatabaseExplorerPage } from './pages/DatabaseExplorerPage';
import { DatasetManagerPage } from './pages/DatasetManagerPage';
import { SqlEditorPage } from './pages/SqlEditorPage';
import { QueryHistoryPage } from './pages/QueryHistoryPage';
import { DashboardsPage } from './pages/DashboardsPage';
import { SettingsPage } from './pages/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Protected App Workspace Routes */}
              <Route element={<Layout />}>
                <Route path="/chat" element={<ChatWorkspace />} />
                <Route path="/explorer" element={<DatabaseExplorerPage />} />
                <Route path="/schema" element={<DatabaseExplorerPage />} />
                <Route path="/datasets" element={<DatasetManagerPage />} />
                <Route path="/editor" element={<SqlEditorPage />} />
                <Route path="/history" element={<QueryHistoryPage />} />
                <Route path="/dashboards" element={<DashboardsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
