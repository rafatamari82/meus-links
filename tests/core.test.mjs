import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/core.js";
import { checkPassword, hashPassword, readSession, signSession } from "../src/security.js";
import { esc, html } from "../src/views.js";

const throwsV = (fn, msg) => assert.throws(fn, core.ValidationError, msg);

test("destination: adds https and keeps accents", () => {
  assert.equal(core.cleanDestination("exemplo.com/a"), "https://exemplo.com/a");
  assert.equal(core.cleanDestination("HTTPS://x.com/promoção"), "https://x.com/promoção");
});
test("destination: rejects bad input", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.com", "", "http://semponto", "https://a b.com", "https://x.com/" + "a".repeat(2100)]) {
    throwsV(() => core.cleanDestination(bad), bad);
  }
});
test("slug rules", () => {
  assert.equal(core.cleanSlug("/Oferta-1_b/"), "Oferta-1_b");
  assert.equal(core.cleanSlug("  "), "");
  for (const bad of ["login", "LINKS", "a b", "-x", "a/b", "x".repeat(51), "ção"]) throwsV(() => core.cleanSlug(bad), bad);
});
test("random slug has no ambiguous chars", () => {
  for (let i = 0; i < 500; i++) {
    const s = core.randomSlug();
    assert.equal(s.length, 6);
    assert.ok(!/[0O1lI]/.test(s), s);
  }
});
test("forward query: merge, short wins", () => {
  assert.equal(core.forwardQuery("https://x.com/p?a=1&b=2", "?b=9&c=3"), "https://x.com/p?a=1&b=9&c=3");
  assert.equal(core.forwardQuery("https://x.com/p#f", ""), "https://x.com/p#f");
  assert.equal(core.forwardQuery("https://x.com/p#f", "?a=1"), "https://x.com/p?a=1#f");
});
test("utm", () => {
  assert.equal(core.addUtm("https://x.com/?utm_source=old&k=1", { source: "ig", medium: " ", campaign: "black friday" }),
    "https://x.com/?k=1&utm_source=ig&utm_campaign=black%20friday");
});
test("bots vs people", () => {
  for (const ua of ["WhatsApp/2.23", "facebookexternalhit/1.1", "TelegramBot (like TwitterBot)", "Slackbot-LinkExpanding 1.0", "Mozilla/5.0 HeadlessChrome/120", "curl/8", ""]) {
    assert.ok(core.isBot(ua), ua);
  }
  for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0", "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36"]) {
    assert.ok(!core.isBot(ua), ua);
  }
});
test("domain rules", () => {
  assert.equal(core.cleanDomain("https://Go.Site.com/x"), "go.site.com");
  for (const bad of ["site", "-a.com", "a..com", "exa mple.com", "127.0.0.1"]) throwsV(() => core.cleanDomain(bad), bad);
});
test("password hash round trip", async () => {
  const h = await hashPassword("uma senha bem longa");
  assert.ok(await checkPassword("uma senha bem longa", h));
  assert.ok(!(await checkPassword("outra", h)));
});
test("session signature and expiry", async () => {
  const tok = await signSession("k", { uid: "u1", exp: Date.now() + 1000 });
  assert.equal((await readSession("k", tok)).uid, "u1");
  assert.equal(await readSession("outra-chave", tok), null);
  assert.equal(await readSession("k", tok.replace(/.$/, (c) => (c === "A" ? "B" : "A"))), null);
  assert.equal(await readSession("k", await signSession("k", { uid: "u1", exp: Date.now() - 1 })), null);
});
test("html escapes", () => {
  assert.equal(esc(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  assert.equal(String(html`<p>${"<b>"}</p>`), "<p>&lt;b&gt;</p>");
});
test("device and os", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0";
  assert.deepEqual(core.parseDevice(iphone), { device: "mobile", os: "iPhone (iOS)" });
  assert.deepEqual(core.parseDevice("Mozilla/5.0 (Linux; Android 14; SM-S918B) Chrome/120 Mobile Safari/537.36"), { device: "mobile", os: "Android" });
  assert.deepEqual(core.parseDevice("Mozilla/5.0 (Linux; Android 13; SM-X700) Chrome/120 Safari/537.36"), { device: "tablet", os: "Android" });
  assert.deepEqual(core.parseDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), { device: "tablet", os: "iPad (iOS)" });
  assert.deepEqual(core.parseDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"), { device: "desktop", os: "Windows" });
  assert.deepEqual(core.parseDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605"), { device: "desktop", os: "Mac" });
  assert.deepEqual(core.parseDevice(""), { device: null, os: null });
});
test("country names in Portuguese", () => {
  assert.equal(core.countryName("BR"), "Brasil");
  assert.equal(core.countryName("US"), "Estados Unidos");
  assert.equal(core.countryName("XX"), "Desconhecido");
  assert.equal(core.countryName(""), "Desconhecido");
});
test("geo rules", () => {
  assert.ok(core.geoAllows("off", "", "BR"));
  assert.ok(!core.geoAllows("block", "BR,US", "BR"));
  assert.ok(core.geoAllows("block", "BR,US", "PT"));
  assert.ok(core.geoAllows("block", "BR", null), "unknown country passes a block list");
  assert.ok(core.geoAllows("allow", "PT", "PT"));
  assert.ok(!core.geoAllows("allow", "PT", "BR"));
  assert.ok(!core.geoAllows("allow", "PT", null), "unknown country does not pass an allow list");
  assert.ok(!core.geoAllows("allow", "PT", "XX"));
});
test("clean geo", () => {
  assert.deepEqual(core.cleanGeo("block", ["us", "br", "BR", "ZZ"]), { mode: "block", countries: "BR,US" });
  assert.deepEqual(core.cleanGeo("off", ["BR"]), { mode: "off", countries: "" });
  assert.deepEqual(core.cleanGeo("hack", ["BR"]), { mode: "off", countries: "" });
  assert.throws(() => core.cleanGeo("allow", []), core.ValidationError);
  assert.equal(core.countryOptions()[0][1], "Brasil");
  assert.equal(core.countryOptions().length, core.COUNTRY_CODES.length);
});
import { cleanPageData, parseFaq, renderRich, videoEmbed, renderPage } from "../src/pages.js";
test("rich text is safe and supports the marks", () => {
  const out = renderRich("## Title\nLine **bold** <script>x</script>\nsecond\n\n- a\n- b\n![alt](https://x.com/i.png)\n[[BOTAO]]\n![no](javascript:alert(1))", "<BTN>");
  assert.match(out, /<h2>Title<\/h2>/);
  assert.match(out, /<p>Line <strong>bold<\/strong> &lt;script&gt;x&lt;\/script&gt;<br>second<\/p>/);
  assert.match(out, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(out, /<img src="https:\/\/x.com\/i.png" alt="alt"/);
  assert.match(out, /<BTN>/);
  assert.ok(!/javascript:alert/.test(out.replace("![no](javascript:alert(1))", "")) || out.includes("![no](javascript:alert(1))"));
  assert.ok(!out.includes("<script>"));
});
test("video embed", () => {
  assert.equal(videoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbed("https://youtu.be/dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(videoEmbed("https://vimeo.com/76979871"), "https://player.vimeo.com/video/76979871");
  assert.equal(videoEmbed(""), null);
  assert.equal(videoEmbed("https://evil.com/v"), undefined);
});
test("faq parsing", () => {
  assert.deepEqual(parseFaq("Is it safe?\nYes, it is.\n\nP: How long?\nR: 30 days"), [{ q: "Is it safe?", a: "Yes, it is." }, { q: "How long?", a: "30 days" }]);
});
test("page data validation", () => {
  const get = (o) => (k) => o[k];
  let r = cleanPageData("tsl", get({ headline: "", body: "" }));
  assert.ok(r.errors.headline && r.errors.body);
  r = cleanPageData("review", get({ headline: "H", product_name: "P", rating: "7", image: "javascript:x" }));
  assert.ok(r.errors.rating && r.errors.image);
  r = cleanPageData("presell", get({ headline: "H", video: "https://evil.com", lang: "xx", accent: "hot" }));
  assert.ok(r.errors.video);
  assert.equal(r.data.lang, "pt");
  assert.equal(r.data.accent, "green");
  const html = renderPage({ link: { slashtag: "a b", template: "review" }, data: { headline: "<b>H</b>", product_name: "P", rating: "4.5", lang: "en", cta_text: "Go" }, assetVersion: "1" });
  assert.match(html, /&lt;b&gt;H&lt;\/b&gt;/);
  assert.match(html, /href="\/a%20b\/go"/);
  assert.match(html, /<html lang="en">/);
});
