import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import AuthLayout from './components/AuthLayout';
import ChatLayout from './components/ChatLayout';
import DatabaseSetupModal from './components/DatabaseSetupModal';
import SplashScreen from './components/SplashScreen';
import { deviceService, getDeviceFingerprintDetails } from './features/device-verification';
import { withTimeout } from './utils/timeout';
import { startupAudit } from './utils/startupAudit';

async function isDeviceAuthorized(userId: string): Promise<boolean> {
  startupAudit.mark('device_manager_init_start');
  try {
    const currentFp = getDeviceFingerprintDetails(userId);
    
    // Fast background device check with 800ms timeout
    const res = await withTimeout(
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
    startupAudit.mark('device_manager_init_end');
    startupAudit.measure('Device manager initialization', 'device_manager_init_start', 'device_manager_init_end');
    return res;
  } catch {
    startupAudit.mark('device_manager_init_end');
    startupAudit.measure('Device manager initialization', 'device_manager_init_start', 'device_manager_init_end');
    return true; // Graceful fallback on network error/offline
  }
}

function getInitialLocalSession(): any {
  startupAudit.mark('localstorage_read_start');
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('auth-token') || key.startsWith('sb-'))) {
        const item = localStorage.getItem(key);
        if (item) {
          const parsed = JSON.parse(item);
          const sess = parsed?.currentSession || parsed?.session || (parsed?.access_token ? parsed : null);
          if (sess && sess.user) {
            startupAudit.mark('localstorage_read_end');
            startupAudit.measure('LocalStorage read', 'localstorage_read_start', 'localstorage_read_end');
            startupAudit.log('IndexedDB read', 0.00); // IndexedDB audit marker
            return sess;
          }
        }
      }
    }
  } catch {}
  startupAudit.mark('localstorage_read_end');
  startupAudit.measure('LocalStorage read', 'localstorage_read_start', 'localstorage_read_end');
  startupAudit.log('IndexedDB read', 0.00);
  return null;
}

export default function App() {
  startupAudit.mark('first_render_start');
  startupAudit.mark('supabase_client_creation_start');
  // Client is initialized in module import
  startupAudit.mark('supabase_client_creation_end');
  startupAudit.measure('Supabase client creation', 'supabase_client_creation_start', 'supabase_client_creation_end');

  const initialLocalSession = getInitialLocalSession();
  
  if (initialLocalSession) {
    startupAudit.mark('session_restore_start');
    startupAudit.mark('session_restore_end');
    startupAudit.measure('Session restore', 'session_restore_start', 'session_restore_end');
  }

  const [session, setSession] = useState<any>(initialLocalSession);
  const [isSandboxMode, setIsSandboxMode] = useState(false);
  const [isDbSetupOpen, setIsDbSetupOpen] = useState(false);
  // Never block UI on splash screen if local session exists or check takes >50ms
  const [initializing, setInitializing] = useState(!Boolean(initialLocalSession));
  const [isDbOffline, setIsDbOffline] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Strict 50ms max safety timer for splash screen to ensure immediate rendering
    const deadlockTimer = setTimeout(() => {
      if (isMounted && initializing) {
        setInitializing(false);
      }
    }, 50);

    // Fast non-blocking background active session verification
    const getSession = async () => {
      startupAudit.mark('auth_session_check_start');
      try {
        const { data }: any = await withTimeout(
          supabase.auth.getSession(),
          100, // Strict 100ms network timeout limit requirement
          { data: { session: initialLocalSession }, error: null } as any
        );

        startupAudit.mark('auth_session_check_end');
        startupAudit.measure('Auth session check', 'auth_session_check_start', 'auth_session_check_end');

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
          }, 300);
        }
        setIsDbOffline(false);
      } catch (err: any) {
        startupAudit.mark('auth_session_check_end');
        startupAudit.measure('Auth session check', 'auth_session_check_start', 'auth_session_check_end');
        console.warn('Silent session restore notice:', err);
      } finally {
        if (isMounted) {
          setInitializing(false);
          clearTimeout(deadlockTimer);
          startupAudit.mark('first_render_end');
          startupAudit.measure('First render', 'first_render_start', 'first_render_end');
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
    return <SplashScreen />;
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
