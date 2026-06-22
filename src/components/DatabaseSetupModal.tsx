import { useState } from 'react';
import { SUPABASE_SCHEMA_SQL } from '../lib/schemaSql';
import { Copy, Check, Terminal, ExternalLink, ShieldCheck, Database } from 'lucide-react';

interface DatabaseSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DatabaseSetupModal({ isOpen, onClose }: DatabaseSetupModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div 
        id="db-setup-modal"
        className="bg-[#1f2c34] text-gray-200 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col border border-emerald-500/10 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="bg-[#202c33] px-6 py-4 border-b border-gray-700/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/15 p-2 rounded-lg text-emerald-400">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Supabase SQL Schema Setup</h3>
              <p className="text-xs text-gray-400">Run this SQL in your Supabase SQL Editor to enable true real-time & profiles</p>
            </div>
          </div>
          <button 
            id="close-db-modal-btn"
            onClick={onClose}
            className="text-gray-400 hover:text-white hover:bg-gray-700/40 p-2 rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Instructions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#222e35] p-4 rounded-xl border border-gray-700/50 space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <Terminal className="w-4 h-4" /> Step 1: Execute SQL
              </span>
              <p className="text-sm text-gray-300">
                Go to the <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-emerald-400 inline-flex items-center gap-0.5 hover:underline font-medium">Supabase Dashboard <ExternalLink className="w-3 h-3" /></a>, select your project, go to the <b className="text-white font-medium">SQL Editor</b>, click <b className="text-white font-medium">New Query</b>, paste this schema, and click <b className="text-white font-medium">Run</b>.
              </p>
            </div>
            <div className="bg-[#222e35] p-4 rounded-xl border border-gray-700/50 space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" /> Step 2: Auth Sync and Realtime
              </span>
              <p className="text-sm text-gray-300">
                This schema provisions <b className="text-white font-medium">Auth triggers</b> that mirror sign-ups immediately to your profile tables, turns on <b className="text-white font-medium">messages replication</b> for instant chat events, and locks down files using precise Row-Level Security (RLS).
              </p>
            </div>
          </div>

          {/* Code Viewer Container */}
          <div className="relative border border-gray-700 rounded-xl overflow-hidden bg-[#0b141a]">
            {/* Code Bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-800/60 border-b border-gray-700 text-xs font-mono text-gray-400">
              <span>supabase_whatsapp_complete_schema.sql</span>
              <button
                id="copy-sql-btn"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500 text-white rounded-md hover:bg-emerald-600 font-sans font-medium transition-all"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy SQL
                  </>
                )}
              </button>
            </div>

            {/* Code text */}
            <pre className="p-4 overflow-x-auto text-xs font-mono text-emerald-400/90 leading-relaxed max-h-[300px]">
              {SUPABASE_SCHEMA_SQL}
            </pre>
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex gap-3 text-emerald-200 text-xs leading-relaxed">
            <span className="text-xl">💡</span>
            <p>
              <b>Pro-Tip:</b> Because the Supabase client handles message decryption 100% locally on the device (using dynamic keys loaded in IndexedDB/LocalStorage), your Supabase tables will only store scrambled binary/base64 ciphertext and the recipients' encrypted symmetric session keys. Nobody—not even the Supabase database administrators or hackers—can inspect your private transcripts!
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#202c33] px-6 py-4 border-t border-gray-700/60 flex items-center justify-end gap-3">
          <button
            id="close-db-modal-footer-btn"
            onClick={onClose}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-[#0b141a] font-semibold rounded-lg text-sm transition-colors cursor-pointer"
          >
            I've Executed the SQL!
          </button>
        </div>
      </div>
    </div>
  );
}
