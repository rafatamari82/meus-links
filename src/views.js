// HTML views. Every interpolated value is escaped unless wrapped in raw().
import { countryName, countryOptions } from "./core.js";
import { ACCENTS, LANGS, TEMPLATES } from "./pages.js";

import { esc, html, raw } from "./html.js";
export { esc, html, raw };

const TZ = "America/Sao_Paulo";
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)).replace(",", "") : "—");

const ICON = raw('<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9.5 14.5l5-5M8 11l-2 2a3.5 3.5 0 005 5l2-2M16 13l2-2a3.5 3.5 0 00-5-5l-2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>');
const csrfField = (c) => html`<input type="hidden" name="csrf" value="${c.csrf}">`;

function head(title, assetVersion) {
  return html`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title} · Meus links</title>
  <link rel="stylesheet" href="/static/tokens.css?v=${assetVersion}">
  <link rel="stylesheet" href="/static/app.css?v=${assetVersion}">
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
  <script src="/static/app.js?v=${assetVersion}" defer></script>
</head>`;
}

function flashes(c) {
  if (!c.flashes?.length) return "";
  return html`<div class="toasts" role="status">${c.flashes.map(([cat, msg]) => html`<div class="toast toast-${cat}">${msg}</div>`)}</div>`;
}

export function page(c, title, body) {
  const nav = (href, label, active) =>
    html`<a href="${href}" class="nav-item ${active ? "is-current" : ""}" ${active ? raw('aria-current="page"') : ""}>${label}</a>`;
  return html`${head(title, c.assetVersion)}
<body class="panel">
<div class="shell">
  <aside class="sidebar" aria-label="Navegação">
    <a class="brand" href="/links">${ICON}<span>Meus links</span></a>
    <nav>${nav("/links", "Links", c.section === "links")}${nav("/pages", "Páginas", c.section === "pages")}${nav("/domains", "Domínios", c.section === "domains")}</nav>
    <form method="post" action="/logout" class="sidebar-foot">${csrfField(c)}<button class="btn btn-ghost btn-sm" type="submit">Sair</button></form>
  </aside>
  <main class="main" id="main">${flashes(c)}${body}</main>
</div>
<div class="sr-only" aria-live="polite" id="live"></div>
</body></html>`.s;
}

function authPage(c, title, body) {
  return html`${head(title, c.assetVersion)}
<body class="auth"><main class="auth-card" id="main">
  <div class="brand brand-center">${ICON}<span>Meus links</span></div>
  ${body}
</main></body></html>`.s;
}

const fieldError = (id, msg) => (msg ? html`<p class="field-error" id="${id}">${msg}</p>` : "");
const invalid = (id, msg) => (msg ? raw(`aria-invalid="true" aria-describedby="${id}"`) : "");

export function setupView(c, { errors = {}, email = "" }) {
  return authPage(c, "Primeiro acesso", html`
<h1 class="h-lg">Crie a conta do dono</h1>
<p class="muted">Só existe uma conta. Depois de criada, esta página deixa de existir.</p>
<form method="post" class="stack" novalidate>
  ${csrfField(c)}
  <div class="field">
    <label for="email">E-mail</label>
    <input id="email" name="email" type="email" autocomplete="email" value="${email}" required ${invalid("email-err", errors.email)}>
    ${fieldError("email-err", errors.email)}
  </div>
  <div class="field">
    <label for="password">Senha</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required minlength="12" ${invalid("pw-err", errors.password)}>
    ${errors.password ? fieldError("pw-err", errors.password) : html`<p class="hint">Pelo menos 12 caracteres.</p>`}
  </div>
  <button class="btn btn-primary btn-block" type="submit">Criar conta</button>
</form>`);
}

export function loginView(c, { error, email = "" }) {
  return authPage(c, "Entrar", html`
<h1 class="h-lg">Entrar</h1>
${error ? html`<p class="alert alert-error" role="alert">${error}</p>` : ""}
<form method="post" class="stack">
  ${csrfField(c)}
  <div class="field"><label for="email">E-mail</label>
    <input id="email" name="email" type="email" autocomplete="email" value="${email}" required autofocus></div>
  <div class="field"><label for="password">Senha</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required></div>
  <button class="btn btn-primary btn-block" type="submit">Entrar</button>
</form>`);
}

export function publicNotFound(assetVersion) {
  return html`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Link não encontrado</title>
<link rel="stylesheet" href="/static/tokens.css?v=${assetVersion}"><link rel="stylesheet" href="/static/app.css?v=${assetVersion}"></head>
<body class="auth"><main class="auth-card center">
<h1 class="h-lg">Link não encontrado</h1>
<p class="muted">Esse endereço não existe ou foi removido. Confira se digitou certo.</p>
</main></body></html>`.s;
}

let OPTIONS = null;
function geoFields(v, e) {
  OPTIONS ??= countryOptions();
  const mode = v.geo_mode || "off";
  const chosen = new Set(String(v.geo_countries || "").split(",").filter(Boolean));
  const radio = (val, label) => html`<label class="check"><input type="radio" name="geo_mode" value="${val}" ${mode === val ? raw("checked") : ""} data-geo-mode> ${label}</label>`;
  return html`
<details class="utm geo" ${mode !== "off" || e.geo ? raw("open") : ""}>
  <summary>Países ${mode === "off" ? "" : html`<span class="badge badge-warning">${mode === "block" ? "bloqueando" : "só liberados"}: ${chosen.size}</span>`}</summary>
  <fieldset class="geo-modes" ${e.geo ? raw('aria-describedby="geo-err"') : ""}>
    <legend class="sr-only">Onde o link funciona</legend>
    ${radio("off", "Funciona em todos os países")}
    ${radio("block", "Bloquear os países marcados")}
    ${radio("allow", "Funcionar só nos países marcados")}
  </fieldset>
  ${fieldError("geo-err", e.geo)}
  <div class="geo-picker" ${mode === "off" ? raw("hidden") : ""}>
    <label class="sr-only" for="geo-filter">Procurar país</label>
    <input id="geo-filter" type="search" placeholder="Procurar país…" data-geo-filter autocomplete="off">
    <p class="hint"><span data-geo-count>${chosen.size}</span> marcado(s). Quem estiver num país bloqueado vê “Oi, curioso! Aqui não.”</p>
    <div class="geo-list" role="group" aria-label="Países">
      ${OPTIONS.map(([code, name]) => html`<label class="check geo-item" data-name="${name.toLowerCase()} ${code.toLowerCase()}"><input type="checkbox" name="geo_countries" value="${code}" ${chosen.has(code) ? raw("checked") : ""}> ${name}</label>`)}
    </div>
  </div>
</details>`;
}

function linkFields(values, errors, domains, editing) {
  const v = values || {};
  const e = errors || {};
  const selected = (d) => (v.domain_id ? v.domain_id === d.id : d.is_default) ? raw("selected") : "";
  return html`
<div class="field">
  <label for="destination">Destino</label>
  <input id="destination" name="destination" type="url" inputmode="url" maxlength="2048" required
         placeholder="https://seusite.com/pagina-longa" value="${v.destination}" ${invalid("destination-err", e.destination)}>
  ${fieldError("destination-err", e.destination)}
</div>
<div class="field-row">
  <div class="field">
    <label for="domain_id">Domínio</label>
    <select id="domain_id" name="domain_id" ${invalid("domain-err", e.domain_id)}>
      ${domains.map((d) => html`<option value="${d.id}" ${selected(d)}>${d.full_name}</option>`)}
    </select>
    ${fieldError("domain-err", e.domain_id)}
  </div>
  <div class="field grow">
    <label for="slashtag">Final do link ${editing ? "" : html`<span class="muted">(opcional)</span>`}</label>
    <div class="input-prefix"><span aria-hidden="true">/</span>
      <input id="slashtag" name="slashtag" maxlength="50" autocomplete="off" spellcheck="false"
             placeholder="${editing ? "" : "gerado se vazio"}" value="${v.slashtag}" ${invalid("slashtag-err", e.slashtag)}>
    </div>
    ${fieldError("slashtag-err", e.slashtag)}
  </div>
</div>
<div class="field">
  <label for="title">Nome <span class="muted">(só você vê)</span></label>
  <input id="title" name="title" maxlength="200" placeholder="Ex.: Oferta – bio do Instagram" value="${v.title}">
</div>
<details class="utm" ${v.utm_source || v.utm_medium || v.utm_campaign ? raw("open") : ""}>
  <summary>Adicionar UTM</summary>
  <div class="field-row">
    <div class="field"><label for="utm_source">Origem</label><input id="utm_source" name="utm_source" maxlength="100" placeholder="instagram" value="${v.utm_source}"></div>
    <div class="field"><label for="utm_medium">Meio</label><input id="utm_medium" name="utm_medium" maxlength="100" placeholder="bio" value="${v.utm_medium}"></div>
    <div class="field"><label for="utm_campaign">Campanha</label><input id="utm_campaign" name="utm_campaign" maxlength="100" placeholder="black-friday" value="${v.utm_campaign}"></div>
  </div>
</details>
${geoFields(v, e)}`;
}

function geoSummary(codes) {
  const list = String(codes || "").split(",").filter(Boolean).map(countryName);
  return list.length <= 3 ? list.join(", ") : `${list.slice(0, 3).join(", ")} e mais ${list.length - 3}`;
}

export function linksView(c, { rows, total, q, domainFilter, domains, activeDomains, newId,
  formValues = {}, formErrors = {}, openDrawer = false }) {
  const shortUrl = (l) => `${c.scheme}://${l.domain_name}/${l.slashtag}`;
  const filters = total ? html`
<form class="filters" method="get" role="search">
  <label class="sr-only" for="q">Buscar links</label>
  <input id="q" name="q" type="search" placeholder="Buscar por nome, final ou destino" value="${q}">
  <label class="sr-only" for="domain">Filtrar por domínio</label>
  <select id="domain" name="domain" data-autosubmit>
    <option value="">Todos os domínios</option>
    ${domains.map((d) => html`<option value="${d.id}" ${d.id === domainFilter ? raw("selected") : ""}>${d.full_name}</option>`)}
  </select>
  <button class="btn btn-secondary" type="submit">Buscar</button>
  ${q || domainFilter ? html`<a class="btn btn-ghost" href="/links">Limpar</a>` : ""}
</form>` : "";

  let list;
  if (rows.length) {
    list = html`
<div class="card table-wrap">
<table class="links-table">
  <thead><tr><th scope="col">Link</th><th scope="col">Destino</th><th scope="col" class="num">Cliques</th><th scope="col">Criado</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
  <tbody>
  ${rows.map((l) => html`
    <tr class="${l.id === newId ? "is-new" : ""}" data-link-id="${l.id}">
      <td data-label="Link">
        ${l.title ? html`<div class="link-title">${l.title}</div>` : ""}
        ${l.geo_mode && l.geo_mode !== "off" ? html`<div class="hint">${l.geo_mode === "block" ? "Bloqueado em" : "Só funciona em"} ${geoSummary(l.geo_countries)}</div>` : ""}
        <div class="short-row">
          <a class="short-url" href="${shortUrl(l)}" target="_blank" rel="noopener">${l.domain_name}/${l.slashtag}</a>
          <button class="btn btn-ghost btn-xs" type="button" data-copy="${shortUrl(l)}" aria-label="Copiar ${l.domain_name}/${l.slashtag}">Copiar</button>
        </div>
      </td>
      <td data-label="Destino" class="dest"><span title="${l.destination}">${l.destination}</span></td>
      <td data-label="Cliques" class="num"><a href="/links/${l.id}" aria-label="Estatísticas de ${l.slashtag}: ${l.clicks} cliques">${l.clicks}</a></td>
      <td data-label="Criado" class="nowrap">${fmtDate(l.created_at)}</td>
      <td class="actions-cell"><div class="actions">
        <a class="btn btn-ghost btn-xs" href="/links/${l.id}" aria-label="Ver estatísticas de ${l.slashtag}">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Estatísticas</a>
        <a class="btn btn-secondary btn-xs" href="/links/${l.id}/edit" aria-label="Editar ${l.slashtag}">Editar</a>
        <form method="post" action="/links/${l.id}/delete" data-confirm="Apagar ${l.domain_name}/${l.slashtag}? Quem clicar nele vai ver “link não encontrado”.">
          ${csrfField(c)}
          <button class="btn btn-ghost btn-xs danger-text" type="submit" aria-label="Apagar ${l.slashtag}">Apagar</button>
        </form>
      </div></td>
    </tr>`)}
  </tbody>
</table>
</div>`;
  } else if (total) {
    list = html`<div class="empty card"><p>Nenhum link encontrado para essa busca.</p><a class="btn btn-secondary" href="/links">Ver todos</a></div>`;
  } else {
    list = html`<div class="empty card">
  <h2 class="h-lg">Crie seu primeiro link</h2>
  <p class="muted">Cole um endereço longo e receba um link curto no seu domínio. Você pode trocar o destino quando quiser, sem mudar o link.</p>
  <button class="btn btn-primary" type="button" data-open="new-link">Novo link</button>
</div>`;
  }

  return page({ ...c, section: "links" }, "Links", html`
<header class="page-head">
  <div><h1 class="h-xl">Links</h1><p class="muted">${total} ${total === 1 ? "link" : "links"}</p></div>
  <button class="btn btn-primary" type="button" data-open="new-link">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    Novo link
  </button>
</header>
${filters}
${list}
<dialog id="new-link" class="drawer" aria-labelledby="new-link-title" ${openDrawer ? raw("data-open-on-load") : ""}>
  <form method="post" action="/links" class="stack" novalidate>
    ${csrfField(c)}
    <div class="drawer-head">
      <h2 id="new-link-title" class="h-lg">Novo link</h2>
      <button class="btn btn-ghost btn-sm" type="button" data-close aria-label="Fechar">✕</button>
    </div>
    ${formErrors.form ? html`<p class="alert alert-error" role="alert">${formErrors.form}</p>` : ""}
    ${activeDomains.length ? "" : html`<p class="alert alert-error">Nenhum domínio ativo. Verifique um domínio primeiro.</p>`}
    ${linkFields(formValues, formErrors, activeDomains, false)}
    <label class="check"><input type="checkbox" name="copy" value="1" checked data-copy-after> Copiar o link depois de criar</label>
    <div class="drawer-foot">
      <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
      <button class="btn btn-primary" type="submit">Criar link</button>
    </div>
  </form>
</dialog>`);
}

export function editView(c, { link, values, errors, activeDomains }) {
  return page({ ...c, section: "links" }, `Editar ${link.slashtag}`, html`
<nav class="crumbs"><a href="/links">Links</a> <span aria-hidden="true">/</span> <span>${link.domain_name}/${link.slashtag}</span></nav>
<header class="page-head"><h1 class="h-xl">Editar link</h1></header>
<div class="card pad narrow">
  <p class="muted">Troque o destino quantas vezes quiser. Quem já tem o link, ou um QR impresso, passa a cair no novo endereço.</p>
  <form method="post" class="stack" novalidate>
    ${csrfField(c)}
    ${linkFields(values, errors, activeDomains, true)}
    <div class="row-end">
      <a class="btn btn-ghost" href="/links">Cancelar</a>
      <button class="btn btn-primary" type="submit">Salvar</button>
    </div>
  </form>
</div>`);
}

function breakdownCard(title, rows, total) {
  return html`<section class="card pad">
  <h2 class="h-lg">${title}</h2>
  ${rows.length ? html`<table class="simple"><tbody>${rows.map((r) => html`<tr><td>${r.label}</td><td class="num">${r.n}</td><td class="num muted">${total ? Math.round((r.n / total) * 100) : 0}%</td></tr>`)}</tbody></table>`
    : html`<p class="muted">Nada ainda.</p>`}
</section>`;
}

export function statsView(c, { link, days, peak, refs, bots, blocked = 0, last30, countries = [], devices = [], systems = [] }) {
  const su = `${c.scheme}://${link.domain_name}/${link.slashtag}`;
  const bars = days.map(([label, n], i) => {
    const h = n ? (n / peak) * 110 : 0;
    return html`<rect x="${i * 10 + 1}" y="${(115 - h).toFixed(1)}" width="8" height="${h > 0 ? h.toFixed(1) : 1}" class="${n ? "bar" : "bar-zero"}"><title>${label}: ${n}</title></rect>`;
  });
  return page({ ...c, section: "links" }, `Cliques em ${link.slashtag}`, html`
<nav class="crumbs">${link.kind === "page" ? html`<a href="/pages">Páginas</a>` : html`<a href="/links">Links</a>`} <span aria-hidden="true">/</span> <span>${link.domain_name}/${link.slashtag}</span></nav>
<header class="page-head">
  <div><h1 class="h-xl">${link.title || `${link.domain_name}/${link.slashtag}`}</h1><p class="muted dest-line">→ ${link.destination}</p></div>
  <div class="row-end">
    <button class="btn btn-secondary" type="button" data-copy="${su}">Copiar link</button>
    <a class="btn btn-primary" href="${link.kind === "page" ? `/pages/${link.id}/edit` : `/links/${link.id}/edit`}">Editar</a>
  </div>
</header>
<div class="stats-grid">
  <div class="card pad stat"><p class="stat-label">${link.kind === "page" ? "Visitas no total" : "Cliques no total"}</p><p class="stat-value">${link.clicks}</p></div>
  ${link.kind === "page" ? html`<div class="card pad stat"><p class="stat-label">Cliques no botão</p><p class="stat-value">${link.cta_clicks || 0}${link.clicks ? html` <span class="stat-small muted">${Math.round(((link.cta_clicks || 0) / link.clicks) * 100)}%</span>` : ""}</p></div>` : ""}
  <div class="card pad stat"><p class="stat-label">Últimos 30 dias</p><p class="stat-value">${last30}</p></div>
  <div class="card pad stat"><p class="stat-label">Último clique</p><p class="stat-value stat-small">${fmtDateTime(link.last_click_at)}</p></div>
</div>
<section class="card pad">
  <h2 class="h-lg">Cliques por dia</h2>
  ${last30 ? html`
  <svg class="bars" viewBox="0 0 300 120" preserveAspectRatio="none" role="img" aria-label="Cliques por dia nos últimos 30 dias">${bars}</svg>
  <div class="bars-axis"><span>${days[0][0]}</span><span>hoje</span></div>
  <table class="sr-only"><caption>Cliques por dia</caption><tbody>${days.map(([d, n]) => html`<tr><th scope="row">${d}</th><td>${n}</td></tr>`)}</tbody></table>`
    : html`<p class="muted">Ainda sem cliques nos últimos 30 dias.</p>`}
</section>
<div class="stats-grid">
  ${breakdownCard("Países", countries, link.clicks)}
  ${breakdownCard("Aparelho", devices, link.clicks)}
  ${breakdownCard("Sistema", systems, link.clicks)}
</div>
<section class="card pad">
  <h2 class="h-lg">De onde vieram</h2>
  <p class="hint">Instagram, WhatsApp e TikTok costumam não informar a origem: esses cliques aparecem como “Direto ou desconhecido”. Para separar canais, crie um link para cada lugar.</p>
  ${refs.length ? html`<table class="simple"><thead><tr><th scope="col">Origem</th><th scope="col" class="num">Cliques</th></tr></thead>
  <tbody>${refs.map((r) => html`<tr><td>${r.ref}</td><td class="num">${r.n}</td></tr>`)}</tbody></table>` : html`<p class="muted">Nada ainda.</p>`}
  ${blocked ? html`<p class="hint">${blocked} ${blocked === 1 ? "acesso de país bloqueado foi barrado e não entrou" : "acessos de países bloqueados foram barrados e não entraram"} na contagem.</p>` : ""}
  ${bots ? html`<p class="hint">${bots} ${bots === 1 ? "acesso de robôs e prévias de redes sociais não entrou" : "acessos de robôs e prévias de redes sociais não entraram"} na contagem.</p>` : ""}
</section>`);
}

export function domainsView(c, { domains, counts, error, value, panelHost }) {
  return page({ ...c, section: "domains" }, "Domínios", html`
<header class="page-head"><div><h1 class="h-xl">Domínios</h1><p class="muted">Os domínios onde seus links curtos funcionam.</p></div></header>
<div class="card table-wrap">
<table class="links-table">
  <thead><tr><th scope="col">Domínio</th><th scope="col">Status</th><th scope="col" class="num">Links</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
  <tbody>
  ${domains.map((d) => html`
  <tr>
    <td data-label="Domínio"><strong>${d.full_name}</strong>${d.type === "service" ? html`<div class="hint">Domínio do painel</div>` : ""}
      ${!d.active && d.last_check_error ? html`<p class="field-error">${d.last_check_error}</p>` : ""}
      ${d.active ? html`
      <form method="post" action="/domains/${d.id}/fallback" class="inline-form">
        ${csrfField(c)}
        <label class="hint" for="fb-${d.id}">Link que não existe leva para</label>
        <input id="fb-${d.id}" name="not_found_url" type="url" placeholder="https://seusite.com" value="${d.not_found_url}">
        <button class="btn btn-ghost btn-xs" type="submit">Salvar</button>
      </form>` : ""}
    </td>
    <td data-label="Status">
      ${d.active ? html`<span class="badge badge-success">Ativo</span>` : html`<span class="badge badge-warning">Aguardando</span>`}
      ${d.is_default ? html`<span class="badge badge-accent">Padrão</span>` : ""}
    </td>
    <td data-label="Links" class="num">${counts[d.id] || 0}</td>
    <td class="actions-cell"><div class="actions">
      ${!d.active ? html`<form method="post" action="/domains/${d.id}/verify">${csrfField(c)}<button class="btn btn-primary btn-xs" type="submit">Verificar</button></form>`
        : !d.is_default ? html`<form method="post" action="/domains/${d.id}/default">${csrfField(c)}<button class="btn btn-secondary btn-xs" type="submit">Tornar padrão</button></form>` : ""}
      ${d.type !== "service" ? html`<form method="post" action="/domains/${d.id}/delete" data-confirm="Remover ${d.full_name}?">${csrfField(c)}<button class="btn btn-ghost btn-xs danger-text" type="submit">Remover</button></form>` : ""}
    </div></td>
  </tr>`)}
  </tbody>
</table>
</div>
<section class="card pad narrow">
  <h2 class="h-lg">Conectar um domínio seu</h2>
  <ol class="steps">
    <li>Use um domínio só para links, ou um subdomínio como <code>go.seusite.com</code>. <strong>Não use o domínio do seu site</strong>: ele passaria a abrir este app no lugar do site.</li>
    <li>No painel da Cloudflare, abra <strong>Workers &amp; Pages → este app → Settings → Domains &amp; Routes → Add → Custom domain</strong> e digite o domínio. A Cloudflare cria o DNS e o HTTPS sozinha. O domínio precisa estar na sua conta Cloudflare.</li>
    <li>Adicione o mesmo domínio aqui embaixo e clique em <strong>Verificar</strong>. Se ainda não passar, espere um ou dois minutos: o certificado leva um tempo.</li>
  </ol>
  <form method="post" class="field-row" novalidate>
    ${csrfField(c)}
    <div class="field grow">
      <label for="domain">Domínio</label>
      <input id="domain" name="domain" placeholder="go.seusite.com" value="${value}" autocomplete="off" spellcheck="false" ${invalid("domain-err", error)}>
      ${fieldError("domain-err", error)}
    </div>
    <div class="field field-end"><button class="btn btn-primary" type="submit">Adicionar</button></div>
  </form>
  <p class="hint">Painel: ${panelHost}</p>
</section>`);
}

export function geoBlocked(assetVersion) {
  return html`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Aqui não</title>
<link rel="stylesheet" href="/static/tokens.css?v=${assetVersion}"><link rel="stylesheet" href="/static/app.css?v=${assetVersion}"></head>
<body class="auth"><main class="auth-card center">
<p class="geo-emoji" aria-hidden="true">👀</p>
<h1 class="h-lg">Oi, curioso! Aqui não.</h1>
</main></body></html>`.s;
}

// ------------------------------------------------------------- pages

export function pagesView(c, { rows }) {
  const url = (l) => `${c.scheme}://${l.domain_name}/${l.slashtag}`;
  return page({ ...c, section: "pages" }, "Páginas", html`
<header class="page-head">
  <div><h1 class="h-xl">Páginas</h1><p class="muted">Review, TSL e Presell no seu domínio, com o botão indo para o seu link de afiliado.</p></div>
</header>
<div class="template-grid">
  ${Object.entries(TEMPLATES).map(([key, t]) => html`
  <div class="card pad template-card">
    <span class="h-lg">${t.label}</span>
    <span class="muted">${t.hint}</span>
    <div class="row">
      <a class="btn btn-primary btn-sm" href="/pages/ai?template=${key}">✨ Criar ${t.label} com IA</a>
      <a class="btn btn-ghost btn-sm" href="/pages/new?template=${key}">Criar ${t.label} sem IA</a>
    </div>
  </div>`)}
</div>
${rows.length ? html`
<div class="card table-wrap">
<table class="links-table">
  <thead><tr><th scope="col">Página</th><th scope="col">Modelo</th><th scope="col" class="num">Visitas</th><th scope="col" class="num">Cliques no botão</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
  <tbody>
  ${rows.map((l) => html`
  <tr class="${l.id === c.newId ? "is-new" : ""}">
    <td data-label="Página">
      <div class="link-title">${l.title || l.slashtag}</div>
      <div class="short-row">
        <a class="short-url" href="${url(l)}" target="_blank" rel="noopener">${l.domain_name}/${l.slashtag}</a>
        <button class="btn btn-ghost btn-xs" type="button" data-copy="${url(l)}" aria-label="Copiar ${l.domain_name}/${l.slashtag}">Copiar</button>
      </div>
    </td>
    <td data-label="Modelo">${TEMPLATES[l.template]?.label || "—"}</td>
    <td data-label="Visitas" class="num">${l.clicks}</td>
    <td data-label="Cliques no botão" class="num">${l.cta_clicks || 0}${l.clicks ? html` <span class="muted">(${Math.round(((l.cta_clicks || 0) / l.clicks) * 100)}%)</span>` : ""}</td>
    <td class="actions-cell"><div class="actions">
      <a class="btn btn-ghost btn-xs" href="/links/${l.id}" aria-label="Ver estatísticas de ${l.slashtag}">Estatísticas</a>
      <a class="btn btn-secondary btn-xs" href="/pages/${l.id}/edit" aria-label="Editar página ${l.slashtag}">Editar</a>
      <form method="post" action="/links/${l.id}/delete" data-confirm="Apagar a página ${l.domain_name}/${l.slashtag}?">
        ${csrfField(c)}
        <button class="btn btn-ghost btn-xs danger-text" type="submit" aria-label="Apagar página ${l.slashtag}">Apagar</button>
      </form>
    </div></td>
  </tr>`)}
  </tbody>
</table>
</div>` : html`<div class="empty card"><p class="muted">Nenhuma página ainda. Escolha um modelo acima para criar a primeira.</p></div>`}`);
}

function textField(name, label, v, e, { hint = "", rows = 0, max = 0, placeholder = "", required = false } = {}) {
  const id = `f-${name}`;
  const common = html`id="${id}" name="${name}" ${max ? raw(`maxlength="${max}"`) : ""} placeholder="${placeholder}" ${required ? raw("required") : ""} ${invalid(id + "-err", e[name])}`;
  return html`<div class="field">
  <label for="${id}">${label}</label>
  ${rows ? html`<textarea ${common} rows="${rows}">${v[name] || ""}</textarea>` : html`<input ${common} value="${v[name] || ""}">`}
  ${e[name] ? fieldError(id + "-err", e[name]) : hint ? html`<p class="hint">${hint}</p>` : ""}
</div>`;
}

const RICH_HINT = "Linha em branco = novo parágrafo. ## Título, - item de lista, **negrito**, ![](https://imagem) e [[BOTAO]] para colocar um botão no meio do texto.";

export function pageEditorView(c, { template, link, values, errors, activeDomains, isNew }) {
  const v = values || {};
  const e = errors || {};
  const t = TEMPLATES[template];
  const sel = (a, b) => (a === b ? raw("selected") : "");
  const specific = template === "review" ? html`
    ${textField("product_name", "Nome do produto", v, e, { max: 100, required: true })}
    ${textField("rating", "Sua nota (0 a 5)", v, e, { max: 3, placeholder: "4.5", hint: "Opcional. É a sua avaliação; aparece em estrelas." })}
    ${textField("intro", "Introdução", v, e, { rows: 4, max: 4000, hint: RICH_HINT })}
    <div class="field-row">
      ${textField("pros", "Pontos positivos (um por linha)", v, e, { rows: 5, max: 2000 })}
      ${textField("cons", "Pontos negativos (um por linha)", v, e, { rows: 5, max: 2000 })}
    </div>
    ${textField("body", "Análise completa", v, e, { rows: 12, max: 30000, hint: RICH_HINT })}
    ${textField("verdict", "Veredito", v, e, { rows: 4, max: 4000 })}
    ${textField("faq", "Perguntas frequentes", v, e, { rows: 6, max: 8000, hint: "Separe cada pergunta com uma linha em branco: primeira linha é a pergunta, as seguintes, a resposta." })}`
    : template === "tsl" ? html`
    ${textField("body", "Texto da carta de vendas", v, e, { rows: 22, max: 60000, required: true, hint: RICH_HINT })}
    ${textField("guarantee", "Garantia", v, e, { rows: 4, max: 3000, placeholder: "Ex.: 60 dias de garantia: se não gostar, devolvemos seu dinheiro." })}
    ${textField("faq", "Perguntas frequentes", v, e, { rows: 6, max: 8000, hint: "Separe cada pergunta com uma linha em branco: primeira linha é a pergunta, as seguintes, a resposta." })}
    ${textField("ps", "P.S.", v, e, { rows: 3, max: 3000 })}`
    : html`
    ${textField("body", "Texto", v, e, { rows: 8, max: 8000, hint: RICH_HINT })}
    ${textField("video", "Vídeo (opcional)", v, e, { max: 2048, placeholder: "https://www.youtube.com/watch?v=…", hint: "YouTube ou Vimeo. Se tiver vídeo, ele aparece no lugar da imagem." })}`;

  return page({ ...c, section: "pages" }, `${isNew ? "Nova página" : "Editar página"} ${t.label}`, html`
<nav class="crumbs"><a href="/pages">Páginas</a> <span aria-hidden="true">/</span> <span>${isNew ? `Nova ${t.label}` : `${link.domain_name}/${link.slashtag}`}</span></nav>
<header class="page-head">
  <h1 class="h-xl">${isNew ? `Nova página ${t.label}` : `Editar página ${t.label}`}</h1>
  ${!isNew ? html`<a class="btn btn-secondary" href="${c.scheme}://${link.domain_name}/${link.slashtag}" target="_blank" rel="noopener">Ver página</a>` : ""}
</header>
<form method="post" action="${isNew ? "/pages/new" : `/pages/${link.id}/edit`}" class="card pad narrow stack" novalidate>
  ${csrfField(c)}
  <input type="hidden" name="template" value="${template}">
  ${e.form ? html`<p class="alert alert-error" role="alert">${e.form}</p>` : ""}
  ${c.aiNotice ? html`<p class="alert alert-info" role="status">✨ Texto escrito pela IA a partir das informações que você deu. Leia, ajuste o que quiser e clique em <strong>Publicar página</strong>.${c.aiNotice !== true ? html` ${c.aiNotice}` : ""}</p>` : ""}
  <h2 class="h-lg">Endereço e botão</h2>
  <div class="field-row">
    <div class="field">
      <label for="domain_id">Domínio</label>
      <select id="domain_id" name="domain_id" ${invalid("domain-err", e.domain_id)}>
        ${activeDomains.map((d) => html`<option value="${d.id}" ${(v.domain_id ? v.domain_id === d.id : d.is_default) ? raw("selected") : ""}>${d.full_name}</option>`)}
      </select>
      ${fieldError("domain-err", e.domain_id)}
    </div>
    <div class="field grow">
      <label for="slashtag">Final do endereço ${isNew ? html`<span class="muted">(opcional)</span>` : ""}</label>
      <div class="input-prefix"><span aria-hidden="true">/</span>
        <input id="slashtag" name="slashtag" maxlength="50" autocomplete="off" spellcheck="false" placeholder="${isNew ? "gerado se vazio" : ""}" value="${v.slashtag}" ${invalid("slashtag-err", e.slashtag)}>
      </div>
      ${fieldError("slashtag-err", e.slashtag)}
    </div>
  </div>
  <div class="field">
    <label for="destination">Link do botão (seu link de afiliado)</label>
    <input id="destination" name="destination" type="url" maxlength="2048" required placeholder="https://…" value="${v.destination}" ${invalid("destination-err", e.destination)}>
    ${fieldError("destination-err", e.destination)}
  </div>
  <div class="field-row">
    ${textField("cta_text", "Texto do botão", v, e, { max: 60 })}
    <div class="field"><label for="accent">Cor</label>
      <select id="accent" name="accent">${Object.entries(ACCENTS).map(([k, label]) => html`<option value="${k}" ${sel(v.accent || "green", k)}>${label}</option>`)}</select></div>
    <div class="field"><label for="lang">Idioma da página</label>
      <select id="lang" name="lang">${Object.entries(LANGS).map(([k, label]) => html`<option value="${k}" ${sel(v.lang || "en", k)}>${label}</option>`)}</select></div>
  </div>

  <h2 class="h-lg">Conteúdo</h2>
  ${textField("headline", "Título principal", v, e, { max: 200, required: true })}
  ${textField("subheadline", "Subtítulo", v, e, { rows: 2, max: 400 })}
  ${textField("image", "Imagem principal (endereço)", v, e, { max: 2048, placeholder: "https://…/imagem.jpg", hint: "Cole o link de uma imagem já publicada (por exemplo, a do seu site ou do produtor)." })}
  ${specific}

  <h2 class="h-lg">Rodapé e aviso</h2>
  ${textField("notice", "Selo no topo (opcional)", v, e, { max: 60, placeholder: "Ex.: Publicidade", hint: "Uma faixa discreta no topo da página. Deixe vazio para não mostrar." })}
  ${textField("disclosure", "Aviso de afiliado", v, e, { rows: 3, max: 600, hint: "Recomendado: dizer que você pode ganhar comissão. Muitas plataformas e leis de publicidade exigem." })}

  ${geoFields(v, e)}
  <div class="row-end">
    <a class="btn btn-ghost" href="/pages">Cancelar</a>
    <button class="btn btn-primary" type="submit">${isNew ? "Publicar página" : "Salvar"}</button>
  </div>
</form>`);
}

export function aiFormView(c, { template, values, errors }) {
  const v = values || {};
  const e = errors || {};
  const t = TEMPLATES[template];
  return page({ ...c, section: "pages" }, `${t.label} com IA`, html`
<nav class="crumbs"><a href="/pages">Páginas</a> <span aria-hidden="true">/</span> <span>${t.label} com IA</span></nav>
<header class="page-head"><div><h1 class="h-xl">Criar ${t.label} com IA</h1>
<p class="muted">Preencha o básico. A IA escreve a página inteira e você revisa antes de publicar.</p></div></header>
<form method="post" class="card pad narrow stack" novalidate data-ai-form>
  ${csrfField(c)}
  <input type="hidden" name="template" value="${template}">
  ${e.form ? html`<p class="alert alert-error" role="alert">${e.form}</p>` : ""}
  ${textField("product_name", "Nome do produto", v, e, { max: 100, required: true, placeholder: "Ex.: SodaPeak" })}
  <div class="field">
    <label for="destination">Seu link de afiliado</label>
    <input id="destination" name="destination" type="url" maxlength="2048" required placeholder="https://…" value="${v.destination}" ${invalid("destination-err", e.destination)}>
    ${fieldError("destination-err", e.destination)}
  </div>
  ${textField("product_url", "Página oficial do produto (recomendado)", v, e, { max: 2048, placeholder: "https://site-oficial-do-produto.com", hint: "A IA lê essa página para usar só informações reais do produto. Sem ela, o texto fica mais genérico." })}
  ${textField("notes", "Observações (opcional)", v, e, { rows: 4, max: 3000, placeholder: "Ex.: público mulheres 40+, destacar garantia de 60 dias, tom mais emocional, mencionar frete grátis.", hint: "Informações extras sobre o produto, a oferta ou o tom. A IA não inventa nada além do que estiver aqui e na página oficial." })}
  <div class="field"><label for="lang">Idioma da página</label>
    <select id="lang" name="lang">${Object.entries(LANGS).map(([k, label]) => html`<option value="${k}" ${(v.lang || "en") === k ? raw("selected") : ""}>${label}</option>`)}</select></div>
  <p class="hint">A IA não cria depoimentos, números, estudos, preços ou promessas de resultado que não estejam nas informações acima. Revise sempre antes de publicar.</p>
  <div class="row-end">
    <a class="btn btn-ghost" href="/pages">Cancelar</a>
    <button class="btn btn-primary" type="submit" data-busy-text="Escrevendo a página… (até 1 minuto)">✨ Gerar página</button>
  </div>
</form>`);
}
