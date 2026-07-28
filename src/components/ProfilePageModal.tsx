import { useState, useEffect, FormEvent } from 'react';
import { User, AtSign, Mail, CheckCircle, RefreshCw, X, Shield, Camera } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { validateUsernameFormat, checkUsernameAvailability, getDisplayName, getFormattedUsername } from '../utils/username';

interface ProfilePageModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProfile: Profile | null;
  currentUserId: string;
  isSandboxMode: boolean;
  onProfileUpdated: (updatedProfile: Profile) => void;
}

export function ProfilePageModal({
  isOpen,
  onClose,
  currentProfile,
  currentUserId,
  isSandboxMode,
  onProfileUpdated
}: ProfilePageModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Username validation & availability states
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  useEffect(() => {
    if (currentProfile) {
      setDisplayName(currentProfile.display_name || currentProfile.username || '');
      setUsername(currentProfile.username ? currentProfile.username.replace(/^@/, '') : '');
      setAvatarUrl(currentProfile.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${currentUserId}`);
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [currentProfile, currentUserId, isOpen]);

  // Debounced realtime username availability check for profile edit
  useEffect(() => {
    if (!isOpen || !username.trim()) {
      setUsernameAvailable(null);
      setUsernameError(null);
      setCheckingUsername(false);
      return;
    }

    const cleanInput = username.trim().toLowerCase().replace(/^@/, '');
    const currentClean = currentProfile?.username ? currentProfile.username.replace(/^@/, '').toLowerCase() : '';

    // If username hasn't changed from current profile, it's valid & available for this user
    if (cleanInput === currentClean) {
      setUsernameAvailable(true);
      setUsernameError(null);
      setCheckingUsername(false);
      return;
    }

    setCheckingUsername(true);
    setUsernameError(null);
    setUsernameAvailable(null);

    const timer = setTimeout(async () => {
      const res = await checkUsernameAvailability(cleanInput, currentUserId, isSandboxMode);
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
  }, [username, isOpen, currentUserId, currentProfile, isSandboxMode]);

  if (!isOpen || !currentProfile) return null;

  const handleRandomizeAvatar = () => {
    const seed = Math.random().toString(36).substring(7);
    setAvatarUrl(`https://api.dicebear.com/7.x/adventurer/svg?seed=${seed}`);
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // Validate Display Name
    if (!displayName.trim()) {
      setErrorMsg('Display Name cannot be empty.');
      return;
    }

    // Validate Username Format
    const val = validateUsernameFormat(username);
    if (!val.isValid) {
      setErrorMsg(val.error || 'Invalid username format.');
      return;
    }

    const cleanUsername = val.cleanUsername;

    // Check if username changed and availability
    const currentClean = currentProfile.username ? currentProfile.username.replace(/^@/, '').toLowerCase() : '';
    if (cleanUsername !== currentClean) {
      if (usernameError) {
        setErrorMsg(usernameError);
        return;
      }
      if (checkingUsername) {
        setErrorMsg('Please wait for username availability check.');
        return;
      }
      if (usernameAvailable === false) {
        setErrorMsg('Username is already taken by another account.');
        return;
      }
    }

    setSaving(true);

    try {
      const updatedProfileRecord: Profile = {
        ...currentProfile,
        display_name: displayName.trim(),
        username: cleanUsername,
        avatar_url: avatarUrl
      };

      if (!isSandboxMode) {
        // Update database row in profiles table
        const { error: dbError } = await supabase
          .from('profiles')
          .update({
            display_name: displayName.trim(),
            username: cleanUsername,
            avatar_url: avatarUrl
          })
          .eq('id', currentUserId);

        if (dbError) {
          throw dbError;
        }

        // Update user auth metadata
        await supabase.auth.updateUser({
          data: {
            display_name: displayName.trim(),
            username: cleanUsername,
            avatar_url: avatarUrl
          }
        });
      }

      onProfileUpdated(updatedProfileRecord);
      setSuccessMsg('Profile updated successfully!');
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err: any) {
      console.error('Failed to update profile:', err);
      setErrorMsg(err.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#1f2c34] text-gray-200 rounded-3xl w-full max-w-md p-6 border border-gray-700/60 shadow-2xl space-y-5 relative">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base leading-snug">User Profile</h3>
              <p className="text-[11px] text-gray-400">Instagram-Style Display Name & Unique Username</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 hover:bg-[#2a3942] rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl font-medium">
            🔴 {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs rounded-xl font-medium flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4 text-emerald-400" /> {successMsg}
          </div>
        )}

        {/* Profile Avatar Banner */}
        <div className="flex flex-col items-center justify-center pt-1 space-y-3">
          <div className="relative group">
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-20 h-20 rounded-full border-2 border-emerald-500/40 bg-[#111b21] shadow-xl"
            />
            <button
              type="button"
              onClick={handleRandomizeAvatar}
              title="Change Avatar Style"
              className="absolute bottom-0 right-0 bg-emerald-500 hover:bg-emerald-400 text-slate-950 p-2 rounded-full shadow-lg transition-transform active:scale-95 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-gray-400">Click camera icon to generate a new avatar</p>
        </div>

        {/* Form Fields */}
        <form onSubmit={handleSaveProfile} className="space-y-4">
          
          {/* Display Name */}
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
                className="w-full pl-11 pr-4 py-2.5 bg-[#2a3942] border border-gray-700 rounded-xl text-sm focus:outline-none focus:border-emerald-500/60 text-white placeholder-gray-500 transition-colors"
              />
            </div>
            <p className="text-[10px] text-gray-400">Shown in chats and conversation lists.</p>
          </div>

          {/* Username (@handle) */}
          <div className="space-y-1 text-left">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-400">Username (@handle)</label>
              <span className="text-[10px] text-gray-400 font-mono">3-30 chars, lowercase</span>
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
                      : 'border-gray-700 focus:border-emerald-500/60'
                }`}
              />
            </div>

            {/* Real-time Availability status */}
            {checkingUsername && (
              <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-1 animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin" /> Checking availability...
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

          {/* Email Address (Readonly) */}
          {currentProfile.email && (
            <div className="space-y-1 text-left">
              <label className="text-xs font-semibold text-gray-400">Email Address (Primary)</label>
              <div className="relative opacity-70">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  disabled
                  value={currentProfile.email}
                  className="w-full pl-11 pr-4 py-2.5 bg-[#111b21] border border-gray-800 rounded-xl text-sm text-gray-400 select-none cursor-not-allowed"
                />
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="pt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || checkingUsername || usernameAvailable === false}
              className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving Profile...
                </>
              ) : (
                'Save Profile Changes'
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
