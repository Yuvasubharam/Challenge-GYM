// Password hashing (PBKDF2-SHA256) and compact HMAC-signed tokens using WebCrypto.
const enc = new TextEncoder();
const ITERATIONS = 100_000; // Workers cap PBKDF2 at 100k iterations

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const actual = await pbkdf2(password, unb64url(salt), Number(iter));
  return timingSafeEqual(actual, unb64url(hash));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** JWT (HS256) */
export async function signToken(payload: Record<string, unknown>, secret: string, ttlSec: number): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

export async function verifyToken<T>(token: string, secret: string): Promise<T | null> {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(s), enc.encode(`${h}.${b}`));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(b)));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
