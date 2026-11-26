// Personal branded-link shortener on Cloudflare Workers + D1.
//
// The panel answers on the panel host (APP_HOST, or any *.workers.dev host when
// APP_HOST is not set). Every other host this Worker receives is a short-link
// domain: it only serves redirects.

import { ASSETS } from "./assets.js";
import * as core from "./core.js";
import { MIGRATIONS, SCHEMA } from "./schema.js";
import {
  checkPassword, cookie, domainToken, hashPassword, newId, parseCookies, randomToken,
  readSession, safeEqual, signSession,
} from "./security.js";
import * as V from "./views.js";
import * as TR from "./tracker-routes.js";
import * as ST from "./settings.js";
import { cleanParam, LINK_SOURCES, NETWORKS } from "./tracker.js";

const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;
const ASSET_VERSION = Object.values(ASSETS).map((a) => a.etag).join("").slice(0, 10);
const TZ = "America/Sao_Paulo";

const decodePath = (p) => {
  try { return decodeURIComponent(p); } catch { return p; }
};
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const isUnique = (e) => /UNIQUE constraint failed/i.test(String(e?.message || e));
const isForeignKey = (e) => /FOREIGN KEY constraint failed/i.test(String(e?.message || e));

let schemaReady = null;
async function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.batch(SCHEMA.map((s) => db.prepare(s)));
      for (const m of MIGRATIONS) {
        try {
          await db.prepare(m).run();
        } catch (e) {
          if (!/duplicate column/i.test(String(e?.message || e))) throw e;
        }
      }
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

async function getSecret(db) {
  const row = await db.prepare("select value from settings where key = 'secret'").first();
  if (row) return row.value;
  // First run: generate and keep a signing secret. No setup step for the owner.
  await db.prepare("insert or ignore into settings (key, value) values ('secret', ?)").bind(randomToken(48)).run();
  return (await db.prepare("select value from settings where key = 'secret'").first()).value;
}

class Ctx {
  constructor(req, env, exec) {
    this.req = req;
    this.env = env;
    this.exec = exec;
    this.db = env.DB;
    this.url = new URL(req.url);
    this.host = this.url.hostname.toLowerCase();
    this.scheme = this.url.protocol.replace(":", "");
    this.secure = this.scheme === "https";
    this.cookies = parseCookies(req.headers.get("Cookie"));
    this.setCookies = [];
    this.assetVersion = ASSET_VERSION;
    this.flashes = [];
  }

  get ip() {
    return this.req.headers.get("CF-Connecting-IP") || "local";
  }

  /** The configured panel host (APP_HOST), or this host when it is the workers.dev address. */
  panelHost() {
    const configured = (this.env.APP_HOST || "").toLowerCase().trim();
    if (configured) return configured;
    return this.isBackupPanel() ? this.host : null;
  }

  // The *.workers.dev address always keeps the panel, so a domain mistake can never lock the owner out.
  isBackupPanel() {
    return this.host.endsWith(".workers.dev") || this.host === "localhost";
  }

  isPanel() {
    return this.host === this.panelHost() || this.isBackupPanel();
  }

  async form() {
    if (!this._form) {
      const ct = this.req.headers.get("Content-Type") || "";
      this._form = ct.includes("form") ? await this.req.formData() : new FormData();
    }
    return this._form;
  }

  flash(cat, msg) {
    const list = this._pendingFlash || [];
    list.push([cat, msg]);
    this._pendingFlash = list;
  }

  respond(body, status = 200, headers = {}) {
    const h = new Headers(headers);
    if (!h.has("Content-Type")) h.set("Content-Type", "text/html; charset=utf-8");
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Referrer-Policy", "strict-origin-when-cross-origin");
    h.set("X-Frame-Options", "DENY");
    h.set("Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action 'self'");
    h.set("Cache-Control", "no-store");
    if (this._pendingFlash) {
      this.setCookies.push(cookie("flash", JSON.stringify(this._pendingFlash), { secure: this.secure, maxAge: 60 }));
    } else if (this.cookies.flash !== undefined && this._flashRead) {
      this.setCookies.push(cookie("flash", "", { secure: this.secure, maxAge: 0 }));
    }
    for (const c of this.setCookies) h.append("Set-Cookie", c);
    return new Response(body, { status, headers: h });
  }

  redirect(location, status = 303) {
    return this.respond(null, status, { Location: location });
  }

  readFlashes() {
    this._flashRead = true;
    try {
      this.flashes = JSON.parse(this.cookies.flash || "[]");
    } catch {
      this.flashes = [];
    }
  }

  csrfToken() {
    if (!this._csrf) {
      this._csrf = this.cookies.csrf || randomToken(24);
      if (!this.cookies.csrf) {
        this.setCookies.push(cookie("csrf", this._csrf, { secure: this.secure, maxAge: 60 * 60 * 24 * 30 }));
      }
    }
    return this._csrf;
  }

  view() {
    this.readFlashes();
    return { csrf: this.csrfToken(), flashes: this.flashes, scheme: this.scheme, assetVersion: ASSET_VERSION };
  }
}

// ---------------------------------------------------------------- the redirect

async function serveShort(c, slashtag) {
  const { db } = c;
  if (!["GET", "HEAD"].includes(c.req.method)) return c.respond("Método não permitido", 405, { "Content-Type": "text/plain" });

  const domain = await db.prepare("select * from domains where full_name = ?").bind(c.host).first();
  if (slashtag === ".well-known/shortlinks-verify") {
    if (!domain) return c.respond(V.publicNotFound(ASSET_VERSION), 404);
    return new Response(await domainToken(c.secret, c.host), {
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  }
  if (!domain) return c.respond(V.publicNotFound(ASSET_VERSION), 404);
  if (!domain.active) {
    // A request reached this Worker on this host: Cloudflare is routing it here.
    const ts = now();
    await db.prepare("update domains set active = 1, verified_at = ?, last_check_error = null, updated_at = ? where id = ?")
      .bind(ts, ts, domain.id).run();
  }

  let link = null;
  if (slashtag && !slashtag.includes("/")) {
    link = await db.prepare("select * from links where domain_id = ? and slashtag_lower = ?")
      .bind(domain.id, slashtag.toLowerCase()).first();
  }
  if (!link) {
    if (domain.not_found_url) {
      return new Response(null, { status: 302, headers: { Location: domain.not_found_url, "Cache-Control": "private, no-store" } });
    }
    return c.respond(V.publicNotFound(ASSET_VERSION), 404);
  }

  // Cloudflare fills request.cf; the header is only a fallback for local runs.
  const country = (c.req.cf?.country || (c.req.cf ? "" : c.req.headers.get("CF-IPCountry")) || "").toUpperCase().slice(0, 2) || null;
  const allowed = core.geoAllows(link.geo_mode, link.geo_countries, country);

  let target = link.destination;
  if (link.forward_parameters) target = core.forwardQuery(target, c.url.search);

  if (c.req.method === "GET") {
    const ua = (c.req.headers.get("User-Agent") || "").slice(0, 400);
    const purpose = c.req.headers.get("Purpose") || c.req.headers.get("Sec-Purpose") || "";
    const bot = core.isBot(ua) || purpose.startsWith("prefetch");
    let ref = null;
    try {
      ref = new URL(c.req.headers.get("Referer") || "").hostname || null;
    } catch { /* no referrer */ }
    const ts = now();
    const { device, os } = core.parseDevice(ua);
    const writes = [db.prepare(
      "insert into clicks (link_id, at, referrer_host, user_agent, is_bot, country, device, os, blocked) values (?,?,?,?,?,?,?,?,?)",
    ).bind(link.id, ts, ref, ua, bot ? 1 : 0, country, device, os, allowed ? 0 : 1)];
    if (!bot && allowed) {
      writes.push(db.prepare("update links set clicks = clicks + 1, last_click_at = ? where id = ?").bind(ts, link.id));
      if (link.track) {
        const t = TR.trackClick(c, link, { country, device });
        target = t.target;
        writes.push(t.write);
      }
    }
    // Record after answering: the visitor never waits for the database.
    c.exec.waitUntil(db.batch(writes).catch((e) => console.error("click not recorded", e)));
  }
  if (!allowed) {
    return new Response(V.geoBlocked(ASSET_VERSION), {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
    });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}

// ---------------------------------------------------------------- panel helpers

async function currentUser(c) {
  const s = await readSession(c.secret, c.cookies.s);
  if (!s) return null;
  return c.db.prepare("select * from users where id = ?").bind(s.uid).first();
}

async function startSession(c, uid) {
  const value = await signSession(c.secret, { uid, exp: Date.now() + SESSION_DAYS * 864e5 });
  c.setCookies.push(cookie("s", value, { secure: c.secure, maxAge: SESSION_DAYS * 86400 }));
}

async function userDomains(c, activeOnly = false) {
  const sql = "select * from domains where user_id = ?" + (activeOnly ? " and active = 1" : "")
    + " order by is_default desc, type desc, full_name";
  return (await c.db.prepare(sql).bind(c.user.id).all()).results;
}

async function getLink(c, id) {
  return c.db.prepare(
    "select l.*, d.full_name as domain_name from links l join domains d on d.id = l.domain_id where l.id = ? and l.user_id = ?",
  ).bind(id, c.user.id).first();
}

async function getDomain(c, id) {
  return c.db.prepare("select * from domains where id = ? and user_id = ?").bind(id, c.user.id).first();
}

async function readLinkForm(c) {
  const f = await c.form();
  const values = {};
  for (const k of ["destination", "domain_id", "slashtag", "title", "utm_source", "utm_medium", "utm_campaign"]) {
    values[k] = String(f.get(k) ?? "");
  }
  const errors = {};
  let dest = null;
  let slug = null;
  try {
    dest = core.cleanDestination(values.destination);
    dest = core.addUtm(dest, { source: values.utm_source, medium: values.utm_medium, campaign: values.utm_campaign });
    if (dest.length > core.DEST_MAX) throw new core.ValidationError("destination", "Com as UTMs o destino passa de 2.048 caracteres.");
  } catch (e) {
    if (!(e instanceof core.ValidationError)) throw e;
    errors[e.field] = e.message;
  }
  try {
    slug = core.cleanSlug(values.slashtag);
  } catch (e) {
    if (!(e instanceof core.ValidationError)) throw e;
    errors[e.field] = e.message;
  }
  const domain = await c.db.prepare("select * from domains where id = ? and user_id = ? and active = 1")
    .bind(values.domain_id, c.user.id).first();
  if (!domain) errors.domain_id = "Escolha um domínio ativo.";
  const title = values.title.trim().slice(0, 200) || null;
  values.geo_mode = String(f.get("geo_mode") || "off");
  values.geo_countries = f.getAll("geo_countries").map(String).join(",");
  let geo = { mode: "off", countries: "" };
  try {
    geo = core.cleanGeo(values.geo_mode, f.getAll("geo_countries"));
  } catch (e) {
    if (!(e instanceof core.ValidationError)) throw e;
    errors[e.field] = e.message;
  }
  values.track = f.get("track") ? "1" : "";
  values.network = NETWORKS[String(f.get("network"))] ? String(f.get("network")) : "other";
  values.sub_param = String(f.get("sub_param") || "");
  values.track_source = LINK_SOURCES.includes(String(f.get("track_source"))) ? String(f.get("track_source")) : "ads";
  const track = { on: values.track ? 1 : 0, network: values.network, sub_param: cleanParam(values.sub_param), source: values.track_source };
  if (track.on && !track.sub_param) errors.sub_param = "Use só letras, números, ponto, hífen ou sublinhado (ex.: tid).";
  return { values, errors, dest, slug, domain, title, geo, track };
}

async function listLinks(c, q = "", domainFilter = "") {
  let sql = "select l.*, d.full_name as domain_name from links l join domains d on d.id = l.domain_id where l.user_id = ?";
  const args = [c.user.id];
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    sql += " and (l.title like ? or l.slashtag like ? or l.destination like ?)";
    args.push(like, like, like);
  }
  if (domainFilter) {
    sql += " and l.domain_id = ?";
    args.push(domainFilter);
  }
  sql += " order by l.created_at desc, l.rowid desc limit 500";
  return (await c.db.prepare(sql).bind(...args).all()).results;
}

function dayKey(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// ---------------------------------------------------------------- panel routes

async function setup(c) {
  if (await c.db.prepare("select 1 from users limit 1").first()) return c.redirect("/login");
  if (c.req.method === "GET") return c.respond(V.setupView(c.view(), {}));
  const f = await c.form();
  const email = String(f.get("email") || "").trim().toLowerCase();
  const pw = String(f.get("password") || "");
  const errors = {};
  if (!email.includes("@") || email.length > 254) errors.email = "Digite um e-mail válido.";
  if (pw.length < 12) errors.password = "Use pelo menos 12 caracteres.";
  if (Object.keys(errors).length) return c.respond(V.setupView(c.view(), { errors, email }), 422);
  const uid = newId();
  const ts = now();
  const host = c.panelHost();
  try {
    // "where not exists" makes the owner unique even if two setups race.
    const res = await c.db.prepare(
      "insert into users (id, email, password_hash, created_at, updated_at) select ?,?,?,?,? where not exists (select 1 from users)",
    ).bind(uid, email, await hashPassword(pw), ts, ts).run();
    if (!res.meta?.changes) return c.redirect("/login");
    await c.db.prepare(
      "insert or ignore into domains (id, user_id, full_name, type, active, is_default, verified_at, created_at, updated_at) values (?,?,?, 'service', 1, 1, ?,?,?)",
    ).bind(newId(), uid, host, ts, ts, ts).run();
  } catch (e) {
    if (isUnique(e)) return c.redirect("/login");
    throw e;
  }
  await startSession(c, uid);
  return c.redirect("/links");
}

async function login(c) {
  if (!(await c.db.prepare("select 1 from users limit 1").first())) return c.redirect("/setup");
  if (c.req.method === "GET") return c.respond(V.loginView(c.view(), {}));
  const f = await c.form();
  const email = String(f.get("email") || "").trim().toLowerCase();
  const since = Date.now() - LOGIN_WINDOW_MS;
  await c.db.prepare("delete from login_attempts where at < ?").bind(since).run();
  const tries = (await c.db.prepare("select count(*) as n from login_attempts where ip = ? and at >= ?").bind(c.ip, since).first()).n;
  if (tries >= LOGIN_MAX) {
    return c.respond(V.loginView(c.view(), { error: "Muitas tentativas. Espere 15 minutos e tente de novo.", email }), 429);
  }
  const user = await c.db.prepare("select * from users where email = ?").bind(email).first();
  if (user && (await checkPassword(String(f.get("password") || ""), user.password_hash))) {
    await c.db.prepare("delete from login_attempts where ip = ?").bind(c.ip).run();
    await startSession(c, user.id);
    let next = c.url.searchParams.get("next") || "";
    if (!next.startsWith("/") || next.startsWith("//")) next = "/links";
    return c.redirect(next);
  }
  await c.db.prepare("insert into login_attempts (ip, at) values (?, ?)").bind(c.ip, Date.now()).run();
  return c.respond(V.loginView(c.view(), { error: "E-mail ou senha incorretos.", email }), 401);
}

async function linksPage(c) {
  const q = (c.url.searchParams.get("q") || "").trim();
  const domainFilter = c.url.searchParams.get("domain") || "";
  const rows = await listLinks(c, q, domainFilter);
  const total = (await c.db.prepare("select count(*) as n from links where user_id = ?").bind(c.user.id).first()).n;
  return c.respond(V.linksView(c.view(), {
    rows, total, q, domainFilter, domains: await userDomains(c), activeDomains: await userDomains(c, true),
    newId: c.url.searchParams.get("new"),
  }));
}

async function createLink(c) {
  const { values, errors, dest, slug, domain, title, geo, track } = await readLinkForm(c);
  if (!Object.keys(errors).length) {
    const ts = now();
    const id = newId();
    const tries = slug ? 1 : 5;
    for (let i = 0; i < tries; i++) {
      const s = slug || core.randomSlug();
      try {
        await c.db.prepare(
          "insert into links (id, user_id, domain_id, slashtag, slashtag_lower, destination, title, geo_mode, geo_countries, track, network, sub_param, track_source, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(id, c.user.id, domain.id, s, s.toLowerCase(), dest, title, geo.mode, geo.countries, track.on, track.on ? track.network : null, track.on ? track.sub_param : null, track.source, ts, ts).run();
        c.flash("success", "Link criado.");
        return c.redirect(`/links?new=${id}`);
      } catch (e) {
        if (!isUnique(e)) throw e;
      }
    }
    if (slug) errors.slashtag = `/${slug} já está em uso em ${domain.full_name}.`;
    else errors.form = "Não consegui gerar um final livre. Tente de novo.";
  }
  const rows = await listLinks(c);
  return c.respond(V.linksView(c.view(), {
    rows, total: rows.length, q: "", domainFilter: "", domains: await userDomains(c),
    activeDomains: await userDomains(c, true), newId: null, formValues: values, formErrors: errors, openDrawer: true,
  }), 422);
}

async function editLink(c, id) {
  const link = await getLink(c, id);
  if (!link) return notFound(c);
  let values = {
    destination: link.destination, slashtag: link.slashtag, title: link.title || "", domain_id: link.domain_id,
    geo_mode: link.geo_mode || "off", geo_countries: link.geo_countries || "",
    track: link.track ? "1" : "", network: link.network || "clickbank", sub_param: link.sub_param || "", track_source: link.track_source || "ads",
  };
  let errors = {};
  if (c.req.method === "POST") {
    const r = await readLinkForm(c);
    values = r.values;
    errors = r.errors;
    if (!r.slug && !errors.slashtag) errors.slashtag = "O final do link não pode ficar vazio.";
    if (!Object.keys(errors).length) {
      try {
        await c.db.prepare(
          "update links set destination = ?, slashtag = ?, slashtag_lower = ?, title = ?, domain_id = ?, geo_mode = ?, geo_countries = ?, track = ?, network = ?, sub_param = ?, track_source = ?, updated_at = ? where id = ? and user_id = ?",
        ).bind(r.dest, r.slug, r.slug.toLowerCase(), r.title, r.domain.id, r.geo.mode, r.geo.countries, r.track.on,
          r.track.on ? r.track.network : null, r.track.on ? r.track.sub_param : null, r.track.source, now(), id, c.user.id).run();
        c.flash("success", "Alterações salvas.");
        return c.redirect("/links");
      } catch (e) {
        if (!isUnique(e)) throw e;
        errors.slashtag = `/${r.slug} já está em uso em ${r.domain.full_name}.`;
      }
    }
  }
  return c.respond(V.editView(c.view(), { link, values, errors, activeDomains: await userDomains(c, true) }),
    Object.keys(errors).length ? 422 : 200);
}

async function deleteLink(c, id) {
  const link = await getLink(c, id);
  if (!link) return notFound(c);
  await c.db.prepare("delete from links where id = ? and user_id = ?").bind(id, c.user.id).run();
  c.flash("success", `Link /${link.slashtag} apagado.`);
  return c.redirect("/links");
}

async function linkStats(c, id) {
  const link = await getLink(c, id);
  if (!link) return notFound(c);
  const today = new Date();
  const keys = [];
  for (let i = 29; i >= 0; i--) keys.push(dayKey(new Date(today.getTime() - i * 864e5)));
  const since = new Date(today.getTime() - 31 * 864e5).toISOString();
  const rows = (await c.db.prepare("select at from clicks where link_id = ? and is_bot = 0 and blocked = 0 and at >= ?")
    .bind(id, since).all()).results;
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = dayKey(new Date(r.at));
    if (k in counts) counts[k]++;
  }
  const days = keys.map((k) => [`${k.slice(8, 10)}/${k.slice(5, 7)}`, counts[k]]);
  const refs = (await c.db.prepare(
    "select coalesce(referrer_host, 'Direto ou desconhecido') as ref, count(*) as n from clicks where link_id = ? and is_bot = 0 and blocked = 0 group by ref order by n desc limit 10",
  ).bind(id).all()).results;
  const bots = (await c.db.prepare("select count(*) as n from clicks where link_id = ? and is_bot = 1").bind(id).first()).n;
  const blocked = (await c.db.prepare("select count(*) as n from clicks where link_id = ? and is_bot = 0 and blocked = 1").bind(id).first()).n;
  const breakdown = async (col) => (await c.db.prepare(
    `select coalesce(${col}, '') as k, count(*) as n from clicks where link_id = ? and is_bot = 0 and blocked = 0 group by k order by n desc limit 10`,
  ).bind(id).all()).results;
  const countries = (await breakdown("country")).map((r) => ({ label: core.countryName(r.k), n: r.n }));
  const devices = (await breakdown("device")).map((r) => ({ label: core.DEVICE_LABELS[r.k] || "Desconhecido", n: r.n }));
  const systems = (await breakdown("os")).map((r) => ({ label: r.k || "Desconhecido", n: r.n }));
  const last30 = days.reduce((a, [, n]) => a + n, 0);
  return c.respond(V.statsView(c.view(), {
    link, days, peak: Math.max(1, ...days.map(([, n]) => n)), refs, bots, blocked, last30, countries, devices, systems,
  }));
}

async function domainsPage(c, error = null, value = "", status = 200) {
  const counts = Object.fromEntries((await c.db.prepare(
    "select domain_id, count(*) as n from links where user_id = ? group by domain_id",
  ).bind(c.user.id).all()).results.map((r) => [r.domain_id, r.n]));
  return c.respond(V.domainsView(c.view(), {
    domains: await userDomains(c), counts, error, value, panelHost: c.panelHost(),
  }), status);
}

async function addDomain(c) {
  const f = await c.form();
  const value = String(f.get("domain") || "");
  let name;
  try {
    name = core.cleanDomain(value);
  } catch (e) {
    return domainsPage(c, e.message, value, 422);
  }
  if (name === c.panelHost() || (name.endsWith(".workers.dev"))) {
    return domainsPage(c, "Esse é o endereço do painel; use outro domínio para os links.", value, 422);
  }
  const ts = now();
  try {
    await c.db.prepare(
      "insert into domains (id, user_id, full_name, type, active, created_at, updated_at) values (?,?,?, 'user', 0, ?, ?)",
    ).bind(newId(), c.user.id, name, ts, ts).run();
  } catch (e) {
    if (isUnique(e)) return domainsPage(c, "Esse domínio já está na sua lista.", value, 422);
    throw e;
  }
  c.flash("success", `${name} adicionado. Conecte-o ao app na Cloudflare e clique em Verificar.`);
  return c.redirect("/domains");
}

async function verifyDomain(c, id) {
  const d = await getDomain(c, id);
  if (!d) return notFound(c);
  const expected = await domainToken(c.secret, d.full_name);
  let ok = false;
  let reason = "sem resposta";
  try {
    const fetcher = c.env.__testFetch || fetch; // test hook only
    const r = await fetcher(`https://${d.full_name}/.well-known/shortlinks-verify`, {
      headers: { "User-Agent": "shortlinks-verify" }, redirect: "manual",
    });
    const body = (await r.text()).trim();
    ok = r.status === 200 && safeEqual(body, expected);
    reason = ok ? "" : `respondeu ${r.status}`;
  } catch (e) {
    reason = e?.name || "erro de conexão";
  }
  // The Worker may have activated it already when the check request arrived.
  const fresh = await getDomain(c, id);
  const ts = now();
  if (ok || fresh.active) {
    await c.db.prepare("update domains set active = 1, verified_at = coalesce(verified_at, ?), last_check_error = null, updated_at = ? where id = ?")
      .bind(ts, ts, id).run();
    c.flash("success", `${d.full_name} verificado e ativo.`);
  } else {
    // A Worker on *.workers.dev can get a 52x when it calls its own custom domain; a real visit settles it.
    const msg = `Não consegui confirmar daqui (${reason}). Abra https://${d.full_name} uma vez no navegador e recarregue esta página: a primeira visita ativa o domínio. Se não abrir, confira se ele está em Custom domain na Cloudflare.`;
    await c.db.prepare("update domains set last_check_error = ?, updated_at = ? where id = ?").bind(msg, ts, id).run();
    c.flash("error", msg);
  }
  return c.redirect("/domains");
}

async function defaultDomain(c, id) {
  const d = await getDomain(c, id);
  if (!d) return notFound(c);
  if (!d.active) {
    c.flash("error", "Verifique o domínio antes de torná-lo padrão.");
    return c.redirect("/domains");
  }
  await c.db.batch([
    c.db.prepare("update domains set is_default = 0 where user_id = ?").bind(c.user.id),
    c.db.prepare("update domains set is_default = 1 where id = ?").bind(id),
  ]);
  c.flash("success", `${d.full_name} agora é o domínio padrão.`);
  return c.redirect("/domains");
}

async function fallbackDomain(c, id) {
  const d = await getDomain(c, id);
  if (!d) return notFound(c);
  const raw = String((await c.form()).get("not_found_url") || "").trim();
  let url = null;
  try {
    url = raw ? core.cleanDestination(raw) : null;
  } catch (e) {
    c.flash("error", e.message);
    return c.redirect("/domains");
  }
  await c.db.prepare("update domains set not_found_url = ?, updated_at = ? where id = ?").bind(url, now(), id).run();
  c.flash("success", "Página de fallback salva.");
  return c.redirect("/domains");
}

async function deleteDomain(c, id) {
  const d = await getDomain(c, id);
  if (!d) return notFound(c);
  if (d.type === "service") {
    c.flash("error", "O domínio do painel não pode ser removido.");
    return c.redirect("/domains");
  }
  try {
    await c.db.prepare("delete from domains where id = ?").bind(id).run();
  } catch (e) {
    if (!isForeignKey(e)) throw e;
    c.flash("error", `${d.full_name} ainda tem links. Apague ou mova os links antes.`);
    return c.redirect("/domains");
  }
  if (d.is_default) {
    await c.db.prepare("update domains set is_default = 1 where user_id = ? and type = 'service'").bind(c.user.id).run();
  }
  c.flash("success", `${d.full_name} removido.`);
  return c.redirect("/domains");
}

function notFound(c) {
  return c.respond(V.publicNotFound(ASSET_VERSION), 404);
}

function serveAsset(c, name) {
  const a = ASSETS[name];
  if (!a) return notFound(c);
  const body = a.b64 ? Uint8Array.from(atob(a.body), (ch) => ch.charCodeAt(0)) : a.body;
  return new Response(body, {
    headers: { "Content-Type": a.type, "Cache-Control": "public, max-age=31536000, immutable", ETag: `"${a.etag}"` },
  });
}

// ---------------------------------------------------------------- router

const PANEL_ROUTES = [
  ["GET", /^\/links$/, linksPage],
  ["POST", /^\/links$/, createLink],
  ["GET", /^\/links\/([\w-]+)\/edit$/, editLink],
  ["POST", /^\/links\/([\w-]+)\/edit$/, editLink],
  ["POST", /^\/links\/([\w-]+)\/delete$/, deleteLink],
  ["GET", /^\/links\/([\w-]+)$/, linkStats],
  ["GET", /^\/results$/, TR.resultsPage],
  ["GET", /^\/sales$/, TR.salesPage],
  ["POST", /^\/sales\/([\w-]+)\/delete$/, TR.deleteSale],
  ["GET", /^\/settings$/, ST.settingsPage],
  ["POST", /^\/settings\/(currency|refunds|mute)$/, ST.settingsPost],
  ["GET", /^\/settings\/password$/, (c) => ST.passwordPage(c)],
  ["POST", /^\/settings\/password$/, ST.passwordPost],
  ["GET", /^\/integrations$/, (c) => TR.integrationsPage(c)],
  ["POST", /^\/integrations\/(settings|key|newsbreak-csv|cost|ntfy|telegram|notify-test|notify-prefs|templates|push-subscribe|push-delete-[\w-]+)$/, TR.integrationsPost],
  ["GET", /^\/domains$/, (c) => domainsPage(c)],
  ["POST", /^\/domains$/, addDomain],
  ["POST", /^\/domains\/([\w-]+)\/verify$/, verifyDomain],
  ["POST", /^\/domains\/([\w-]+)\/default$/, defaultDomain],
  ["POST", /^\/domains\/([\w-]+)\/fallback$/, fallbackDomain],
  ["POST", /^\/domains\/([\w-]+)\/delete$/, deleteDomain],
];

async function handle(req, env, exec) {
  const c = new Ctx(req, env, exec);
  const path = c.url.pathname;
  if (path.startsWith("/static/")) return serveAsset(c, path.slice(8));
  if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });

  await ensureSchema(c.db);
  c.secret = await getSecret(c.db);

  if (!c.isPanel()) return serveShort(c, decodePath(path.slice(1)));

  if (path === "/health") return new Response("ok", { headers: { "Content-Type": "text/plain" } });

  // Machine endpoints: the secret key in the path is the credential, so no session or CSRF.
  if (path === "/t.js") return TR.presellScript();
  if (path === "/apple-touch-icon.png" || path === "/apple-touch-icon-precomposed.png") {
    const a = ASSETS["apple-touch-icon-azul.png"];
    return new Response(Uint8Array.from(atob(a.body), (ch) => ch.charCodeAt(0)), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
  }
  if (path === "/sw.js") {
    return new Response(ASSETS["sw.js"].body, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
  }
  let m = path.match(/^\/pb\/([\w-]+)(?:\/([a-z0-9]+))?\/?$/);
  if (m) return TR.postback(c, m[1], m[2] || "other");
  m = path.match(/^\/cost\/([\w-]+)\/google$/);
  if (m) return TR.googleCost(c, m[1]);
  m = path.match(/^\/export\/([\w-]+)\/google\.csv$/);
  if (m) return TR.googleConversionsCsv(c, m[1]);

  if (req.method === "POST") {
    const sent = (await c.form()).get("csrf");
    if (!sent || !c.cookies.csrf || !safeEqual(sent, c.cookies.csrf)) {
      return c.respond("Sessão expirada. Recarregue a página e tente de novo.", 400, { "Content-Type": "text/plain; charset=utf-8" });
    }
  }

  if (path === "/setup") return setup(c);
  if (path === "/login") return login(c);
  if (path === "/logout" && req.method === "POST") {
    c.setCookies.push(cookie("s", "", { secure: c.secure, maxAge: 0 }));
    return c.redirect("/login");
  }
  if (path === "/") return c.redirect("/links");

  for (const [method, re, fn] of PANEL_ROUTES) {
    const m = path.match(re);
    if (m && method === req.method) {
      c.user = await currentUser(c);
      if (!c.user) {
        if (method !== "GET") return c.redirect("/login");
        return c.redirect(`/login?next=${encodeURIComponent(path + c.url.search)}`);
      }
      return fn(c, m[1]);
    }
  }
  // Anything else on the panel host is a short link on the panel's own domain.
  return serveShort(c, decodePath(path.slice(1)));
}

export default {
  async fetch(req, env, exec) {
    try {
      return await handle(req, env, exec);
    } catch (e) {
      console.error(e);
      return new Response("Algo deu errado. Tente de novo em instantes.", {
        status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
