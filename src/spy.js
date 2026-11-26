// "Espionar Google": a daily checklist of bottom-of-funnel keywords, opened as the Google of another country.
// Searches open in the owner's own browser, from his own connection: no VPN, no automated queries.
import { csrfField, fieldError, html, page, raw } from "./views.js";
import { newId } from "./security.js";

export const COUNTRIES = {
  US: { name: "Estados Unidos", hl: "en", loc: "United States", domain: "google.com" },
  CA: { name: "Canadá", hl: "en", loc: "Canada", domain: "google.ca" },
  GB: { name: "Reino Unido", hl: "en", loc: "United Kingdom", domain: "google.co.uk" },
  AU: { name: "Austrália", hl: "en", loc: "Australia", domain: "google.com.au" },
  NZ: { name: "Nova Zelândia", hl: "en", loc: "New Zealand", domain: "google.co.nz" },
  IE: { name: "Irlanda", hl: "en", loc: "Ireland", domain: "google.ie" },
  DE: { name: "Alemanha", hl: "de", loc: "Germany", domain: "google.de" },
  FR: { name: "França", hl: "fr", loc: "France", domain: "google.fr" },
  ES: { name: "Espanha", hl: "es", loc: "Spain", domain: "google.es" },
  IT: { name: "Itália", hl: "it", loc: "Italy", domain: "google.it" },
  PT: { name: "Portugal", hl: "pt-PT", loc: "Portugal", domain: "google.pt" },
  MX: { name: "México", hl: "es", loc: "Mexico", domain: "google.com.mx" },
  BR: { name: "Brasil", hl: "pt-BR", loc: "Brazil", domain: "google.com.br" },
};

const LUT = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Google's location hint for a canonical place name. */
export function uule(name) {
  return `w+CAIQICI${LUT[name.length] || "A"}${btoa(name).replace(/=+$/, "")}`;
}

/** Google search URL as seen from a country. kind: web | videos */
export function googleUrl(keyword, country, kind = "web") {
  const c = COUNTRIES[country] || COUNTRIES.US;
  const q = new URLSearchParams({ q: keyword, gl: country.toLowerCase(), hl: c.hl, pws: "0" });
  if (kind === "videos") q.set("tbm", "vid");
  return `https://www.${c.domain}/search?${q}&uule=${encodeURIComponent(uule(c.loc)).replace(/%2B/g, "+")}`;
}

export const LANGS = { en: "English", es: "Español", pt: "Português", de: "Deutsch", fr: "Français", it: "Italiano" };

/** Search URL for the simple form: Google or Bing, a country and a language. */
export function searchUrl({ q, engine, country, lang, kind }) {
  const c = COUNTRIES[country] || COUNTRIES.US;
  const hl = LANGS[lang] ? lang : c.hl.slice(0, 2);
  if (engine === "bing") {
    return `https://www.bing.com/search?${new URLSearchParams({ q, cc: country.toLowerCase(), setlang: `${hl}-${country.toLowerCase()}`, mkt: `${hl}-${country}` })}`;
  }
  const url = new URL(googleUrl(q, country, kind === "videos" ? "videos" : "web"));
  url.searchParams.set("hl", hl);
  return url.toString().replace(/uule=w%2BCAIQ/, "uule=w+CAIQ");
}

/** /spy/go: opens the search in a new tab from the simple form. */
export function spyGo(c) {
  const p = c.url.searchParams;
  const q = String(p.get("q") || "").trim().slice(0, 200);
  if (!q) return c.redirect("/spy");
  const country = COUNTRIES[p.get("country")] ? p.get("country") : "US";
  const target = searchUrl({ q, engine: p.get("engine"), country, lang: p.get("lang"), kind: p.get("kind") });
  // A page, not a redirect: the panel's CSP (form-action 'self') forbids a form redirecting to another site.
  const e = (x) => String(x).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const body = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0;url=${e(target)}"><title>Abrindo a busca…</title></head>
<body style="font-family:system-ui;padding:24px"><p>Abrindo a busca… <a href="${e(target)}" rel="noreferrer">Clique aqui se não abrir.</a></p></body></html>`;
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Search-Target": target } });
}

export const youtubeUrl = (keyword) => `https://www.youtube.com/results?${new URLSearchParams({ search_query: keyword })}`;
export const transparencyUrl = (domain, country) =>
  `https://adstransparency.google.com/?${new URLSearchParams({ region: country, domain })}`;

const spToday = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const STATUS = { yes: "Rankeando", no: "Fora", ad: "Só anúncio" };

export async function spyPage(c, extra = {}, status = 200) {
  const kws = (await c.db.prepare("select * from spy_keywords order by created_at").all()).results;
  const since = addDays(spToday(), -13);
  const checks = (await c.db.prepare("select keyword_id, date, status, note from spy_checks where date >= ?").bind(since).all()).results;
  const domains = (await c.db.prepare("select * from spy_domains order by created_at").all()).results;
  return c.respond(spyView(c.view(), { kws, checks, domains, ...extra }), status);
}

export async function spyPost(c, action) {
  const f = await c.form();
  const country = COUNTRIES[String(f.get("country"))] ? String(f.get("country")) : "US";
  if (action === "add") {
    const lines = String(f.get("keywords") || "").split(/\r?\n|,/).map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 100);
    if (!lines.length) return spyPage(c, { kwError: "Digite pelo menos uma palavra.", kwValue: "" }, 422);
    const ts = new Date().toISOString();
    let added = 0;
    for (const k of lines) {
      const res = await c.db.prepare("insert or ignore into spy_keywords (id, keyword, country, created_at) values (?,?,?,?)")
        .bind(newId(), k.slice(0, 120), country, ts).run();
      added += res.meta?.changes || 0;
    }
    c.flash("success", added ? `${added} palavra(s) adicionada(s).` : "Essas palavras já estavam na lista.");
  } else if (action.startsWith("del-")) {
    await c.db.prepare("delete from spy_keywords where id = ?").bind(action.slice(4)).run();
    c.flash("success", "Palavra removida.");
  } else if (action.startsWith("check-")) {
    const st = String(f.get("status"));
    const id = action.slice(6);
    const date = spToday();
    if (st === "clear") {
      await c.db.prepare("delete from spy_checks where keyword_id = ? and date = ?").bind(id, date).run();
    } else if (STATUS[st]) {
      await c.db.prepare(
        "insert into spy_checks (keyword_id, date, status, note) values (?,?,?,?) on conflict(keyword_id, date) do update set status = excluded.status, note = coalesce(excluded.note, spy_checks.note)",
      ).bind(id, date, st, String(f.get("note") || "").trim().slice(0, 200) || null).run();
    }
    return c.redirect(`/spy#kw-${id}`);
  } else if (action === "domain") {
    const raw = String(f.get("domain") || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(raw)) return spyPage(c, { domError: "Digite só o domínio, por exemplo concorrente.com." }, 422);
    await c.db.prepare("insert or ignore into spy_domains (id, domain, country, created_at) values (?,?,?,?)")
      .bind(newId(), raw, country, new Date().toISOString()).run();
    c.flash("success", `${raw} adicionado.`);
  } else if (action.startsWith("deldom-")) {
    await c.db.prepare("delete from spy_domains where id = ?").bind(action.slice(7)).run();
    c.flash("success", "Domínio removido.");
  }
  return c.redirect("/spy");
}

function countrySelect(id, sel = "US") {
  return html`<select id="${id}" name="country">${Object.entries(COUNTRIES).map(([k, v]) => html`<option value="${k}" ${k === sel ? raw("selected") : ""}>${v.name}</option>`)}</select>`;
}

function spyView(c, { kws, checks, domains, kwError, kwValue = "", domError }) {
  const today = spToday();
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(addDays(today, -i));
  const map = new Map(checks.map((x) => [`${x.keyword_id}|${x.date}`, x]));
  const done = kws.filter((k) => map.has(`${k.id}|${today}`)).length;
  const ranking = kws.filter((k) => map.get(`${k.id}|${today}`)?.status === "yes").length;
  const btn = (k, st, label, cur) => html`<button class="btn btn-xs ${cur === st ? "btn-primary" : "btn-secondary"}" type="submit" name="status" value="${st}" ${cur === st ? raw('aria-pressed="true"') : raw('aria-pressed="false"')}>${label}</button>`;
  return page({ ...c, section: "spy" }, "Espionar Google", html`
<header class="page-head">
  <div><h1 class="h-xl">Pesquisar em outro país</h1>
  <p class="muted">Veja o Google como alguém de outro país vê.</p></div>
</header>

<section class="card pad search-card">
  <form method="get" action="/spy/go" target="_blank" class="stack">
    <div class="field">
      <label for="sq">Palavra</label>
      <input id="sq" name="q" type="search" required maxlength="200" placeholder="Ex.: sodapeak review" autocomplete="off">
    </div>
    <fieldset class="seg">
      <legend>Buscador</legend>
      <label><input type="radio" name="engine" value="google" checked><span>Google</span></label>
      <label><input type="radio" name="engine" value="bing"><span>Bing</span></label>
    </fieldset>
    <div class="field-row">
      <div class="field"><label for="s-country">País</label>${countrySelect("s-country")}</div>
      <div class="field"><label for="s-lang">Idioma</label><select id="s-lang" name="lang">${Object.entries(LANGS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div>
    </div>
    <fieldset class="seg">
      <legend>Mostrar</legend>
      <label><input type="radio" name="kind" value="web" checked><span>Tudo</span></label>
      <label><input type="radio" name="kind" value="videos"><span>Só vídeos</span></label>
    </fieldset>
    <button class="btn btn-primary btn-block btn-lg" type="submit">Pesquisar</button>
    <p class="hint">Abre numa aba nova, direto da sua internet (sem VPN), então não dá o erro 403. Os resultados e os vídeos saem como os do país escolhido; anúncios podem variar.</p>
  </form>
</section>

<h2 class="h-lg section-title">Minhas palavras do dia <span class="muted small">· hoje ${done} de ${kws.length} conferidas, rankeando em ${ranking}</span></h2>
<section class="card table-wrap">
  ${kws.length ? html`
  <table class="links-table spy-table">
    <thead><tr><th scope="col">Palavra</th><th scope="col">Abrir</th><th scope="col">Hoje</th><th scope="col">Últimos 14 dias</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
    <tbody>${kws.map((k) => {
      const cur = map.get(`${k.id}|${today}`);
      return html`<tr id="kw-${k.id}" class="${cur ? "is-checked" : ""}">
        <td data-label="Palavra"><strong>${k.keyword}</strong><div class="hint">${COUNTRIES[k.country]?.name || k.country}</div></td>
        <td data-label="Abrir"><div class="actions start">
          <a class="btn btn-primary btn-xs" href="${googleUrl(k.keyword, k.country)}" target="_blank" rel="noopener noreferrer">Google</a>
          <a class="btn btn-secondary btn-xs" href="${googleUrl(k.keyword, k.country, "videos")}" target="_blank" rel="noopener noreferrer">Vídeos</a>
          <a class="btn btn-ghost btn-xs" href="${youtubeUrl(k.keyword)}" target="_blank" rel="noopener noreferrer">YouTube</a>
        </div></td>
        <td data-label="Hoje"><form method="post" action="/spy/check-${k.id}" class="actions start">
          ${csrfField(c)}${btn(k, "yes", "Rankeando", cur?.status)}${btn(k, "no", "Fora", cur?.status)}${btn(k, "ad", "Só anúncio", cur?.status)}
          ${cur ? html`<button class="btn btn-ghost btn-xs" type="submit" name="status" value="clear" aria-label="Desmarcar ${k.keyword}">↺</button>` : ""}
        </form></td>
        <td data-label="14 dias"><div class="streak" role="img" aria-label="Histórico de ${k.keyword}">${days.map((d) => {
          const x = map.get(`${k.id}|${d}`);
          return html`<span class="dot dot-${x?.status || "none"}" title="${ddmm(d)}: ${x ? STATUS[x.status] : "não conferida"}"></span>`;
        })}</div></td>
        <td class="actions-cell"><form method="post" action="/spy/del-${k.id}" data-confirm="Remover “${k.keyword}” e o histórico dela?">${csrfField(c)}<button class="btn btn-ghost btn-xs danger-text" type="submit">Remover</button></form></td>
      </tr>`;
    })}</tbody>
  </table>
  <p class="hint pad-x"><span class="dot dot-yes"></span> rankeando <span class="dot dot-no"></span> fora <span class="dot dot-ad"></span> só anúncio <span class="dot dot-none"></span> não conferida. A busca abre no seu navegador, sem VPN, já como o Google do país escolhido.</p>`
    : html`<div class="empty"><h2 class="h-lg">Monte sua lista do dia</h2><p class="muted">Adicione as palavras de fundo de funil que você confere todo dia, como “sodapeak review”. Cada uma vira um botão que abre o Google do país certo.</p></div>`}
</section>

<section class="card pad narrow">
  <h2 class="h-lg">Adicionar palavras</h2>
  <form method="post" action="/spy/add" class="stack" novalidate>
    ${csrfField(c)}
    <div class="field">
      <label for="keywords">Palavras (uma por linha)</label>
      <textarea id="keywords" name="keywords" rows="4" placeholder="sodapeak review&#10;honeyboost reviews&#10;sodapeak scam" ${kwError ? raw('aria-invalid="true" aria-describedby="kw-err"') : ""}>${kwValue}</textarea>
      ${fieldError("kw-err", kwError)}
    </div>
    <div class="field-row">
      <div class="field"><label for="kw-country">País do Google</label>${countrySelect("kw-country")}</div>
      <div class="field field-end"><button class="btn btn-primary" type="submit">Adicionar</button></div>
    </div>
  </form>
</section>

<section class="card pad narrow">
  <h2 class="h-lg">Anúncios dos concorrentes</h2>
  <p class="muted">Todos os anúncios que um site rodou no Google num país, pela Central de Transparência de Anúncios do Google.</p>
  ${domains.length ? html`<table class="simple"><tbody>${domains.map((d) => html`<tr>
    <td><strong>${d.domain}</strong><div class="hint">${COUNTRIES[d.country]?.name || d.country}</div></td>
    <td class="actions-cell"><div class="actions">
      <a class="btn btn-secondary btn-xs" href="${transparencyUrl(d.domain, d.country)}" target="_blank" rel="noopener noreferrer">Ver anúncios</a>
      <form method="post" action="/spy/deldom-${d.id}">${csrfField(c)}<button class="btn btn-ghost btn-xs danger-text" type="submit">Remover</button></form>
    </div></td></tr>`)}</tbody></table>` : ""}
  <form method="post" action="/spy/domain" class="field-row" novalidate>
    ${csrfField(c)}
    <div class="field grow"><label for="spy-domain">Site do concorrente</label>
      <input id="spy-domain" name="domain" placeholder="concorrente.com" autocomplete="off" spellcheck="false" ${domError ? raw('aria-invalid="true" aria-describedby="dom-err"') : ""}>
      ${fieldError("dom-err", domError)}</div>
    <div class="field"><label for="dom-country">País</label>${countrySelect("dom-country")}</div>
    <div class="field field-end"><button class="btn btn-secondary" type="submit">Adicionar</button></div>
  </form>
  <p class="hint">Para ver a página de resultados com anúncios de qualquer cidade, sem contar impressão: no Google Ads, Ferramentas → Solução de problemas → Visualização e diagnóstico de anúncios.</p>
</section>`);
}
