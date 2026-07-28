import { generateE2EKeyPair } from '../lib/crypto';
import { supabase } from '../lib/supabase';
import { generatePublicKeyFingerprint } from '../features/device-verification/utils/deviceFingerprint';

export interface KeyGenerationResult {
  success: boolean;
  keys?: { publicKeyJWK: string; privateKeyJWK: string };
  error?: string;
  alreadyExisted?: boolean;
}

export interface E2EEKeyParams {
  userId: string;
  isSandboxMode: boolean;
  username?: string;
  userEmail?: string;
  avatarUrl?: string;
  force?: boolean;
}

// Global execution promise lock / mutex to prevent simultaneous key generation runs
let keyGenPromiseLock: Promise<KeyGenerationResult> | null = null;

/**
 * Checks if the user already has valid local E2EE keys on this browser device.
 * Validates:
 * 1. Local Private Key exists in localStorage
 * 2. Local Public Key exists in localStorage
 * 3. Fingerprint exists and is valid (not fallback '00:11:22:33:44')
 */
export function checkHasLocalKeys(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    const pub = localStorage.getItem(`whatsapp_public_key_jwk_${userId}`);
    const priv = localStorage.getItem(`whatsapp_private_key_jwk_${userId}`);
    if (!pub || !priv) return false;

    // Validate valid JSON format
    JSON.parse(pub);
    JSON.parse(priv);

    // Verify fingerprint computation is valid
    const fp = generatePublicKeyFingerprint(userId);
    if (!fp || fp === '00:11:22:33:44') {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Single canonical implementation for generating, storing, and uploading E2EE Keys.
 * Reused by BOTH manual "Regenerate Keys" button and automatic post-login key generation.
 */
export async function generateAndSaveE2EEKeys({
  userId,
  isSandboxMode,
  username,
  userEmail,
  avatarUrl,
  force = false,
}: E2EEKeyParams): Promise<KeyGenerationResult> {
  if (!userId) {
    return { success: false, error: 'User ID missing' };
  }

  // Safety Check & Multi-tab Check:
  // If not forcing regeneration, check if keys already exist on this device
  if (!force && checkHasLocalKeys(userId)) {
    const pub = localStorage.getItem(`whatsapp_public_key_jwk_${userId}`);
    const priv = localStorage.getItem(`whatsapp_private_key_jwk_${userId}`);
    if (pub && priv) {
      return {
        success: true,
        alreadyExisted: true,
        keys: { publicKeyJWK: pub, privateKeyJWK: priv },
      };
    }
  }

  // Mutex lock to prevent duplicate concurrent key generation
  if (keyGenPromiseLock) {
    return keyGenPromiseLock;
  }

  const executeGeneration = async (): Promise<KeyGenerationResult> => {
    // Re-verify localStorage inside mutex in case another tab generated keys while waiting
    if (!force && checkHasLocalKeys(userId)) {
      const pub = localStorage.getItem(`whatsapp_public_key_jwk_${userId}`);
      const priv = localStorage.getItem(`whatsapp_private_key_jwk_${userId}`);
      if (pub && priv) {
        return {
          success: true,
          alreadyExisted: true,
          keys: { publicKeyJWK: pub, privateKeyJWK: priv },
        };
      }
    }

    try {
      // 1. Generate RSA-2048 keypair asynchronously
      const keys = await generateE2EKeyPair();

      // 2. Store Private Key & Public Key locally
      // PRIVATE KEY NEVER LEAVES LOCAL DEVICE
      localStorage.setItem(`whatsapp_public_key_jwk_${userId}`, keys.publicKeyJWK);
      localStorage.setItem(`whatsapp_private_key_jwk_${userId}`, keys.privateKeyJWK);

      // 3. Upload Public Key to database profile if not in sandbox mode
      if (!isSandboxMode) {
        const { data: existingProfile, error: checkError } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', userId)
          .maybeSingle();

        if (checkError) {
          console.warn('[E2EE] Profile check warning during key generation:', checkError.message);
        }

        if (!existingProfile) {
          const { error: insertError } = await supabase
            .from('profiles')
            .insert({
              id: userId,
              username: username || userEmail?.split('@')[0] || 'User',
              avatar_url: avatarUrl || `https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}`,
              public_key: keys.publicKeyJWK,
            });
          if (insertError) {
            console.warn('[E2EE] Profile insert warning during key generation:', insertError.message);
          }
        } else {
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ public_key: keys.publicKeyJWK })
            .eq('id', userId);
          if (updateError) {
            console.warn('[E2EE] Profile update public key warning:', updateError.message);
          }
        }
      }

      return {
        success: true,
        alreadyExisted: false,
        keys,
      };
    } catch (err: any) {
      console.error('[E2EE] Key generation error:', err);
      return {
        success: false,
        error: err?.message || 'Failed to generate crypto keys',
      };
    } finally {
      keyGenPromiseLock = null;
    }
  };

  keyGenPromiseLock = executeGeneration();
  return keyGenPromiseLock;
}

/**
 * Auto-generates keys with up to 3 automatic retries if generation fails.
 */
export async function autoGenerateKeysWithRetry(
  params: E2EEKeyParams,
  maxAttempts: number = 3
): Promise<KeyGenerationResult> {
  if (checkHasLocalKeys(params.userId)) {
    const pub = localStorage.getItem(`whatsapp_public_key_jwk_${params.userId}`);
    const priv = localStorage.getItem(`whatsapp_private_key_jwk_${params.userId}`);
    return {
      success: true,
      alreadyExisted: true,
      keys: pub && priv ? { publicKeyJWK: pub, privateKeyJWK: priv } : undefined,
    };
  }

  let attempt = 0;
  let lastResult: KeyGenerationResult = { success: false, error: 'Key generation failed' };

  while (attempt < maxAttempts) {
    attempt++;
    if (checkHasLocalKeys(params.userId)) {
      const pub = localStorage.getItem(`whatsapp_public_key_jwk_${params.userId}`);
      const priv = localStorage.getItem(`whatsapp_private_key_jwk_${params.userId}`);
      return {
        success: true,
        alreadyExisted: true,
        keys: pub && priv ? { publicKeyJWK: pub, privateKeyJWK: priv } : undefined,
      };
    }

    lastResult = await generateAndSaveE2EEKeys({ ...params, force: false });

    if (lastResult.success) {
      return lastResult;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return lastResult;
}
