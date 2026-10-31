import React from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  Database,
  Terminal,
  ShieldCheck,
  BarChart3,
  Bot,
  ArrowRight,
  UploadCloud,
  CheckCircle2,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top Navbar */}
      <header className="h-16 border-b border-border flex items-center justify-between px-6 lg:px-12 bg-card/60 backdrop-blur sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="font-bold text-base tracking-tight">Conversational SQL Analytics</span>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="text-xs font-semibold px-4 py-2 rounded-lg border border-border hover:bg-muted text-foreground transition-colors"
          >
            Sign In
          </Link>
          <Link
            to="/register"
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm"
          >
            Get Started Free
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20 max-w-4xl mx-auto space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Production-Grade AI Text-to-SQL Engine</span>
        </div>

        <h1 className="text-4xl lg:text-6xl font-extrabold tracking-tight text-foreground leading-[1.15]">
          Query your database in{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-indigo-600">
            plain English
          </span>
          .
        </h1>

        <p className="text-sm lg:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Upload datasets, automatically infer relational schemas, formulate complex PostgreSQL joins and CTEs, execute securely with strict permission boundaries, and visualize insights instantly.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
          <Link
            to="/register"
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-md"
          >
            <span>Launch Analytics Assistant</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/login"
            className="flex items-center gap-2 px-6 py-3 rounded-xl border border-border hover:bg-muted text-foreground font-semibold text-sm transition-all"
          >
            <span>Live Project Demo</span>
          </Link>
        </div>

        {/* Feature Badges */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-12 text-left w-full">
          <div className="p-4 rounded-xl border border-border bg-card shadow-sm space-y-2">
            <Bot className="w-5 h-5 text-primary" />
            <h4 className="font-semibold text-xs text-foreground">Natural Language SQL</h4>
            <p className="text-[11px] text-muted-foreground leading-normal">
              Deep understanding of multi-table joins, subqueries, and window functions.
            </p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card shadow-sm space-y-2">
            <UploadCloud className="w-5 h-5 text-emerald-500" />
            <h4 className="font-semibold text-xs text-foreground">Multi-Format Ingestion</h4>
            <p className="text-[11px] text-muted-foreground leading-normal">
              Drag-and-drop CSV, JSON, and PDF tables straight into actual PostgreSQL tables.
            </p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card shadow-sm space-y-2">
            <ShieldCheck className="w-5 h-5 text-amber-500" />
            <h4 className="font-semibold text-xs text-foreground">Execution Guardrails</h4>
            <p className="text-[11px] text-muted-foreground leading-normal">
              AST parsing with SQLGlot, parameter safety, and mandatory mutation confirmation.
            </p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card shadow-sm space-y-2">
            <BarChart3 className="w-5 h-5 text-indigo-500" />
            <h4 className="font-semibold text-xs text-foreground">Interactive Recharts</h4>
            <p className="text-[11px] text-muted-foreground leading-normal">
              Automatic chart recommendation for bars, donuts, lines, areas, and KPI cards.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Conversational SQL Analytics Assistant &copy; 2026. Production Full-Stack Architecture.
      </footer>
    </div>
  );
};
