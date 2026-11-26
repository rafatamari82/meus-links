import test from "node:test";
import assert from "node:assert/strict";
import { b64u, encryptPayload, newVapidKeys, sendPush, unb64u } from "../src/webpush.js";

const enc = new TextEncoder();
const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt, ikm, info, bits) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bits));
}

// What the browser does: decrypt RFC 8291 aes128gcm.
async function decrypt(body, ua, uaPublic, auth) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 256);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 96);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  assert.equal(plain[plain.length - 1], 2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

test("payload round-trips through browser-side decryption", async () => {
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload('{"title":"💰 Venda!"}', b64u(uaPublic), b64u(auth));
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(await decrypt(body, ua, uaPublic, auth), '{"title":"💰 Venda!"}');
});

test("VAPID header is a valid ES256 JWT for the endpoint origin", async () => {
  const keys = await newVapidKeys();
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const sub = { endpoint: "https://push.example.com/abc", p256dh: b64u(await crypto.subtle.exportKey("raw", ua.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
  let seen;
  const status = await sendPush(sub, { title: "x" }, keys, "mailto:a@b.com", async (url, init) => { seen = init; return new Response(null, { status: 201 }); });
  assert.equal(status, 201);
  assert.equal(seen.headers["Content-Encoding"], "aes128gcm");
  const [, t, k] = seen.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, c, sig] = t.split(".");
  assert.equal(JSON.parse(new TextDecoder().decode(unb64u(c))).aud, "https://push.example.com");
  const pub = await crypto.subtle.importKey("raw", unb64u(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(sig), enc.encode(`${h}.${c}`)));
});
