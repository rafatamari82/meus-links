// Local server: runs the Worker in Node with a SQLite-backed D1 stand-in.
//   node dev/server.mjs            -> http://localhost:8787
// Env: PORT, DB_PATH, TEST_ROUTES="go.teste.com=http://127.0.0.1:8787" (tests only)
import http from "node:http";
import { D1Shim } from "./d1-shim.mjs";
import worker from "../src/index.js";

const port = Number(process.env.PORT || 8787);
const env = { DB: new D1Shim(process.env.DB_PATH || "dev/local.db"), APP_HOST: process.env.APP_HOST || "" };

// Test hook: route verification fetches for listed domains back to this server.
const routes = Object.fromEntries((process.env.TEST_ROUTES || "").split(",").filter(Boolean).map((r) => r.split("=")));
env.__testFetch = async (url, init) => {
  const u = new URL(url);
  const base = routes[u.hostname];
  if (!base) throw Object.assign(new Error("connection refused"), { name: "ConnectionRefused" });
  return fetch(base + u.pathname + u.search, { ...init, headers: { ...(init?.headers || {}), "X-Test-Host": u.hostname } });
};

// Dev: a fixed exchange rate instead of calling the quote service.
env.__ratesFetch = async () => new Response(JSON.stringify({ USDBRL: { bid: "5.40" }, EURBRL: { bid: "6.20" } }));

// Test hook: phone notifications are logged instead of sent.
if (process.env.TEST_ROUTES) {
  // Fake Google (OAuth + Ads API) so the connect flow runs offline.
  env.__googleFetch = async (url, init = {}) => {
    const j = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
    const u = String(url);
    console.log("GOOGLE", init.method || "GET", u.replace(/^https:\/\/[^/]+/, ""));
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      const b = new URLSearchParams(init.body);
      if (b.get("grant_type") === "authorization_code") return j({ access_token: "at", refresh_token: "rt-test", expires_in: 3600 });
      return j({ access_token: "at", expires_in: 3600 });
    }
    if (u.endsWith("customers:listAccessibleCustomers")) return j({ resourceNames: ["customers/1112223333", "customers/9998887777"] });
    const body = init.body ? JSON.parse(init.body) : {};
    if (u.includes("googleAds:search")) {
      const q = body.query || "";
      if (q.includes("FROM customer")) {
        const id = u.match(/customers\/(\d+)/)[1];
        return j({ results: [{ customer: { id, descriptiveName: id === "1112223333" ? "Conta Teste" : "Minha MCC", currencyCode: "USD", manager: id !== "1112223333" } }] });
      }
      if (q.includes("FROM conversion_action")) return j({ results: [] });
      if (q.includes("FROM campaign")) {
        const d = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
        return j({ results: [{ segments: { date: d }, campaign: { id: "777", name: "Campanha API" }, metrics: { costMicros: "12340000", clicks: "10", impressions: "100" } }] });
      }
    }
    if (u.includes("conversionActions:mutate")) return j({ results: [{ resourceName: "customers/1112223333/conversionActions/555" }] });
    if (u.includes(":uploadClickConversions")) return j({ results: body.conversions.map(() => ({})) });
    if (u.includes(":uploadConversionAdjustments")) return j({ results: [{}] });
    return j({ error: { status: "NOT_FOUND", message: u } }, 404);
  };
  env.EMAIL_TO = "voce@exemplo.com";
  env.EMAIL = { send: async (m) => { console.log("EMAIL", m.from?.email, m.subject); return { messageId: "dev" }; } };
  env.__notifyFetch = async (url, init) => {
    console.log("NOTIFY", url.replace(/bot[^/]+/, "bot***"), init?.body);
    return new Response("{}", { status: 200 });
  };
}

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const host = req.headers["x-test-host"] || req.headers.host;
  const url = `http://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  headers.set("CF-Connecting-IP", req.socket.remoteAddress || "local");
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
  const pending = [];
  const exec = { waitUntil: (p) => pending.push(p), passThroughOnException() {} };
  try {
    const r = await worker.fetch(new Request(url, { method: req.method, headers, body }), env, exec);
    await Promise.all(pending); // deterministic for tests
    const out = {};
    r.headers.forEach((v, k) => { if (k !== "set-cookie") out[k] = v; });
    const cookies = r.headers.getSetCookie?.() || [];
    if (cookies.length) out["set-cookie"] = cookies;
    res.writeHead(r.status, out);
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500).end("dev server error");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
