import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import AuthLayout from './components/AuthLayout';
import ChatLayout from './components/ChatLayout';
import DatabaseSetupModal from './components/DatabaseSetupModal';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [isSandboxMode, setIsSandboxMode] = useState(false);
  const [isDbSetupOpen, setIsDbSetupOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Check active session on startup if not in sandbox mode
    const getSession = async () => {
      try {
        const { data: { session: activeSession }, error } = await supabase.auth.getSession();
        if (activeSession) {
          setSession(activeSession);
          setIsSandboxMode(false);
        }
      } catch (err) {
        console.warn('Silent session restore warning (Supabase may still be cold-starting):', err);
      } finally {
        setInitializing(false);
      }
    };

    getSession();

    // Listen for Auth Changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession && !isSandboxMode) {
        setSession(newSession);
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
    if (!isSandboxMode) {
      await supabase.auth.signOut();
    }
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
