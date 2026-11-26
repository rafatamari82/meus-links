// Sales tracker: public endpoints (postback, cost, scripts) and panel pages.
import * as T from "./tracker.js";
import { randomToken, safeEqual } from "./security.js";
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
  return {
    key: s.key,
    currency: T.CURRENCIES.includes(s.currency) ? s.currency : "BRL",
    usd_brl: Number(s.usd_brl) > 0 ? Number(s.usd_brl) : 5.4,
    eur_brl: Number(s.eur_brl) > 0 ? Number(s.eur_brl) : 6.2,
    nb_postback: s.nb_postback || "",
    gads_conv_name: s.gads_conv_name || "Venda",
  };
}

async function setSetting(db, key, value) {
  await db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value")
    .bind(`tk_${key}`, String(value)).run();
}

// ---------------------------------------------------------------- the click

/** Called from the short-link redirect for links with tracking on. Returns the target with the click ID. */
export function trackClick(c, link, { country, device }) {
  const cid = T.newClickId();
  const p = T.readClickParams(c.url.searchParams);
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
  if (p.type !== "sale" && p.type !== "upsell" && p.amount_cents == null && p.txid) {
    const orig = await c.db.prepare("select amount_cents, currency from tk_conversions where network = ? and txid = ? and type in ('sale','upsell')")
      .bind(network, p.txid).first();
    if (orig) { p.amount_cents = orig.amount_cents; p.currency = orig.currency; }
  }
  if (p.type === "sale" && p.upsell) p.type = "upsell";
  const txid = p.txid || (click ? `${click.id}` : `sem-id-${randomToken(6)}`);
  const res = await c.db.prepare(
    "insert or ignore into tk_conversions (id, click_id, network, txid, type, amount_cents, currency, at) values (?,?,?,?,?,?,?,?)",
  ).bind(randomToken(12), click?.id || null, network, txid, p.type, Math.abs(p.amount_cents || 0), p.currency || "USD", nowIso()).run();
  const dup = !res.meta?.changes;
  const outcome = dup ? "repetido" : click ? "ok" : "sem clique";
  const label = { sale: "venda", upsell: "upsell", refund: "reembolso", chargeback: "chargeback" }[p.type];
  await logEvent(c.db, network, outcome,
    `${label} ${T.fmtMoney(p.amount_cents || 0, p.currency || "USD")}${p.txid ? ` · pedido ${p.txid}` : ""}${click ? ` · clique ${click.id}` : p.ids.length ? ` · click ID ${p.ids[0]} não encontrado` : " · sem click ID"}`,
    raw);

  // Tell NewsBreak about the sale, so its algorithm learns from it.
  if (!dup && click?.nb_callback && s.nb_postback && (p.type === "sale" || p.type === "upsell")) {
    const value = (T.convert(p.amount_cents || 0, p.currency, "USD", s) / 100).toFixed(2);
    const url = s.nb_postback.replaceAll("{clickid}", encodeURIComponent(click.nb_callback)).replaceAll("{value}", value);
    if (/^https:\/\//.test(url)) c.exec.waitUntil(fetch(url).catch((e) => console.error("newsbreak postback", e)));
  }
  return text(dup ? "ok (repetido)" : "ok");
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
  for (const r of rows) {
    const date = T.normDate(r.date);
    if (!date || !r.campaign_id) continue;
    stmts.push(costUpsert(c.db, {
      date, source: "google", campaign_key: String(r.campaign_id).slice(0, 60), campaign_name: String(r.campaign_name || "").slice(0, 200),
      cost_cents: Math.round(Number(r.cost_micros || 0) / 10000), currency,
      clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0,
    }, ts));
  }
  for (let i = 0; i < stmts.length; i += 50) await c.db.batch(stmts.slice(i, i + 50));
  await logEvent(c.db, "google-ads", "ok", `gasto: ${stmts.length} linha(s)`, "");
  return text(`ok ${stmts.length}`);
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
  const s = await getSettings(c.db);
  const range = readRange(c.url.searchParams);
  const byAd = c.url.searchParams.get("by") === "ad";
  const srcFilter = c.url.searchParams.get("source") || "";
  const db = c.db;
  const adCol = byAd ? ", coalesce(ad, '') as ad" : ", '' as ad";
  const adGroup = byAd ? ", ad" : "";
  const clicks = (await db.prepare(
    `select source, coalesce(campaign, '') as campaign${adCol}, count(*) as n from tk_clicks where at >= ? and at < ? group by source, campaign${adGroup}`,
  ).bind(range.start, range.end).all()).results;
  const convs = (await db.prepare(
    `select coalesce(k.source, 'none') as source, coalesce(k.campaign, '') as campaign${byAd ? ", coalesce(k.ad, '') as ad" : ", '' as ad"},
            v.type, v.currency, sum(v.amount_cents) as cents, count(*) as n
     from tk_conversions v left join tk_clicks k on k.id = v.click_id
     where v.at >= ? and v.at < ? group by 1, 2, 3, v.type, v.currency`,
  ).bind(range.start, range.end).all()).results;
  const costs = (await db.prepare(
    "select source, campaign_key as campaign, currency, sum(cost_cents) as cents, sum(clicks) as clicks from tk_costs where date >= ? and date <= ? group by source, campaign_key, currency",
  ).bind(range.from, range.to).all()).results;
  const names = Object.fromEntries((await db.prepare(
    "select source || '|' || campaign_key as k, max(campaign_name) as name from tk_costs group by source, campaign_key",
  ).all()).results.map((r) => [r.k, r.name]));

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
  const srcSql = srcFilter ? " and coalesce(k.source, 'none') = ?" : "";
  const dRows = (await db.prepare(
    `select substr(datetime(v.at, '-${SP_OFFSET_H} hours'), 1, 10) as d, v.type, v.currency, sum(v.amount_cents) as cents
     from tk_conversions v left join tk_clicks k on k.id = v.click_id where v.at >= ? and v.at < ?${srcSql} group by 1, 2, 3`,
  ).bind(range.start, range.end, ...(srcFilter ? [srcFilter] : [])).all()).results;
  for (const r of dRows) if (r.d in dayRev) dayRev[r.d] += sumRev(r.type, conv(r.cents, r.currency));
  const cRows = (await db.prepare(
    `select date as d, currency, sum(cost_cents) as cents from tk_costs where date >= ? and date <= ?${srcFilter ? " and source = ?" : ""} group by 1, 2`,
  ).bind(range.from, range.to, ...(srcFilter ? [srcFilter] : [])).all()).results;
  for (const r of cRows) if (r.d in dayCost) dayCost[r.d] += conv(r.cents, r.currency);
  const series = days.map((d) => ({ d, rev: dayRev[d], cost: dayCost[d] }));

  const hasAny = (await db.prepare("select (select count(*) from tk_clicks) + (select count(*) from tk_conversions) + (select count(*) from tk_costs) as n").first()).n;
  return c.respond(TV.resultsView(c.view(), { s, range, byAd, srcFilter, list, tot, series, hasAny }));
}

export async function salesPage(c) {
  const s = await getSettings(c.db);
  const range = readRange(c.url.searchParams);
  const sales = (await c.db.prepare(
    `select v.*, k.source, k.campaign, k.ad, k.keyword from tk_conversions v left join tk_clicks k on k.id = v.click_id
     where v.at >= ? and v.at < ? order by v.at desc limit 300`,
  ).bind(range.start, range.end).all()).results;
  const events = (await c.db.prepare("select * from tk_events order by id desc limit 40").all()).results;
  return c.respond(TV.salesView(c.view(), { s, range, sales, events }));
}

export async function integrationsPage(c, extra = {}, status = 200) {
  const s = await getSettings(c.db);
  const d = await c.db.prepare("select full_name from domains where user_id = ? and active = 1 order by is_default desc, type asc limit 1")
    .bind(c.user.id).first();
  const costCount = (await c.db.prepare("select source, count(*) as n, max(updated_at) as last from tk_costs group by source").all()).results;
  return c.respond(TV.integrationsView(c.view(), {
    s, base: `https://${c.panelHost()}`, linkDomain: d?.full_name || c.panelHost(), costCount, ...extra,
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
    await setSetting(c.db, "usd_brl", usd);
    await setSetting(c.db, "eur_brl", eur);
    await setSetting(c.db, "gads_conv_name", String(f.get("gads_conv_name") || "Venda").trim().slice(0, 100) || "Venda");
    const nb = String(f.get("nb_postback") || "").trim();
    if (nb && !/^https:\/\/\S+$/.test(nb)) return integrationsPage(c, { settingsError: "O postback da NewsBreak precisa começar com https://." }, 422);
    await setSetting(c.db, "nb_postback", nb.slice(0, 1000));
    c.flash("success", "Configurações salvas.");
  } else if (action === "key") {
    await setSetting(c.db, "key", randomToken(24));
    c.flash("success", "Chave trocada. Atualize as URLs de postback nas redes e o script do Google Ads.");
  } else if (action === "newsbreak-csv") {
    const csv = String(f.get("csv") || "");
    const currency = T.CURRENCIES.includes(String(f.get("currency"))) ? String(f.get("currency")) : "USD";
    const r = T.parseCostCsv(csv);
    if (r.error) return integrationsPage(c, { csvError: r.error, csvValue: csv.slice(0, 20000) }, 422);
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
      return integrationsPage(c, { costError: "Preencha data, campanha e valor." }, 422);
    }
    await costUpsert(c.db, { date, source, campaign_key: name, campaign_name: name, cost_cents: cents, currency }, nowIso()).run();
    c.flash("success", "Gasto salvo.");
  }
  return c.redirect("/integrations");
}

export async function deleteSale(c, id) {
  await c.db.prepare("delete from tk_conversions where id = ?").bind(id).run();
  c.flash("success", "Venda removida.");
  return c.redirect("/sales");
}
