import { useState, useEffect } from 'react';
import { Key, Shield, ShieldCheck, RefreshCw, Eye, EyeOff, AlertTriangle, HelpCircle } from 'lucide-react';
import { generateE2EKeyPair } from '../lib/crypto';
import { supabase } from '../lib/supabase';

interface E2EEKeyManagerProps {
  userId: string | undefined;
  hasKeys: boolean;
  onKeysGenerated: () => void;
  isSandboxMode: boolean;
  userEmail?: string;
  username?: string;
  avatarUrl?: string;
}

export default function E2EEKeyManager({ 
  userId, 
  hasKeys, 
  onKeysGenerated,
  isSandboxMode,
  userEmail,
  username,
  avatarUrl
}: E2EEKeyManagerProps) {
  const [loading, setLoading] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [publicKeyJWK, setPublicKeyJWK] = useState<string | null>(null);
  const [privateKeyJWK, setPrivateKeyJWK] = useState<string | null>(null);
  const [errorString, setErrorString] = useState<string | null>(null);

  useEffect(() => {
    if (userId) {
      const pub = localStorage.getItem(`whatsapp_public_key_jwk_${userId}`);
      const priv = localStorage.getItem(`whatsapp_private_key_jwk_${userId}`);
      if (pub && priv) {
        setPublicKeyJWK(pub);
        setPrivateKeyJWK(priv);
      }
    }
  }, [userId, hasKeys]);

  const handleGenerateKeys = async () => {
    if (!userId) return;
    setLoading(true);
    setErrorString(null);
    try {
      const keys = await generateE2EKeyPair();
      
      // Save locally
      localStorage.setItem(`whatsapp_public_key_jwk_${userId}`, keys.publicKeyJWK);
      localStorage.setItem(`whatsapp_private_key_jwk_${userId}`, keys.privateKeyJWK);
      
      setPublicKeyJWK(keys.publicKeyJWK);
      setPrivateKeyJWK(keys.privateKeyJWK);

      // Upload public key to database so others can encrypt messages for me
      if (!isSandboxMode) {
        // Safety Fallback: Query to ensure the profile row exists. If not, insert it (to bypass trigger delay/absence)
        const { data: existingProfile, error: checkError } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', userId)
          .maybeSingle();

        if (checkError) {
          console.warn('Profile schema detection failed:', checkError.message);
          setErrorString('Database schema check failed. Make sure you applied the SQL Editor Setup using the button!');
          onKeysGenerated();
          return;
        }

        if (!existingProfile) {
          // Attempt automated registration insertion
          const { error: insertError } = await supabase
            .from('profiles')
            .insert({
              id: userId,
              username: username || userEmail?.split('@')[0] || 'User',
              avatar_url: avatarUrl || `https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}`,
              public_key: keys.publicKeyJWK
            });

          if (insertError) {
            console.error('Failed to auto-insert profile:', insertError.message);
            if (insertError.message.includes('public_key') || insertError.message.includes('schema cache')) {
              setErrorString('Could not write public_key column. Please open the SQL console (database cylinder icon in the sidebar) and run the setup script to add this column to your Supabase tables.');
            } else {
              setErrorString('Profile insertion failed. Ensure you have run the setup SQL script in your Supabase SQL Editor.');
            }
          }
        } else {
          // Attempt normal update
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ public_key: keys.publicKeyJWK })
            .eq('id', userId);

          if (updateError) {
            console.error('Failed to update public key profile:', updateError.message);
            if (updateError.message.includes('public_key') || updateError.message.includes('schema cache')) {
              setErrorString('Could not find public_key column in your profiles table. Please open the SQL console (database cylinder icon in the sidebar) and run the setup script to add this column to your Supabase tables.');
            } else {
              setErrorString('Local keys ready, but failed to upload to server. Ensure Supabase SQL schema is loaded.');
            }
          }
        }
      }

      onKeysGenerated();
    } catch (err: any) {
      console.error('Key generation error:', err);
      setErrorString('Failed to generate crypto keys: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!userId) return null;

  return (
    <div className="bg-[#111b21] p-4 rounded-xl border border-emerald-500/10 space-y-4">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasKeys ? (
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          ) : (
            <Shield className="w-5 h-5 text-amber-400" />
          )}
          <h4 className="text-sm font-semibold text-gray-200">End-to-End Encryption Keys</h4>
        </div>
        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
          hasKeys ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
        }`}>
          {hasKeys ? 'Protected' : 'Unprotected'}
        </span>
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        {hasKeys 
          ? 'Your secure RSA-2048 keypair has been generated client-side. The public key is stored in your database profile, while your private key remains strictly on this browser device.'
          : 'You of do not have an encryption keypair generated. Direct messages will not be encrypted. Click Generate below to generate secure, unshareable cryptokeys.'
        }
      </p>

      {errorString && (
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-300 text-xs flex gap-2 items-center">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorString}</span>
        </div>
      )}

      {/* Keys Visualizer */}
      {hasKeys && publicKeyJWK && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <button
              id="toggle-keys-visibility-btn"
              onClick={() => setShowKeys(!showKeys)}
              className="flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
            >
              {showKeys ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" /> Hide Key Details
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" /> Inspect Raw Key Pairs
                </>
              )}
            </button>
          </div>

          {showKeys && (
            <div className="space-y-2 font-mono text-[9px] bg-black/40 p-2.5 rounded border border-gray-800">
              <div className="space-y-1">
                <span className="text-emerald-400 block font-sans font-semibold">Public Key JWK (Shared with Database Recipients)</span>
                <div className="text-gray-400 break-all bg-black/60 p-1.5 rounded select-all max-h-[80px] overflow-y-auto">
                  {publicKeyJWK}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-rose-400 block font-sans font-semibold">Private Key JWK (Held Locally and Safely - Never Sent to Server)</span>
                <div className="text-gray-400 break-all bg-black/60 p-1.5 rounded select-all max-h-[80px] overflow-y-auto">
                  {privateKeyJWK}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Button */}
      <button
        id="generate-e2ee-keys-btn"
        disabled={loading}
        onClick={handleGenerateKeys}
        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-500 hover:bg-emerald-600 text-slate-900 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        {hasKeys ? 'Regenerate E2EE Keys' : 'Generate Secure Keys'}
      </button>

      {/* E2EE Info Box */}
      <div className="flex gap-2 p-3 bg-gray-800/40 rounded-lg text-gray-400 text-[11px] leading-relaxed border border-gray-700/30">
        <HelpCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
        <p>
          <b>How does this work?</b> When you chat with another user, your browser downloads their Public Key. It creates a random AES symmetric key, encrypts your message text with it, and then scrambles that AES key with their Public Key. They then rely on their unique Local Private Key to decode the message. Secure and private!
        </p>
      </div>
    </div>
  );
}
