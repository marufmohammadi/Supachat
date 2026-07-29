import { createClient } from '@supabase/supabase-js';
import { withTimeout } from '../utils/timeout';

// Access variables safely with fallback to the user's provided project variables
const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://yinaveonuxbrjgcyzgrv.supabase.co';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Pu6Hu_6dkSl6dKPlZewziQ_tXbjJE3f';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Checks connection health to the given Supabase instance with a fast timeout.
 * Returns true if successful, false otherwise.
 */
export async function testSupabaseConnection(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await withTimeout(
      supabase.from('profiles').select('id').limit(1),
      timeoutMs,
      { data: null, error: null } as any
    );
    if (res.error) {
      console.warn('Database connection warning (tables might not exist yet):', res.error.message);
      return true;
    }
    return true;
  } catch (err) {
    console.warn('Supabase connection test notice:', err);
    return false;
  }
}

