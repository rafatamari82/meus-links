// Google Ads, connected through the official Google Ads API with the owner's own Google Cloud app and developer token.
// Pulls cost per campaign and uploads each sale as a click conversion (gclid) as it happens.
import { csrfField, fieldError, fmtDateTime, html, raw } from "./views.js";
import { randomToken, safeEqual } from "./security.js";
import { setSetting, trackingPage } from "./tracker-routes.js";

export const ADS_API = "https://googleads.googleapis.com/v26";
const SCOPE = "https://www.googleapis.com/auth/adwords";
const ACTION_NAME = "Cutti - Venda";

// ---------------------------------------------------------------- secrets at rest

async function aesKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`cutti-google:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const toB64 = (u8) => btoa(String.fromCharCode(...u8));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function seal(secret, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(text)));
  return `${toB64(iv)}.${toB64(ct)}`;
}
export async function unseal(secret, box) {
  if (!box) return "";
  const [iv, ct] = box.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await aesKey(secret), fromB64(ct));
  return new TextDecoder().decode(pt);
}

// ---------------------------------------------------------------- config

export async function gConfig(c) {
  const rows = (await c.db.prepare("select key, value from settings where key like 'tk_gads_%'").all()).results;
  const s = Object.fromEntries(rows.map((r) => [r.key.slice(8), r.value]));
  const open = async (k) => { try { return await unseal(c.secret, s[k]); } catch { return ""; } };
  return {
    clientId: s.client_id || "",
    clientSecret: await open("client_secret"),
    devToken: await open("dev_token"),
    loginCid: s.login_cid || "",
    refresh: await open("refresh"),
    customer: s.customer || "",
    customerName: s.customer_name || "",
    currency: s.currency || "BRL",
    action: s.action || "",
    lastSync: s.last_sync || "",
    lastError: s.last_error || "",
    email: s.email || "",
  };
}
const setG = (c, k, v) => setSetting(c.db, `gads_${k}`, v ?? "");
const digits = (x) => String(x || "").replace(/\D/g, "");
export const redirectUri = (c) => `https://${c.panelHost()}/tracking/google/callback`;

// ---------------------------------------------------------------- API

let tokenCache = { key: "", token: "", until: 0 };
async function accessToken(c, g) {
  if (tokenCache.key === g.refresh && Date.now() < tokenCache.until) return tokenCache.token;
  const r = await (c.env.__googleFetch || fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: g.clientId, client_secret: g.clientSecret, refresh_token: g.refresh, grant_type: "refresh_token" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error === "invalid_grant" ? "O acesso ao Google expirou ou foi removido. Conecte de novo." : `Google recusou o login (${j.error || r.status}).`);
  tokenCache = { key: g.refresh, token: j.access_token, until: Date.now() + (Number(j.expires_in || 3600) - 120) * 1000 };
  return j.access_token;
}

async function ads(c, g, path, body, { method = "POST", login = true } = {}) {
  const headers = {
    Authorization: `Bearer ${await accessToken(c, g)}`,
    "developer-token": g.devToken,
    "Content-Type": "application/json",
  };
  if (login && g.loginCid) headers["login-customer-id"] = digits(g.loginCid);
  const r = await (c.env.__googleFetch || fetch)(`${ADS_API}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(adsError(j, r.status));
  return j;
}

function adsError(j, status) {
  const e = Array.isArray(j) ? j[0]?.error : j?.error;
  const d = e?.details?.[0]?.errors?.[0];
  const code = d ? Object.values(d.errorCode || {})[0] : e?.status;
  const hints = {
    DEVELOPER_TOKEN_NOT_APPROVED: "O token de desenvolvedor ainda não foi aprovado para contas reais. Aguarde a aprovação do Google.",
    DEVELOPER_TOKEN_PROHIBITED: "Esse token de desenvolvedor não pode ser usado com esse projeto do Google Cloud.",
    USER_PERMISSION_DENIED: "O Google que você conectou não tem acesso a essa conta. Confira o ID da conta de administrador (MCC).",
    CUSTOMER_NOT_ENABLED: "Essa conta do Google Ads não está ativa.",
    PERMISSION_DENIED: "Sem permissão. Confira se a API do Google Ads está ativada no projeto do Google Cloud.",
  };
  return hints[code] || `${code || `HTTP ${status}`}: ${d?.message || e?.message || "erro do Google Ads"}`.slice(0, 300);
}

async function search(c, g, cid, query) {
  const out = [];
  let pageToken;
  do {
    const j = await ads(c, g, `customers/${cid}/googleAds:search`, { query, ...(pageToken ? { pageToken } : {}) });
    out.push(...(j.results || []));
    pageToken = j.nextPageToken;
  } while (pageToken && out.length < 20000);
  return out;
}

export async function listCustomers(c, g) {
  const j = await ads(c, g, "customers:listAccessibleCustomers", null, { method: "GET", login: false });
  const ids = (j.resourceNames || []).map((r) => r.split("/")[1]);
  const out = [];
  for (const id of ids.slice(0, 30)) {
    try {
      const [row] = await search(c, g, id, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1");
      out.push({ id, name: row?.customer?.descriptiveName || id, currency: row?.customer?.currencyCode || "", manager: !!row?.customer?.manager });
    } catch (e) {
      out.push({ id, name: id, currency: "", manager: false, error: e.message });
    }
  }
  return out;
}

async function ensureAction(c, g) {
  const found = await search(c, g, g.customer,
    `SELECT conversion_action.resource_name, conversion_action.status FROM conversion_action WHERE conversion_action.name = '${ACTION_NAME}' AND conversion_action.status != 'REMOVED' LIMIT 1`);
  if (found[0]) return found[0].conversionAction.resourceName;
  const j = await ads(c, g, `customers/${g.customer}/conversionActions:mutate`, {
    operations: [{ create: { name: ACTION_NAME, type: "UPLOAD_CLICKS", category: "PURCHASE", status: "ENABLED", valueSettings: { defaultValue: 0, alwaysUseDefaultValue: false } } }],
  });
  return j.results[0].resourceName;
}

const ymd = (d) => d.toISOString().slice(0, 10);
const gadsTime = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`;

/** Cost per campaign for the last 7 days, into tk_costs. */
export async function syncCosts(c, g) {
  const to = new Date();
  const from = new Date(Date.now() - 7 * 864e5);
  const rows = await search(c, g, g.customer,
    `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date BETWEEN '${ymd(from)}' AND '${ymd(to)}'`);
  const ts = new Date().toISOString();
  const stmts = rows.map((r) => c.db.prepare(
    `insert into tk_costs (date, source, campaign_key, campaign_name, cost_cents, currency, clicks, impressions, updated_at)
     values (?, 'google', ?, ?, ?, ?, ?, ?, ?) on conflict(date, source, campaign_key) do update set
     campaign_name = excluded.campaign_name, cost_cents = excluded.cost_cents, currency = excluded.currency,
     clicks = excluded.clicks, impressions = excluded.impressions, updated_at = excluded.updated_at`,
  ).bind(r.segments.date, String(r.campaign.id), r.campaign.name || "", Math.round(Number(r.metrics.costMicros || 0) / 10000),
    g.currency, Number(r.metrics.clicks || 0), Number(r.metrics.impressions || 0), ts));
  for (let i = 0; i < stmts.length; i += 50) await c.db.batch(stmts.slice(i, i + 50));
  return rows.length;
}

/** Upload sales with a gclid that Google has not received yet. */
export async function uploadConversions(c, g, { only = null } = {}) {
  const since = new Date(Date.now() - 89 * 864e5).toISOString();
  const where = only ? "v.id = ?" : "v.gads_sent_at is null and coalesce(v.gads_tries, 0) < 5 and v.at >= ?";
  const rows = (await c.db.prepare(
    `select v.id, v.at, v.amount_cents, v.currency, v.type, k.gclid from tk_conversions v join tk_clicks k on k.id = v.click_id
     where k.gclid is not null and v.type in ('sale','upsell') and ${where} order by v.at limit 200`,
  ).bind(only || since).all()).results;
  if (!rows.length) return { sent: 0, failed: 0 };
  const j = await ads(c, g, `customers/${g.customer}:uploadClickConversions`, {
    conversions: rows.map((r) => ({
      gclid: r.gclid, conversionAction: g.action, conversionDateTime: gadsTime(r.at),
      conversionValue: r.amount_cents / 100, currencyCode: r.currency, orderId: r.id,
    })),
    partialFailure: true,
  });
  // Partial failure details point at the failing rows by index.
  const failed = new Map();
  for (const d of j.partialFailureError?.details || []) {
    for (const e of d.errors || []) {
      const idx = e.location?.fieldPathElements?.find((x) => x.fieldName === "conversions")?.index;
      if (idx != null) failed.set(Number(idx), `${Object.values(e.errorCode || {})[0] || ""}: ${e.message || ""}`.slice(0, 200));
    }
  }
  const ts = new Date().toISOString();
  const stmts = rows.map((r, i) => (failed.has(i)
    ? c.db.prepare("update tk_conversions set gads_tries = coalesce(gads_tries, 0) + 1, gads_error = ? where id = ?").bind(failed.get(i), r.id)
    : c.db.prepare("update tk_conversions set gads_sent_at = ?, gads_error = null where id = ?").bind(ts, r.id)));
  await c.db.batch(stmts);
  return { sent: rows.length - failed.size, failed: failed.size };
}

/** A refund takes the sale back out of Google's numbers. */
export async function retractConversion(c, g, txid, network) {
  const orig = await c.db.prepare(
    `select v.id, v.at, k.gclid from tk_conversions v join tk_clicks k on k.id = v.click_id
     where v.network = ? and v.txid = ? and v.type in ('sale','upsell') and v.gads_sent_at is not null limit 1`,
  ).bind(network, txid).first();
  if (!orig) return;
  await ads(c, g, `customers/${g.customer}:uploadConversionAdjustments`, {
    conversionAdjustments: [{
      adjustmentType: "RETRACTION", conversionAction: g.action, adjustmentDateTime: gadsTime(new Date().toISOString()),
      orderId: orig.id,
    }],
    partialFailure: true,
  });
}

const ready = (g) => g.refresh && g.devToken && g.customer && g.action;

/** Called after a postback stores a conversion. Never throws. */
export async function onConversion(c, { id, type, txid, network, gclid }) {
  try {
    const g = await gConfig(c);
    if (!ready(g)) return;
    if ((type === "sale" || type === "upsell") && gclid) await uploadConversions(c, g, { only: id });
    else if ((type === "refund" || type === "chargeback") && txid) await retractConversion(c, g, txid, network);
  } catch (e) {
    await setG(c, "last_error", `${new Date().toISOString()} ${e.message}`.slice(0, 400));
  }
}

/** Cron: costs and any conversion that failed to go out. */
export async function scheduledSync(c) {
  const g = await gConfig(c);
  if (!ready(g)) return;
  try {
    await syncCosts(c, g);
    await uploadConversions(c, g);
    await setG(c, "last_sync", new Date().toISOString());
    await setG(c, "last_error", "");
  } catch (e) {
    await setG(c, "last_error", `${new Date().toISOString()} ${e.message}`.slice(0, 400));
  }
}

// ---------------------------------------------------------------- routes

export async function googlePost(c, action) {
  const f = await c.form();
  if (action === "credentials") {
    const clientId = String(f.get("client_id") || "").trim();
    const clientSecret = String(f.get("client_secret") || "").trim();
    const devToken = String(f.get("dev_token") || "").trim();
    const login = digits(f.get("login_cid"));
    const errors = {};
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) errors.client_id = "O ID do cliente termina em .apps.googleusercontent.com.";
    const g = await gConfig(c);
    if (!clientSecret && !g.clientSecret) errors.client_secret = "Cole a chave secreta do cliente.";
    if (!devToken && !g.devToken) errors.dev_token = "Cole o token de desenvolvedor.";
    if (login && login.length !== 10) errors.login_cid = "O ID tem 10 números (123-456-7890).";
    if (Object.keys(errors).length) return trackingPage(c, { gErrors: errors, gValues: { client_id: clientId, login_cid: f.get("login_cid") } }, 422);
    await setG(c, "client_id", clientId);
    if (clientSecret) await setG(c, "client_secret", await seal(c.secret, clientSecret));
    if (devToken) await setG(c, "dev_token", await seal(c.secret, devToken));
    await setG(c, "login_cid", login);
    c.flash("success", "Dados salvos. Agora clique em Conectar com Google.");
  } else if (action === "customer") {
    const g = await gConfig(c);
    const id = digits(f.get("customer"));
    try {
      const list = await listCustomers(c, g);
      const pick = list.find((x) => x.id === id);
      if (!pick) throw new Error("Conta não encontrada na lista.");
      if (pick.manager) throw new Error("Essa é uma conta de administrador (MCC). Escolha a conta onde os anúncios rodam.");
      await setG(c, "customer", id);
      await setG(c, "customer_name", pick.name);
      await setG(c, "currency", pick.currency || "BRL");
      const action2 = await ensureAction(c, { ...g, customer: id });
      await setG(c, "action", action2);
      const n = await syncCosts(c, { ...g, customer: id, currency: pick.currency || "BRL" });
      await setG(c, "last_sync", new Date().toISOString());
      await setG(c, "last_error", "");
      c.flash("success", `Conta ${pick.name} conectada. ${n} linha(s) de gasto trazidas; a conversão “${ACTION_NAME}” está pronta.`);
    } catch (e) {
      c.flash("error", e.message);
    }
  } else if (action === "sync") {
    const g = await gConfig(c);
    try {
      const n = await syncCosts(c, g);
      const up = await uploadConversions(c, g);
      await setG(c, "last_sync", new Date().toISOString());
      await setG(c, "last_error", "");
      c.flash("success", `Sincronizado: ${n} linha(s) de gasto, ${up.sent} venda(s) enviada(s) ao Google${up.failed ? `, ${up.failed} com erro` : ""}.`);
    } catch (e) {
      await setG(c, "last_error", `${new Date().toISOString()} ${e.message}`.slice(0, 400));
      c.flash("error", e.message);
    }
  } else if (action === "disconnect") {
    for (const k of ["refresh", "customer", "customer_name", "action", "last_sync", "last_error", "email"]) await setG(c, k, "");
    c.flash("success", "Google Ads desconectado. O script e o arquivo diário continuam funcionando.");
  } else if (action === "forget") {
    for (const k of ["client_id", "client_secret", "dev_token", "login_cid", "refresh", "customer", "customer_name", "action", "last_sync", "last_error", "email"]) await setG(c, k, "");
    c.flash("success", "Dados do Google apagados.");
  }
  return c.redirect("/tracking#google");
}

export async function googleConnect(c) {
  const g = await gConfig(c);
  if (!g.clientId || !g.clientSecret) return c.redirect("/tracking#google");
  const state = randomToken(24);
  const q = new URLSearchParams({
    client_id: g.clientId, redirect_uri: redirectUri(c), response_type: "code", scope: `${SCOPE} email`,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`,
      "Set-Cookie": `gstate=${state}; Path=/tracking/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
    },
  });
}

export async function googleCallback(c) {
  const p = c.url.searchParams;
  const state = c.cookies.gstate || "";
  if (p.get("error")) {
    c.flash("error", p.get("error") === "access_denied" ? "Você cancelou a conexão com o Google." : `O Google recusou: ${p.get("error")}`);
    return c.redirect("/tracking#google");
  }
  if (!state || !safeEqual(state, String(p.get("state") || ""))) {
    c.flash("error", "A conexão expirou. Clique em Conectar com Google de novo.");
    return c.redirect("/tracking#google");
  }
  const g = await gConfig(c);
  const r = await (c.env.__googleFetch || fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: String(p.get("code") || ""), client_id: g.clientId, client_secret: g.clientSecret, redirect_uri: redirectUri(c), grant_type: "authorization_code" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) {
    c.flash("error", j.refresh_token === undefined && r.ok
      ? "O Google não devolveu o acesso permanente. Remova o Cutti em myaccount.google.com/permissions e conecte de novo."
      : `O Google recusou a conexão (${j.error_description || j.error || r.status}). Confira o ID e a chave do cliente e o URI de redirecionamento.`);
    return c.redirect("/tracking#google");
  }
  await setG(c, "refresh", await seal(c.secret, j.refresh_token));
  try {
    const payload = JSON.parse(atob(String(j.id_token || "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.email) await setG(c, "email", payload.email);
  } catch { /* no id token */ }
  tokenCache = { key: "", token: "", until: 0 };
  c.flash("success", "Google conectado. Agora escolha a conta do Google Ads.");
  return c.redirect("/tracking#google");
}

// ---------------------------------------------------------------- the box on the Trackeamento page

export async function googleBox(c, s, extra = {}) {
  const g = await gConfig(c);
  const cv = c.view();
  const e = extra.gErrors || {};
  const v = extra.gValues || {};
  const field = (name, label, attrs, hint = "") => html`<div class="field"><label for="g-${name}">${label}</label>
    <input id="g-${name}" name="${name}" ${raw(attrs)} ${e[name] ? raw(`aria-invalid="true" aria-describedby="g-${name}-err"`) : ""}>
    ${fieldError(`g-${name}-err`, e[name])}${hint ? html`<p class="hint">${hint}</p>` : ""}</div>`;
  const status = (await c.db.prepare(
    "select sum(case when gads_sent_at is not null then 1 else 0 end) as sent, sum(case when gads_sent_at is null and gads_error is not null then 1 else 0 end) as failed from tk_conversions",
  ).first()) || {};

  let inner;
  if (!g.refresh) {
    inner = html`
    <p class="muted">Conecte sua conta do Google Ads e o Cutti passa a trazer o gasto sozinho e a mandar cada venda para o Google na hora. Sem script e sem arquivo.</p>
    <details class="utm" ${g.clientId ? "" : raw("open")}>
      <summary>1. Dados do seu app no Google (uma vez só)</summary>
      <ol class="steps">
        <li>Em <strong>console.cloud.google.com</strong>, crie um projeto e ative a <strong>Google Ads API</strong> (APIs e serviços → Biblioteca).</li>
        <li>Em <strong>Tela de consentimento OAuth</strong>: tipo Externo, preencha nome e e-mail, e no fim clique em <strong>Publicar app</strong> (em produção). Em teste, o Google desconecta a cada 7 dias.</li>
        <li>Em <strong>Credenciais → Criar credenciais → ID do cliente OAuth</strong>, tipo Aplicativo da Web. Em URIs de redirecionamento autorizados, cole: <code>${redirectUri(c)}</code></li>
        <li>No Google Ads, na conta de administrador (MCC): <strong>Administrador → Central da API</strong>, pegue o <strong>token de desenvolvedor</strong>.</li>
      </ol>
      <form method="post" action="/tracking/google/credentials" class="stack" novalidate>
        ${csrfField(cv)}
        ${field("client_id", "ID do cliente", `value="${String(v.client_id || g.clientId).replace(/"/g, "&quot;")}" autocomplete="off" spellcheck="false" placeholder="123….apps.googleusercontent.com"`)}
        ${field("client_secret", "Chave secreta do cliente", `type="password" autocomplete="off" placeholder="${g.clientSecret ? "salva — deixe vazio para manter" : "GOCSPX-…"}"`)}
        ${field("dev_token", "Token de desenvolvedor", `type="password" autocomplete="off" placeholder="${g.devToken ? "salvo — deixe vazio para manter" : ""}"`)}
        ${field("login_cid", "ID da conta de administrador (MCC)", `value="${String(v.login_cid || g.loginCid).replace(/"/g, "&quot;")}" inputmode="numeric" placeholder="123-456-7890"`, "Opcional. Preencha se a sua conta de anúncios fica dentro de uma MCC.")}
        <div class="row-end"><button class="btn btn-secondary" type="submit">Salvar dados</button></div>
      </form>
    </details>
    ${g.clientId && g.clientSecret ? html`<a class="btn btn-primary" href="/tracking/google/connect">2. Conectar com Google</a>
      <p class="hint">Como o app é seu e não foi verificado pelo Google, ele mostra um aviso. Clique em Avançado → Acessar.</p>` : ""}`;
  } else if (!g.customer) {
    let list = [];
    let err = "";
    try { list = (await listCustomers(c, g)).filter((x) => !x.manager); } catch (x) { err = x.message; }
    inner = html`
    <p class="muted">Google conectado${g.email ? ` (${g.email})` : ""}. Escolha a conta onde seus anúncios rodam.</p>
    ${err ? html`<p class="alert alert-error" role="alert">${err}</p>` : ""}
    ${list.length ? html`<form method="post" action="/tracking/google/customer" class="field-row" novalidate>
      ${csrfField(cv)}
      <div class="field grow"><label for="g-customer">Conta do Google Ads</label>
        <select id="g-customer" name="customer">${list.map((x) => html`<option value="${x.id}">${x.name} · ${x.id.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}${x.currency ? ` · ${x.currency}` : ""}</option>`)}</select></div>
      <div class="field field-end"><button class="btn btn-primary" type="submit">Usar esta conta</button></div>
    </form>` : err ? "" : html`<p class="muted">Nenhuma conta de anúncios encontrada nesse Google.</p>`}
    <form method="post" action="/tracking/google/disconnect">${csrfField(cv)}<button class="btn btn-ghost btn-xs" type="submit">Desconectar</button></form>`;
  } else {
    inner = html`
    <div class="g-status">
      <div><span class="badge badge-success">Conectado</span> <strong>${g.customerName}</strong> <span class="muted">· ${g.customer.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}${g.email ? ` · ${g.email}` : ""}</span></div>
      <ul class="g-facts">
        <li>Gasto por campanha: automático a cada 30 minutos${g.lastSync ? ` · última vez ${fmtDateTime(g.lastSync)}` : ""}</li>
        <li>Vendas enviadas ao Google na hora, na conversão “${ACTION_NAME}”: ${status.sent || 0}${status.failed ? html` · <span class="danger-text">${status.failed} com erro</span>` : ""}</li>
        <li>Reembolsos são retirados da conversão no Google.</li>
      </ul>
      ${g.lastError ? html`<p class="alert alert-error" role="alert">Último erro: ${g.lastError.slice(25)}</p>` : ""}
      <div class="actions start">
        <form method="post" action="/tracking/google/sync">${csrfField(cv)}<button class="btn btn-secondary btn-sm" type="submit">Sincronizar agora</button></form>
        <form method="post" action="/tracking/google/disconnect" data-confirm="Desconectar o Google Ads? O gasto para de chegar sozinho.">${csrfField(cv)}<button class="btn btn-ghost btn-sm danger-text" type="submit">Desconectar</button></form>
      </div>
      <p class="hint">Com a API conectada, apague o script do Cutti no Google Ads (Ferramentas → Scripts). Os dois juntos não duplicam o gasto, mas é melhor ter um caminho só.</p>
    </div>`;
  }
  return html`<div id="google">${inner}</div>`;
}
