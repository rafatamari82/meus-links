// Passwords, signed session cookies, CSRF, per-domain tokens. Web Crypto only.

const enc = new TextEncoder();
// Workers caps PBKDF2 at 100k iterations; the free plan has a 10 ms CPU budget per request.
// 30k keeps login under budget; brute force is held back by the login throttle (10 per 15 min).
const PBKDF2_ITERATIONS = 30000;

export const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export function randomToken(bytes = 24) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function newId() {
  return crypto.randomUUID();
}

export function safeEqual(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(bits)}`;
}

export async function checkPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored).split("$");
  if (alg !== "pbkdf2-sha256") return false;
  const bits = await pbkdf2(password, fromB64url(salt), Number(iter));
  return safeEqual(b64url(bits), hash);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function hmac(secret, message) {
  return b64url(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message)));
}

export async function signSession(secret, data) {
  const body = b64url(enc.encode(JSON.stringify(data)));
  return `${body}.${await hmac(secret, "session:" + body)}`;
}

export async function readSession(secret, cookie) {
  if (!cookie || !cookie.includes(".")) return null;
  const [body, sig] = cookie.split(".");
  if (!safeEqual(sig, await hmac(secret, "session:" + body))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export async function domainToken(secret, name) {
  return (await hmac(secret, "verify:" + name.toLowerCase())).slice(0, 32);
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge, secure, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (httpOnly) c += "; HttpOnly";
  if (secure) c += "; Secure";
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}
