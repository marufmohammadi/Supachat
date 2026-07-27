import { RegisterDevicePayload } from '../types';

export function getOrGenerateDeviceId(): string {
  let deviceId = localStorage.getItem('whatsapp_device_id');
  if (!deviceId) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      deviceId = crypto.randomUUID();
    } else {
      deviceId = 'dev-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
    }
    localStorage.setItem('whatsapp_device_id', deviceId);
  }
  return deviceId;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function generatePublicKeyFingerprint(currentUserId?: string): string {
  try {
    const keyJwk = currentUserId 
      ? localStorage.getItem(`whatsapp_private_key_jwk_${currentUserId}`) || localStorage.getItem(`whatsapp_public_key_jwk_${currentUserId}`)
      : null;
    
    if (!keyJwk) {
      return '00:11:22:33:44';
    }

    const hashStr = simpleHash(keyJwk + (currentUserId || ''));
    const pairs: string[] = [];
    for (let i = 0; i < hashStr.length; i += 2) {
      pairs.push(hashStr.substring(i, i + 2).toUpperCase());
    }
    return pairs.slice(0, 5).join(':');
  } catch {
    return 'AA:BB:CC:DD:EE';
  }
}

export function parseBrowserAndOS(ua: string) {
  let browser = 'Unknown Browser';
  let version = '1.0';
  let os = 'Unknown OS';
  let platform = 'Desktop';

  // Platform
  if (/mobile/i.test(ua)) {
    platform = 'Mobile';
  } else if (/tablet|ipad/i.test(ua)) {
    platform = 'Tablet';
  }

  // OS
  if (/macintosh|mac os x/i.test(ua)) {
    os = 'macOS';
  } else if (/windows|win32|win64/i.test(ua)) {
    os = 'Windows';
  } else if (/android/i.test(ua)) {
    os = 'Android';
    platform = 'Mobile';
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    os = 'iOS';
    platform = 'Mobile';
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
  }

  // Browser
  if (/edg/i.test(ua)) {
    browser = 'Microsoft Edge';
    const match = ua.match(/edg\/([\d.]+)/i);
    if (match) version = match[1];
  } else if (/chrome|crios/i.test(ua) && !/opr|opera|edg/i.test(ua)) {
    browser = 'Google Chrome';
    const match = ua.match(/(?:chrome|crios)\/([\d.]+)/i);
    if (match) version = match[1];
  } else if (/firefox|fxios/i.test(ua)) {
    browser = 'Mozilla Firefox';
    const match = ua.match(/(?:firefox|fxios)\/([\d.]+)/i);
    if (match) version = match[1];
  } else if (/safari/i.test(ua) && !/chrome|crios|android/i.test(ua)) {
    browser = 'Apple Safari';
    const match = ua.match(/version\/([\d.]+)/i);
    if (match) version = match[1];
  } else if (/opr|opera/i.test(ua)) {
    browser = 'Opera';
    const match = ua.match(/(?:opr|opera)\/([\d.]+)/i);
    if (match) version = match[1];
  }

  return { browser, version, os, platform };
}

export function getDeviceFingerprintDetails(currentUserId?: string): RegisterDevicePayload {
  const deviceId = getOrGenerateDeviceId();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';
  const { browser, version, os, platform } = parseBrowserAndOS(ua);

  const screenRes = typeof window !== 'undefined' && window.screen 
    ? `${window.screen.width}x${window.screen.height}` 
    : '1920x1080';

  const timezone = typeof Intl !== 'undefined' && Intl.DateTimeFormat 
    ? Intl.DateTimeFormat().resolvedOptions().timeZone 
    : 'UTC';

  const language = typeof navigator !== 'undefined' ? navigator.language : 'en-US';

  const pubKeyFingerprint = generatePublicKeyFingerprint(currentUserId);

  // Stable fingerprint component including unique deviceId
  const rawFingerprint = `${deviceId}|${browser}|${version}|${os}|${platform}|${screenRes}|${timezone}|${language}`;
  const deviceFingerprint = simpleHash(rawFingerprint);

  const deviceName = `${browser} on ${os}`;

  return {
    device_id: deviceId,
    device_fingerprint: deviceFingerprint,
    device_name: deviceName,
    browser,
    browser_version: version,
    operating_system: os,
    platform,
    screen_resolution: screenRes,
    timezone,
    language,
    public_key_fingerprint: pubKeyFingerprint
  };
}
