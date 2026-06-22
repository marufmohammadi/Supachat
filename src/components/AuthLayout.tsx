import { useState, FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Key, Mail, Lock, User, ShieldAlert, Sparkles, MessageSquare, Database } from 'lucide-react';

interface AuthLayoutProps {
  onAuthSuccess: (session: any, isSandboxMode: boolean) => void;
  onOpenDbSetup: () => void;
}

export default function AuthLayout({ onAuthSuccess, onOpenDbSetup }: AuthLayoutProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  const handleAuth = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      if (isSignUp) {
        if (!username) {
          throw new Error('Please choose a username.');
        }
        // Sign up with Supabase, saving username in user metadata so the trigger can pick it up
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: username,
              avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${username}`,
            },
          },
        });

        if (error) throw error;

        if (data.user && data.session === null) {
          setSuccessText('Sign up successful! Please check your email inbox to verify your account or sign in directly if verification is disabled in your Supabase project.');
          setIsSignUp(false);
        } else if (data.session) {
          onAuthSuccess(data.session, false);
        }
      } else {
        // Sign in
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        if (data.session) {
          onAuthSuccess(data.session, false);
        }
      }
    } catch (err: any) {
      console.error('Authentication error:', err);
      setErrorText(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  const startSandboxMode = () => {
    // Generate a temporary mock session
    const mockSession = {
      user: {
        id: 'mock-user-alice-1234',
        email: 'alice@whatsapp.e2e.example',
        user_metadata: {
          username: 'Alice (You)',
          avatar_url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Alice',
        },
      },
    };
    onAuthSuccess(mockSession, true);
  };

  return (
    <div className="min-h-screen bg-[#0b141a] flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Decorative gradient overlay */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-[#00a884]/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-[#00a884]/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-md bg-[#1f2c34] p-8 rounded-2xl shadow-2xl border border-gray-700/60 relative z-10 space-y-6">
        
        {/* Logo and Meta Info */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#00a884]/20 rounded-2xl text-[#00a884] mb-2 animate-bounce-subtle">
            <MessageSquare className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">WhatsApp Clone</h2>
          <p className="text-sm text-gray-400">Real-Time Messaging & Client-to-Client Encryption</p>
        </div>

        {errorText && (
          <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl flex flex-col gap-2">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorText}</span>
            </div>
            
            {/* Context-aware suggestions depending on the error message */}
            {errorText.toLowerCase().includes('already registered') && (
              <button
                type="button"
                id="suggest-login-btn"
                onClick={() => {
                  setIsSignUp(false);
                  setErrorText(null);
                }}
                className="mt-1 self-start text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
              >
                💡 This email is already active. Click here to login instead!
              </button>
            )}

            {errorText.toLowerCase().includes('invalid login credentials') && (
              <div className="mt-1 text-[11px] text-gray-400 leading-relaxed font-sans space-y-1">
                <p>💡 Double check your email spelling or password.</p>
                <button
                  type="button"
                  id="suggest-signup-btn"
                  onClick={() => {
                    setIsSignUp(true);
                    setErrorText(null);
                  }}
                  className="font-semibold text-[#00a884] hover:underline cursor-pointer"
                >
                  Need a new account? Click here to sign up.
                </button>
              </div>
            )}
          </div>
        )}

        {successText && (
          <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs rounded-xl flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            <span>{successText}</span>
          </div>
        )}

        {/* Real authentication form */}
        <form onSubmit={handleAuth} className="space-y-4">
          {isSignUp && (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400">Choose Username</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  required
                  placeholder="e.g. alex_crypto"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-11 pr-4 py-2.5 bg-[#2a3942] border border-gray-700 rounded-xl text-sm focus:outline-none focus:border-[#00a884] text-white placeholder-gray-500 transition-colors"
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-400">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 bg-[#2a3942] border border-gray-700 rounded-xl text-sm focus:outline-none focus:border-[#00a884] text-white placeholder-gray-500 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-400">Account Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 bg-[#2a3942] border border-gray-700 rounded-xl text-sm focus:outline-none focus:border-[#00a884] text-white placeholder-gray-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#00a884] hover:bg-[#008f72] active:scale-[0.98] text-slate-950 font-bold rounded-xl text-sm transition-all shadow-lg hover:shadow-emerald-950/25 cursor-pointer flex justify-center items-center"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
            ) : isSignUp ? (
              'Create Encrypted Account'
            ) : (
              'Login Securly'
            )}
          </button>
        </form>

        {/* Toggle Mode */}
        <div className="text-center">
          <button
            id="toggle-signup-mode-btn"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-xs text-[#00a884] hover:underline"
          >
            {isSignUp ? 'Already using WhatsApp? Log in instead' : "Don't have an account yet? Register account"}
          </button>
        </div>

        {/* Separator / Sandbox Mode Option */}
        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-gray-700/60"></div>
          <span className="flex-shrink mx-4 text-gray-500 text-xs">OR DEPLOY LOCALLY</span>
          <div className="flex-grow border-t border-gray-700/60"></div>
        </div>

        {/* Sandbox Playground and SQL Button */}
        <div className="space-y-3">
          <button
            id="launch-sandbox-btn"
            onClick={startSandboxMode}
            className="w-full py-2.5 bg-gray-800/60 hover:bg-gray-800 border border-gray-700 text-gray-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-[#00a884]" />
            Enter Interactive Demo Sandbox
          </button>

          <button
            id="auth-db-setup-btn"
            onClick={onOpenDbSetup}
            className="w-full py-2.5 bg-[#128c7e]/15 hover:bg-[#128c7e]/25 text-[#128c7e] border border-[#128c7e]/20 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Database className="w-4 h-4" />
            Open Database SQL Editor Setup Schema
          </button>
        </div>

      </div>

      {/* Security note */}
      <p className="mt-6 text-gray-500 text-[11px] text-center max-w-sm leading-relaxed">
        🔒 This clone includes strict client-to-client E2EE. Your cryptographic private keys remain local inside your web browser and are never uploaded to the database.
      </p>
    </div>
  );
}
