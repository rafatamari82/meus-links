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
