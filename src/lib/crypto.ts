// Client-side End-to-End Encryption (E2EE) Hybrid Cryptosystem using Web Crypto API.
// It generates RSA-OAEP 2048-bit key pairs and uses AES-256-GCM for symmetric message encryption.

// Helper to convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Helper to convert Base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Generate RSA-OAEP key pair
export async function generateE2EKeyPair(): Promise<{ publicKeyJWK: string; privateKeyJWK: string }> {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );

  const publicKeyJWK = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJWK = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return {
    publicKeyJWK: JSON.stringify(publicKeyJWK),
    privateKeyJWK: JSON.stringify(privateKeyJWK),
  };
}

// Import public key from JWK string
export async function importPublicKey(jwkString: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkString);
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false, // not extractable
    ['encrypt']
  );
}

// Import private key from JWK string
export async function importPrivateKey(jwkString: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkString);
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false, // not extractable
    ['decrypt']
  );
}

// Hybrid Encryption: Encrypt message text using standard public keys of recipients
// Returns { encryptedBody: base64(IV + aesCiphertext), encryptedKeys: Map<userId, base64(rsaCipherkey)> }
export async function encryptMessage(
  text: string,
  recipientPublicKeys: { [userId: string]: string }
): Promise<{
  encryptedBody: string;
  encryptedKeys: { [userId: string]: string };
}> {
  // 1. Generate random 256-bit AES-GCM key
  const aesKey = await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );

  // 2. Encrypt text with AES-GCM
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV is standard for GCM

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    aesKey,
    textBytes
  );

  // Combine IV and Ciphertext for transport in database
  const combinedBuffer = new Uint8Array(iv.byteLength + ciphertextBuffer.byteLength);
  combinedBuffer.set(iv, 0);
  combinedBuffer.set(new Uint8Array(ciphertextBuffer), iv.byteLength);
  const encryptedBodyBase64 = arrayBufferToBase64(combinedBuffer);

  // 3. Export AES key as JWK raw format for encryption with RSA
  const aesKeyRaw = await window.crypto.subtle.exportKey('raw', aesKey);

  // 4. Encrypt the raw AES key for each participant using their RSA public key
  const encryptedKeys: { [userId: string]: string } = {};

  for (const userId of Object.keys(recipientPublicKeys)) {
    try {
      const publicKeyStr = recipientPublicKeys[userId];
      if (!publicKeyStr) continue;

      const rsaPublicKey = await importPublicKey(publicKeyStr);
      const rsaEncryptedBuffer = await window.crypto.subtle.encrypt(
        {
          name: 'RSA-OAEP',
        },
        rsaPublicKey,
        aesKeyRaw
      );

      encryptedKeys[userId] = arrayBufferToBase64(rsaEncryptedBuffer);
    } catch (err) {
      console.error(`Failed to encrypt AES key for user ${userId}`, err);
    }
  }

  return {
    encryptedBody: encryptedBodyBase64,
    encryptedKeys,
  };
}

// Hybrid Decryption: Decrypt message body with encrypted AES key and own RSA private key
export async function decryptMessage(
  encryptedBodyBase64: string,
  encryptedAesKeyBase64: string,
  privateKeyJWKString: string
): Promise<string> {
  try {
    // 1. Import local private key
    const privateKey = await importPrivateKey(privateKeyJWKString);

    // 2. Decrypt symmetric AES key with RSA private key
    const encryptedAesKeyBuffer = base64ToArrayBuffer(encryptedAesKeyBase64);
    const decryptedAesKeyRaw = await window.crypto.subtle.decrypt(
      {
        name: 'RSA-OAEP',
      },
      privateKey,
      encryptedAesKeyBuffer
    );

    // 3. Import AES key
    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      decryptedAesKeyRaw,
      {
        name: 'AES-GCM',
      },
      false, // not extractable
      ['decrypt']
    );

    // 4. Separate IV from ciphertext in message body
    const combinedBuffer = base64ToArrayBuffer(encryptedBodyBase64);
    const combinedBytes = new Uint8Array(combinedBuffer);
    const iv = combinedBytes.slice(0, 12);
    const ciphertext = combinedBytes.slice(12);

    // 5. Decrypt message text with AES key
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      aesKey,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (error) {
    console.error('Failed to decrypt message:', error);
    return '🔒 Decryption Error: Secure key mismatch or invalid private key.';
  }
}
