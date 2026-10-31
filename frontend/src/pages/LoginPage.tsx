import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Lock, Mail, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await login({ email, password });
      navigate('/chat');
    } catch (err: any) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 shadow-xl space-y-6">
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center mx-auto shadow-sm">
            <Sparkles className="w-5 h-5" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Welcome Back</h2>
          <p className="text-xs text-muted-foreground">
            Sign in to access your projects, database schemas, and analytics.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Email Address</label>
            <div className="relative">
              <input
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-muted/60 border border-border rounded-xl px-3.5 py-2.5 pl-9 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Password</label>
            <div className="relative">
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-muted/60 border border-border rounded-xl px-3.5 py-2.5 pl-9 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-primary text-primary-foreground font-semibold text-xs rounded-xl hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50"
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        <div className="text-center text-xs text-muted-foreground pt-2">
          Don't have an account yet?{' '}
          <Link to="/register" className="text-primary font-semibold hover:underline">
            Register free
          </Link>
        </div>
      </div>
    </div>
  );
};
