// Sales tracker: public endpoints (postback, cost, scripts) and panel pages.
import * as T from "./tracker.js";
import { newId, randomToken, safeEqual } from "./security.js";
import { newVapidKeys, sendPush } from "./webpush.js";
import * as GA from "./googleads.js";
import { countryName } from "./core.js";

const flag = (cc) => (/^[A-Z]{2}$/.test(cc || "") ? String.fromCodePoint(...[...cc].map((ch) => 127397 + ch.charCodeAt(0))) : "");
import * as TV from "./tracker-views.js";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const SP_OFFSET_H = 3; // America/Sao_Paulo is UTC-3 all year

export async function getSettings(db) {
  const rows = (await db.prepare("select key, value from settings where key like 'tk_%'").all()).results;
  const s = Object.fromEntries(rows.map((r) => [r.key.slice(3), r.value]));
  if (!s.key) {
    await db.prepare("insert or ignore into settings (key, value) values ('tk_key', ?)").bind(randomToken(24)).run();
    s.key = (await db.prepare("select value from settings where key = 'tk_key'").first()).value;
  }
  if (!s.vapid_pub || !s.vapid_priv) {
    const k = await newVapidKeys();
    await db.batch([
      db.prepare("insert or ignore into settings (key, value) values ('tk_vapid_priv', ?)").bind(k.privateJwk),
      db.prepare("insert or ignore into settings (key, value) values ('tk_vapid_pub', ?)").bind(k.publicKey),
    ]);
    s.vapid_priv = (await db.prepare("select value from settings where key = 'tk_vapid_priv'").first()).value;
    s.vapid_pub = (await db.prepare("select value from settings where key = 'tk_vapid_pub'").first()).value;
  }
  return {
    key: s.key,
    vapid: { privateJwk: s.vapid_priv, publicKey: s.vapid_pub },
    currency: T.CURRENCIES.includes(s.currency) ? s.currency : "BRL",
    usd_brl: Number(s.usd_brl) > 0 ? Number(s.usd_brl) : 5.4,
    eur_brl: Number(s.eur_brl) > 0 ? Number(s.eur_brl) : 6.2,
    nb_postback: s.nb_postback || "",
    gads_conv_name: s.gads_conv_name || "Cutti - Venda",
    tg_token: s.tg_token || "",
    tg_chat: s.tg_chat || "",
    tg_name: s.tg_name || "",
    notify_refunds: s.notify_refunds !== "0",
    antibot: s.antibot !== "0",
    // The platforms shown on the dashboard; null until chosen (then the networks of tracked links are used).
    platforms: s.platforms == null ? null : s.platforms.split(",").filter((n) => T.NETWORKS[n] && n !== "other"),
    notify_muted: (s.notify_muted || "").split(",").filter(Boolean),
    rate_auto: s.rate_auto !== "0",
    rate_at: s.rate_at || "",
    rate_src: s.rate_src || "",
    rate_err: s.rate_err || "",
    awesome_token: s.awesome_token || "",
    gscript_at: s.gscript_at || "",
    email_on: s.email_on !== "0",
    templates: Object.fromEntries(Object.entries(T.TEMPLATE_DEFAULTS).map(([k, d]) => [k, s[`tpl_${k}`] || d])),
  };
}

// Quote sources, tried in order. Each returns { usd, eur } in reais, or throws.
// Live sources first; Banco Central (PTAX) publishes a few times a day; the last two once a day, as a fallback.
const getJson = async (fetcher, url) => {
  const r = await fetcher(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; cutti.us)", Accept: "application/json" }, signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const mdy = (d) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
const RATE_SOURCES = [
  ["AwesomeAPI", async (f, s) => {
    const j = await getJson(f, `https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL${s.awesome_token ? `?token=${encodeURIComponent(s.awesome_token)}` : ""}`);
    return { usd: Number(j?.USDBRL?.bid), eur: Number(j?.EURBRL?.bid) };
  }],
  ["Yahoo Finance", async (f) => {
    const px = async (sym) => Number((await getJson(f, `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`))?.chart?.result?.[0]?.meta?.regularMarketPrice);
    return { usd: await px("BRL=X"), eur: await px("EURBRL=X") };
  }],
  ["Banco Central (PTAX)", async (f) => {
    const to = new Date();
    const from = new Date(Date.now() - 7 * 864e5);
    const last = async (cur) => {
      const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='${cur}'&@dataInicial='${mdy(from)}'&@dataFinalCotacao='${mdy(to)}'&$format=json`;
      const v = (await getJson(f, url))?.value || [];
      v.sort((a, b) => String(a.dataHoraCotacao).localeCompare(String(b.dataHoraCotacao)));
      const x = v[v.length - 1];
      return x ? (Number(x.cotacaoCompra) + Number(x.cotacaoVenda)) / 2 : NaN;
    };
    return { usd: await last("USD"), eur: await last("EUR") };
  }],
  ["ExchangeRate-API (diária)", async (f) => {
    const j = await getJson(f, "https://open.er-api.com/v6/latest/USD");
    return { usd: Number(j?.rates?.BRL), eur: Number(j?.rates?.BRL) / Number(j?.rates?.EUR) };
  }],
  ["Frankfurter (diária)", async (f) => {
    const j = await getJson(f, "https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL,EUR");
    return { usd: Number(j?.rates?.BRL), eur: Number(j?.rates?.BRL) / Number(j?.rates?.EUR) };
  }],
];
const okRate = (x) => x > 1 && x < 50;

/** Today's dollar and euro in reais, from free quote services (no key). Refreshed at most every hour. */
let ratesFailedAt = 0;
export async function freshRates(c, s, { force = false } = {}) {
  if (!s.rate_auto) return s;
  if (!force && Date.now() - ratesFailedAt < 10 * 60e3) return s; // all sources were down a moment ago
  if (!force && s.rate_at && Date.now() - Date.parse(s.rate_at) < 15 * 60e3) return s;
  const fetcher = c.env.__ratesFetch || fetch;
  const errors = [];
  for (const [name, read] of RATE_SOURCES) {
    try {
      const { usd, eur } = await read(fetcher, s);
      if (!okRate(usd) || !okRate(eur)) throw new Error("valor fora do esperado");
      const at = new Date().toISOString();
      await c.db.batch([["usd_brl", usd.toFixed(4)], ["eur_brl", eur.toFixed(4)], ["rate_at", at], ["rate_src", name], ["rate_err", errors.join("; ")]]
        .map(([k, v]) => settingStmt(c.db, k, v)));
      return { ...s, usd_brl: usd, eur_brl: eur, rate_at: at, rate_src: name, rate_err: errors.join("; ") };
    } catch (e) {
      errors.push(`${name}: ${e?.name === "TimeoutError" ? "demorou" : e?.message || e}`);
      console.error("cotação", name, e?.message || e);
    }
  }
  ratesFailedAt = Date.now();
  await setSetting(c.db, "rate_err", errors.join("; "));
  return { ...s, rate_err: errors.join("; ") };
}

const settingStmt = (db, key, value) =>
  db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").bind(`tk_${key}`, String(value));
export async function setSetting(db, key, value) {
  await settingStmt(db, key, value).run();
}

/** Pages never wait for the quote: they show the last one and refresh it in the background for the next visit. */
export function ratesLater(c, s) {
  if (c.exec?.waitUntil) c.exec.waitUntil(freshRates(c, s).catch((e) => console.error("cotação", e)));
  return s;
}

// ---------------------------------------------------------------- the click

/** Called from the short-link redirect for links with tracking on. Returns the target with the click ID. */
export function trackClick(c, link, { country, device }) {
  const cid = T.newClickId();
  const p = T.readClickParams(c.url.searchParams);
  // Organic link: the origin is fixed on the link, and the link's name tells which video or post it is.
  if (link.track_source && link.track_source !== "ads") p.source = link.track_source;
  if (!p.campaign) p.campaign = (link.title || link.slashtag || "").slice(0, 200);
  const target = T.trackedTarget(link.destination, c.url.search, link.sub_param, cid);
  const write = c.db.prepare(
    "insert into tk_clicks (id, link_id, at, source, campaign, adset, ad, keyword, gclid, nb_callback, country, device) values (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(cid, link.id, nowIso(), p.source, p.campaign, p.adset, p.ad, p.keyword, p.gclid, p.nb_callback, country, device);
  return { target, write };
}

// ---------------------------------------------------------------- public endpoints

async function checkKey(c, key) {
  const s = await getSettings(c.db);
  return safeEqual(String(key || ""), s.key) ? s : null;
}

const text = (body, status = 200, type = "text/plain; charset=utf-8") =>
  new Response(body, { status, headers: { "Content-Type": type, "Cache-Control": "no-store" } });

async function logEvent(db, network, outcome, detail, raw) {
  await db.prepare("insert into tk_events (at, network, outcome, detail, raw) values (?,?,?,?,?)")
    .bind(nowIso(), network, outcome, detail, String(raw || "").slice(0, 3000)).run();
  if (Math.random() < 0.05) await db.prepare("delete from tk_events where id <= (select max(id) - 300 from tk_events)").run();
}

export async function postback(c, key, network) {
  const s = await checkKey(c, key);
  if (!s) return text("chave inválida", 403);
  if (network === "mediascalers") network = "medisscalers"; // the right spelling also works
  network = T.NETWORKS[network] ? network : "other";
  const fields = Object.fromEntries(c.url.searchParams);
  let json = null;
  let body = "";
  if (!["GET", "HEAD"].includes(c.req.method)) {
    body = (await c.req.text()).slice(0, 200000);
    const ct = c.req.headers.get("Content-Type") || "";
    if (/json/.test(ct) || /^\s*[{[]/.test(body)) {
      try { json = JSON.parse(body); } catch { /* not JSON */ }
    } else if (body) {
      for (const [k, v] of new URLSearchParams(body)) if (!(k in fields)) fields[k] = v;
    }
  }
  const raw = c.url.search + (body ? `\n${body}` : "");
  const p = T.parsePostback(network, fields, json);
  if (p.ignore) {
    await logEvent(c.db, network, "ignorado", p.ignore, raw);
    return text("ok (ignorado)");
  }
  let click = null;
  for (const id of p.ids) {
    click = await c.db.prepare("select * from tk_clicks where id = ?").bind(id).first();
    if (click) break;
  }
  if (p.type === "reject") {
    const orig = p.txid && await c.db.prepare("select 1 from tk_conversions where network = ? and txid = ? and type in ('sale','upsell')").bind(network, p.txid).first();
    if (!orig) {
      await logEvent(c.db, network, "ignorado", `conversão recusada${p.txid ? ` (pedido ${p.txid})` : ""} sem venda anterior`, raw);
      return text("ok (ignorado)");
    }
    p.type = "refund";
    p.amount_cents = null;
  }
  if (p.type !== "sale" && p.type !== "upsell" && p.amount_cents == null && p.txid) {
    const orig = await c.db.prepare("select amount_cents, currency from tk_conversions where network = ? and txid = ? and type in ('sale','upsell')")
      .bind(network, p.txid).first();
    if (orig) { p.amount_cents = orig.amount_cents; p.currency = orig.currency; }
  }
  if (!p.product && p.txid && p.type !== "sale" && p.type !== "upsell") {
    const orig = await c.db.prepare("select product from tk_conversions where network = ? and txid = ? and product is not null limit 1").bind(network, p.txid).first();
    if (orig) p.product = orig.product;
  }
  if (p.type === "sale" && p.upsell) p.type = "upsell";
  const txid = p.txid || (click ? `${click.id}` : `sem-id-${randomToken(6)}`);
  const convId = randomToken(12);
  const res = await c.db.prepare(
    "insert or ignore into tk_conversions (id, click_id, network, txid, type, amount_cents, currency, at, product, country) values (?,?,?,?,?,?,?,?,?,?)",
  ).bind(convId, click?.id || null, network, txid, p.type, Math.abs(p.amount_cents || 0), p.currency || "USD", nowIso(), p.product || null, p.country || null).run();
  const dup = !res.meta?.changes;
  if (!dup) {
    c.exec.waitUntil(GA.onConversion(c, { id: convId, type: p.type, txid: p.txid, network, gclid: click?.gclid }));
  }
  const outcome = dup ? "repetido" : click ? "ok" : "sem clique";
  const label = { sale: "venda", upsell: "upsell", refund: "reembolso", chargeback: "chargeback" }[p.type];
  await logEvent(c.db, network, outcome,
    `${label} ${T.fmtMoney(p.amount_cents || 0, p.currency || "USD")}${p.product ? ` · ${p.product}` : ""}${p.txid ? ` · pedido ${p.txid}` : ""}${click ? ` · clique ${click.id}` : p.ids.length ? ` · click ID ${p.ids[0]} não encontrado` : " · sem click ID"}`,
    raw);

  // Phone notification.
  if (!dup && !s.notify_muted.includes(network) && (p.type === "sale" || p.type === "upsell" || s.notify_refunds)) {
    c.exec.waitUntil(saleMessage(c.db, s, network, p, click).then((m) => notify(c.db, s, m, c.env.__notifyFetch || fetch, { email: c.env.EMAIL, emailTo: c.env.EMAIL_TO, panel: `https://${c.panelHost()}` }))
      .then((r) => (r.errors.length ? logEvent(c.db, "avisos", "falha", r.errors.join("; "), "") : null))
      .catch((e) => console.error("notify", e)));
  }

  // Tell NewsBreak about the sale, so its algorithm learns from it.
  if (!dup && click?.nb_callback && s.nb_postback && (p.type === "sale" || p.type === "upsell")) {
    const value = (T.convert(p.amount_cents || 0, p.currency, "USD", s) / 100).toFixed(2);
    const url = s.nb_postback.replaceAll("{clickid}", encodeURIComponent(click.nb_callback)).replaceAll("{value}", value);
    if (/^https:\/\//.test(url)) c.exec.waitUntil(fetch(url).catch((e) => console.error("newsbreak postback", e)));
  }
  return text(dup ? "ok (repetido)" : "ok");
}

// ---------------------------------------------------------------- phone notifications

async function saleMessage(db, s, network, p, click) {
  const refund = p.type === "refund" || p.type === "chargeback";
  let campanha = click?.campaign || "";
  if (campanha) {
    const r = await db.prepare("select campaign_name from tk_costs where source = ? and campaign_key = ? and campaign_name is not null limit 1")
      .bind(click.source, campanha).first();
    if (r?.campaign_name) campanha = r.campaign_name;
  }
  const today = utcStart(spToday());
  const rows = (await db.prepare("select type, currency, sum(amount_cents) as cents, count(*) as n from tk_conversions where at >= ? group by type, currency")
    .bind(today).all()).results;
  let hoje = 0;
  let total = 0;
  for (const r of rows) {
    if (r.type === "sale" || r.type === "upsell") hoje += r.n;
    total += sumRev(r.type, T.convert(r.cents, r.currency, s.currency, s));
  }
  const vars = {
    emoji: { sale: "💰", upsell: "💰", refund: "↩️", chargeback: "⚠️" }[p.type],
    tipo: { sale: "Venda", upsell: "Upsell", refund: "Reembolso", chargeback: "Chargeback" }[p.type],
    valor: T.fmtMoney(p.amount_cents || 0, p.currency || "USD"),
    valor_painel: T.fmtMoney(T.convert(p.amount_cents || 0, p.currency || "USD", s.currency, s), s.currency),
    rede: T.NETWORKS[network]?.name || network,
    origem: click ? (T.SOURCES[click.source] || click.source) : "sem clique rastreado",
    campanha, anuncio: click?.ad || "", palavra: click?.keyword || "", pedido: p.txid || "", produto: p.product || "",
    hoje: String(hoje), total_hoje: T.fmtMoney(total, s.currency),
    pais: (() => {
      const cc = T.cleanCountry(click?.country) || p.country;
      return cc ? `${flag(cc)} ${countryName(cc)}` : "";
    })(),
  };
  return messageFrom(s, vars, refund);
}

function messageFrom(s, vars, refund) {
  const t = s.templates;
  return {
    title: T.renderTemplate(refund ? t.refund_title : t.sale_title, vars) || "Cutti",
    body: T.renderTemplate(refund ? t.refund_body : t.sale_body, vars),
    refund, vars,
  };
}

/** Send to every channel that is set up. Returns a list of errors (empty when all went out). */
export async function notify(db, s, m, fetcher = fetch, { email = null, panel = "", emailTo = "" } = {}) {
  const jobs = [];
  if (s.email_on && email) jobs.push(sendSaleEmail(email, m, panel, emailTo).then(() => null).catch((e) => String(e?.message || e).slice(0, 300)));
  const subs = (await db.prepare("select * from push_subs").all()).results;
  if (subs.length) {
    const owner = await db.prepare("select email from users limit 1").first();
    const subject = `mailto:${owner?.email || "dono@cutti.us"}`;
    for (const sub of subs) {
      jobs.push(sendPush(sub, { title: m.title, body: m.body, url: "/sales" }, s.vapid, subject, fetcher).then(async (st) => {
        if (st === 404 || st === 410) {
          await db.prepare("delete from push_subs where id = ?").bind(sub.id).run();
          return `${sub.label || "aparelho"} saiu (removido)`;
        }
        if (st >= 200 && st < 300) {
          await db.prepare("update push_subs set last_ok_at = ? where id = ?").bind(nowIso(), sub.id).run();
          return null;
        }
        return `${sub.label || "aparelho"} respondeu ${st}`;
      }));
    }
  }

  if (s.tg_token && s.tg_chat) {
    jobs.push(fetcher(`https://api.telegram.org/bot${s.tg_token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: s.tg_chat, text: `${m.title}\n${m.body}` }),
    }).then((r) => (r.ok ? null : `Telegram respondeu ${r.status}`)));
  }
  const out = await Promise.all(jobs.map((j) => j.catch((e) => `falha de conexão (${e?.name || "erro"})`)));
  return { sent: jobs.length, errors: out.filter(Boolean) };
}

// E-mail through Cloudflare Email Routing (free to a verified address). EMAIL_FROM must be on the panel's domain.
const escHtml = (x) => String(x ?? "").replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
export function saleEmail(m, panel) {
  const v = m.vars || {};
  const rows = [
    ["Produto", v.produto], ["Valor", v.valor], ["Em reais", v.valor_painel], ["Rede", v.rede], ["País", v.pais], ["Origem", v.origem],
    ["Campanha", v.campanha], ["Anúncio", v.anuncio], ["Pedido", v.pedido], ["Vendas hoje", v.hoje], ["Faturamento hoje", v.total_hoje],
  ].filter(([, x]) => x);
  const text = `${m.title}\n${m.body}\n\n${rows.map(([k, x]) => `${k}: ${x}`).join("\n")}\n\nVer no Cutti: ${panel}/sales`;
  const html = `<!doctype html><html><body style="margin:0;background:#f2f5fa;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0a0a0a">
<div style="max-width:480px;margin:0 auto;padding:24px 16px">
<div style="background:linear-gradient(135deg,#0447a8,#02235b);color:#fff;border-radius:16px;padding:20px 22px">
<div style="font-size:14px;opacity:.9">${escHtml(m.refund ? "Reembolso" : "Nova venda")}</div>
<div style="font-size:26px;font-weight:700;margin-top:4px">${escHtml(m.title)}</div>
<div style="font-size:14px;opacity:.9;margin-top:6px">${escHtml(m.body)}</div></div>
<table style="width:100%;margin-top:16px;background:#fff;border-radius:14px;border-collapse:separate;border-spacing:0;font-size:15px">
${rows.map(([k, x], i) => `<tr><td style="padding:12px 16px;color:#5b5b63;${i ? "border-top:1px solid #e0e6ef;" : ""}">${escHtml(k)}</td><td style="padding:12px 16px;text-align:right;font-weight:600;${i ? "border-top:1px solid #e0e6ef;" : ""}">${escHtml(x)}</td></tr>`).join("")}
</table>
<p style="text-align:center;margin:20px 0"><a href="${escHtml(panel)}/sales" style="display:inline-block;background:#062a6b;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">Ver no Cutti</a></p>
</div></body></html>`;
  return { text, html };
}

const b64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const wrap76 = (x) => x.replace(/.{1,76}/g, "$&\r\n");

/** A plain RFC 5322 message (multipart text + html), for the raw EmailMessage API. */
export function rawEmail({ from, fromName, to, subject, text, html, domain }) {
  const boundary = `cutti-${crypto.randomUUID()}`;
  return [
    `From: =?UTF-8?B?${b64(fromName)}?= <${from}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function sendSaleEmail(binding, m, panel, to) {
  const { text, html } = saleEmail(m, panel);
  const domain = new URL(panel).hostname.replace(/^app\./, "");
  const from = `vendas@${domain}`;
  let first;
  try {
    await binding.send({ from: { email: from, name: "Cutti" }, to, subject: m.title, text, html });
    return;
  } catch (e) {
    first = e;
  }
  // Older runtimes or Email Routing alone: send the raw message.
  try {
    const { EmailMessage } = await import("cloudflare:email");
    await binding.send(new EmailMessage(from, to, rawEmail({ from, fromName: "Cutti", to, subject: m.title, text, html, domain })));
  } catch (e) {
    throw new Error(`e-mail: ${first?.code || ""} ${first?.message || first} / ${e?.code || ""} ${e?.message || e}`.trim());
  }
}

async function telegramConnect(c, token) {
  if (!/^\d{5,15}:[\w-]{30,60}$/.test(token)) return "Esse não parece um token do BotFather (formato 123456789:ABC…).";
  const api = (m) => fetch(`https://api.telegram.org/bot${token}/${m}`).then((r) => r.json()).catch(() => null);
  const me = await api("getMe");
  if (!me?.ok) return "O Telegram não aceitou esse token. Copie de novo no @BotFather.";
  await setSetting(c.db, "tg_token", token);
  await setSetting(c.db, "tg_name", me.result.username || "");
  const up = await api("getUpdates?limit=50");
  const msgs = (up?.result || []).map((u) => u.message || u.my_chat_member).filter((x) => x?.chat?.id);
  const chat = msgs.length ? msgs[msgs.length - 1].chat.id : null;
  if (!chat) return `Bot @${me.result.username} salvo. Agora abra o Telegram, mande /start para ele e clique em Conectar de novo.`;
  await setSetting(c.db, "tg_chat", String(chat));
  return null;
}

export async function googleCost(c, key) {
  const s = await checkKey(c, key);
  if (!s) return text("chave inválida", 403);
  if (c.req.method !== "POST") return text("use POST", 405);
  let data;
  try { data = JSON.parse(await c.req.text()); } catch { return text("JSON inválido", 400); }
  const currency = T.CURRENCIES.includes(String(data.currency).toUpperCase()) ? String(data.currency).toUpperCase() : "BRL";
  const rows = Array.isArray(data.rows) ? data.rows.slice(0, 5000) : [];
  const ts = nowIso();
  const stmts = [];
  let costRows = 0;
  for (const r of rows) {
    const date = T.normDate(r.date);
    if (!date || !r.campaign_id) continue;
    costRows++;
    stmts.push(costUpsert(c.db, {
      date, source: "google", campaign_key: String(r.campaign_id).slice(0, 60), campaign_name: String(r.campaign_name || "").slice(0, 200),
      cost_cents: Math.round(Number(r.cost_micros || 0) / 10000), currency,
      clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0,
    }, ts));
  }
  // Age and gender (script v3).
  const demo = Array.isArray(data.demo) ? data.demo.slice(0, 20000) : [];
  for (const r of demo) {
    const date = T.normDate(r.date);
    const dim = r.dim === "age" ? "age" : r.dim === "gender" ? "gender" : "";
    const bucket = String(r.bucket || "").slice(0, 40);
    if (!date || !dim || !bucket || !r.campaign_id) continue;
    stmts.push(c.db.prepare(
      `insert into tk_demo (date, campaign_key, dim, bucket, cost_cents, currency, clicks, impressions, conversions, updated_at) values (?,?,?,?,?,?,?,?,?,?)
       on conflict (date, campaign_key, dim, bucket) do update set cost_cents = excluded.cost_cents, currency = excluded.currency,
       clicks = excluded.clicks, impressions = excluded.impressions, conversions = excluded.conversions, updated_at = excluded.updated_at`,
    ).bind(date, String(r.campaign_id).slice(0, 60), dim, bucket, Math.round(Number(r.cost_micros || 0) / 10000), currency,
      Number(r.clicks) || 0, Number(r.impressions) || 0, Number(r.conversions) || 0, ts));
  }
  for (let i = 0; i < stmts.length; i += 50) await c.db.batch(stmts.slice(i, i + 50));
  await setSetting(c.db, "gscript_at", ts);
  if (!data.want_conversions) {
    await logEvent(c.db, "google-ads", "ok", `gasto: ${costRows} linha(s), público: ${demo.length}`, "");
    return text(`ok ${costRows}`);
  }
  // Script v2: hand back the sales with a gclid that Google has not received yet; the script uploads them.
  const since = new Date(Date.now() - 89 * 864e5).toISOString();
  const pending = (await c.db.prepare(
    `select v.id, v.at, v.amount_cents, v.currency, k.gclid from tk_conversions v join tk_clicks k on k.id = v.click_id
     where k.gclid is not null and v.type in ('sale','upsell') and v.gads_sent_at is null and v.at >= ? order by v.at limit 500`,
  ).bind(since).all()).results;
  const conversions = pending.map((r) => ({
    id: r.id, gclid: r.gclid,
    time: new Date(Date.parse(r.at) - SP_OFFSET_H * 36e5).toISOString().replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2}).*$/, "$2/$3/$1 $4"),
    value: (r.amount_cents / 100).toFixed(2), currency: r.currency,
  }));
  await logEvent(c.db, "google-ads", "ok", `script: gasto ${costRows} linha(s), público ${demo.length}, ${conversions.length} venda(s) para enviar`, "");
  return new Response(JSON.stringify({ ok: true, costs: costRows, conversion_name: s.gads_conv_name, conversions }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Script v2 confirms which sales it uploaded. */
export async function googleAck(c, key) {
  const s = await checkKey(c, key);
  if (!s) return text("chave inválida", 403);
  let data;
  try { data = JSON.parse(await c.req.text()); } catch { return text("JSON inválido", 400); }
  const ids = (Array.isArray(data.ids) ? data.ids : []).map(String).filter((x) => /^[\w-]{6,40}$/.test(x)).slice(0, 500);
  const ts = nowIso();
  if (ids.length) await c.db.batch(ids.map((id) => c.db.prepare("update tk_conversions set gads_sent_at = ?, gads_error = null where id = ? and gads_sent_at is null").bind(ts, id)));
  if (data.error) await logEvent(c.db, "google-ads", "falha", `script: ${String(data.error).slice(0, 300)}`, "");
  else if (ids.length) await logEvent(c.db, "google-ads", "ok", `script: ${ids.length} venda(s) enviada(s) ao Google`, "");
  return text(`ok ${ids.length}`);
}

function costUpsert(db, r, ts) {
  return db.prepare(
    `insert into tk_costs (date, source, campaign_key, campaign_name, cost_cents, currency, clicks, impressions, updated_at)
     values (?,?,?,?,?,?,?,?,?) on conflict(date, source, campaign_key) do update set
     campaign_name = excluded.campaign_name, cost_cents = excluded.cost_cents, currency = excluded.currency,
     clicks = excluded.clicks, impressions = excluded.impressions, updated_at = excluded.updated_at`,
  ).bind(r.date, r.source, r.campaign_key, r.campaign_name, r.cost_cents, r.currency, r.clicks || 0, r.impressions || 0, ts);
}

export async function googleConversionsCsv(c, key) {
  const s = await checkKey(c, key);
  if (!s) return text("chave inválida", 403);
  const since = new Date(Date.now() - 89 * 864e5).toISOString();
  const rows = (await c.db.prepare(
    `select k.gclid, v.at, v.amount_cents, v.currency from tk_conversions v join tk_clicks k on k.id = v.click_id
     where k.gclid is not null and v.type in ('sale','upsell') and v.at >= ? order by v.at`,
  ).bind(since).all()).results;
  const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
  const lines = ["Parameters:TimeZone=America/Sao_Paulo", "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency"];
  for (const r of rows) {
    const local = new Date(new Date(r.at).getTime() - SP_OFFSET_H * 36e5).toISOString().slice(0, 19).replace("T", " ");
    lines.push([q(r.gclid), q(s.gads_conv_name), local, (r.amount_cents / 100).toFixed(2), r.currency].join(","));
  }
  return text(lines.join("\n") + "\n", 200, "text/csv; charset=utf-8");
}

export function presellScript() {
  return new Response(T.PRESELL_JS, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}

// ---------------------------------------------------------------- ranges

function spToday() {
  return new Date(Date.now() - SP_OFFSET_H * 36e5).toISOString().slice(0, 10);
}
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const utcStart = (d) => `${d}T0${SP_OFFSET_H}:00:00Z`;

export function readRange(params) {
  const today = spToday();
  const preset = params.get("p") || "7d";
  let from;
  let to = today;
  if (preset === "today") from = today;
  else if (preset === "yesterday") { from = addDays(today, -1); to = from; }
  else if (preset === "30d") from = addDays(today, -29);
  else if (preset === "month") from = `${today.slice(0, 8)}01`;
  else if (preset === "custom") {
    from = T.normDate(params.get("from")) || addDays(today, -6);
    to = T.normDate(params.get("to")) || today;
    if (to < from) [from, to] = [to, from];
  } else from = addDays(today, -6);
  return { preset: ["today", "yesterday", "7d", "30d", "month", "custom"].includes(preset) ? preset : "7d", from, to, start: utcStart(from), end: utcStart(addDays(to, 1)) };
}

// ---------------------------------------------------------------- panel pages

const sumRev = (type, cents) => (type === "refund" || type === "chargeback" ? -cents : cents);

export async function resultsPage(c) {
  const force = c.url.searchParams.get("refresh") === "1";
  const s0 = await getSettings(c.db);
  const s = force ? await freshRates(c, s0, { force }) : ratesLater(c, s0);
  const range = readRange(c.url.searchParams);
  const byAd = c.url.searchParams.get("by") === "ad";
  const srcFilter = c.url.searchParams.get("source") || "";
  const netFilter = T.NETWORKS[c.url.searchParams.get("network")] ? c.url.searchParams.get("network") : "";
  const prodFilter = String(c.url.searchParams.get("product") || "").slice(0, 160);
  // Network and product narrow the sales; clicks follow the link's network; ad cost is per campaign and is not split.
  const vSql = `${netFilter ? " and v.network = ?" : ""}${prodFilter ? " and v.product = ?" : ""}`;
  const vArgs = [...(netFilter ? [netFilter] : []), ...(prodFilter ? [prodFilter] : [])];
  const db = c.db;
  const adCol = byAd ? ", coalesce(ad, '') as ad" : ", '' as ad";
  const adGroup = byAd ? ", ad" : "";
  const srcSql = srcFilter ? " and coalesce(k.source, 'none') = ?" : "";
  // Every query goes to the database in one round trip (it is far away, so each trip costs).
  const [clicks, convs, costs, nameRows, dRows, cRows, hasAnyRows, netRows, linkNets, pRows, prodNameRows, srcRows, demoRows] = (await db.batch([
    db.prepare(
    `select source, coalesce(campaign, '') as campaign${adCol}, count(*) as n from tk_clicks
     where at >= ? and at < ?${netFilter ? " and link_id in (select id from links where network = ?)" : ""} group by source, campaign${adGroup}`,
  ).bind(range.start, range.end, ...(netFilter ? [netFilter] : [])),
    db.prepare(
    `select coalesce(k.source, 'none') as source, coalesce(k.campaign, '') as campaign${byAd ? ", coalesce(k.ad, '') as ad" : ", '' as ad"},
            v.type, v.currency, sum(v.amount_cents) as cents, count(*) as n
     from tk_conversions v left join tk_clicks k on k.id = v.click_id
     where v.at >= ? and v.at < ?${vSql} group by 1, 2, 3, v.type, v.currency`,
  ).bind(range.start, range.end, ...vArgs),
    db.prepare(
    "select source, campaign_key as campaign, currency, sum(cost_cents) as cents, sum(clicks) as clicks from tk_costs where date >= ? and date <= ? group by source, campaign_key, currency",
  ).bind(range.from, range.to),
    db.prepare("select source || '|' || campaign_key as k, max(campaign_name) as name from tk_costs group by source, campaign_key"),
    db.prepare(
    `select substr(datetime(v.at, '-${SP_OFFSET_H} hours'), 1, 10) as d, v.type, v.currency, sum(v.amount_cents) as cents
     from tk_conversions v left join tk_clicks k on k.id = v.click_id where v.at >= ? and v.at < ?${srcSql}${vSql} group by 1, 2, 3`,
    ).bind(range.start, range.end, ...(srcFilter ? [srcFilter] : []), ...vArgs),
    db.prepare(
    `select date as d, currency, sum(cost_cents) as cents from tk_costs where date >= ? and date <= ?${srcFilter ? " and source = ?" : ""} group by 1, 2`,
    ).bind(range.from, range.to, ...(srcFilter ? [srcFilter] : [])),
    db.prepare("select (select count(*) from tk_clicks) + (select count(*) from tk_conversions) + (select count(*) from tk_costs) as n"),
    db.prepare(
    `select v.network, v.type, v.currency, sum(v.amount_cents) as cents, count(*) as n
     from tk_conversions v left join tk_clicks k on k.id = v.click_id
     where v.at >= ? and v.at < ?${srcSql}${vSql} group by v.network, v.type, v.currency`,
    ).bind(range.start, range.end, ...(srcFilter ? [srcFilter] : []), ...vArgs),
    db.prepare("select distinct network from links where track = 1 and network is not null"),
    db.prepare(
    `select coalesce(v.product, '') as product, v.type, v.currency, sum(v.amount_cents) as cents, count(*) as n
     from tk_conversions v left join tk_clicks k on k.id = v.click_id
     where v.at >= ? and v.at < ?${srcSql}${vSql} group by 1, v.type, v.currency`,
    ).bind(range.start, range.end, ...(srcFilter ? [srcFilter] : []), ...vArgs),
    db.prepare("select distinct product from tk_conversions where product is not null order by product limit 200"),
    db.prepare("select distinct source from tk_clicks"),
    db.prepare(
      "select dim, bucket, currency, sum(cost_cents) as cents, sum(clicks) as clicks, sum(conversions) as conv from tk_demo where date >= ? and date <= ? group by dim, bucket, currency",
    ).bind(range.from, range.to),
  ])).map((r) => r.results || []);
  const audience = { age: new Map(), gender: new Map() };
  if (!srcFilter || srcFilter === "google") {
    for (const r of demoRows) {
      const mp = audience[r.dim];
      if (!mp) continue;
      const x = mp.get(r.bucket) || { bucket: r.bucket, cost: 0, clicks: 0, conv: 0 };
      x.cost += T.convert(r.cents || 0, r.currency, s.currency, s); x.clicks += r.clicks; x.conv += r.conv;
      mp.set(r.bucket, x);
    }
  }
  const names = Object.fromEntries(nameRows.map((r) => [r.k, r.name]));

  const rows = new Map();
  const row = (source, campaign, ad) => {
    const k = `${source}|${campaign}|${ad}`;
    if (!rows.has(k)) {
      rows.set(k, {
        source, campaign, ad, name: names[`${source}|${campaign}`] || campaign,
        clicks: 0, sales: 0, refunds: 0, revenue: 0, cost: byAd ? null : 0,
      });
    }
    return rows.get(k);
  };
  const conv = (cents, cur) => T.convert(cents || 0, cur, s.currency, s);
  for (const r of clicks) row(r.source, r.campaign, r.ad).clicks += r.n;
  for (const r of convs) {
    const x = row(r.source, r.campaign, r.ad);
    if (r.type === "sale" || r.type === "upsell") x.sales += r.n; else x.refunds += r.n;
    x.revenue += sumRev(r.type, conv(r.cents, r.currency));
  }
  let costTotal = 0;
  for (const r of costs) {
    const v = conv(r.cents, r.currency);
    costTotal += srcFilter && srcFilter !== r.source ? 0 : v;
    if (!byAd) row(r.source, r.campaign, "").cost += v;
  }
  let list = [...rows.values()];
  if (srcFilter) list = list.filter((r) => r.source === srcFilter);
  for (const r of list) {
    r.profit = r.revenue - (r.cost || 0);
    r.roas = r.cost ? r.revenue / r.cost : null;
    r.cpa = r.cost && r.sales ? Math.round(r.cost / r.sales) : null;
  }
  list.sort((a, b) => b.revenue - a.revenue || (b.cost || 0) - (a.cost || 0) || b.clicks - a.clicks);
  const tot = list.reduce((t, r) => ({
    clicks: t.clicks + r.clicks, sales: t.sales + r.sales, refunds: t.refunds + r.refunds, revenue: t.revenue + r.revenue,
  }), { clicks: 0, sales: 0, refunds: 0, revenue: 0 });
  tot.cost = costTotal;
  tot.trackedSales = list.filter((r) => r.source !== "none").reduce((a, r) => a + r.sales, 0);
  tot.profit = tot.revenue - tot.cost;
  tot.roas = tot.cost ? tot.revenue / tot.cost : null;
  tot.cpa = tot.cost && tot.sales ? Math.round(tot.cost / tot.sales) : null;

  // per day, for the chart
  const days = [];
  for (let d = range.from; d <= range.to && days.length < 92; d = addDays(d, 1)) days.push(d);
  const dayRev = Object.fromEntries(days.map((d) => [d, 0]));
  const dayCost = Object.fromEntries(days.map((d) => [d, 0]));
  for (const r of dRows) if (r.d in dayRev) dayRev[r.d] += sumRev(r.type, conv(r.cents, r.currency));
  for (const r of cRows) if (r.d in dayCost) dayCost[r.d] += conv(r.cents, r.currency);
  const series = days.map((d) => ({ d, rev: dayRev[d], cost: dayCost[d] }));

  const hasAny = hasAnyRows[0]?.n || 0;
  // Per network, for the cards: networks of tracked links plus any that sent a sale in the period.
  const nets = new Map();
  for (const k of s.platforms ?? linkNets.map((r) => r.network)) {
    nets.set(k, { network: k, revenue: 0, sales: 0, refunds: 0 });
  }
  for (const r of netRows) {
    if (!nets.has(r.network)) nets.set(r.network, { network: r.network, revenue: 0, sales: 0, refunds: 0 });
    const x = nets.get(r.network);
    if (r.type === "sale" || r.type === "upsell") x.sales += r.n; else x.refunds += r.n;
    x.revenue += sumRev(r.type, conv(r.cents, r.currency));
  }
  const networks = [...nets.values()].filter((n) => !netFilter || n.network === netFilter).sort((a, b) => b.revenue - a.revenue || b.sales - a.sales);

  // Per product, plus money totals for refunds and chargebacks.
  const prods = new Map();
  const money = { gross: 0, refunded: 0, charged: 0, refundN: 0, chargeN: 0 };
  for (const r of pRows) {
    const v = conv(r.cents, r.currency);
    if (!prods.has(r.product)) prods.set(r.product, { product: r.product, sales: 0, revenue: 0 });
    const x = prods.get(r.product);
    if (r.type === "sale" || r.type === "upsell") { x.sales += r.n; money.gross += v; }
    else if (r.type === "refund") { money.refunded += v; money.refundN += r.n; }
    else { money.charged += v; money.chargeN += r.n; }
    x.revenue += sumRev(r.type, v);
  }
  const products = [...prods.values()].sort((a, b) => b.revenue - a.revenue);
  const productNames = prodNameRows.map((r) => r.product);
  const sources = srcRows.map((r) => r.source);
  if (srcFilter && !sources.includes(srcFilter)) sources.push(srcFilter);
  return c.respond(TV.resultsView(c.view(), { s, range, byAd, srcFilter, netFilter, prodFilter, list, tot, series, hasAny, sources, networks, products, productNames, money, audience: { age: [...audience.age.values()], gender: [...audience.gender.values()] } }));
}

export async function salesPage(c) {
  const s = ratesLater(c, await getSettings(c.db));
  const range = readRange(c.url.searchParams);
  const network = T.NETWORKS[c.url.searchParams.get("network")] ? c.url.searchParams.get("network") : "";
  const [sales, events, dayRows] = (await c.db.batch([
    c.db.prepare(
      `select v.*, k.source, k.campaign, k.ad, k.keyword, coalesce(k.country, v.country) as country from tk_conversions v left join tk_clicks k on k.id = v.click_id
       where v.at >= ? and v.at < ?${network ? " and v.network = ?" : ""} order by v.at desc limit 300`,
    ).bind(range.start, range.end, ...(network ? [network] : [])),
    c.db.prepare("select * from tk_events order by id desc limit 40"),
    // per-day totals (all networks), like "Vendas hoje" and "Faturamento hoje" in the sale e-mail
    c.db.prepare(
      `select substr(datetime(at, '-${SP_OFFSET_H} hours'), 1, 10) as d, type, currency, sum(amount_cents) as cents, count(*) as n
       from tk_conversions where at >= ? and at < ? group by 1, 2, 3`,
    ).bind(range.start, range.end),
  ])).map((r) => r.results || []);
  const days = {};
  for (const r of dayRows) {
    const x = (days[r.d] ||= { sales: 0, revenue: 0 });
    if (r.type === "sale" || r.type === "upsell") x.sales += r.n;
    x.revenue += sumRev(r.type, T.convert(r.cents || 0, r.currency, s.currency, s));
  }
  for (const v of sales) v.day = new Date(Date.parse(v.at) - SP_OFFSET_H * 36e5).toISOString().slice(0, 10);
  return c.respond(TV.salesView(c.view(), { s, range, sales, events, network, days, today: spToday() }));
}

export async function integrationsPage(c, extra = {}, status = 200) {
  const s = await getSettings(c.db);
  const devices = (await c.db.prepare("select id, label, created_at, last_ok_at from push_subs order by created_at").all()).results;
  return c.respond(TV.integrationsView(c.view(), { s, devices, ...extra }), status);
}

export async function trackingPage(c, extra = {}, status = 200) {
  const s = await getSettings(c.db);
  const d = await c.db.prepare("select full_name from domains where user_id = ? and active = 1 order by is_default desc, type asc limit 1")
    .bind(c.user.id).first();
  const costCount = (await c.db.prepare("select source, count(*) as n, max(updated_at) as last from tk_costs group by source").all()).results;
  const google = await GA.googleBox(c, s, extra);
  return c.respond(TV.trackingView(c.view(), {
    s, base: `https://${c.panelHost()}`, linkDomain: d?.full_name || c.panelHost(), costCount, google, ...extra,
  }), status);
}

export async function integrationsPost(c, action) {
  const f = await c.form();
  if (action === "settings") {
    const cur = String(f.get("currency") || "BRL");
    const usd = Number(String(f.get("usd_brl") || "").replace(",", "."));
    const eur = Number(String(f.get("eur_brl") || "").replace(",", "."));
    if (!(usd > 0) || !(eur > 0)) return integrationsPage(c, { settingsError: "Digite um câmbio maior que zero." }, 422);
    await setSetting(c.db, "currency", T.CURRENCIES.includes(cur) ? cur : "BRL");
    await setSetting(c.db, "rate_auto", f.get("rate_auto") ? "1" : "0");
    if (f.get("rate_auto")) await setSetting(c.db, "rate_at", "");
    await setSetting(c.db, "usd_brl", usd);
    await setSetting(c.db, "eur_brl", eur);
    c.flash("success", "Configurações salvas.");
  } else if (action === "awesome-token") {
    await setSetting(c.db, "awesome_token", String(f.get("token") || "").trim().replace(/[^\w-]/g, "").slice(0, 100));
    await setSetting(c.db, "rate_at", "");
    c.flash("success", "Chave da AwesomeAPI salva. A cotação é buscada de novo na próxima abertura.");
  } else if (action === "tracking-settings") {
    const nb = String(f.get("nb_postback") || "").trim();
    if (nb && !/^https:\/\/\S+$/.test(nb)) return trackingPage(c, { settingsError: "O postback da NewsBreak precisa começar com https://." }, 422);
    await setSetting(c.db, "nb_postback", nb.slice(0, 1000));
    await setSetting(c.db, "gads_conv_name", String(f.get("gads_conv_name") || "").trim().slice(0, 100) || "Cutti - Venda");
    c.flash("success", "Salvo.");
  } else if (action === "telegram") {
    if (f.get("off")) {
      for (const k of ["tg_token", "tg_chat", "tg_name"]) await setSetting(c.db, k, "");
      c.flash("success", "Avisos pelo Telegram desligados.");
    } else {
      const s = await getSettings(c.db);
      const token = String(f.get("token") || "").trim() || s.tg_token;
      const err = await telegramConnect(c, token);
      if (err) return integrationsPage(c, { tgError: err }, 422);
      c.flash("success", "Telegram conectado. Toque em Testar.");
    }
  } else if (action === "notify-test") {
    const s = await getSettings(c.db);
    const r = await notify(c.db, s, { ...messageFrom(s, T.SAMPLE_VARS, false), vars: T.SAMPLE_VARS }, c.env.__notifyFetch || fetch, { email: c.env.EMAIL, emailTo: c.env.EMAIL_TO, panel: `https://${c.panelHost()}` });
    if (!r.sent) c.flash("error", "Nenhum aviso configurado ainda.");
    else if (r.errors.length) c.flash("error", `Não foi: ${r.errors.join("; ")}`);
    else c.flash("success", "Aviso de teste enviado. Olhe o celular.");
  } else if (action === "templates") {
    if (f.get("reset")) {
      for (const k of Object.keys(T.TEMPLATE_DEFAULTS)) await setSetting(c.db, `tpl_${k}`, "");
      c.flash("success", "Texto do aviso voltou ao padrão.");
    } else {
      for (const [k, d] of Object.entries(T.TEMPLATE_DEFAULTS)) {
        const v = T.cleanTemplate(f.get(k), d);
        await setSetting(c.db, `tpl_${k}`, v === d ? "" : v);
      }
      c.flash("success", "Texto do aviso salvo. Toque em Testar aviso para ver no celular.");
    }
    return c.redirect("/integrations#avisos");
  } else if (action === "notify-prefs") {
    await setSetting(c.db, "notify_refunds", f.get("refunds") ? "1" : "0");
    c.flash("success", "Preferência salva.");
  } else if (action === "push-subscribe") {
    const endpoint = String(f.get("endpoint") || "");
    const p256dh = String(f.get("p256dh") || "");
    const auth = String(f.get("auth") || "");
    if (!/^https:\/\/\S{10,1000}$/.test(endpoint) || !/^[\w-]{80,100}$/.test(p256dh) || !/^[\w-]{16,30}$/.test(auth)) {
      c.flash("error", "Não consegui ativar neste aparelho. Tente de novo.");
      return c.redirect("/integrations#avisos");
    }
    const label = String(f.get("label") || "Aparelho").slice(0, 60);
    await c.db.prepare(
      "insert into push_subs (id, endpoint, p256dh, auth, label, created_at) values (?,?,?,?,?,?) on conflict(endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label",
    ).bind(newId(), endpoint, p256dh, auth, label, nowIso()).run();
    c.flash("success", `Avisos ativados neste aparelho (${label}). Toque em Testar aviso.`);
    return c.redirect("/integrations#avisos");
  } else if (action.startsWith("push-delete-")) {
    await c.db.prepare("delete from push_subs where id = ?").bind(action.slice(12)).run();
    c.flash("success", "Aparelho removido.");
  } else if (action === "key") {
    await setSetting(c.db, "key", randomToken(24));
    c.flash("success", "Chave trocada. Atualize as URLs de postback nas redes e o script do Google Ads.");
  } else if (action === "newsbreak-csv") {
    const csv = String(f.get("csv") || "");
    const currency = T.CURRENCIES.includes(String(f.get("currency"))) ? String(f.get("currency")) : "USD";
    const r = T.parseCostCsv(csv);
    if (r.error) return trackingPage(c, { csvError: r.error, csvValue: csv.slice(0, 20000) }, 422);
    const ts = nowIso();
    const stmts = r.rows.map((x) => costUpsert(c.db, { ...x, source: "newsbreak", currency }, ts));
    for (let i = 0; i < stmts.length; i += 50) await c.db.batch(stmts.slice(i, i + 50));
    c.flash("success", `${r.rows.length} linha(s) de gasto da NewsBreak importadas.`);
  } else if (action === "cost") {
    const date = T.normDate(f.get("date"));
    const source = ["google", "newsbreak", "other"].includes(String(f.get("source"))) ? String(f.get("source")) : "other";
    const name = String(f.get("campaign") || "").trim().slice(0, 200);
    const cents = T.toCents(f.get("amount"));
    const currency = T.CURRENCIES.includes(String(f.get("currency"))) ? String(f.get("currency")) : "BRL";
    if (!date || !name || cents == null) {
      return trackingPage(c, { costError: "Preencha data, campanha e valor." }, 422);
    }
    await costUpsert(c.db, { date, source, campaign_key: name, campaign_name: name, cost_cents: cents, currency }, nowIso()).run();
    c.flash("success", "Gasto salvo.");
  }
  return c.redirect(["/settings", "/tracking"].includes(f.get("back")) ? f.get("back") : "/integrations");
}

export async function deleteSale(c, id) {
  await c.db.prepare("delete from tk_conversions where id = ?").bind(id).run();
  c.flash("success", "Venda removida.");
  return c.redirect("/sales");
}

// ---------------------------------------------------------------- platforms (pick the networks shown on the dashboard)

async function currentPlatforms(c, s) {
  if (s.platforms) return s.platforms;
  const rows = (await c.db.prepare("select distinct network from links where track = 1 and network is not null").all()).results;
  return rows.map((r) => r.network).filter((n) => T.NETWORKS[n] && n !== "other");
}

export async function platformsPage(c) {
  const s = await getSettings(c.db);
  return c.respond(TV.platformsView(c.view(), { selected: await currentPlatforms(c, s) }));
}

export async function platformsPost(c) {
  const f = await c.form();
  const picked = [...new Set(f.getAll("net").map(String))].filter((n) => T.NETWORKS[n] && n !== "other");
  const before = await currentPlatforms(c, await getSettings(c.db));
  await setSetting(c.db, "platforms", picked.join(","));
  const added = picked.filter((n) => !before.includes(n));
  if (!picked.length) {
    c.flash("success", "Nenhuma plataforma no painel.");
    return c.redirect("/results");
  }
  return c.redirect(`/platforms/setup${added.length ? `?new=${added.join(",")}` : ""}`);
}

export async function platformsSetupPage(c) {
  const s = await getSettings(c.db);
  const selected = await currentPlatforms(c, s);
  const added = String(c.url.searchParams.get("new") || "").split(",").filter((n) => selected.includes(n));
  return c.respond(TV.platformsSetupView(c.view(), { s, base: `https://${c.panelHost()}`, selected, added }));
}
