import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import AuthLayout from './components/AuthLayout';
import ChatLayout from './components/ChatLayout';
import DatabaseSetupModal from './components/DatabaseSetupModal';
import { deviceService, getDeviceFingerprintDetails } from './features/device-verification';
import { withTimeout } from './utils/timeout';

async function isDeviceAuthorized(userId: string): Promise<boolean> {
  try {
    const currentFp = getDeviceFingerprintDetails(userId);
    
    // Fast background device check with 800ms timeout
    return await withTimeout(
      (async () => {
        const activePrimary = await deviceService.getActivePrimaryDevice(userId, false);
        if (!activePrimary) {
          return true;
        }
        if (activePrimary.device_id === currentFp.device_id && !activePrimary.is_revoked) {
          return true;
        }
        return await deviceService.isDeviceApproved(userId, currentFp.device_id, false);
      })(),
      800,
      true
    );
  } catch {
    return true; // Graceful fallback on network error/offline
  }
}

function getInitialLocalSession(): any {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('auth-token') || key.startsWith('sb-'))) {
        const item = localStorage.getItem(key);
        if (item) {
          const parsed = JSON.parse(item);
          const sess = parsed?.currentSession || parsed?.session || (parsed?.access_token ? parsed : null);
          if (sess && sess.user) {
            return sess;
          }
        }
      }
    }
  } catch {}
  return null;
}

export default function App() {
  const initialLocalSession = getInitialLocalSession();
  const [session, setSession] = useState<any>(initialLocalSession);
  const [isSandboxMode, setIsSandboxMode] = useState(false);
  const [isDbSetupOpen, setIsDbSetupOpen] = useState(false);
  const [initializing, setInitializing] = useState(!Boolean(initialLocalSession));
  const [isDbOffline, setIsDbOffline] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Maximum 200ms safety timer for splash screen
    const deadlockTimer = setTimeout(() => {
      if (isMounted && initializing) {
        setInitializing(false);
      }
    }, 200);

    // Fast background active session verify
    const getSession = async () => {
      try {
        const { data }: any = await withTimeout(
          supabase.auth.getSession(),
          200,
          { data: { session: initialLocalSession }, error: null } as any
        );

        if (!isMounted) return;

        const activeSession = data?.session || initialLocalSession;
        if (activeSession) {
          setSession(activeSession);
          setIsSandboxMode(false);
          
          // Verify device authorization asynchronously in the background
          setTimeout(() => {
            isDeviceAuthorized(activeSession.user.id).then((authorized) => {
              if (!authorized && isMounted) {
                console.warn('[PWA Boot] Device unauthorized on background check.');
                setSession(null);
              }
            }).catch(() => {});
          }, 500);
        }
        setIsDbOffline(false);
      } catch (err: any) {
        console.warn('Silent session restore notice:', err);
      } finally {
        if (isMounted) {
          setInitializing(false);
          clearTimeout(deadlockTimer);
        }
      }
    };

    getSession();

    // Listen for Auth Changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!isMounted) return;
      if (newSession && !isSandboxMode) {
        setSession(newSession);
        setTimeout(() => {
          isDeviceAuthorized(newSession.user.id).then((authorized) => {
            if (!authorized && isMounted) {
              setSession(null);
            }
          }).catch(() => {});
        }, 500);
      } else if (!newSession && !isSandboxMode) {
        setSession(null);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(deadlockTimer);
      subscription.unsubscribe();
    };
  }, [isSandboxMode]);


  const handleAuthSuccess = (newSession: any, sandbox: boolean) => {
    setIsSandboxMode(sandbox);
    setSession(newSession);
  };

  const handleLogout = async () => {
    try {
      const userId = session?.user?.id;
      if (userId) {
        const fp = getDeviceFingerprintDetails(userId);
        await deviceService.handleLogoutCleanup(userId, fp.device_id, isSandboxMode);
      }
      if (!isSandboxMode) {
        await supabase.auth.signOut({ scope: 'local' });
      }
    } catch (err) {
      console.warn('Logout signOut warning:', err);
    }
    localStorage.clear();
    sessionStorage.clear();
    setSession(null);
    setIsSandboxMode(false);
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-[#0b141a] flex flex-col items-center justify-center text-gray-200 font-sans">
        <div className="w-10 h-10 border-3 border-[#00a884] border-t-transparent rounded-full animate-spin mb-3" />
        <span className="text-xs font-semibold tracking-wider text-[#00a884] uppercase">SupaChat</span>
      </div>
    );
  }

  return (
    <div className="bg-[#0b141a] min-h-screen overflow-x-hidden">
      {session ? (
        <ChatLayout 
          session={session} 
          isSandboxMode={isSandboxMode} 
          onLogout={handleLogout}
          onOpenDbSetup={() => setIsDbSetupOpen(true)}
        />
      ) : (
        <AuthLayout 
          onAuthSuccess={handleAuthSuccess}
          onOpenDbSetup={() => setIsDbSetupOpen(true)}
          isDbOffline={isDbOffline}
        />
      )}

      {/* Database Setup Modal accessible globally */}
      <DatabaseSetupModal 
        isOpen={isDbSetupOpen} 
        onClose={() => setIsDbSetupOpen(false)}
      />
    </div>
  );
}
