// Pure rules: back-halves, destinations, bots, query forwarding. No Worker APIs.

// No 0/O, 1/l/I: easy to read aloud and type from print.
export const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const SLUG_LEN = 6;
export const SLUG_MAX = 50;
export const DEST_MAX = 2048;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// Paths the panel uses; they can never be a back-half.
export const RESERVED = new Set([
  "login", "logout", "setup", "links", "domains", "static", "internal",
  "design", "favicon.ico", "robots.txt", "health", "api", "admin",
]);

const BOT_RE = new RegExp(
  "bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|whatsapp|" +
  "telegram|slack|discord|twitter|linkedin|embedly|preview|pinterest|" +
  "skypeuripreview|vkshare|quora link|bitlybot|headless|curl|wget|" +
  "python-requests|go-http-client|okhttp|monitor|uptime",
  "i",
);

export class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

export function randomSlug() {
  const bytes = crypto.getRandomValues(new Uint8Array(SLUG_LEN * 2));
  let out = "";
  for (const b of bytes) {
    // rejection sampling keeps the distribution even
    if (b < 256 - (256 % SLUG_ALPHABET.length)) out += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
    if (out.length === SLUG_LEN) return out;
  }
  return out + randomSlug().slice(0, SLUG_LEN - out.length);
}

export function cleanSlug(raw) {
  const s = String(raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!s) return "";
  if (s.length > SLUG_MAX) throw new ValidationError("slashtag", `Use no máximo ${SLUG_MAX} caracteres.`);
  if (!SLUG_RE.test(s)) {
    throw new ValidationError("slashtag",
      "Use só letras, números, hífen e sublinhado, começando por letra ou número.");
  }
  if (RESERVED.has(s.toLowerCase())) {
    throw new ValidationError("slashtag", "Esse final é reservado pelo sistema. Escolha outro.");
  }
  return s;
}

export function cleanDestination(raw) {
  let d = String(raw ?? "").trim();
  if (!d) throw new ValidationError("destination", "Cole o endereço de destino.");
  if (/\s/.test(d)) throw new ValidationError("destination", "O endereço não pode ter espaços.");
  if (!/^https?:\/\//i.test(d)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(d) && !/^[^:/]+:\d/.test(d)) {
      throw new ValidationError("destination", "O destino precisa começar com http:// ou https://.");
    }
    d = "https://" + d;
  }
  if (d.length > DEST_MAX) throw new ValidationError("destination", `O destino passa de ${DEST_MAX} caracteres.`);
  let u;
  try {
    u = new URL(d);
  } catch {
    throw new ValidationError("destination", "Esse endereço não parece válido.");
  }
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new ValidationError("destination", "O destino precisa começar com http:// ou https://.");
  }
  if (!u.hostname.includes(".") && u.hostname !== "localhost") {
    throw new ValidationError("destination", "Esse endereço não parece válido.");
  }
  // keep what the user typed (accents stay readable), only normalise the scheme
  return u.protocol + d.slice(d.indexOf(":") + 1);
}

export function cleanDomain(raw) {
  let d = String(raw ?? "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").split("/")[0].split(":")[0].replace(/\.$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(d) || /^[\d.]+$/.test(d)) {
    throw new ValidationError("domain", "Digite só o domínio, por exemplo go.seusite.com.");
  }
  return d;
}

export function isBot(userAgent) {
  const ua = userAgent || "";
  return !ua.trim() || BOT_RE.test(ua);
}

function splitQuery(q) {
  return q ? q.split("&").filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return i < 0 ? [p, null] : [p.slice(0, i), p.slice(i + 1)];
  }) : [];
}

function decodeKey(k) {
  try { return decodeURIComponent(k.replace(/\+/g, " ")); } catch { return k; }
}

function joinQuery(pairs) {
  return pairs.map(([k, v]) => (v === null ? k : `${k}=${v}`)).join("&");
}

function withQuery(url, mutate) {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = base.indexOf("?");
  const path = qAt >= 0 ? base.slice(0, qAt) : base;
  const pairs = mutate(splitQuery(qAt >= 0 ? base.slice(qAt + 1) : ""));
  return path + (pairs.length ? "?" + joinQuery(pairs) : "") + hash;
}

/** Append the short URL's query to the destination. Short URL wins on clashes. */
export function forwardQuery(destination, search) {
  const incoming = splitQuery(String(search || "").replace(/^\?/, ""));
  if (!incoming.length) return destination;
  const keys = new Set(incoming.map(([k]) => decodeKey(k)));
  return withQuery(destination, (pairs) => [...pairs.filter(([k]) => !keys.has(decodeKey(k))), ...incoming]);
}

export function addUtm(destination, utm) {
  const add = Object.entries(utm)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => [`utm_${k}`, encodeURIComponent(String(v).trim())]);
  if (!add.length) return destination;
  const names = new Set(add.map(([k]) => k));
  return withQuery(destination, (pairs) => [...pairs.filter(([k]) => !names.has(decodeKey(k))), ...add]);
}

export const DEVICE_LABELS = { mobile: "Celular", tablet: "Tablet", desktop: "Computador" };

/** Rough device and OS from the user agent. Good enough for a breakdown, not for fingerprinting. */
export function parseDevice(userAgent) {
  const ua = userAgent || "";
  let os = null;
  if (/iPhone|iPod/.test(ua)) os = "iPhone (iOS)";
  else if (/iPad/.test(ua)) os = "iPad (iOS)";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Macintosh|Mac OS X/.test(ua)) os = "Mac";
  else if (/Linux/i.test(ua)) os = "Linux";
  let device = null;
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android/i.test(ua)) device = "mobile";
  else if (os) device = "desktop";
  return { device, os };
}

let regionNames = null;
export function countryName(code) {
  if (!code || !/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return "Desconhecido";
  try {
    regionNames ??= new Intl.DisplayNames(["pt-BR"], { type: "region" });
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}
