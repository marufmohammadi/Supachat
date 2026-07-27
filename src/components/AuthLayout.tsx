import { useState, FormEvent, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Key, Mail, Lock, User, ShieldAlert, Sparkles, MessageSquare, Database, QrCode, Clock, RefreshCw, Smartphone, Laptop } from 'lucide-react';
import { deviceService, getDeviceFingerprintDetails } from '../features/device-verification';

interface AuthLayoutProps {
  onAuthSuccess: (session: any, isSandboxMode: boolean) => void;
  onOpenDbSetup: () => void;
  isDbOffline?: boolean;
}

export default function AuthLayout({ onAuthSuccess, onOpenDbSetup, isDbOffline = false }: AuthLayoutProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  // QR Mode States
  const [showQRMode, setShowQRMode] = useState(false);
  const [qrInputToken, setQrInputToken] = useState('');
  const [qrValidating, setQrValidating] = useState(false);

  // Login Request Waiting States
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [waitingForApproval, setWaitingForApproval] = useState(false);
  const [pendingSession, setPendingSession] = useState<any | null>(null);
  const [approvalCountdown, setApprovalCountdown] = useState(60);

  // Countdown timer for approval waiting
  useEffect(() => {
    if (!waitingForApproval || approvalCountdown <= 0) return;
    const interval = setInterval(() => {
      setApprovalCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setWaitingForApproval(false);
          setPendingRequestId(null);
          setPendingSession(null);
          supabase.auth.signOut({ scope: 'local' });
          localStorage.clear();
          sessionStorage.clear();
          setErrorText('Login request timed out. Please try again or approve on primary device.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [waitingForApproval, approvalCountdown]);

  // Realtime subscription / event listener for login approval
  useEffect(() => {
    if (!pendingRequestId) return;

    const handleSandboxUpdate = async (e: CustomEvent) => {
      const req = e.detail;
      if (req && req.id === pendingRequestId) {
        if (req.status === 'approved') {
          setWaitingForApproval(false);
          setPendingRequestId(null);
          if (pendingSession) onAuthSuccess(pendingSession, true);
        } else if (req.status === 'declined') {
          setWaitingForApproval(false);
          setPendingRequestId(null);
          setPendingSession(null);
          await supabase.auth.signOut({ scope: 'local' });
          localStorage.clear();
          sessionStorage.clear();
          setErrorText('Login request was declined by your Primary Device.');
        }
      }
    };

    window.addEventListener('sandbox_login_request_updated', handleSandboxUpdate as EventListener);

    let channel: any = null;
    channel = supabase
      .channel(`device_login_req_${pendingRequestId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'device_login_requests',
          filter: `id=eq.${pendingRequestId}`
        },
        async payload => {
          const req = payload.new as any;
          if (req) {
            if (req.status === 'approved') {
              setWaitingForApproval(false);
              setPendingRequestId(null);
              if (pendingSession) onAuthSuccess(pendingSession, false);
            } else if (req.status === 'declined') {
              setWaitingForApproval(false);
              setPendingRequestId(null);
              setPendingSession(null);
              await supabase.auth.signOut({ scope: 'local' });
              localStorage.clear();
              sessionStorage.clear();
              setErrorText('Login request was declined by your Primary Device.');
            }
          }
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener('sandbox_login_request_updated', handleSandboxUpdate as EventListener);
      if (channel) supabase.removeChannel(channel);
    };
  }, [pendingRequestId, pendingSession, onAuthSuccess]);

  const handleQRSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!qrInputToken.trim()) return;
    setQrValidating(true);
    setErrorText(null);

    try {
      const res = await deviceService.validateAndConsumeQRSession(qrInputToken, false);
      if (res.valid) {
        // Successful QR scan login
        const mockQRSession = {
          user: {
            id: res.userId || 'qr-linked-user',
            email: 'linked-device@whatsapp.example',
            user_metadata: {
              username: 'Linked Device User',
              avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${res.userId}`
            }
          }
        };
        onAuthSuccess(mockQRSession, false);
      } else {
        setErrorText('Invalid or expired QR Session code. Please generate a new code on your Primary Device.');
      }
    } catch {
      setErrorText('Failed to validate QR session code.');
    } finally {
      setQrValidating(false);
    }
  };

  const checkDeviceAndCompleteAuth = async (session: any) => {
    const userId = session.user.id;
    const primaryDevice = await deviceService.getPrimaryDevice(userId, false);
    const currentFpPayload = getDeviceFingerprintDetails(userId);

    if (primaryDevice) {
      const isPrimary = primaryDevice.device_id === currentFpPayload.device_id && !primaryDevice.is_revoked;
      const isApproved = await deviceService.isDeviceApproved(userId, currentFpPayload.device_id, false);

      if (isPrimary || isApproved) {
        await deviceService.registerDevice(userId, currentFpPayload, false, !isPrimary);
        onAuthSuccess(session, false);
      } else {
        // SECONDARY DEVICE LOGIN ATTEMPT! Requires Primary Device approval
        console.log('[DEVICE-VERIFICATION] Secondary device detected. Requesting Primary Device approval...');
        const req = await deviceService.createLoginRequest(userId, currentFpPayload, false);
        setPendingRequestId(req.id);
        setPendingSession(session);
        setWaitingForApproval(true);
        setApprovalCountdown(60);
      }
    } else {
      // First time login for user -> Register as Primary Device
      await deviceService.registerDevice(userId, currentFpPayload, false, false);
      onAuthSuccess(session, false);
    }
  };

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
          await checkDeviceAndCompleteAuth(data.session);
        }
      } else {
        // Sign in
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          if (error.message && (error.message.toLowerCase().includes('invalid login credentials') || error.message.toLowerCase().includes('user not found'))) {
            console.log('User not found or invalid credentials on signin. Attempting silent auto-registration for sandbox/demo flow...');
            const autoUsername = email.split('@')[0];
            const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
              email,
              password,
              options: {
                data: {
                  username: autoUsername,
                  avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${autoUsername}`,
                },
              },
            });

            if (signUpError) {
              throw error;
            }

            if (signUpData.session) {
              await checkDeviceAndCompleteAuth(signUpData.session);
              return;
            } else if (signUpData.user) {
              const { data: reSignInData, error: reSignInError } = await supabase.auth.signInWithPassword({
                email,
                password,
              });
              if (!reSignInError && reSignInData.session) {
                await checkDeviceAndCompleteAuth(reSignInData.session);
                return;
              } else {
                setSuccessText('Auto-registered successfully! Logging you in via interactive sandbox mode...');
                setTimeout(() => {
                  const mockSession = {
                    user: {
                      id: signUpData.user?.id || 'mock-user-alice-1234',
                      email: email,
                      user_metadata: {
                        username: autoUsername,
                        avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${autoUsername}`,
                      },
                    },
                  };
                  onAuthSuccess(mockSession, true);
                }, 1500);
                return;
              }
            }
          }
          throw error;
        }

        if (data.session) {
          await checkDeviceAndCompleteAuth(data.session);
        }
      }
    } catch (err: any) {
      console.error('Authentication error:', err);
      let errMsg = err?.message || 'An error occurred during authentication.';
      if (errMsg.toLowerCase().includes('failed to fetch')) {
        errMsg = 'Failed to fetch (Database connection blocked/unreachable). Privacy ad-blockers (such as Brave Shield or uBlock Origin) frequently block Supabase connection domains. Please temporarily disable ad-blockers for this tab, check your internet, or enter the Sandbox Mode below!';
      }
      setErrorText(errMsg);
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

        {isDbOffline && (
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs rounded-xl space-y-2 text-left">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>Cloud Database Offline / Blocked</span>
            </div>
            <p className="text-[11px] text-gray-300 leading-relaxed font-sans">
              Unable to reach the Supabase cloud database (Failed to fetch). This is often caused by <b>ad-blockers</b> (like Brave, uBlock Origin) blocking third-party database connections, firewall limits, or being offline.
            </p>
            <button
              type="button"
              id="offline-suggest-sandbox-btn"
              onClick={startSandboxMode}
              className="w-full mt-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-[#0b141a] font-bold text-xs rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Enter Interactive Demo Sandbox (No Setup Required)
            </button>
          </div>
        )}

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

        {/* QR Mode Toggle or Form */}
        {showQRMode ? (
          <form onSubmit={handleQRSubmit} className="space-y-4">
            <div className="p-3.5 bg-[#111b21] border border-emerald-500/30 rounded-xl space-y-2 text-left">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                <QrCode className="w-4 h-4" /> Link Secondary Device with QR
              </div>
              <p className="text-[11px] text-gray-300 leading-relaxed">
                Enter the QR session token displayed on your Primary Device (under Linked Devices &gt; Link Device) to authenticate immediately.
              </p>
            </div>

            <div className="space-y-1 text-left">
              <label className="text-xs font-semibold text-gray-400">QR Session Token</label>
              <input
                type="text"
                required
                placeholder="e.g. WA-QR-172160..."
                value={qrInputToken}
                onChange={(e) => setQrInputToken(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#2a3942] border border-gray-700 rounded-xl text-sm focus:outline-none focus:border-[#00a884] text-white font-mono placeholder-gray-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={qrValidating}
              className="w-full py-3 bg-[#00a884] hover:bg-[#008f72] active:scale-[0.98] text-slate-950 font-bold rounded-xl text-sm transition-all shadow-lg cursor-pointer flex justify-center items-center gap-2"
            >
              {qrValidating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Authenticating Token...
                </>
              ) : (
                'Link & Launch Device'
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowQRMode(false)}
              className="w-full py-2 text-xs text-gray-400 hover:text-white transition-colors"
            >
              ← Back to standard email login
            </button>
          </form>
        ) : waitingForApproval ? (
          <div className="p-6 bg-[#111b21] border border-emerald-500/40 rounded-2xl space-y-4 text-center animate-fade-in">
            <div className="p-3 bg-emerald-500/15 rounded-full text-emerald-400 w-12 h-12 mx-auto flex items-center justify-center">
              <RefreshCw className="w-6 h-6 animate-spin" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Waiting for Primary Device Approval</h3>
              <p className="text-xs text-gray-300 mt-1">
                An approval request has been sent to your Primary Device. Please tap <strong className="text-emerald-400">Approve Device</strong> on your phone or primary browser.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-amber-400 bg-amber-500/10 py-1.5 px-3 rounded-full border border-amber-500/20 w-fit mx-auto font-mono font-bold">
              <Clock className="w-3.5 h-3.5 animate-pulse" />
              <span>{approvalCountdown}s remaining</span>
            </div>

            <button
              type="button"
              onClick={() => {
                setWaitingForApproval(false);
                setPendingRequestId(null);
              }}
              className="mt-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
            >
              Cancel Login
            </button>
          </div>
        ) : (
          /* Real authentication form */
          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <div className="space-y-1 text-left">
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

            <div className="space-y-1 text-left">
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

            <div className="space-y-1 text-left">
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
                'Login Securely'
              )}
            </button>
          </form>
        )}

        {/* Link Device with QR code option */}
        {!showQRMode && !waitingForApproval && (
          <div className="text-center space-y-2 pt-1 border-t border-gray-700/50">
            <button
              id="link-qr-code-mode-btn"
              type="button"
              onClick={() => setShowQRMode(true)}
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center justify-center gap-1.5 mx-auto py-1 cursor-pointer"
            >
              <QrCode className="w-4 h-4" /> Link Device using QR Code Token
            </button>
            <div>
              <button
                id="toggle-signup-mode-btn"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-xs text-[#00a884] hover:underline"
              >
                {isSignUp ? 'Already using WhatsApp? Log in instead' : "Don't have an account yet? Register account"}
              </button>
            </div>
          </div>
        )}

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
