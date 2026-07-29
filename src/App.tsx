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

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [isSandboxMode, setIsSandboxMode] = useState(false);
  const [isDbSetupOpen, setIsDbSetupOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [isDbOffline, setIsDbOffline] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Fail-safe deadlock timer: Splash screen NEVER blocks longer than 600ms
    const deadlockTimer = setTimeout(() => {
      if (isMounted && initializing) {
        console.warn('[PWA Boot] Deadlock safety timer fired (600ms). Dismissing splash screen.');
        setInitializing(false);
      }
    }, 600);

    // Ultra-fast active session restore from local auth storage
    const getSession = async () => {
      try {
        const { data }: any = await withTimeout(
          supabase.auth.getSession(),
          400,
          { data: { session: null }, error: null } as any
        );

        if (!isMounted) return;

        const activeSession = data?.session;
        if (activeSession) {
          // Render main UI immediately!
          setSession(activeSession);
          setIsSandboxMode(false);
          
          // Verify device authorization asynchronously in the background
          isDeviceAuthorized(activeSession.user.id).then((authorized) => {
            if (!authorized && isMounted) {
              console.warn('[PWA Boot] Device unauthorized on background check.');
              setSession(null);
            }
          }).catch((err) => console.warn('[PWA Boot] Background device check notice:', err));
        }
        setIsDbOffline(false);
      } catch (err: any) {
        console.warn('Silent session restore warning (Supabase may still be cold-starting):', err);
        const errMsg = err?.message || '';
        if (errMsg.toLowerCase().includes('failed to fetch')) {
          setIsDbOffline(true);
        }
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
        // Verify in background
        isDeviceAuthorized(newSession.user.id).then((authorized) => {
          if (!authorized && isMounted) {
            setSession(null);
          }
        }).catch(() => {});
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
        <div className="w-12 h-12 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-semibold tracking-wide text-gray-300">Initializing Secure Handshake...</p>
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
