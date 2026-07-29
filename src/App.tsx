import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import AuthLayout from './components/AuthLayout';
import ChatLayout from './components/ChatLayout';
import DatabaseSetupModal from './components/DatabaseSetupModal';
import { deviceService, getDeviceFingerprintDetails } from './features/device-verification';

async function isDeviceAuthorized(userId: string): Promise<boolean> {
  try {
    const currentFp = getDeviceFingerprintDetails(userId);
    
    // Perform device checks with a fast 1.5s timeout fallback
    const checkPromise = (async () => {
      const activePrimary = await deviceService.getActivePrimaryDevice(userId, false);
      if (!activePrimary) {
        return true;
      }
      if (activePrimary.device_id === currentFp.device_id && !activePrimary.is_revoked) {
        return true;
      }
      return await deviceService.isDeviceApproved(userId, currentFp.device_id, false);
    })();

    const timeoutPromise = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1500));
    return await Promise.race([checkPromise, timeoutPromise]);
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

    // Fast active session restore with 2s max timeout
    const getSession = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Auth restore timeout')), 2000));
        const sessionPromise = supabase.auth.getSession();

        const { data }: any = await Promise.race([sessionPromise, timeoutPromise]).catch((err) => {
          console.warn('[PWA Boot] Fast auth timeout fallback:', err);
          return { data: { session: null } };
        });

        if (!isMounted) return;

        const activeSession = data?.session;
        if (activeSession) {
          const authorized = await isDeviceAuthorized(activeSession.user.id);
          if (authorized && isMounted) {
            setSession(activeSession);
            setIsSandboxMode(false);
          }
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
        }
      }
    };

    getSession();

    // Listen for Auth Changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return;
      if (newSession && !isSandboxMode) {
        const authorized = await isDeviceAuthorized(newSession.user.id);
        if (authorized && isMounted) {
          setSession(newSession);
        }
      } else if (!newSession && !isSandboxMode) {
        setSession(null);
      }
    });

    return () => {
      isMounted = false;
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
