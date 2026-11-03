import React, { useState, useEffect } from 'react';
import { Settings, Key, Shield, Sparkles, CheckCircle2, Trash2, Activity, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { api } from '../services/api';
import { UserSettings } from '../types';

export const SettingsPage: React.FC = () => {
  const { user, activeProject, refreshProjects } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [geminiKey, setGeminiKey] = useState<string>('');
  const [openaiKey, setOpenaiKey] = useState<string>('');
  const [savedGeminiMasked, setSavedGeminiMasked] = useState<string>('');
  const [savedOpenaiMasked, setSavedOpenaiMasked] = useState<string>('');
  const [autoExecute, setAutoExecute] = useState<boolean>(true);
  const [rowLimit, setRowLimit] = useState<number>(500);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [projectName, setProjectName] = useState<string>('');

  // Provider Health State
  const [isTestingHealth, setIsTestingHealth] = useState<boolean>(false);
  const [healthResult, setHealthResult] = useState<{
    healthy: boolean;
    status: string;
    message: string;
    active_model?: string;
  } | null>(null);

  const loadProfile = () => {
    api.getProfile().then(res => {
      if (res.settings) {
        setProvider((res.settings.default_llm_provider as any) || 'gemini');
        setAutoExecute(res.settings.auto_execute_select ?? true);
        setRowLimit(res.settings.max_row_limit || 500);
        setSavedGeminiMasked(res.settings.gemini_api_key || '');
        setSavedOpenaiMasked(res.settings.openai_api_key || '');
      }
    }).catch(console.error);
  };

  useEffect(() => {
    loadProfile();
    if (activeProject) {
      setProjectName(activeProject.name);
    }
  }, [activeProject]);

  const handleTestHealth = async () => {
    setIsTestingHealth(true);
    setHealthResult(null);
    try {
      const res = await api.checkProviderHealth(provider, provider === 'gemini' ? (geminiKey || undefined) : (openaiKey || undefined));
      setHealthResult(res);
    } catch (err: any) {
      setHealthResult({
        healthy: false,
        status: 'error',
        message: err.message || 'Could not verify provider health',
      });
    } finally {
      setIsTestingHealth(false);
    }
  };

  const handleClearKey = async (type: 'gemini' | 'openai') => {
    try {
      const payload: any = {};
      if (type === 'gemini') {
        payload.geminiApiKey = null;
        setGeminiKey('');
        setSavedGeminiMasked('');
      } else {
        payload.openaiApiKey = null;
        setOpenaiKey('');
        setSavedOpenaiMasked('');
      }
      await api.updateSettings(payload);
      loadProfile();
      alert(`Custom ${type.toUpperCase()} key removed. Reverted to environment configuration.`);
    } catch (err: any) {
      alert(`Clear failed: ${err.message}`);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        defaultLlmProvider: provider,
        autoExecuteSelect: autoExecute,
        maxRowLimit: rowLimit,
      };
      if (geminiKey.trim()) payload.geminiApiKey = geminiKey.trim();
      if (openaiKey.trim()) payload.openaiApiKey = openaiKey.trim();

      await api.updateSettings(payload);
      setIsSaved(true);
      loadProfile();
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    }
  };

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !projectName.trim()) return;
    try {
      await api.updateProject(activeProject.id, { name: projectName.trim() });
      await refreshProjects();
      alert('Project updated successfully.');
    } catch (err: any) {
      alert(`Failed to update project: ${err.message}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-background max-w-4xl">
      <div className="border-b border-border pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <Settings className="w-6 h-6 text-primary" />
          System & Model Configuration
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Manage AI providers, external API credentials, query execution guardrails, and project metadata.
        </p>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* AI Model Configuration Box */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm text-foreground">AI Service & LLM Provider</h3>
            </div>
            {/* Live Health Check Trigger */}
            <button
              type="button"
              onClick={handleTestHealth}
              disabled={isTestingHealth}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/70 hover:bg-muted text-foreground text-xs font-medium transition-colors disabled:opacity-50"
              title="Make real lightweight probe to test credentials & quota"
            >
              <Activity className={`w-3.5 h-3.5 ${isTestingHealth ? 'animate-spin text-primary' : 'text-emerald-500'}`} />
              <span>{isTestingHealth ? 'Testing...' : 'Test Connection & Health'}</span>
            </button>
          </div>

          {/* Health Status Result Card */}
          {healthResult && (
            <div className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
              healthResult.healthy
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
            }`}>
              {healthResult.healthy ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5 flex-1">
                <div className="flex items-center justify-between font-semibold">
                  <span>Provider Status: {healthResult.status.toUpperCase()}</span>
                  {healthResult.active_model && (
                    <span className="font-mono text-[11px] bg-background/50 px-2 py-0.5 rounded border border-border/50">
                      Model: {healthResult.active_model}
                    </span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed opacity-90">{healthResult.message}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-xs space-y-1 block">
              <span className="font-medium text-foreground">Default LLM Provider</span>
              <select
                value={provider}
                onChange={e => setProvider(e.target.value as any)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none"
              >
                <option value="gemini">Google Gemini (Gemini 2.5 Flash Lite / Pro)</option>
                <option value="openai">OpenAI (GPT-4o Mini / GPT-4o)</option>
              </select>
            </label>

            <label className="text-xs space-y-1 block">
              <span className="font-medium text-foreground">Query Execution Row Limit</span>
              <input
                type="number"
                value={rowLimit}
                onChange={e => setRowLimit(Number(e.target.value))}
                min={10}
                max={5000}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none"
              />
            </label>
          </div>

          {/* Gemini API Key */}
          <div className="space-y-1.5 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-muted-foreground" />
                Google Gemini API Key
              </label>
              {savedGeminiMasked && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                    Active: {savedGeminiMasked}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleClearKey('gemini')}
                    className="text-[11px] text-destructive hover:underline flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </button>
                </div>
              )}
            </div>
            <input
              type="password"
              placeholder={savedGeminiMasked ? "Enter new key to update..." : "Paste GEMINI_API_KEY (or use server .env)..."}
              value={geminiKey}
              onChange={e => setGeminiKey(e.target.value)}
              className="w-full bg-muted/60 border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="text-[11px] text-muted-foreground">
              User keys take precedence over environment defaults. If blank, server .env credentials or deterministic fallback is used.
            </p>
          </div>

          {/* OpenAI API Key */}
          <div className="space-y-1.5 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-muted-foreground" />
                OpenAI API Key
              </label>
              {savedOpenaiMasked && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                    Active: {savedOpenaiMasked}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleClearKey('openai')}
                    className="text-[11px] text-destructive hover:underline flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </button>
                </div>
              )}
            </div>
            <input
              type="password"
              placeholder={savedOpenaiMasked ? "Enter new key to update..." : "Paste OPENAI_API_KEY (or use server .env)..."}
              value={openaiKey}
              onChange={e => setOpenaiKey(e.target.value)}
              className="w-full bg-muted/60 border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Safety & Execution Guardrails */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2.5">
            <Shield className="w-4 h-4 text-emerald-500" />
            <h3 className="font-semibold text-sm text-foreground">Safety & Confirmation Policies</h3>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoExecute}
                onChange={e => setAutoExecute(e.target.checked)}
                className="w-4 h-4 rounded text-primary focus:ring-primary"
              />
              <div className="text-xs">
                <span className="font-medium text-foreground block">Automatically execute safe SELECT queries</span>
                <span className="text-muted-foreground text-[11px]">Queries that only read data will execute without an extra confirmation click.</span>
              </div>
            </label>

            <div className="p-3 bg-muted/40 rounded-lg border border-border text-[11px] text-muted-foreground">
              ⚠️ Strict CRUD Guardrail: All INSERT, UPDATE, DELETE, and DROP statements strictly require explicit user confirmation.
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="px-6 py-2.5 bg-primary text-primary-foreground font-semibold text-xs rounded-xl hover:bg-primary/90 transition-all shadow-sm flex items-center gap-2"
        >
          {isSaved && <CheckCircle2 className="w-4 h-4" />}
          {isSaved ? 'Settings Saved!' : 'Save Configuration'}
        </button>
      </form>

      {/* Project Metadata Management */}
      {activeProject && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm">
          <h3 className="font-semibold text-sm text-foreground">Active Project Settings</h3>
          <form onSubmit={handleUpdateProject} className="flex gap-2">
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground font-medium text-xs rounded-lg border border-border"
            >
              Rename Project
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
