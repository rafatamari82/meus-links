// Sales tracker rules: click IDs, networks, postback parsing, money. No Worker APIs.

const CID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const CID_RE = /(?:^|[^a-z0-9])(ct[a-z2-7]{10})(?![a-z0-9])/i;

export function newClickId() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  let s = "ct";
  for (const x of b) s += CID_ALPHABET[x & 31];
  return s;
}

// Where each network carries the sub-ID, and the postback template with that network's macros.
// Macros differ per network; the click ID is also found by its format, so a wrong name still works.
export const NETWORKS = {
  clickbank: { name: "ClickBank", param: "tid", currency: "USD", query: "cid={tid}&amount={affiliate_earnings}&txid={order_id}" },
  buygoods: { name: "BuyGoods", param: "subid", currency: "USD", query: "cid={SUBID}&amount={COMMISSION_AMOUNT}&txid={ORDERID}&type={CONV_TYPE}&product={PRODUCT_CODENAME}" },
  digistore24: { name: "Digistore24", param: "cid", currency: "USD", query: "cid={cid}&amount={amount_affiliate}&txid={order_id}&currency={currency}&product={product_name}" },
  maxweb: { name: "MaxWeb", param: "subid", currency: "USD", query: "cid={SUBID}&amount={COMMISSION_AMOUNT}&txid={ORDERID}&product={PRODUCT_CODENAME}" },
  gurumedia: { name: "GuruMedia", param: "sub1", currency: "USD", query: "cid={sub1}&amount={payout_amount}&txid={transaction_id}&currency={offer_currency}&product={offer_name}" },
  smartadv: { name: "SmartADV", param: "sub1", currency: "USD", query: "cid={sub1}&amount={payout_amount}&txid={transaction_id}&currency={offer_currency}&product={offer_name}" },
  smashloud: { name: "SmashLoud", param: "sub1", currency: "USD", query: "cid={sub1}&amount={payout_amount}&txid={transaction_id}&currency={currency}&product={offer_name}" },
  clickadv: { name: "ClickADV", param: "sub1", currency: "USD", query: "cid={sub1}&amount={payout_amount}&txid={conversion_id}&currency={offer_currency}&product={offer_name}" },
  hotmart: { name: "Hotmart", param: "sck", currency: "BRL", json: true },
  kiwify: { name: "Kiwify", param: "sck", currency: "BRL", json: true },
  medisscalers: { name: "MedisScalers", param: "sub1", currency: "USD", query: "cid={sub1}&amount={payout_amount}&txid={transaction_id}&currency={offer_currency}&status={status}&product={offer_name}" },
  other: { name: "Outra rede", param: "sub1", currency: "USD", query: "cid=SUBID&amount=VALOR&txid=PEDIDO&product=PRODUTO", check: true },
};

export const SOURCES = {
  google: "Google Ads", newsbreak: "NewsBreak", youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok",
  facebook: "Facebook", email: "E-mail", whatsapp: "WhatsApp", organic: "Orgânico", other: "Outros",
};
// Fixed origin a tracked link can carry, for links that sit in organic places (video descriptions, bios).
export const LINK_SOURCES = ["ads", "youtube", "instagram", "tiktok", "facebook", "email", "whatsapp", "organic"];

export function cleanParam(raw) {
  const p = String(raw ?? "").trim();
  return /^[A-Za-z0-9_.-]{1,40}$/.test(p) ? p : "";
}

/** Read the ad's parameters on the short-link click. */
export function readClickParams(params) {
  const get = (...names) => {
    for (const n of names) {
      const v = params.get(n);
      if (v && !/^[{_]/.test(v)) return v.slice(0, 200); // an unfilled macro stays out
    }
    return null;
  };
  const gclid = get("gclid", "gbraid", "wbraid");
  let source = (get("src", "utm_source") || "").toLowerCase();
  if (gclid || source.startsWith("google")) source = "google";
  else if (source.includes("newsbreak") || params.get("nbcb")) source = "newsbreak";
  else if (SOURCES[source] && source !== "other") { /* youtube, instagram… typed in ?src= */ }
  else source = "other";
  return {
    source,
    campaign: get("cmp", "campaign_id", "utm_campaign", "campaign"),
    adset: get("adg", "adset", "adgroup"),
    ad: get("ad", "creative", "utm_content"),
    keyword: get("kw", "keyword", "utm_term"),
    gclid,
    nb_callback: get("nbcb"),
  };
}

const TRACK_KEYS = ["src", "cmp", "adg", "ad", "kw", "nbcb", "lp"];

/** Destination for a tracked click: optional Google {lpurl} on the same host, minus our keys, plus the click ID. */
export function trackedTarget(destination, search, subParam, cid) {
  const incoming = new URLSearchParams(search);
  let base = destination;
  const lp = incoming.get("lp");
  if (lp) {
    try {
      const a = new URL(lp);
      const d = new URL(destination);
      if (["http:", "https:"].includes(a.protocol) && a.hostname.toLowerCase() === d.hostname.toLowerCase()) base = a.toString();
    } catch { /* ignore a bad lp */ }
  }
  const u = new URL(base);
  for (const [k, v] of incoming) if (!TRACK_KEYS.includes(k) && !u.searchParams.has(k)) u.searchParams.append(k, v);
  if (subParam) u.searchParams.set(subParam, cid);
  return u.toString();
}

// ---------------------------------------------------------------- postbacks

export function normType(raw) {
  const t = String(raw ?? "").toLowerCase();
  if (!t) return "sale";
  if (/charge.?back|chargedback|dispute/.test(t)) return "chargeback";
  if (/refund|reembols|devol|cancel/.test(t)) return "refund";
  if (/upsell|upsale|bump|rebill|recurr|renov/.test(t)) return "upsell";
  return "sale";
}

export function toCents(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  let s = String(raw).trim().replace(/[^\d.,-]/g, "");
  if (!s || /^[{[]/.test(String(raw))) return null;
  // "1.234,56" or "1234,56" -> 1234.56 ; "1,234.56" -> 1234.56
  if (s.includes(",") && (!s.includes(".") || s.lastIndexOf(",") > s.lastIndexOf("."))) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function strings(obj, out = [], depth = 0) {
  if (depth > 8 || obj == null) return out;
  if (typeof obj === "string") out.push(obj);
  else if (typeof obj === "number") out.push(String(obj));
  else if (Array.isArray(obj)) obj.forEach((x) => strings(x, out, depth + 1));
  else if (typeof obj === "object") Object.values(obj).forEach((x) => strings(x, out, depth + 1));
  return out;
}

/** Every click ID-looking token anywhere in the request. */
export function findClickIds(fields, json) {
  const seen = new Set();
  for (const s of [...Object.values(fields), ...strings(json)]) {
    const m = String(s).match(new RegExp(CID_RE.source, "gi")) || [];
    for (const x of m) seen.add(x.replace(/^[^c]*/i, "").toLowerCase());
  }
  return [...seen];
}

const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = k.split(".").reduce((a, p) => (a == null ? a : a[p]), o);
    if (v != null && v !== "") return v;
  }
  return null;
};

/**
 * Turn a postback or webhook into a conversion.
 * Returns { ignore: reason } for events that are not a sale, refund or chargeback.
 */
export function parsePostback(network, fields, json) {
  const net = NETWORKS[network] || NETWORKS.other;
  const f = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v]));
  const ids = findClickIds(fields, json);

  if (network === "hotmart" && json) {
    const ev = String(json.event || "").toUpperCase();
    let type;
    if (/CHARGEBACK/.test(ev)) type = "chargeback";
    else if (/REFUND/.test(ev)) type = "refund";
    else if (/APPROVED|COMPLETE/.test(ev)) type = "sale";
    else return { ignore: `evento ${ev || "sem nome"}` };
    const d = json.data || {};
    const comms = Array.isArray(d.commissions) ? d.commissions : [];
    const mine = comms.find((x) => /AFFILIATE/i.test(x.source || "")) || comms.find((x) => /PRODUCER/i.test(x.source || ""));
    const amount = mine?.value ?? pick(d, "purchase.price.value", "purchase.full_price.value");
    return {
      ids, type, txid: String(pick(d, "purchase.transaction") || json.id || ""),
      amount_cents: toCents(amount),
      currency: String(mine?.currency_value || pick(d, "purchase.price.currency_value") || net.currency).toUpperCase().slice(0, 3),
      upsell: pick(d, "purchase.order_bump.is_order_bump") === true,
      product: cleanProduct(pick(d, "product.name", "product.id")),
    };
  }

  if (network === "kiwify" && json) {
    const st = String(json.order_status || json.webhook_event_type || "").toLowerCase();
    let type;
    if (/chargedback|chargeback/.test(st)) type = "chargeback";
    else if (/refund/.test(st)) type = "refund";
    else if (/paid|approved/.test(st)) type = "sale";
    else return { ignore: `status ${st || "sem nome"}` };
    const c = json.Commissions || json.commissions || {};
    const cents = c.my_commission ?? c.charge_amount ?? json.amount;
    return {
      ids, type, txid: String(json.order_id || json.order_ref || ""),
      amount_cents: cents == null ? null : Math.round(Number(cents)),
      currency: String(c.currency || c.product_base_price_currency || net.currency).toUpperCase().slice(0, 3),
      product: cleanProduct(pick(json, "Product.product_name", "product.name", "product_name")),
    };
  }

  const amount = pick(f, "amount", "payout", "commission", "commission_amount", "sum", "value", "revenue")
    ?? (json ? pick(json, "amount", "payout", "commission") : null);
  const txid = pick(f, "txid", "order_id", "orderid", "transaction_id", "transaction", "receipt", "order")
    ?? (json ? pick(json, "txid", "order_id", "transaction_id") : null);
  const typeRaw = pick(f, "type", "status", "event", "conv_type", "transaction_type") ?? (json ? pick(json, "type", "status", "event") : null);
  const tr = String(typeRaw || "");
  if (/abandon|lead|view|checkout/i.test(tr) && !/refund|charge/i.test(tr)) return { ignore: `tipo ${typeRaw}` };
  // A rejected or reversed conversion undoes a sale already counted; pending counts as a sale (approval repeats the order ID).
  const rejected = /declin|fail|reject|revers|invalid|denied|cancel/i.test(tr) && !/refund|charge/i.test(tr);
  return {
    ids, type: rejected ? "reject" : normType(typeRaw), txid: txid == null ? "" : String(txid).slice(0, 120),
    amount_cents: toCents(amount),
    currency: String(pick(f, "currency", "cur") || net.currency).replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3) || net.currency,
    product: cleanProduct(pick(f, "product", "product_name", "offer_name", "offer", "product_codename", "item", "sku")
      ?? (json ? pick(json, "product", "product_name", "offer_name") : null)),
  };
}

/** Product name as sent, or null when the network left the macro unfilled. */
export function cleanProduct(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || /^[{[%]|^\$\{/.test(s)) return null;
  return s.slice(0, 160);
}

// ---------------------------------------------------------------- money

export const CURRENCIES = ["BRL", "USD", "EUR"];

/** Rates: how many BRL one unit is worth. */
export function convert(cents, from, to, rates) {
  const r = { BRL: 1, USD: rates.usd_brl, EUR: rates.eur_brl };
  const a = r[from] ?? r.USD; // unknown currency: assume dollar, the networks' default
  const b = r[to] ?? 1;
  return Math.round((cents * a) / b);
}

export function fmtMoney(cents, currency) {
  const n = (cents || 0) / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n);
}

// ---------------------------------------------------------------- costs

/** Parse a CSV export (NewsBreak Ads Manager or any) into rows with date, campaign and spend. */
export function parseCostCsv(text) {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { error: "Cole o CSV com a linha de títulos e pelo menos uma linha." };
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const split = (line) => {
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const find = (re) => head.findIndex((h) => re.test(h));
  const iDate = find(/^(date|day|data|dia)\b|date/);
  const iCamp = find(/campaign\s*name|^campaign$|campanha/);
  const iCampId = find(/campaign\s*id/);
  const iCost = find(/spend|cost|gasto|custo|amount spent|valor/);
  const iClicks = find(/^clicks?$|cliques/);
  const iImpr = find(/impression|impress/);
  if (iDate < 0 || (iCamp < 0 && iCampId < 0) || iCost < 0) {
    return { error: "Não achei as colunas de data, campanha e gasto. Exporte o relatório por dia e por campanha." };
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    const c = split(line);
    const date = normDate(c[iDate]);
    const name = (iCamp >= 0 ? c[iCamp] : c[iCampId]) || "";
    const cost = toCents(c[iCost]);
    if (!date || !name || cost == null) continue;
    rows.push({
      date, campaign_key: name.slice(0, 200), campaign_name: name.slice(0, 200), cost_cents: cost,
      clicks: iClicks >= 0 ? Number(String(c[iClicks]).replace(/\D/g, "")) || 0 : 0,
      impressions: iImpr >= 0 ? Number(String(c[iImpr]).replace(/\D/g, "")) || 0 : 0,
    });
  }
  if (!rows.length) return { error: "Nenhuma linha com data, campanha e gasto válidos." };
  return { rows };
}

export function normDate(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // NewsBreak exports US dates; Brazilian sheets use dd/mm
  if (m) {
    let [, a, b, y] = m;
    let mm = a; let dd = b;
    if (Number(a) > 12) { dd = a; mm = b; }
    return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Google Ads script the owner pastes in Tools > Scripts. Runs hourly and posts the last 7 days of cost. */
export function googleAdsScript(endpoint) {
  return `// Manda o gasto por campanha para o cutti.us. Programe para rodar a cada hora.
var ENDPOINT = ${JSON.stringify(endpoint)};

function main() {
  var tz = AdsApp.currentAccount().getTimeZone();
  var today = new Date();
  var from = new Date(today.getTime() - 7 * 864e5);
  var fmt = function (d) { return Utilities.formatDate(d, tz, "yyyy-MM-dd"); };
  var q = "SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions " +
          "FROM campaign WHERE segments.date BETWEEN '" + fmt(from) + "' AND '" + fmt(today) + "'";
  var rows = [];
  var it = AdsApp.search(q);
  while (it.hasNext()) {
    var r = it.next();
    rows.push({
      date: r.segments.date,
      campaign_id: String(r.campaign.id),
      campaign_name: r.campaign.name,
      cost_micros: Number(r.metrics.costMicros || 0),
      clicks: Number(r.metrics.clicks || 0),
      impressions: Number(r.metrics.impressions || 0)
    });
  }
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify({ currency: AdsApp.currentAccount().getCurrencyCode(), rows: rows })
  });
  Logger.log(res.getResponseCode() + " " + res.getContentText());
}
`;
}

/** The presell script: passes the click ID from this page's address to the offer links. */
export const PRESELL_JS = `(function(){
  var s=document.currentScript, p=(s&&s.getAttribute("data-param"))||"", id=null;
  var q=new URLSearchParams(location.search);
  q.forEach(function(v){ if(!id&&/^ct[a-z2-7]{10}$/i.test(v)) id=v.toLowerCase(); });
  try{ if(id) sessionStorage.setItem("cutti_cid",id); else id=sessionStorage.getItem("cutti_cid"); }catch(e){}
  if(!id) return;
  function tag(a){
    try{
      var u=new URL(a.href, location.href);
      if(u.host===location.host||!/^https?:$/.test(u.protocol)) return;
      var name=a.getAttribute("data-param")||p;
      if(!name) return;
      u.searchParams.set(name,id); a.href=u.toString();
    }catch(e){}
  }
  function all(){ var l=document.getElementsByTagName("a"); for(var i=0;i<l.length;i++) tag(l[i]); }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",all); else all();
  document.addEventListener("click",function(e){ var a=e.target.closest&&e.target.closest("a"); if(a) tag(a); },true);
})();`;

// ---------------------------------------------------------------- notification text

export const TEMPLATE_DEFAULTS = {
  sale_title: "{emoji} {tipo}! {valor}",
  sale_body: "{produto} · {rede} · {origem} · {campanha}",
  refund_title: "{emoji} {tipo} {valor}",
  refund_body: "{produto} · {rede} · pedido {pedido}",
};

export const TEMPLATE_VARS = {
  emoji: "💰 nas vendas, ↩️ no reembolso, ⚠️ no chargeback",
  tipo: "Venda, Upsell, Reembolso ou Chargeback",
  valor: "valor na moeda da rede (US$ 87,50)",
  valor_painel: "valor convertido para a moeda do painel (R$ 472,50)",
  rede: "ClickBank, BuyGoods…",
  origem: "Google Ads ou NewsBreak",
  campanha: "nome da campanha",
  anuncio: "anúncio",
  palavra: "palavra-chave do Google",
  pedido: "número do pedido",
  produto: "nome do produto (ou da oferta) vendido",
  hoje: "vendas de hoje até agora (contando esta)",
  total_hoje: "faturamento de hoje no painel",
};

export const SAMPLE_VARS = {
  emoji: "💰", tipo: "Venda", valor: "US$ 87,50", valor_painel: "R$ 472,50", rede: "ClickBank", origem: "Google Ads",
  campanha: "Campanha exemplo", anuncio: "Anúncio 3", produto: "SodaPeak", palavra: "receita de bolo", pedido: "ABC123", hoje: "4", total_hoje: "R$ 1.890,00",
};

export function cleanTemplate(raw, fallback) {
  const t = String(raw ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  return t || fallback;
}

/** Fill {variables}; empty ones drop out together with their " · " separator. */
export function renderTemplate(tpl, vars) {
  const out = String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? "") : m));
  return out.split(/\s*·\s*/).map((x) => x.trim()).filter((x) => x && !/^(pedido|clique)$/i.test(x)).join(" · ").replace(/\s{2,}/g, " ").trim();
}
