import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../src/tracker.js";

test("click IDs have the ct format and are found anywhere", () => {
  const id = T.newClickId();
  assert.match(id, /^ct[a-z2-7]{10}$/);
  assert.deepEqual(T.findClickIds({ tid: id }, null), [id]);
  assert.deepEqual(T.findClickIds({}, { data: { purchase: { origin: { sck: id.toUpperCase() } } } }), [id]);
  assert.deepEqual(T.findClickIds({ s: `x_${id}_y` }, null), [id]);
  assert.deepEqual(T.findClickIds({ s: "contract1234567" }, null), []);
});

test("tracked target adds the click ID, drops our keys, honours lp on the same host", () => {
  const u = T.trackedTarget("https://presell.com/a", "?src=google&cmp=123&gclid=G&lp=https%3A%2F%2Fpresell.com%2Fb%3Fx%3D1", "tid", "ctaaaaaaaaaa");
  const p = new URL(u);
  assert.equal(p.pathname, "/b");
  assert.equal(p.searchParams.get("tid"), "ctaaaaaaaaaa");
  assert.equal(p.searchParams.get("x"), "1");
  assert.equal(p.searchParams.get("gclid"), "G");
  assert.equal(p.searchParams.get("cmp"), null);
  const evil = T.trackedTarget("https://presell.com/a", "?lp=https%3A%2F%2Fevil.com%2F", "tid", "ctaaaaaaaaaa");
  assert.equal(new URL(evil).hostname, "presell.com");
});

test("click params: source, unfilled macros skipped", () => {
  const g = T.readClickParams(new URLSearchParams("cmp=111&adg=222&kw=x&gclid=abc"));
  assert.equal(g.source, "google");
  assert.equal(g.campaign, "111");
  const nb = T.readClickParams(new URLSearchParams("src=newsbreak&cmp=__CAMPAIGN_NAME__&nbcb=cb1"));
  assert.equal(nb.source, "newsbreak");
  assert.equal(nb.campaign, null);
  assert.equal(nb.nb_callback, "cb1");
});

test("money parsing", () => {
  assert.equal(T.toCents("49.90"), 4990);
  assert.equal(T.toCents("1.234,56"), 123456);
  assert.equal(T.toCents("1,234.56"), 123456);
  assert.equal(T.toCents("{COMMISSION_AMOUNT}"), null);
  assert.equal(T.convert(1000, "USD", "BRL", { usd_brl: 5, eur_brl: 6 }), 5000);
  assert.equal(T.convert(5000, "BRL", "USD", { usd_brl: 5, eur_brl: 6 }), 1000);
});

test("query postback (BuyGoods style)", () => {
  const p = T.parsePostback("buygoods", { cid: "ctaaaaaaaaaa", amount: "87.50", txid: "B1", type: "upsell" }, null);
  assert.deepEqual([p.type, p.amount_cents, p.txid, p.currency, p.ids[0]], ["upsell", 8750, "B1", "USD", "ctaaaaaaaaaa"]);
  assert.equal(T.parsePostback("clickbank", { cid: "x", type: "refund" }, null).type, "refund");
  assert.ok(T.parsePostback("maxweb", { type: "lead" }, null).ignore);
});

test("Hotmart webhook", () => {
  const body = { event: "PURCHASE_APPROVED", data: { purchase: { transaction: "HP1", price: { value: 197, currency_value: "BRL" }, origin: { sck: "ctbbbbbbbbbb" } },
    commissions: [{ value: 120.5, source: "AFFILIATE", currency_value: "BRL" }] } };
  const p = T.parsePostback("hotmart", {}, body);
  assert.deepEqual([p.type, p.amount_cents, p.txid, p.ids[0]], ["sale", 12050, "HP1", "ctbbbbbbbbbb"]);
  assert.ok(T.parsePostback("hotmart", {}, { event: "PURCHASE_BILLET_PRINTED", data: {} }).ignore);
  assert.equal(T.parsePostback("hotmart", {}, { event: "PURCHASE_REFUNDED", data: { purchase: { transaction: "HP1" } } }).type, "refund");
});

test("Kiwify webhook", () => {
  const body = { order_id: "K1", order_status: "paid", Commissions: { my_commission: 4990, currency: "BRL" }, TrackingParameters: { sck: "ctcccccccccc" } };
  const p = T.parsePostback("kiwify", {}, body);
  assert.deepEqual([p.type, p.amount_cents, p.txid, p.ids[0]], ["sale", 4990, "K1", "ctcccccccccc"]);
  assert.equal(T.parsePostback("kiwify", {}, { order_status: "chargedback" }).type, "chargeback");
});

test("cost CSV", () => {
  const r = T.parseCostCsv('Date,Campaign Name,Impressions,Clicks,Spend\n11/24/2026,"Oferta, US",1000,40,"$35.20"\n2026-11-25,Outra,10,1,2');
  assert.equal(r.rows.length, 2);
  assert.deepEqual([r.rows[0].date, r.rows[0].campaign_key, r.rows[0].cost_cents, r.rows[0].clicks], ["2026-11-24", "Oferta, US", 3520, 40]);
  assert.ok(T.parseCostCsv("a,b\n1,2").error);
});

test("notification templates", () => {
  const v = { emoji: "💰", tipo: "Venda", valor: "US$ 10,00", rede: "ClickBank", origem: "Google Ads", campanha: "", anuncio: "A1", pedido: "", produto: "", pais: "" };
  assert.equal(T.renderTemplate(T.TEMPLATE_DEFAULTS.sale_title, v), "💰 Venda! US$ 10,00");
  assert.equal(T.renderTemplate(T.TEMPLATE_DEFAULTS.sale_body, v), "ClickBank · Google Ads");
  assert.equal(T.renderTemplate(T.TEMPLATE_DEFAULTS.sale_body, { ...v, produto: "SodaPeak", campanha: "C1", pais: "🇺🇸 Estados Unidos" }), "SodaPeak · 🇺🇸 Estados Unidos · ClickBank · Google Ads · C1");
  assert.equal(T.renderTemplate(T.TEMPLATE_DEFAULTS.refund_body, v), "ClickBank");
  assert.equal(T.renderTemplate("Caiu {valor} {desconhecida}", v), "Caiu US$ 10,00 {desconhecida}");
  assert.equal(T.cleanTemplate("  ", "x"), "x");
});

test("GuruMedia postback with its real macros filled in", () => {
  const p = T.parsePostback("gurumedia", { cid: "ctdddddddddd", amount: "45.00", txid: "GM77", currency: "usd" }, null);
  assert.deepEqual([p.type, p.amount_cents, p.txid, p.currency, p.ids[0]], ["sale", 4500, "GM77", "USD", "ctdddddddddd"]);
});

test("MedisScalers statuses", () => {
  const ok = T.parsePostback("medisscalers", { cid: "cteeeeeeeeee", amount: "30", txid: "M1", currency: "USD", status: "approved" }, null);
  assert.equal(ok.type, "sale");
  assert.equal(T.parsePostback("medisscalers", { cid: "cteeeeeeeeee", txid: "M1", status: "pending" }, null).type, "sale");
  assert.equal(T.parsePostback("medisscalers", { cid: "cteeeeeeeeee", txid: "M1", status: "rejected" }, null).type, "reject");
  assert.equal(T.parsePostback("medisscalers", { txid: "M1", status: "refunded" }, null).type, "refund");
});

test("product comes from the postback, unfilled macros stay out", () => {
  assert.equal(T.parsePostback("gurumedia", { cid: "x", product: "SodaPeak" }, null).product, "SodaPeak");
  assert.equal(T.parsePostback("buygoods", { cid: "x", product: "{PRODUCT_CODENAME}" }, null).product, null);
  assert.equal(T.parsePostback("hotmart", {}, { event: "PURCHASE_APPROVED", data: { product: { name: "Curso X" }, purchase: { transaction: "H" } } }).product, "Curso X");
  assert.equal(T.parsePostback("kiwify", {}, { order_status: "paid", order_id: "K", Product: { product_name: "Ebook Y" } }).product, "Ebook Y");
});

test("sale e-mail escapes what the networks send", async () => {
  const { saleEmail } = await import("../src/tracker-routes.js");
  const { text, html } = saleEmail({ title: "💰 Venda! US$ 10,00", body: "x", vars: { produto: "<b>Soda</b>", rede: "ClickBank" } }, "https://app.cutti.us");
  assert.ok(html.includes("&#60;b&#62;Soda"));
  assert.ok(!html.includes("<b>Soda"));
  assert.ok(text.includes("Produto: <b>Soda</b>"));
});

test("raw e-mail is valid MIME with encoded subject", async () => {
  const { rawEmail } = await import("../src/tracker-routes.js");
  const m = rawEmail({ from: "vendas@cutti.us", fromName: "Cutti", to: "a@b.com", subject: "💰 Venda!", text: "oi", html: "<p>oi</p>", domain: "cutti.us" });
  assert.match(m, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <vendas@cutti\.us>\r\n/);
  assert.match(m, /\r\nSubject: =\?UTF-8\?B\?8J\+SsCBWZW5kYSE=\?=\r\n/);
  assert.ok(m.includes("multipart/alternative"));
  assert.ok(m.endsWith("--\r\n"));
});

test("country comes from the postback when the network sends it", () => {
  assert.equal(T.parsePostback("buygoods", { subid: "ctaaaaaaaaaa", amount: "10", country: "us" }).country, "US");
  assert.equal(T.parsePostback("buygoods", { subid: "ctaaaaaaaaaa", amount: "10", country: "{COUNTRY}" }).country, null);
  assert.equal(T.parsePostback("buygoods", { subid: "ctaaaaaaaaaa", amount: "10", country: "Brazil" }).country, null);
  assert.equal(T.parsePostback("hotmart", {}, { event: "PURCHASE_APPROVED", data: { buyer: { address: { country_iso: "BR" } }, purchase: { transaction: "H1" } } }).country, "BR");
  assert.equal(T.cleanCountry("XX"), null);
});

test("Google Ads script also sends age and gender", () => {
  const js = T.googleAdsScript("https://app.example.com/cost/k/google");
  assert.match(js, /age_range_view/);
  assert.match(js, /gender_view/);
  assert.match(js, /demo: demo/);
  assert.doesNotThrow(() => new Function(js));
});

test("Everflow-style networks send the buyer's country", () => {
  for (const n of ["gurumedia", "smartadv", "smashloud", "clickadv", "medisscalers"]) assert.match(T.NETWORKS[n].query, /country=\{geo_country_code\}/);
  assert.equal(T.parsePostback("gurumedia", { cid: "ctaaaaaaaaaa", amount: "30", country: "CA" }).country, "CA");
  assert.equal(T.parsePostback("smartadv", { cid: "ctaaaaaaaaaa", amount: "30", country: "{geo_country_code}" }).country, null);
});
