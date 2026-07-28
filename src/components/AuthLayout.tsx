import { useState, FormEvent, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Key, Mail, Lock, User, ShieldAlert, Sparkles, MessageSquare, Database, QrCode, Clock, RefreshCw, Smartphone, Laptop, CheckCircle, AtSign } from 'lucide-react';
import { deviceService, getDeviceFingerprintDetails } from '../features/device-verification';
import { validateUsernameFormat, checkUsernameAvailability } from '../utils/username';

interface AuthLayoutProps {
  onAuthSuccess: (session: any, isSandboxMode: boolean) => void;
  onOpenDbSetup: () => void;
  isDbOffline?: boolean;
}

export default function AuthLayout({ onAuthSuccess, onOpenDbSetup, isDbOffline = false }: AuthLayoutProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  // Username validation & availability states
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  // Debounced realtime username check
  useEffect(() => {
    if (!isSignUp || !username.trim()) {
      setUsernameAvailable(null);
      setUsernameError(null);
      setCheckingUsername(false);
      return;
    }

    setCheckingUsername(true);
    setUsernameError(null);
    setUsernameAvailable(null);

    const timer = setTimeout(async () => {
      const res = await checkUsernameAvailability(username, undefined, isDbOffline);
      setCheckingUsername(false);
      if (res.available) {
        setUsernameAvailable(true);
        setUsernameError(null);
      } else {
        setUsernameAvailable(false);
        setUsernameError(res.error || 'Username already taken.');
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [username, isSignUp, isDbOffline]);

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
    const currentFpPayload = getDeviceFingerprintDetails(userId);
    const activePrimary = await deviceService.getActivePrimaryDevice(userId, false);

    if (activePrimary) {
      const isPrimary = activePrimary.device_id === currentFpPayload.device_id && !activePrimary.is_revoked;
      const isApproved = await deviceService.isDeviceApproved(userId, currentFpPayload.device_id, false);

      if (isPrimary || isApproved) {
        await deviceService.registerDevice(userId, currentFpPayload, false, !isPrimary);
        if (isPrimary) {
          await deviceService.promoteToPrimaryDevice(userId, currentFpPayload.device_id, false);
        }
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
      // First time login OR previous primary device logged out/offline -> Automatically promote current login to Primary Device
      console.log('[DEVICE-VERIFICATION] No active primary session found. Promoting current device to Primary Device.');
      await deviceService.registerDevice(userId, currentFpPayload, false, false);
      await deviceService.promoteToPrimaryDevice(userId, currentFpPayload.device_id, false);
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
        // Validate Display Name
        if (!displayName.trim()) {
          throw new Error('Please enter your Display Name.');
        }

        // Validate Username format
        const usernameFormat = validateUsernameFormat(username);
        if (!usernameFormat.isValid) {
          throw new Error(usernameFormat.error);
        }

        if (usernameError) {
          throw new Error(usernameError);
        }

        if (checkingUsername) {
          throw new Error('Please wait for username availability check.');
        }

        if (usernameAvailable === false) {
          throw new Error('Username is already taken. Please choose another username.');
        }

        // Validate Email (Required for registration)
        if (!email || !email.trim()) {
          throw new Error('Please enter a valid email address.');
        }

        // Validate Password match
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }

        const cleanUsername = usernameFormat.cleanUsername;
        const userEmail = email.trim();

        const { data, error } = await supabase.auth.signUp({
          email: userEmail,
          password,
          options: {
            data: {
              display_name: displayName.trim(),
              username: cleanUsername,
              avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${cleanUsername}`,
            },
          },
        });

        if (error) throw error;

        // Store local username-to-email mapping
        try {
          localStorage.setItem('wa_user_email_' + cleanUsername, userEmail);
          localStorage.setItem('wa_user_username_' + userEmail.toLowerCase(), cleanUsername);
        } catch {}

        // Best effort client-side profile upsert
        if (data.user) {
          try {
            const baseProfileWithEmail = {
              id: data.user.id,
              username: cleanUsername,
              email: userEmail,
              avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${cleanUsername}`,
            };
            const baseProfileNoEmail = {
              id: data.user.id,
              username: cleanUsername,
              avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${cleanUsername}`,
            };

            let { error: pErr } = await supabase.from('profiles').upsert({
              ...baseProfileWithEmail,
              display_name: displayName.trim() || cleanUsername,
            }, { onConflict: 'id' });

            if (pErr) {
              let { error: retryErr } = await supabase.from('profiles').upsert(baseProfileWithEmail, { onConflict: 'id' });
              if (retryErr && (retryErr.message?.includes('email') || retryErr.code === 'PGRST204')) {
                await supabase.from('profiles').upsert(baseProfileNoEmail, { onConflict: 'id' });
              }
            }
          } catch (e) {
            console.warn('Profile client upsert warning:', e);
          }
        }

        if (data.user && data.session === null) {
          if (userEmail.endsWith('@whatsapp.e2e.example')) {
            // Instant login for username sign up without email verification requirement
            startSandboxMode(cleanUsername);
            return;
          }
          setSuccessText('Sign up successful! Account created with username @' + cleanUsername + '. Please check your email inbox to verify or sign in.');
          setIsSignUp(false);
        } else if (data.session) {
          await checkDeviceAndCompleteAuth(data.session);
        }
      } else {
        // Dual Login: Email or Username
        const rawInput = loginIdentifier.trim();
        if (!rawInput) {
          throw new Error('Please enter your email or username.');
        }

        // 1. Detect whether the login input is an Email or a Username
        const isEmailFormat = rawInput.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawInput);
        const isDevMode = Boolean((import.meta as any).env?.DEV);
        if (isDevMode) {
          console.log('[AUTH_DEV] Detected login type:', isEmailFormat ? 'Email' : 'Username', { input: rawInput });
        }

        let targetEmail = '';
        let cleanUsername = '';

        if (isEmailFormat) {
          // 2. Email login
          targetEmail = rawInput;
        } else {
          // 3. Username login
          cleanUsername = rawInput.toLowerCase().replace(/^@/, '');

          // 4. Query profiles table (case-insensitive) - never query Auth users directly
          let userProfile: { id: string; email?: string | null; username: string } | null = null;
          let profileErr: any = null;

          const res = await supabase
            .from('profiles')
            .select('id, email, username')
            .ilike('username', cleanUsername)
            .maybeSingle();

          if (res.error) {
            if (res.error.message?.includes('email') || res.error.code === 'PGRST204') {
              // Fallback query if email column does not exist on profiles table
              const fallbackRes = await supabase
                .from('profiles')
                .select('id, username')
                .ilike('username', cleanUsername)
                .maybeSingle();
              userProfile = fallbackRes.data;
              profileErr = fallbackRes.error;
            } else {
              profileErr = res.error;
            }
          } else {
            userProfile = res.data;
          }

          if (profileErr) {
            throw profileErr;
          }

          // Recover email from localStorage if profiles table lacks email column
          const cachedEmail = localStorage.getItem('wa_user_email_' + cleanUsername);
          const resolvedEmail = userProfile?.email || cachedEmail || `${cleanUsername}@whatsapp.e2e.example`;

          // 15. Runtime logging (development only)
          if (isDevMode) {
            console.log('[AUTH_DEV] Username lookup:', {
              username: cleanUsername,
              success: !!userProfile,
              resolvedEmail,
              error: profileErr?.message || null,
            });
          }

          // 5. If username does not exist
          if (!userProfile) {
            throw new Error('Username not found');
          }

          targetEmail = resolvedEmail;
        }

        // Attempt sign in with target email
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: targetEmail,
          password,
        });

        if (isDevMode) {
          console.log('[AUTH_DEV] Auth result:', {
            input: rawInput,
            resolvedEmail: targetEmail,
            success: !authError,
            error: authError?.message || null,
          });
        }

        if (authError) {
          if (!isEmailFormat) {
            // 6. If password is incorrect for username login
            throw new Error('Incorrect password');
          }
          const msg = authError.message?.toLowerCase() || '';
          if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
            throw new Error('Incorrect password');
          }
          throw authError;
        }

        // 12 & 13 & 14. Verify that every authenticated user has a profile row and profile.email matches auth.users.email
        if (authData.user) {
          const user = authData.user;
          let existingProfile: { id: string; email?: string | null; username?: string } | null = null;
          let checkProfileErr: any = null;

          const checkRes = await supabase
            .from('profiles')
            .select('id, email, username')
            .eq('id', user.id)
            .maybeSingle();

          if (checkRes.error) {
            if (checkRes.error.message?.includes('email') || checkRes.error.code === 'PGRST204') {
              const fallbackCheck = await supabase
                .from('profiles')
                .select('id, username')
                .eq('id', user.id)
                .maybeSingle();
              existingProfile = fallbackCheck.data;
              checkProfileErr = fallbackCheck.error;
            } else {
              checkProfileErr = checkRes.error;
            }
          } else {
            existingProfile = checkRes.data;
          }

          if (checkProfileErr && isDevMode) {
            console.warn('[AUTH_DEV] Profile query error during post-auth verification:', checkProfileErr.message);
          }

          if (!existingProfile) {
            console.warn('[AUTH] Missing profile row detected for authenticated user ID:', user.id, '- Creating missing profile row.');
            const fallbackUsername = cleanUsername || user.user_metadata?.username || user.email?.split('@')[0] || 'user';
            
            const baseProfileWithEmail = {
              id: user.id,
              username: fallbackUsername,
              email: user.email,
              avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${fallbackUsername}`,
            };

            const baseProfileNoEmail = {
              id: user.id,
              username: fallbackUsername,
              avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${fallbackUsername}`,
            };

            let { error: upsertErr } = await supabase.from('profiles').upsert({
              ...baseProfileWithEmail,
              display_name: user.user_metadata?.display_name || fallbackUsername,
            }, { onConflict: 'id' });

            if (upsertErr) {
              let retry = await supabase.from('profiles').upsert(baseProfileWithEmail, { onConflict: 'id' });
              if (retry.error && (retry.error.message?.includes('email') || retry.error.code === 'PGRST204')) {
                retry = await supabase.from('profiles').upsert(baseProfileNoEmail, { onConflict: 'id' });
              }
              upsertErr = retry.error;
            }

            if (upsertErr) {
              console.warn('[AUTH] Profile row notice:', upsertErr.message);
            }
          } else if (existingProfile.email && existingProfile.email !== user.email) {
            if (isDevMode) {
              console.log('[AUTH_DEV] Profile email mismatch. Updating profile email to match auth.users.email:', user.email);
            }
            try {
              await supabase.from('profiles').update({ email: user.email }).eq('id', user.id);
            } catch (e) {
              console.warn('Profile email update notice:', e);
            }
          }
        }

        if (authData.session) {
          await checkDeviceAndCompleteAuth(authData.session);
        }
      }
    } catch (err: any) {
      console.warn('[AUTH] Authentication notice:', err?.message || err);
      let errMsg = err?.message || 'An error occurred during authentication.';
      if (errMsg.toLowerCase().includes('failed to fetch')) {
        errMsg = 'Failed to fetch (Database connection blocked/unreachable). Privacy ad-blockers (such as Brave Shield or uBlock Origin) frequently block Supabase connection domains. Please temporarily disable ad-blockers for this tab, check your internet, or enter the Sandbox Mode below!';
      }
      setErrorText(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const startSandboxMode = (customName?: any) => {
    const rawInput = (typeof customName === 'string' ? customName : loginIdentifier || username || email || '').trim();
    const cleanName = rawInput.replace(/^@/, '') || 'Alice (You)';
    const cleanEmail = rawInput.includes('@') ? rawInput : `${cleanName.toLowerCase().replace(/\s+/g, '')}@whatsapp.e2e.example`;

    const mockSession = {
      user: {
        id: `mock-user-${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'alice'}-1234`,
        email: cleanEmail,
        user_metadata: {
          username: cleanName,
          display_name: cleanName,
          avatar_url: `https://api.dicebear.com/7.x/adventurer/svg?seed=${cleanName}`,
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
          <h2 className="text-2xl font-bold text-white tracking-tight">SupaChat</h2>
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
              Try Demo
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

            {errorText.toLowerCase().includes('failed to fetch') && (
              <div className="mt-1 text-[11px] text-gray-300 leading-relaxed font-sans space-y-2">
                <p>💡 The database connection could not be reached. Check network connection.</p>
                <button
                  type="button"
                  id="suggest-sandbox-fetch-btn"
                  onClick={() => startSandboxMode(loginIdentifier.trim() || username || email)}
                  className="w-full py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-[#0b141a] font-bold text-xs rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#0b141a]" />
                  ⚡ Try Demo
                </button>
              </div>
            )}

            {(errorText.toLowerCase().includes('invalid login credentials') || errorText.toLowerCase().includes('credentials') || errorText.toLowerCase().includes('user not found') || errorText.toLowerCase().includes('not found')) && (
              <div className="mt-1 text-[11px] text-gray-300 leading-relaxed font-sans space-y-2">
                <p>💡 Double check your username/email spelling or password.</p>
                <div className="flex flex-col gap-1.5 pt-0.5">
                  <button
                    type="button"
                    id="suggest-sandbox-login-btn"
                    onClick={() => startSandboxMode(loginIdentifier.trim() || username || email)}
                    className="py-1.5 px-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-xs rounded-lg border border-amber-500/30 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    ⚡ Try Demo as "{loginIdentifier.trim() || 'User'}"
                  </button>
                  <button
                    type="button"
                    id="suggest-signup-btn"
                    onClick={() => {
                      setIsSignUp(true);
                      setErrorText(null);
                      const rawInput = loginIdentifier.trim();
                      if (rawInput.includes('@') && rawInput.includes('.')) {
                        setEmail(rawInput);
                        if (!username) {
                          setUsername(rawInput.split('@')[0]);
                        }
                      } else if (rawInput) {
                        setUsername(rawInput.replace(/^@/, ''));
                      }
                    }}
                    className="py-1.5 px-3 bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] font-bold text-xs rounded-lg border border-[#00a884]/30 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    👉 Sign Up for a new account with "{loginIdentifier.trim() || 'username'}"
                  </button>
                </div>
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
            {isSignUp ? (
              <>
                {/* 1. Display Name */}
                <div className="space-y-1 text-left">
                  <label className="text-xs font-semibold text-gray-400">Display Name</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Maruf Mohammadi"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full pl-11 pr-4 py-2.5 bg-[#2a3942] border border-gray-700 rounded-xl text-sm focus:outline-none focus:border-[#00a884] text-white placeholder-gray-500 transition-colors"
                    />
                  </div>
                </div>

                {/* 2. Username with Realtime Availability */}
                <div className="space-y-1 text-left">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-400">Username (@handle)</label>
                    <span className="text-[10px] text-gray-400 font-mono">Lowercase, 3-30 chars</span>
                  </div>
                  <div className="relative">
                    <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. maruf"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className={`w-full pl-11 pr-4 py-2.5 bg-[#2a3942] border rounded-xl text-sm focus:outline-none text-white placeholder-gray-500 transition-colors ${
                        usernameError
                          ? 'border-rose-500/80 focus:border-rose-500'
                          : usernameAvailable
                            ? 'border-emerald-500/80 focus:border-emerald-500'
                            : 'border-gray-700 focus:border-[#00a884]'
                      }`}
                    />
                  </div>
                  {/* Realtime Availability Status */}
                  {checkingUsername && (
                    <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-1 font-sans animate-pulse">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Checking username availability...
                    </p>
                  )}
                  {!checkingUsername && usernameAvailable === true && (
                    <p className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
                      <CheckCircle className="w-3 h-3 text-emerald-400" /> 🟢 Username available
                    </p>
                  )}
                  {!checkingUsername && usernameError && (
                    <p className="text-[10px] text-rose-400 font-medium flex items-center gap-1 mt-1">
                      🔴 {usernameError}
                    </p>
                  )}
                </div>

                {/* 3. Email Address */}
                <div className="space-y-1 text-left">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-400">Email Address</label>
                  </div>
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

                {/* 4. Password */}
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

                {/* 5. Confirm Password */}
                <div className="space-y-1 text-left">
                  <label className="text-xs font-semibold text-gray-400">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full pl-11 pr-4 py-2.5 bg-[#2a3942] border border-gray-700 rounded-xl text-sm focus:outline-none focus:border-[#00a884] text-white placeholder-gray-500 transition-colors"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Dual Login: Email or Username */}
                <div className="space-y-1 text-left">
                  <label className="text-xs font-semibold text-gray-400">Email or Username</label>
                  <div className="relative">
                    <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="text"
                      required
                      placeholder="you@example.com or @username"
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      className="w-full pl-11 pr-4 py-2.5 bg-[#2a3942] border border-gray-700 rounded-xl text-sm focus:outline-none focus:border-[#00a884] text-white placeholder-gray-500 transition-colors"
                    />
                  </div>
                </div>

                {/* Password */}
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
              </>
            )}

            <button
              type="submit"
              disabled={loading || (isSignUp && (checkingUsername || usernameAvailable === false))}
              className="w-full py-3 bg-[#00a884] hover:bg-[#008f72] active:scale-[0.98] text-slate-950 font-bold rounded-xl text-sm transition-all shadow-lg hover:shadow-emerald-950/25 cursor-pointer flex justify-center items-center disabled:opacity-50 disabled:cursor-not-allowed"
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
                {isSignUp ? 'Already have an account? Log in instead' : "Don't have an account yet? Register account"}
              </button>
            </div>
          </div>
        )}

        {/* Separator / Demo Mode Option */}
        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-gray-700/60"></div>
          <span className="flex-shrink mx-4 text-gray-500 text-xs">OR DEMO MODE</span>
          <div className="flex-grow border-t border-gray-700/60"></div>
        </div>

        {/* Try Demo Button */}
        <div className="space-y-3">
          <button
            id="launch-sandbox-btn"
            onClick={startSandboxMode}
            className="w-full py-2.5 bg-gray-800/60 hover:bg-gray-800 border border-gray-700 text-gray-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-[#00a884]" />
            Try Demo
          </button>
        </div>

      </div>

      {/* Security note */}
      <p className="mt-6 text-gray-500 text-[11px] text-center max-w-sm leading-relaxed">
        🔒 SupaChat includes strict client-to-client E2EE. Your cryptographic private keys remain local inside your web browser and are never uploaded to the database.
      </p>
    </div>
  );
}
