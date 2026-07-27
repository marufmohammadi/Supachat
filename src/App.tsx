import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import AuthLayout from './components/AuthLayout';
import ChatLayout from './components/ChatLayout';
import DatabaseSetupModal from './components/DatabaseSetupModal';
import { deviceService, getDeviceFingerprintDetails } from './features/device-verification';

async function isDeviceAuthorized(userId: string): Promise<boolean> {
  try {
    const primary = await deviceService.getPrimaryDevice(userId, false);
    if (!primary) {
      // No primary device registered yet -> First login will create Primary Device
      return true;
    }
    const currentFp = getDeviceFingerprintDetails(userId);
    
    // Check 1: Does current device_id match the Primary Device's device_id?
    if (primary.device_id === currentFp.device_id && !primary.is_revoked) {
      return true;
    }

    // Check 2: Is this device_id registered as an approved Linked Device in user_devices?
    const isApproved = await deviceService.isDeviceApproved(userId, currentFp.device_id, false);
    return isApproved;
  } catch {
    return false;
  }
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [isSandboxMode, setIsSandboxMode] = useState(false);
  const [isDbSetupOpen, setIsDbSetupOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [isDbOffline, setIsDbOffline] = useState(false);

  useEffect(() => {
    // Check active session on startup if not in sandbox mode
    const getSession = async () => {
      try {
        const { data: { session: activeSession } } = await supabase.auth.getSession();
        if (activeSession) {
          const authorized = await isDeviceAuthorized(activeSession.user.id);
          if (authorized) {
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
        setInitializing(false);
      }
    };

    getSession();

    // Listen for Auth Changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (newSession && !isSandboxMode) {
        const authorized = await isDeviceAuthorized(newSession.user.id);
        if (authorized) {
          setSession(newSession);
        }
      } else if (!newSession && !isSandboxMode) {
        setSession(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isSandboxMode]);

  const handleAuthSuccess = (newSession: any, sandbox: boolean) => {
    setIsSandboxMode(sandbox);
    setSession(newSession);
  };

  const handleLogout = async () => {
    try {
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
