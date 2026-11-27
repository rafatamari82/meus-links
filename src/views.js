// HTML views. Every interpolated value is escaped unless wrapped in raw().
import { countryName, countryOptions } from "./core.js";
import { LINK_SOURCES, NETWORKS, SOURCES } from "./tracker.js";

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(s);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const render = (v) =>
  v instanceof Raw ? v.s : Array.isArray(v) ? v.map(render).join("") : v === false || v == null ? "" : esc(v);
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Raw(out);
}

const TZ = "America/Sao_Paulo";
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)).replace(",", "") : "—");

const ICON = raw('<img class="brand-logo" src="/static/gr-64.png" alt="" width="28" height="28">');
export const csrfField = (c) => html`<input type="hidden" name="csrf" value="${c.csrf}">`;

function head(title, assetVersion) {
  return html`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title} · Gringa Ads</title>
  <link rel="manifest" href="/static/manifest.webmanifest?v=${assetVersion}">
  <meta name="theme-color" content="#03384b">
  <link rel="apple-touch-icon" href="/static/gr-apple-180.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Gringa Ads">
  <link rel="stylesheet" href="/static/tokens.css?v=${assetVersion}">
  <link rel="stylesheet" href="/static/app.css?v=${assetVersion}">
  <link rel="icon" href="/static/gr-64.png" type="image/png">
  <script src="/static/app.js?v=${assetVersion}" defer></script>
</head>`;
}

function flashes(c) {
  if (!c.flashes?.length) return "";
  return html`<div class="toasts" role="status">${c.flashes.map(([cat, msg]) => html`<div class="toast toast-${cat}">${msg}</div>`)}</div>`;
}

export function page(c, title, body) {
  const nav = (href, label, active, icon) =>
    html`<a href="${href}" class="nav-item ${active ? "is-current" : ""}" ${active ? raw('aria-current="page"') : ""}>${icon || ""}<span>${label}</span></a>`;
  return html`${head(title, c.assetVersion)}
<body class="panel">
<div class="shell">
  <aside class="sidebar" aria-label="Navegação">
    ${c.section === "results" ? html`<span class="topbar-title" aria-hidden="true">Dashboard</span>` : ""}
    <a class="brand ${c.section === "results" ? "brand-dash" : ""}" href="/results">${ICON}<span class="brand-name">Gringa Ads</span><img class="brand-wordmark" src="/static/gr-wordmark.png?v=${c.assetVersion}" alt="Gringa Ads"></a>
    <nav>${nav("/results", "Resumo", c.section === "results", TAB_ICONS.home)}${nav("/sales", "Vendas", c.section === "sales", TAB_ICONS.list)}${nav("/links", "Encurtador de Link", c.section === "links", TAB_ICONS.link)}${nav("/tracking", "Trackeamento", c.section === "tracking", TAB_ICONS.target)}${nav("/integrations", "Avisos e moeda", c.section === "integrations", TAB_ICONS.bell)}${nav("/domains", "Domínios", c.section === "domains", TAB_ICONS.globe)}${nav("/settings", "Ajustes", c.section === "settings", TAB_ICONS.gear)}</nav>
    <form method="post" action="/logout" class="sidebar-foot">${csrfField(c)}<button class="btn btn-ghost btn-sm" type="submit">Sair</button></form>
  </aside>
  <main class="main" id="main">${flashes(c)}${body}</main>
</div>
<nav class="tabbar" aria-label="Navegação principal">
  ${tabItem("/results", "Resumo", TAB_ICONS.home, c.section === "results")}
  ${tabItem("/sales", "Vendas", TAB_ICONS.list, c.section === "sales")}
  ${tabItem("/links", "Links", TAB_ICONS.link, c.section === "links")}
  ${tabItem("/settings", "Ajustes", TAB_ICONS.gear, ["settings", "integrations", "domains", "tracking"].includes(c.section))}
</nav>
<div class="sr-only" aria-live="polite" id="live"></div>
</body></html>`.s;
}

// Bottom tab bar on phones. Icons drawn for this app (simple strokes).
const svg = (d) => raw(`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
const TAB_ICONS = {
  home: svg('<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/><path d="M10 19v-5h4v5"/>'),
  list: svg('<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.5" cy="7" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17" r="1"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'),
};
function tabItem(href, label, icon, active) {
  return html`<a href="${href}" class="tab-item ${active ? "is-current" : ""}" ${active ? raw('aria-current="page"') : ""}>${icon}<span>${label}</span></a>`;
}

function authPage(c, title, body) {
  return html`${head(title, c.assetVersion)}
<body class="auth"><main class="auth-card" id="main">
  <div class="brand brand-center">${ICON}<span>Gringa Ads</span></div>
  ${body}
</main></body></html>`.s;
}

export const fieldError = (id, msg) => (msg ? html`<p class="field-error" id="${id}">${msg}</p>` : "");
export const invalid = (id, msg) => (msg ? raw(`aria-invalid="true" aria-describedby="${id}"`) : "");

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
<details class="utm geo" ${mode !== "off" || e.geo || v.block_vpn ? raw("open") : ""}>
  <summary>Países ${mode === "off" ? "" : html`<span class="badge badge-warning">${mode === "block" ? "bloqueando" : "só liberados"}: ${chosen.size}</span>`}${v.block_vpn ? html` <span class="badge badge-warning">sem VPN</span>` : ""}</summary>
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
  <label class="check vpn-check"><input type="checkbox" name="block_vpn" value="1" ${v.block_vpn ? raw("checked") : ""}>
    <span>Barrar VPN e proxies<span class="hint">Quem usa VPN para fingir estar em outro país vê a mesma página de bloqueio. Pega a maioria das VPNs comerciais, não todas.</span></span></label>
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
${geoFields(v, e)}
${trackFields(v, e)}`;
}

function trackFields(v, e) {
  const on = v.track === "1" || v.track === 1;
  const net = v.network || "clickbank";
  return html`
<details class="utm track" ${on || e.sub_param ? raw("open") : ""}>
  <summary>Rastrear vendas ${on ? html`<span class="badge badge-accent">${NETWORKS[net]?.name || net}</span>` : ""}</summary>
  <label class="check"><input type="checkbox" name="track" value="1" ${on ? raw("checked") : ""}> Gerar um código por clique e mandar para a rede</label>
  <div class="field-row">
    <div class="field">
      <label for="network">Rede ou plataforma</label>
      <select id="network" name="network" data-network>
        ${Object.entries(NETWORKS).map(([k, n]) => html`<option value="${k}" data-param="${n.param}" ${k === net ? raw("selected") : ""}>${n.name}</option>`)}
      </select>
    </div>
    <div class="field">
      <label for="sub_param">Parâmetro do código</label>
      <input id="sub_param" name="sub_param" maxlength="40" spellcheck="false" value="${v.sub_param || NETWORKS[net]?.param || ""}" ${invalid("sub-err", e.sub_param)}>
      ${fieldError("sub-err", e.sub_param)}
    </div>
  </div>
  <div class="field">
    <label for="track_source">De onde vem o clique</label>
    <select id="track_source" name="track_source">
      ${LINK_SOURCES.map((k) => html`<option value="${k}" ${(v.track_source || "ads") === k ? raw("selected") : ""}>${k === "ads" ? "Anúncio (Google Ads ou NewsBreak, pelo modelo de rastreamento)" : SOURCES[k]}</option>`)}
    </select>
    <p class="hint">Para orgânico, crie um link por vídeo ou post e dê a ele o nome do vídeo no campo Nome: é esse nome que aparece em Resultados.</p>
  </div>
  <p class="hint">Se o destino é uma presell, deixe o parâmetro e cole o script de Integrações na presell.</p>
</details>`;
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
        ${l.track ? html`<div class="hint"><span class="badge badge-accent">Rastreado · ${NETWORKS[l.network]?.name || l.network}${l.track_source && l.track_source !== "ads" ? ` · ${SOURCES[l.track_source]}` : ""}</span></div>` : ""}
        ${l.geo_mode && l.geo_mode !== "off" ? html`<div class="hint">${l.geo_mode === "block" ? "Bloqueado em" : "Só funciona em"} ${geoSummary(l.geo_countries)}${l.block_vpn ? " · sem VPN" : ""}</div>` : l.block_vpn ? html`<div class="hint">Sem VPN</div>` : ""}
        <div class="short-row">
          <a class="short-url" href="${shortUrl(l)}" target="_blank" rel="noopener">${l.domain_name}/${l.slashtag}</a>
          <button class="btn btn-ghost btn-xs" type="button" data-copy="${shortUrl(l)}" aria-label="Copiar ${l.domain_name}/${l.slashtag}">Copiar</button>
        </div>
      </td>
      <td data-label="Destino" class="dest"><span title="${l.destination}">${l.destination}</span></td>
      <td data-label="Cliques" class="num"><a href="/links/${l.id}" aria-label="Estatísticas de ${l.slashtag}: ${l.clicks} cliques">${l.clicks}</a></td>
      <td data-label="Criado" class="nowrap">${fmtDate(l.created_at)}</td>
      <td class="actions-cell"><div class="actions">
        <a class="btn btn-secondary btn-xs" href="/links/${l.id}" aria-label="Ver estatísticas de ${l.slashtag}">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Ver estatísticas</a>
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

  return page({ ...c, section: "links" }, "Encurtador de Link", html`
<header class="page-head">
  <div><h1 class="h-xl">Encurtador de Link</h1><p class="muted">${total} ${total === 1 ? "link" : "links"}</p></div>
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
<nav class="crumbs"><a href="/links">Encurtador de Link</a> <span aria-hidden="true">/</span> <span>${link.domain_name}/${link.slashtag}</span></nav>
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

export function statsView(c, { link, days, peak, refs, bots, blocked = 0, blockedList = [], ipBlockedHits = 0, myBlocks = new Set(), robotsBlocked = 0, vpnBlocked = 0, robots = [], last30, countries = [], devices = [], systems = [] }) {
  const su = `${c.scheme}://${link.domain_name}/${link.slashtag}`;
  const bars = days.map(([label, n], i) => {
    const h = n ? (n / peak) * 110 : 0;
    return html`<rect x="${i * 10 + 1}" y="${(115 - h).toFixed(1)}" width="8" height="${h > 0 ? h.toFixed(1) : 1}" class="${n ? "bar" : "bar-zero"}"><title>${label}: ${n}</title></rect>`;
  });
  return page({ ...c, section: "links" }, `Cliques em ${link.slashtag}`, html`
<nav class="crumbs"><a href="/links">Encurtador de Link</a> <span aria-hidden="true">/</span> <span>${link.domain_name}/${link.slashtag}</span></nav>
<header class="page-head">
  <div><h1 class="h-xl">${link.title || `${link.domain_name}/${link.slashtag}`}</h1><p class="muted dest-line">→ ${link.destination}</p></div>
  <div class="row-end">
    <button class="btn btn-secondary" type="button" data-copy="${su}">Copiar link</button>
    <a class="btn btn-primary" href="/links/${link.id}/edit">Editar</a>
  </div>
</header>
<div class="stats-grid">
  <div class="card pad stat"><p class="stat-label">Cliques no total</p><p class="stat-value">${link.clicks}</p></div>
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
  ${ipBlockedHits ? html`<p class="hint">${ipBlockedHits} ${ipBlockedHits === 1 ? "acesso de IP bloqueado foi barrado" : "acessos de IPs bloqueados foram barrados"}.</p>` : ""}
  ${vpnBlocked ? html`<p class="hint">${vpnBlocked} ${vpnBlocked === 1 ? "acesso por VPN foi barrado" : "acessos por VPN foram barrados"}.</p>` : ""}
  ${robotsBlocked ? html`<p class="hint">${robotsBlocked} ${robotsBlocked === 1 ? "acesso de robô foi barrado" : "acessos de robôs foram barrados"} pelo filtro anti-robô.</p>` : ""}
  ${bots ? html`<p class="hint">${bots} ${bots === 1 ? "acesso de robôs e prévias de redes sociais não entrou" : "acessos de robôs e prévias de redes sociais não entraram"} na contagem.</p>` : ""}
</section>
${blockedList.length ? html`<section class="card table-wrap robots">
  <h2 class="h-md pad-x">Acessos bloqueados</h2>
  <p class="hint pad-x">Quem abriu o link de um país ou IP bloqueado e viu a página “Oi Curioso!”. Não conta como clique.</p>
  <table class="simple"><thead><tr><th scope="col">Quando</th><th scope="col">IP</th><th scope="col">Local</th><th scope="col">Internet</th><th scope="col">Aparelho</th><th scope="col">Motivo</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
  <tbody>${blockedList.map((r) => html`<tr>
    <td data-label="Quando">${fmtDateTime(r.at)}</td>
    <td data-label="IP" class="mono">${r.ip || "—"}</td>
    <td data-label="Local">${[r.city, r.region, r.country ? countryName(r.country) : "País desconhecido"].filter(Boolean).join(", ")}</td>
    <td data-label="Internet">${r.as_org || "—"}</td>
    <td data-label="Aparelho">${[r.device, r.os].filter(Boolean).join(" · ") || "—"}</td>
    <td data-label="Motivo">${r.blocked === 4 ? html`<span class="badge badge-warning">IP bloqueado</span>` : html`<span class="badge">País</span>`}</td>
    <td class="actions-cell">${ipButton(c, r.ip, myBlocks, link.id)}</td>
  </tr>`)}</tbody></table>
  <p class="hint pad-x">A cidade vem da localização aproximada do IP e pode errar por algumas dezenas de km. Os acessos de antes desta mudança aparecem sem IP e cidade.</p>
</section>` : ""}
${robots.length ? html`<section class="card table-wrap robots">
  <h2 class="h-md pad-x">Acessos de robôs e VPN</h2>
  <p class="hint pad-x">Os últimos ${robots.length}. O IP e o local são guardados só de robôs, VPNs e acessos bloqueados; de quem passa, nunca.</p>
  <table class="simple robot-table"><thead><tr><th scope="col">Quando</th><th scope="col">IP</th><th scope="col">Local</th><th scope="col">Rede</th><th scope="col">Situação</th><th scope="col">Navegador</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
  <tbody>${robots.map((r) => html`<tr>
    <td data-label="Quando">${fmtDateTime(r.at)}</td>
    <td data-label="IP" class="mono">${r.ip || "—"}</td>
    <td data-label="Local">${[r.city, r.region, r.country && countryName(r.country)].filter(Boolean).join(", ") || "—"}</td>
    <td data-label="Rede">${r.as_org || "—"}${r.asn ? html` <span class="hint">AS${r.asn}</span>` : ""}</td>
    <td data-label="Situação">${r.blocked === 2 ? html`<span class="badge badge-warning">Barrado</span>` : r.blocked === 3 ? html`<span class="badge badge-warning">VPN barrada</span>` : html`<span class="badge">Liberado</span>`}</td>
    <td data-label="Navegador" class="ua-cell" title="${r.user_agent || ""}">${(r.user_agent || "(vazio)").slice(0, 60)}${(r.user_agent || "").length > 60 ? "…" : ""}</td>
    <td class="actions-cell">${ipButton(c, r.ip, myBlocks, link.id)}</td>
  </tr>`)}</tbody></table>
  <p class="hint pad-x">Liberado: robôs do Google, NewsBreak e prévias de redes sociais (ou o filtro estava desligado). Não contam como clique.</p>
</section>` : ""}`);
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

// "Bloquear este IP" / "Desbloquear" button for a row of the access tables.
function ipButton(c, ip, blocks, linkId) {
  if (!ip || ip === "local") return "";
  const on = blocks.has(ip);
  return html`<form method="post" action="/ip-blocks" ${on ? "" : raw('data-confirm="Bloquear este IP em todos os seus links? Em internet de celular, o mesmo IP pode ser de várias pessoas."')}>
    ${csrfField(c)}<input type="hidden" name="ip" value="${ip}"><input type="hidden" name="back" value="/links/${linkId}">
    ${on ? html`<input type="hidden" name="action" value="unblock"><button class="btn btn-ghost btn-xs" type="submit">Desbloquear</button>`
      : html`<button class="btn btn-secondary btn-xs" type="submit">Bloquear IP</button>`}
  </form>`;
}

export function geoBlocked(assetVersion) {
  return html`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Aqui não</title>
<link rel="stylesheet" href="/static/tokens.css?v=${assetVersion}"><link rel="stylesheet" href="/static/app.css?v=${assetVersion}"></head>
<body class="geo-blocked"><main class="geo-main">
<h1><img class="geo-banner" src="/static/oi-curioso.png?v=${assetVersion}" alt="Oi, curioso!"></h1>
<img class="geo-mico" src="/static/mico.svg?v=${assetVersion}" alt="">
</main></body></html>`.s;
}
