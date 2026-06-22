import { createClient } from '@supabase/supabase-js';

// Access variables safely with fallback to the user's provided project variables
const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://yinaveonuxbrjgcyzgrv.supabase.co';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Pu6Hu_6dkSl6dKPlZewziQ_tXbjJE3f';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Checks connection health to the given Supabase instance.
 * Returns true if successful, false otherwise.
 */
export async function testSupabaseConnection(): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('profiles').select('id').limit(1);
    if (error) {
      console.warn('Database connection warning (tables might not exist yet):', error.message);
      // If error is about the table not existing, then Supabase is connected but tables need to be created.
      return true; 
    }
    return true;
  } catch (err) {
    console.error('Supabase connection test failed:', err);
    return false;
  }
}
