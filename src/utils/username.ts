import { supabase } from '../lib/supabase';
import { Profile } from '../types';

export interface UsernameValidationResult {
  isValid: boolean;
  cleanUsername: string;
  error?: string;
}

export interface UsernameAvailabilityResult {
  available: boolean;
  error?: string;
}

/**
 * Validates the username format strictly according to the requirements:
 * - 3-30 characters
 * - Allowed: a-z, 0-9, _, .
 * - Lowercase only (automatically converted / cleaned)
 * - Trimmed whitespace
 * - No spaces, no special symbols
 */
export function validateUsernameFormat(rawUsername: string): UsernameValidationResult {
  const trimmed = rawUsername.trim().toLowerCase().replace(/^@/, '');

  if (!trimmed) {
    return { isValid: false, cleanUsername: '', error: 'Username is required.' };
  }

  if (trimmed.length < 3) {
    return { isValid: false, cleanUsername: trimmed, error: 'Username must be at least 3 characters.' };
  }

  if (trimmed.length > 30) {
    return { isValid: false, cleanUsername: trimmed, error: 'Username must be at most 30 characters.' };
  }

  const allowedRegex = /^[a-z0-9_.]+$/;
  if (!allowedRegex.test(trimmed)) {
    return {
      isValid: false,
      cleanUsername: trimmed,
      error: 'Username can only contain lowercase letters (a-z), numbers (0-9), underscores (_), and dots (.).'
    };
  }

  return { isValid: true, cleanUsername: trimmed };
}

/**
 * Checks if a username is available in real-time.
 * Supports both live Supabase database and Sandbox Mode.
 */
export async function checkUsernameAvailability(
  rawUsername: string,
  excludeUserId?: string,
  isSandboxMode: boolean = false
): Promise<UsernameAvailabilityResult> {
  const validation = validateUsernameFormat(rawUsername);
  if (!validation.isValid) {
    return { available: false, error: validation.error };
  }

  const cleanUsername = validation.cleanUsername;

  if (isSandboxMode) {
    // Sandbox mock usernames list
    const reservedSandboxUsernames = ['alice', 'bob', 'charlie'];
    if (reservedSandboxUsernames.includes(cleanUsername) && excludeUserId !== `mock-user-${cleanUsername}-1234`) {
      return { available: false, error: 'Username already taken.' };
    }
    return { available: true };
  }

  try {
    let query = supabase
      .from('profiles')
      .select('id')
      .ilike('username', cleanUsername);

    if (excludeUserId) {
      query = query.neq('id', excludeUserId);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('Username availability check error:', error.message);
      // Fallback: assume available if table query warning or error
      return { available: true };
    }

    if (data && data.length > 0) {
      return { available: false, error: 'Username already taken.' };
    }

    return { available: true };
  } catch (err: any) {
    console.warn('Username check catch error:', err);
    return { available: true };
  }
}

/**
 * Helper to get the display name for a user profile
 */
export function getDisplayName(profile?: Partial<Profile> | null, defaultFallback: string = 'User'): string {
  if (!profile) return defaultFallback;
  return profile.display_name?.trim() || profile.username?.trim() || defaultFallback;
}

/**
 * Helper to get the @username handle for a user profile
 */
export function getFormattedUsername(profile?: Partial<Profile> | null, defaultFallback: string = ''): string {
  if (!profile || !profile.username) return defaultFallback ? `@${defaultFallback}` : '';
  const clean = profile.username.replace(/^@/, '').trim();
  return clean ? `@${clean}` : '';
}
